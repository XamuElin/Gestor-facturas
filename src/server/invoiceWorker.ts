import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { google } from 'googleapis';

// 4 Facturas concurrentes en segundo plano según requerimiento
export const WORKER_CONCURRENCY = 4;

export const EXACT_SYSTEM_INSTRUCTION =
  'Eres un extractor de facturas colombianas. Devuelve SOLO JSON según el esquema. Si un dato no aparece, usa null; nunca inventes. Montos como número sin símbolos ni separadores de miles (ej. 1234567.50). \'total\' es el valor final a pagar. Fecha en formato AAAA-MM-DD. \'concepto_resumen\': de 3 a 8 palabras en MAYÚSCULAS con lo principal que se compró (ej. \'COMPRA CEMENTO Y MASILLA\').';

export const INVOICE_SCHEMA_V2 = {
  type: Type.OBJECT,
  properties: {
    proveedor: {
      type: Type.STRING,
      description: 'Nombre del emisor o proveedor',
    },
    nit: {
      type: Type.STRING,
      description: 'NIT o RUT del proveedor',
    },
    numero_factura: {
      type: Type.STRING,
      description: 'Número de factura o comprobante',
    },
    fecha: {
      type: Type.STRING,
      description: 'Fecha en formato AAAA-MM-DD',
    },
    subtotal: {
      type: Type.NUMBER,
      description: 'Subtotal antes de IVA sin símbolos',
    },
    iva: {
      type: Type.NUMBER,
      description: 'Valor del IVA sin símbolos',
    },
    retenciones: {
      type: Type.NUMBER,
      description: 'Retenciones aplicadas (ej: ReteFuente, ReteICA) o 0',
    },
    descuentos: {
      type: Type.NUMBER,
      description: 'Descuentos aplicados o 0',
    },
    total: {
      type: Type.NUMBER,
      description: 'Total final a pagar',
    },
    moneda: {
      type: Type.STRING,
      description: 'Código de moneda (COP por defecto)',
    },
    items: {
      type: Type.ARRAY,
      description: 'Lista de ítems de la factura',
      items: {
        type: Type.OBJECT,
        properties: {
          descripcion: { type: Type.STRING },
          cantidad: { type: Type.NUMBER },
          unidad: { type: Type.STRING },
          valor_unitario: { type: Type.NUMBER },
          valor_total: { type: Type.NUMBER },
        },
        required: ['descripcion', 'valor_total'],
      },
    },
    concepto_resumen: {
      type: Type.STRING,
      description: 'De 3 a 8 palabras en MAYÚSCULAS con lo principal que se compró',
    },
    categoria: {
      type: Type.STRING,
      enum: ['material', 'herramienta', 'transporte', 'EPP', 'otro'],
    },
    confianza: {
      type: Type.NUMBER,
      description: 'Confianza de la extracción de 0 a 1',
    },
    campos_dudosos: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Lista de campos con dudas o ilegibles',
    },
  },
  required: ['total', 'moneda', 'concepto_resumen', 'categoria', 'confianza', 'items'],
};

export interface InvoiceJob {
  id: string;
  projectId: string;
  projectName?: string;
  fileName: string;
  fileSha256: string;
  fileSizeBytes: number;
  mimeType: string;
  targetFolderId: string;
  spreadsheetId?: string;
  sheetTab?: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  status: 'en_cola' | 'leyendo' | 'leida' | 'revisar' | 'error';
  confidence?: 'alta' | 'media' | 'baja';
  retryCount: number;
  errorMessage?: string;
  errorReason?: string;
  isDuplicate?: boolean;
  isPossibleDuplicate?: boolean;
  duplicateReason?: string;
  extractedData?: any;
  sheetAppended?: boolean;
  durationMs?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  fileBase64?: string;
  userToken?: string;
}

// Caché en memoria por SHA-256 para evitar re-enviar archivos idénticos a Gemini
const sha256ExtractionCache = new Map<string, { data: any; status: 'leida' | 'revisar'; cachedAt: number }>();

// Persistencia en archivo /tmp para que los trabajos sigan vivos si se reinicia el servidor
const JOBS_FILE_PATH = path.join('/tmp', 'svh_background_invoice_jobs.json');

const jobsMap = new Map<string, InvoiceJob>();

// Cargar trabajos previos al iniciar
try {
  if (fs.existsSync(JOBS_FILE_PATH)) {
    const raw = fs.readFileSync(JOBS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const j of parsed) {
        // Al arrancar, si quedó alguno en 'leyendo', volverlo a poner 'en_cola'
        if (j.status === 'leyendo') {
          j.status = 'en_cola';
        }
        jobsMap.set(j.id, j);
      }
    }
  }
} catch (e) {
  console.warn('[Worker] Aviso leyendo archivo persistente de trabajos:', e);
}

function persistJobsToDisk() {
  try {
    const serialized = Array.from(jobsMap.values()).map((job) => {
      // Excluir el base64 pesado del archivo para no sobrecargar el disco
      const { fileBase64, userToken, ...rest } = job;
      return rest;
    });
    fs.writeFileSync(JOBS_FILE_PATH, JSON.stringify(serialized, null, 2));
  } catch (e) {
    console.warn('[Worker] Aviso persistiendo trabajos a disco:', e);
  }
}

// Normalización de números colombianos y validación matemática en código (sin IA)
export function validateAndNormalizeExtraction(extracted: any): {
  data: any;
  status: 'leida' | 'revisar';
  camposDudosos: string[];
  reasons: string[];
} {
  const camposDudosos: string[] = Array.isArray(extracted.campos_dudosos) ? [...extracted.campos_dudosos] : [];
  const reasons: string[] = [];

  const total = Number(extracted.total) || 0;
  const subtotal = extracted.subtotal !== null && extracted.subtotal !== undefined ? Number(extracted.subtotal) : null;
  const iva = extracted.iva !== null && extracted.iva !== undefined ? Number(extracted.iva) : 0;
  const retenciones = extracted.retenciones !== null && extracted.retenciones !== undefined ? Number(extracted.retenciones) : 0;
  const descuentos = extracted.descuentos !== null && extracted.descuentos !== undefined ? Number(extracted.descuentos) : 0;

  // 1. Total mayor a 0
  if (total <= 0) {
    camposDudosos.push('total');
    reasons.push('El total debe ser mayor a 0');
  }

  // 2. Validación matemática: subtotal + iva − retenciones − descuentos ≈ total (tolerancia $1)
  if (subtotal !== null && subtotal > 0) {
    const calculatedTotal = subtotal + iva - retenciones - descuentos;
    if (Math.abs(calculatedTotal - total) > 1.05) {
      camposDudosos.push('subtotal', 'iva', 'total');
      reasons.push(
        `Descuadre: Subtotal ($${subtotal.toLocaleString('es-CO')}) + IVA ($${iva.toLocaleString('es-CO')}) - Ret ($${retenciones.toLocaleString('es-CO')}) - Desc ($${descuentos.toLocaleString('es-CO')}) = $${calculatedTotal.toLocaleString('es-CO')} vs Total ($${total.toLocaleString('es-CO')})`
      );
    }
  }

  // 3. Validación de fecha válida (AAAA-MM-DD)
  const dateStr = String(extracted.fecha || '').trim();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateStr || !dateRegex.test(dateStr) || isNaN(new Date(dateStr).getTime())) {
    camposDudosos.push('fecha');
    reasons.push('Fecha inválida o no detectada');
  }

  // 4. Proveedor obligatorio
  const proveedor = String(extracted.proveedor || '').trim();
  if (!proveedor || proveedor.toLowerCase() === 'null' || proveedor.length < 2) {
    camposDudosos.push('proveedor');
    reasons.push('Proveedor no identificado');
  }

  // 5. Confianza de Gemini
  const confianza = typeof extracted.confianza === 'number' ? extracted.confianza : 0.8;
  if (confianza < 0.75) {
    reasons.push(`Confianza de extracción moderada/baja (${(confianza * 100).toFixed(0)}%)`);
  }

  const isDoubtful = camposDudosos.length > 0 || reasons.length > 0 || confianza < 0.75;
  const status: 'leida' | 'revisar' = isDoubtful ? 'revisar' : 'leida';

  const normalized = {
    ...extracted,
    proveedor: proveedor || 'Proveedor por verificar',
    nit: extracted.nit || '',
    numero_factura: extracted.numero_factura || 'S/N',
    fecha: dateStr || new Date().toISOString().split('T')[0],
    subtotal: subtotal ?? (total - iva),
    iva,
    retenciones,
    descuentos,
    total,
    moneda: extracted.moneda || 'COP',
    concepto_resumen: extracted.concepto_resumen || 'COMPRA DE MATERIALES',
    categoria: extracted.categoria || 'material',
    confianza,
    campos_dudosos: Array.from(new Set(camposDudosos)),
    reasons,
    confidence: confianza >= 0.8 && !isDoubtful ? 'alta' : confianza >= 0.5 ? 'media' : 'baja',
    // Compatibilidad hacia atrás para Google Sheets y modales
    cliente: proveedor || 'Proveedor por verificar',
    vendorName: proveedor || 'Proveedor por verificar',
    nitRut: extracted.nit || '',
    vendorTaxId: extracted.nit || '',
    numeroFactura: extracted.numero_factura || 'S/N',
    invoiceNumber: extracted.numero_factura || 'S/N',
    concepto: extracted.concepto_resumen || 'COMPRA DE MATERIALES',
    concept: extracted.concepto_resumen || 'COMPRA DE MATERIALES',
    totalAmount: total,
    taxAmount: iva,
    currency: extracted.moneda || 'COP',
  };

  return {
    data: normalized,
    status,
    camposDudosos: Array.from(new Set(camposDudosos)),
    reasons,
  };
}

let activeWorkerSlots = 0;

export async function processQueue() {
  if (activeWorkerSlots >= WORKER_CONCURRENCY) return;

  const availableSlots = WORKER_CONCURRENCY - activeWorkerSlots;
  const pendingJobs = Array.from(jobsMap.values())
    .filter((j) => j.status === 'en_cola')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, availableSlots);

  if (pendingJobs.length === 0) return;

  for (const job of pendingJobs) {
    activeWorkerSlots++;
    executeWorkerJob(job).finally(() => {
      activeWorkerSlots--;
      processQueue();
    });
  }
}

async function executeWorkerJob(job: InvoiceJob) {
  job.status = 'leyendo';
  job.updatedAt = Date.now();
  persistJobsToDisk();

  const startTime = Date.now();
  console.log(`[Worker] Iniciando procesamiento de trabajo "${job.fileName}" (ID: ${job.id})...`);

  try {
    let extractionResult: { data: any; status: 'leida' | 'revisar' };

    // 1. Verificar si el archivo ya fue leído por hash SHA-256
    if (sha256ExtractionCache.has(job.fileSha256)) {
      console.log(`[Worker] Hash SHA-256 encontrado en caché para "${job.fileName}". Recuperando instantáneamente.`);
      const cached = sha256ExtractionCache.get(job.fileSha256)!;
      extractionResult = { data: cached.data, status: cached.status };
    } else {
      // 2. Llamada directa y única a Gemini Flash
      if (!job.fileBase64) {
        throw new Error('El archivo no está disponible en memoria para lectura.');
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const cleanBase64 = job.fileBase64.replace(/^data:[^;]+;base64,/, '');

      let retriesLeft = 3;
      let backoffDelays = [3000, 6000, 12000];
      let geminiRes: any = null;

      while (retriesLeft >= 0) {
        try {
          // Model: gemini-3.8-flash (más reciente y veloz disponible, thinking en mínimo/0, temperatura 0)
          geminiRes = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [
              {
                inlineData: {
                  mimeType: job.mimeType || 'image/jpeg',
                  data: cleanBase64,
                },
              },
              'Extrae los datos de esta factura colombiana según el esquema JSON.',
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: INVOICE_SCHEMA_V2,
              systemInstruction: EXACT_SYSTEM_INSTRUCTION,
              temperature: 0,
              thinkingConfig: {
                thinkingBudget: 0,
              },
            },
          });
          break; // Éxito
        } catch (apiErr: any) {
          const status = apiErr?.status || apiErr?.code || apiErr?.error?.code;
          const msg = String(apiErr?.message || '');
          const isRetryable =
            status === 429 ||
            status === 503 ||
            status === 500 ||
            msg.includes('429') ||
            msg.includes('503') ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('high demand');

          if (isRetryable && retriesLeft > 0) {
            const delay = backoffDelays[3 - retriesLeft] || 5000;
            console.log(`[Worker] Reintentando factura "${job.fileName}" tras ${delay}ms por respuesta ${status}...`);
            await new Promise((r) => setTimeout(r, delay));
            job.retryCount++;
            retriesLeft--;
          } else {
            throw apiErr;
          }
        }
      }

      const rawJson = geminiRes?.text?.trim()?.replace(/^```json/i, '')?.replace(/```$/i, '')?.trim();
      if (!rawJson) {
        throw new Error('La IA no devolvió contenido JSON válido.');
      }

      const parsed = JSON.parse(rawJson);
      const validated = validateAndNormalizeExtraction(parsed);

      // Guardar en caché SHA-256
      sha256ExtractionCache.set(job.fileSha256, {
        data: validated.data,
        status: validated.status,
        cachedAt: Date.now(),
      });

      extractionResult = validated;
    }

    const durationMs = Date.now() - startTime;
    console.log(`[Gemini Benchmark] Factura "${job.fileName}" procesada en ${durationMs}ms (meta <= 8000ms). Estado: ${extractionResult.status}`);

    job.durationMs = durationMs;
    job.extractedData = extractionResult.data;
    job.status = extractionResult.status;
    job.confidence = extractionResult.data.confidence;

    // 3. Verificación Anti-duplicados por datos contables en la misma obra:
    // "Marca también 'posible duplicado' si coinciden proveedor + número de factura + total"
    const vendorNorm = String(extractionResult.data.proveedor || '').trim().toLowerCase();
    const invNumNorm = String(extractionResult.data.numero_factura || '').trim().toLowerCase();
    const totalVal = Number(extractionResult.data.total) || 0;

    const existingMatch = Array.from(jobsMap.values()).find(
      (j) =>
        j.id !== job.id &&
        j.projectId === job.projectId &&
        j.extractedData &&
        String(j.extractedData.proveedor || '').trim().toLowerCase() === vendorNorm &&
        String(j.extractedData.numero_factura || '').trim().toLowerCase() === invNumNorm &&
        invNumNorm !== 's/n' &&
        Math.abs((Number(j.extractedData.total) || 0) - totalVal) < 1
    );

    if (existingMatch) {
      job.isPossibleDuplicate = true;
      job.duplicateReason = `Posible duplicado: Coincide proveedor (${extractionResult.data.proveedor}), número (#${extractionResult.data.numero_factura}) y total ($${totalVal.toLocaleString('es-CO')}).`;
      job.status = 'revisar';
    }

    // 4. Si hay Google Sheets y token asociado, agregar la fila en Sheets
    if (job.spreadsheetId && job.userToken && !job.sheetAppended) {
      try {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: job.userToken });
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

        const rowValues = [
          job.extractedData.fecha,
          job.extractedData.proveedor,
          job.extractedData.nit,
          job.extractedData.concepto_resumen,
          job.extractedData.categoria,
          job.extractedData.subtotal,
          job.extractedData.iva,
          job.extractedData.total,
          job.driveWebViewLink || '',
        ];

        const targetTab = job.sheetTab || 'Control Facturas';
        await sheets.spreadsheets.values.append({
          spreadsheetId: job.spreadsheetId,
          range: `'${targetTab}'!A:I`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [rowValues] },
        });
        job.sheetAppended = true;
        console.log(`[Worker] Factura "${job.fileName}" insertada exitosamente en Google Sheet ${job.spreadsheetId}`);
      } catch (sheetErr) {
        console.warn(`[Worker] Aviso insertando en Google Sheets para "${job.fileName}":`, sheetErr);
      }
    }

    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    // Liberar el base64 de la memoria una vez procesado
    delete job.fileBase64;
    persistJobsToDisk();
  } catch (err: any) {
    console.error(`[Worker] Error procesando factura "${job.fileName}":`, err);
    job.status = 'error';
    job.errorMessage = err?.message || 'Error durante la lectura con IA';
    job.errorReason = err?.message || 'Error durante la lectura con IA';
    job.updatedAt = Date.now();
    persistJobsToDisk();
  }
}

export function enqueueInvoiceJob(params: {
  projectId: string;
  projectName?: string;
  fileName: string;
  fileSha256: string;
  fileSizeBytes: number;
  mimeType: string;
  fileBase64: string;
  targetFolderId: string;
  spreadsheetId?: string;
  sheetTab?: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  userToken?: string;
}): { job: InvoiceJob; isDuplicate: boolean; duplicateReason?: string } {
  // 1. Anti-duplicados por SHA-256 en esa obra
  const existingWithHash = Array.from(jobsMap.values()).find(
    (j) => j.projectId === params.projectId && j.fileSha256 === params.fileSha256
  );

  const isDuplicate = Boolean(existingWithHash);
  const duplicateReason = isDuplicate
    ? `Ya existe un archivo idéntico en esta obra ("${existingWithHash?.fileName}").`
    : undefined;

  const jobId = `JOB-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  const newJob: InvoiceJob = {
    id: jobId,
    projectId: params.projectId,
    projectName: params.projectName,
    fileName: params.fileName,
    fileSha256: params.fileSha256,
    fileSizeBytes: params.fileSizeBytes,
    mimeType: params.mimeType,
    targetFolderId: params.targetFolderId,
    spreadsheetId: params.spreadsheetId,
    sheetTab: params.sheetTab,
    driveFileId: params.driveFileId,
    driveWebViewLink: params.driveWebViewLink,
    status: 'en_cola',
    retryCount: 0,
    isDuplicate,
    duplicateReason,
    createdAt: now,
    updatedAt: now,
    fileBase64: params.fileBase64,
    userToken: params.userToken,
  };

  jobsMap.set(jobId, newJob);
  persistJobsToDisk();

  // Despachar el worker de inmediato en segundo plano
  setTimeout(() => {
    processQueue();
  }, 50);

  return { job: newJob, isDuplicate, duplicateReason };
}

export function getJobsForProject(projectId: string): InvoiceJob[] {
  return Array.from(jobsMap.values())
    .filter((j) => !projectId || j.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function retryJob(jobId: string): InvoiceJob | null {
  const job = jobsMap.get(jobId);
  if (!job) return null;
  job.status = 'en_cola';
  job.retryCount = 0;
  job.errorMessage = undefined;
  job.errorReason = undefined;
  job.updatedAt = Date.now();
  persistJobsToDisk();

  setTimeout(() => {
    processQueue();
  }, 50);

  return job;
}

export function getBadgeReviewCount(projectId?: string): number {
  return Array.from(jobsMap.values()).filter(
    (j) => (!projectId || j.projectId === projectId) && j.status === 'revisar'
  ).length;
}
