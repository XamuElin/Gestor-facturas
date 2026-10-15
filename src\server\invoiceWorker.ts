import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { extractInvoice } from './invoiceExtraction';
import { appendInvoiceRow } from './sheetsWriter';

export { validateAndNormalizeExtraction } from './invoiceExtraction';

// Facturas leídas en paralelo. Ajustable con INVOICE_WORKER_CONCURRENCY según el cupo de Gemini.
export const WORKER_CONCURRENCY = Math.max(1, Number(process.env.INVOICE_WORKER_CONCURRENCY) || 4);

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
  sheetError?: string;
  modelUsed?: string;
  durationMs?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  fileBase64?: string;
  userToken?: string;
}

// Caché por SHA-256 para no volver a enviar a Gemini un archivo idéntico
const extractionCache = new Map<string, { data: any; status: 'leida' | 'revisar' }>();

// Persistencia junto al proyecto (antes /tmp, que en Windows no existe) para sobrevivir reinicios.
// Se guarda el archivo en base64 aparte para poder reanudar trabajos pendientes tras un reinicio.
const DATA_DIR = path.resolve(process.env.INVOICE_DATA_DIR || '.data');
const JOBS_FILE = path.join(DATA_DIR, 'invoice-jobs.json');
const PENDING_DIR = path.join(DATA_DIR, 'pending');
const MAX_JOBS_KEPT = 1000;

const jobsMap = new Map<string, InvoiceJob>();

function pendingFile(jobId: string) {
  return path.join(PENDING_DIR, `${jobId}.b64`);
}

function loadJobs() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
    if (!Array.isArray(parsed)) return;
    for (const j of parsed as InvoiceJob[]) {
      if (j.status === 'leyendo' || j.status === 'en_cola') {
        const file = pendingFile(j.id);
        if (fs.existsSync(file)) {
          j.fileBase64 = fs.readFileSync(file, 'utf-8');
          j.status = 'en_cola';
        } else {
          j.status = 'error';
          j.errorMessage = j.errorReason = 'El servidor se reinició y el archivo ya no está disponible. Vuelve a subirlo.';
        }
      }
      jobsMap.set(j.id, j);
    }
  } catch (e) {
    console.warn('[Worker] No se pudo leer el historial de trabajos:', e);
  }
}

let persistTimer: NodeJS.Timeout | null = null;
function persistJobs() {
  // Agrupa escrituras: varias actualizaciones seguidas generan una sola escritura en disco
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const all = Array.from(jobsMap.values()).sort((a, b) => b.createdAt - a.createdAt);
      for (const old of all.slice(MAX_JOBS_KEPT)) jobsMap.delete(old.id);
      const serialized = all.slice(0, MAX_JOBS_KEPT).map(({ fileBase64, userToken, ...rest }) => rest);
      fs.writeFileSync(JOBS_FILE, JSON.stringify(serialized));
    } catch (e) {
      console.warn('[Worker] No se pudo guardar el historial de trabajos:', e);
    }
  }, 300);
}

function savePendingFile(job: InvoiceJob) {
  try {
    fs.mkdirSync(PENDING_DIR, { recursive: true });
    if (job.fileBase64) fs.writeFileSync(pendingFile(job.id), job.fileBase64);
  } catch (e) {
    console.warn('[Worker] No se pudo guardar el archivo pendiente:', e);
  }
}

function removePendingFile(jobId: string) {
  fs.rm(pendingFile(jobId), { force: true }, () => {});
}

loadJobs();

let activeSlots = 0;

export function processQueue() {
  const pending = Array.from(jobsMap.values())
    .filter((j) => j.status === 'en_cola')
    .sort((a, b) => a.createdAt - b.createdAt);

  while (activeSlots < WORKER_CONCURRENCY && pending.length > 0) {
    const job = pending.shift()!;
    activeSlots++;
    job.status = 'leyendo';
    job.updatedAt = Date.now();
    executeJob(job).finally(() => {
      activeSlots--;
      processQueue();
    });
  }
  persistJobs();
}

async function executeJob(job: InvoiceJob) {
  const started = Date.now();
  try {
    let extraction = extractionCache.get(job.fileSha256);
    if (extraction) {
      console.log(`[Worker] "${job.fileName}" ya leída antes (mismo SHA-256); se reutiliza el resultado.`);
    } else {
      if (!job.fileBase64) throw new Error('El archivo ya no está en memoria. Vuelve a subirlo.');
      const res = await extractInvoice({ base64: job.fileBase64, mimeType: job.mimeType, fileName: job.fileName });
      extraction = { data: res.data, status: res.status };
      job.modelUsed = res.modelUsed;
      extractionCache.set(job.fileSha256, extraction);
    }

    job.extractedData = extraction.data;
    job.status = extraction.status;
    job.confidence = extraction.data.confidence;
    job.durationMs = Date.now() - started;

    // Posible duplicado en la misma obra: mismo proveedor + número + total
    const d = extraction.data;
    const vendor = String(d.proveedor || '').trim().toLowerCase();
    const number = String(d.numero_factura || '').trim().toLowerCase();
    const match = Array.from(jobsMap.values()).find(
      (j) =>
        j.id !== job.id &&
        j.projectId === job.projectId &&
        j.extractedData &&
        number && number !== 's/n' &&
        String(j.extractedData.proveedor || '').trim().toLowerCase() === vendor &&
        String(j.extractedData.numero_factura || '').trim().toLowerCase() === number &&
        Math.abs((Number(j.extractedData.total) || 0) - (Number(d.total) || 0)) < 1
    );
    if (match) {
      job.isPossibleDuplicate = true;
      job.duplicateReason = `Posible duplicado de "${match.fileName}": mismo proveedor, número (#${d.numero_factura}) y total.`;
      job.status = 'revisar';
    }

    // Registrar en Sheets solo si no es duplicado (exacto o probable)
    if (job.spreadsheetId && job.userToken && !job.sheetAppended && !job.isDuplicate && !job.isPossibleDuplicate) {
      try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: job.userToken });
        await appendInvoiceRow({
          sheets: google.sheets({ version: 'v4', auth }),
          spreadsheetId: job.spreadsheetId,
          tab: job.sheetTab,
          invoice: d,
          driveUrl: job.driveWebViewLink,
          fileName: job.fileName,
          token: job.userToken,
        });
        job.sheetAppended = true;
        job.sheetError = undefined;
      } catch (err: any) {
        job.sheetError = `No se pudo registrar en Google Sheets: ${err?.message || err}`;
        console.warn(`[Worker] ${job.sheetError}`);
      }
    }

    job.errorMessage = job.errorReason = undefined;
    job.completedAt = Date.now();
    delete job.fileBase64;
    delete job.userToken;
    removePendingFile(job.id);
    console.log(`[Worker] "${job.fileName}" → ${job.status} en ${job.durationMs} ms`);
  } catch (err: any) {
    job.status = 'error';
    job.errorMessage = job.errorReason = err?.message || 'Error durante la lectura con IA';
    job.durationMs = Date.now() - started;
    console.warn(`[Worker] Error en "${job.fileName}": ${job.errorMessage}`);
  } finally {
    job.updatedAt = Date.now();
    persistJobs();
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
  const existing = Array.from(jobsMap.values()).find(
    (j) => j.projectId === params.projectId && j.fileSha256 === params.fileSha256 && j.status !== 'error'
  );
  const isDuplicate = Boolean(existing);
  const duplicateReason = existing ? `Ya existe un archivo idéntico en esta obra ("${existing.fileName}").` : undefined;

  const now = Date.now();
  const job: InvoiceJob = {
    id: `JOB-${now}-${Math.random().toString(36).slice(2, 7)}`,
    ...params,
    status: 'en_cola',
    retryCount: 0,
    isDuplicate,
    duplicateReason,
    createdAt: now,
    updatedAt: now,
  };

  jobsMap.set(job.id, job);
  savePendingFile(job);
  setImmediate(processQueue);
  return { job: publicJob(job), isDuplicate, duplicateReason };
}

/** Copia del trabajo sin el archivo ni el token (lo que se envía al navegador). */
function publicJob(job: InvoiceJob): InvoiceJob {
  const { fileBase64, userToken, ...rest } = job;
  return rest as InvoiceJob;
}

export function getJobsForProject(projectId: string): InvoiceJob[] {
  return Array.from(jobsMap.values())
    .filter((j) => !projectId || j.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicJob);
}

export function retryJob(jobId: string, userToken?: string): InvoiceJob | null {
  const job = jobsMap.get(jobId);
  if (!job) return null;
  if (!job.fileBase64 && !extractionCache.has(job.fileSha256)) {
    job.status = 'error';
    job.errorMessage = job.errorReason = 'El archivo original ya no está disponible en el servidor. Vuelve a subirlo.';
    job.updatedAt = Date.now();
    persistJobs();
    return publicJob(job);
  }
  // Si aún tenemos el archivo, el reintento fuerza una nueva lectura con la IA
  if (job.fileBase64) extractionCache.delete(job.fileSha256);
  if (userToken) job.userToken = userToken;
  job.status = 'en_cola';
  job.retryCount++;
  job.errorMessage = job.errorReason = undefined;
  job.updatedAt = Date.now();
  setImmediate(processQueue);
  return publicJob(job);
}

export function getBadgeReviewCount(projectId?: string): number {
  return Array.from(jobsMap.values()).filter(
    (j) => (!projectId || j.projectId === projectId) && j.status === 'revisar'
  ).length;
}

// Reanudar trabajos pendientes recuperados del disco
setImmediate(processQueue);
