import { GoogleGenAI, ThinkingLevel } from '@google/genai';

/**
 * Cliente único de Gemini para todo el servidor.
 *
 * Modelos: GEMINI_MODEL (por defecto gemini-3.8-flash, estable) y GEMINI_FALLBACK_MODELS
 * (lista separada por comas) para conmutar si el principal no existe o está saturado.
 * Los modelos Gemini 3 no admiten thinkingBudget: 0 junto a thinkingLevel y recomiendan
 * temperatura por defecto, así que aquí se usa thinkingLevel LOW y no se fija temperatura.
 */

const DEFAULT_MODEL = 'gemini-3.8-flash';
// Cada modelo tiene su propia cuota: si uno se agota, el siguiente sigue leyendo
const DEFAULT_FALLBACKS = ['gemini-3-flash-preview', 'gemini-3.5-flash'];
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90_000;

/**
 * Regulador global: limita las llamadas simultáneas a Gemini y, cuando Gemini responde 429
 * (límite por minuto), pausa TODAS las llamadas el tiempo que indique en vez de que cada
 * factura insista por su cuenta y agote la cuota aún más.
 */
const MAX_CONCURRENT = Math.max(1, Number(process.env.GEMINI_MAX_CONCURRENT) || 2);
let activeCalls = 0;
const waiters: Array<() => void> = [];
let pausedUntil = 0;

async function acquireSlot(): Promise<void> {
  for (;;) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (activeCalls < MAX_CONCURRENT) {
      activeCalls++;
      return;
    }
    await new Promise<void>((r) => waiters.push(r));
  }
}

function releaseSlot() {
  activeCalls = Math.max(0, activeCalls - 1);
  waiters.shift()?.();
}

function pauseAll(ms: number) {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined;

export function getGenAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
    cachedKey = apiKey;
  }
  return cachedClient;
}

export function getModelChain(preferred?: string): string[] {
  const primary = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACKS.join(','))
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const chain = Array.from(new Set([primary, ...fallbacks]));
  // El navegador puede pedir un modelo concreto, pero solo se respeta si está configurado aquí
  // (evita llamadas a modelos inexistentes o retirados que solo añaden latencia).
  if (preferred && chain.includes(preferred)) return [preferred, ...chain.filter((m) => m !== preferred)];
  return chain;
}

// Modelos que devolvieron 404 o cuota agotada: se saltan hasta que expire el enfriamiento
const modelCooldown = new Map<string, number>();
// Modelos sin cupo diario. Se vuelven a probar cada 15 min (por si se activa facturación) o tras el reinicio diario
const dailyExhausted = new Map<string, number>();
const DAILY_RECHECK_MS = 15 * 60_000;

/** Próximo reinicio del cupo gratuito de Gemini (medianoche hora del Pacífico). */
export function nextQuotaReset(from = new Date()): Date {
  const pt = new Date(from.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const offsetMs = from.getTime() - pt.getTime();
  const midnightPt = new Date(pt);
  midnightPt.setHours(24, 0, 0, 0);
  return new Date(midnightPt.getTime() + offsetMs);
}

/** Hora del reinicio en Colombia, p. ej. "2:00 a. m.". */
export function quotaResetLabel(from = new Date()): string {
  return nextQuotaReset(from).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
}

/** Error que indica que TODOS los modelos agotaron el cupo diario: no tiene sentido reintentar hoy. */
export class DailyQuotaError extends Error {
  readonly dailyQuota = true;
  readonly status = 429;
  constructor(public cause?: any) {
    super(
      `Se agotó el cupo diario gratuito de Gemini. Se renueva hoy a las ${quotaResetLabel()} (hora Colombia). ` +
        'Las facturas quedan pendientes para leerlas después, o activa la facturación de la clave de Gemini para seguir ahora.'
    );
    this.name = 'DailyQuotaError';
  }
}

export function isDailyQuotaError(err: any): boolean {
  return !!(err?.dailyQuota || err?.cause?.dailyQuota);
}

function errorStatus(err: any): number {
  const raw = err?.status ?? err?.code ?? err?.error?.code ?? err?.response?.status;
  const n = Number(raw);
  if (!isNaN(n) && n > 0) return n;
  const msg = String(err?.message || err || '');
  const m = msg.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
  if (m) return Number(m[1]);
  if (/RESOURCE_EXHAUSTED|quota/i.test(msg)) return 429;
  if (/UNAVAILABLE|overloaded|high demand/i.test(msg)) return 503;
  if (/NOT_FOUND/i.test(msg)) return 404;
  if (/timed? ?out|aborted|ETIMEDOUT|ECONNRESET/i.test(msg)) return 408;
  return 0;
}

export function isTransientError(err: any): boolean {
  const s = errorStatus(err);
  return s === 408 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
}

export interface GeminiCallResult {
  success: boolean;
  text?: string;
  error?: any;
  modelUsed?: string;
  durationMs: number;
}

/**
 * Llama a Gemini con reintentos (backoff exponencial ante 429/5xx/timeout) y
 * conmutación de modelo ante 404 o cuota agotada. `config` es el GenerateContentConfig;
 * cualquier temperature/thinkingConfig heredado se reemplaza por los ajustes de Gemini 3.
 */
export async function callGemini(
  contents: any,
  config: Record<string, any>,
  opts: { task?: string; preferredModel?: string; maxAttemptsPerModel?: number } = {}
): Promise<GeminiCallResult> {
  const start = Date.now();
  const ai = getGenAI();
  if (!ai) {
    return {
      success: false,
      error: new Error('GEMINI_API_KEY no está configurada. Añádela al archivo .env y reinicia el servidor.'),
      durationMs: 0,
    };
  }

  const { temperature: _t, thinkingConfig: _tc, ...rest } = config || {};
  const finalConfig = { ...rest, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };

  const task = opts.task || 'Inferencia IA';
  const maxAttempts = opts.maxAttemptsPerModel ?? 4;
  const chain = getModelChain(opts.preferredModel);
  const now = Date.now();
  const allDailyExhausted = () => chain.every((m) => (dailyExhausted.get(m) || 0) > Date.now());
  // Sin cupo diario en ningún modelo: responder al instante en vez de gastar minutos reintentando
  if (allDailyExhausted()) {
    return { success: false, error: new DailyQuotaError(), durationMs: 0 };
  }
  const withQuota = chain.filter((m) => (dailyExhausted.get(m) || 0) <= now);
  const available = withQuota.filter((m) => (modelCooldown.get(m) || 0) <= now);
  const models = available.length > 0 ? available : withQuota;
  let lastError: any = null;
  // Tiempo máximo total esperando por límites de cuota en una sola factura
  const deadline = start + 150_000;

  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await acquireSlot();
        let response;
        try {
          response = await ai.models.generateContent({ model, contents, config: finalConfig });
        } finally {
          releaseSlot();
        }
        const text = response.text;
        if (text && text.trim()) {
          const durationMs = Date.now() - start;
          dailyExhausted.delete(model);
          console.log(`[Gemini] ${task}: OK con ${model} en ${durationMs} ms`);
          return { success: true, text, modelUsed: model, durationMs };
        }
        lastError = new Error('La IA devolvió una respuesta vacía.');
      } catch (err: any) {
        lastError = err;
        const status = errorStatus(err);
        const msg = err?.message || String(err);

        if (status === 404 || (status === 400 && /model/i.test(msg))) {
          console.warn(`[Gemini] Modelo ${model} no disponible (${status}). Se probará el siguiente.`);
          modelCooldown.set(model, Date.now() + 60 * 60_000);
          break;
        }
        if (status === 401 || status === 403) {
          // Clave inválida o sin permisos: ningún otro modelo lo resolverá
          return { success: false, error: err, durationMs: Date.now() - start };
        }
        // Con 429 Gemini indica cuánto esperar ("retryDelay": "23s")
        const hinted = Number(msg.match(/retry(?:Delay)?["':\s]+(?:in\s+)?([\d.]+)\s*s/i)?.[1]);
        if (status === 429) {
          console.warn(`[Gemini] ${task}: ${model} 429 → ${msg.replace(/\s+/g, ' ').slice(0, 300)}`);
          // Solo es la cuota DIARIA si así lo dice y no hay espera corta sugerida (la de minuto trae retryDelay)
          const isDaily = /per ?day|daily/i.test(msg) && !/per ?minute/i.test(msg) && !(hinted > 0 && hinted <= 120);
          if (isDaily) {
            console.warn(`[Gemini] Cuota diaria agotada en ${model}; se usará el siguiente modelo.`);
            dailyExhausted.set(model, Math.min(Date.now() + DAILY_RECHECK_MS, nextQuotaReset().getTime()));
            break;
          }
          // Límite por minuto: pausar todas las llamadas lo que pida Gemini (mín. 10 s, máx. 60 s)
          pauseAll(Math.min(60_000, Math.max(10_000, (hinted || 20) * 1000)));
        }
        if (isTransientError(err) && attempt < maxAttempts) {
          const backoff = Math.min(8000, 1000 * 2 ** (attempt - 1));
          const delay = (status === 429 ? Math.max(0, pausedUntil - Date.now()) : backoff) + Math.round(Math.random() * 1500);
          if (Date.now() + delay > deadline) break;
          console.warn(`[Gemini] ${task}: ${model} respondió ${status || 'error transitorio'}; reintento en ${delay} ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        console.warn(`[Gemini] ${task}: fallo con ${model}: ${msg}`);
        break;
      }
    }
  }

  if (allDailyExhausted()) {
    console.warn('[Gemini] Todos los modelos agotaron el cupo diario.');
    return { success: false, error: new DailyQuotaError(lastError), durationMs: Date.now() - start };
  }
  return { success: false, error: lastError, durationMs: Date.now() - start };
}

/** Quita cercas de markdown y parsea JSON devuelto por el modelo. */
export function parseModelJson(text: string): any {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(clean);
}

/** Mensaje legible en español para errores de Gemini. */
export function describeGeminiError(err: any): string {
  const status = errorStatus(err);
  const msg = err?.message || String(err || '');
  if (isDailyQuotaError(err)) return msg;
  if (/GEMINI_API_KEY/.test(msg)) return msg;
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(msg)) {
    return 'La clave GEMINI_API_KEY no es válida o no tiene permisos. Revísala en el archivo .env.';
  }
  if (status === 429) return 'Se alcanzó el límite de uso de Gemini. Espera un momento y vuelve a intentarlo.';
  if (status === 503 || status === 500 || status === 502 || status === 504) {
    return 'Gemini está saturado temporalmente. Vuelve a intentarlo en unos segundos.';
  }
  if (status === 408) return 'Gemini tardó demasiado en responder. Vuelve a intentarlo.';
  if (status === 404) return 'El modelo de Gemini configurado no existe. Revisa GEMINI_MODEL en el archivo .env.';
  return msg || 'Error desconocido al consultar Gemini.';
}
