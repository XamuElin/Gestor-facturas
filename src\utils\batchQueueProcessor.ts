/**
 * Batch & Queue Processor para sincronización y análisis de comprobantes contables con Gemini.
 * Diseñado para evitar picos de solicitudes a la API, saturación y errores 503/429.
 */

// 1. CONSTANTES CONFIGURABLES
export const MAX_CONCURRENCY = 2; // Concurrencia máxima: 2 archivos en paralelo
export const BATCH_SIZE = 5; // Divide los archivos en lotes de 5
export const DEFAULT_FILE_DELAY_MS = 1500; // 1.5s de espera entre cada archivo
export const BATCH_PAUSE_MS = 10000; // 10s de espera entre cada lote
export const MAX_RETRIES = 4; // Reintentos máximos por archivo
export const RETRY_BACKOFF_STEPS_MS = [3000, 6000, 12000, 24000]; // 3s, 6s, 12s, 24s
export const FALLBACK_MODEL_NAME = 'gemini-3.1-flash-lite'; // Modelo alternativo Flash de respaldo

export type QueueItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface QueueItem {
  id: string; // ID único del archivo
  name: string;
  mimeType?: string;
  sizeFormatted?: string;
  status: QueueItemStatus;
  retryAttempt: number; // 0, 1, 2, 3, 4
  errorMessage?: string;
  extractedData?: any;
  driveUrl?: string;
  modelUsed?: string;
  preferredModel?: string; // Si se fuerza modelo alternativo
}

export interface QueueProgressState {
  currentBatchIndex: number; // 1-indexed (ej. 2 de 6)
  totalBatches: number;
  processedCount: number; // ej. 14 de 30
  totalFiles: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  isPaused: boolean;
  pauseMessage?: string | null;
  pauseSecondsRemaining?: number;
  currentRunningFileNames: string[];
}

export interface QueueStorageData {
  storageKey: string;
  items: QueueItem[];
  consecutive503Count: number;
  currentFileDelayMs: number;
  lastUpdated: number;
}

/**
 * Calcula el tiempo de reintento exponencial con jitter (0 a 1s)
 */
export function getRetryDelayWithJitter(attemptIndex: number): number {
  const base = RETRY_BACKOFF_STEPS_MS[Math.min(attemptIndex, RETRY_BACKOFF_STEPS_MS.length - 1)] || 3000;
  const jitter = Math.floor(Math.random() * 1000); // 0 a 1000ms
  return base + jitter;
}

/**
 * Detecta si un error es candidato a reintento automático (503, 429, timeout o saturación)
 */
export function isRetryableApiError(error: any): { isRetryable: boolean; is503: boolean; is429: boolean; isTimeout: boolean } {
  const errMsg = String(error?.message || error || '').toLowerCase();
  const status = error?.status || error?.statusCode || error?.code;

  const is503 =
    status === 503 ||
    errMsg.includes('503') ||
    errMsg.includes('unavailable') ||
    errMsg.includes('high demand') ||
    errMsg.includes('overloaded') ||
    errMsg.includes('service unavailable');

  const is429 =
    status === 429 ||
    errMsg.includes('429') ||
    errMsg.includes('resource_exhausted') ||
    errMsg.includes('quota exceeded') ||
    errMsg.includes('rate limit');

  const isTimeout =
    errMsg.includes('timeout') ||
    errMsg.includes('timed out') ||
    errMsg.includes('econnreset') ||
    errMsg.includes('etimedout');

  return {
    isRetryable: is503 || is429 || isTimeout,
    is503,
    is429,
    isTimeout,
  };
}

/**
 * Helper para pausar la ejecución un tiempo determinado
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persistencia en localStorage
 */
export function saveQueueStateToStorage(storageKey: string, data: { items: QueueItem[]; consecutive503Count: number; currentFileDelayMs: number }) {
  try {
    const payload: QueueStorageData = {
      storageKey,
      items: data.items,
      consecutive503Count: data.consecutive503Count,
      currentFileDelayMs: data.currentFileDelayMs,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(`gemini_batch_queue_${storageKey}`, JSON.stringify(payload));
  } catch (err) {
    console.warn('[QueueStorage] Error guardando estado:', err);
  }
}

export function loadQueueStateFromStorage(storageKey: string): QueueStorageData | null {
  try {
    const raw = localStorage.getItem(`gemini_batch_queue_${storageKey}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[QueueStorage] Error cargando estado:', err);
    return null;
  }
}

export function clearQueueStorage(storageKey: string) {
  try {
    localStorage.removeItem(`gemini_batch_queue_${storageKey}`);
  } catch (err) {
    // ignore
  }
}
