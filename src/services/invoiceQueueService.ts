import { computeSha256, WakeLockManager } from '../utils/formatters';
import { optimizeImageForAnalysis } from '../utils/imageOptimizer';

export interface BackendInvoiceJob {
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
}

export interface UploadProgressItem {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  progressPercent: number;
  status: 'comprimiendo' | 'subiendo' | 'recibida' | 'error';
  message: string;
  jobId?: string;
  job?: BackendInvoiceJob;
  error?: string;
}

const wakeLock = new WakeLockManager();

/**
 * Prepara y sube un archivo al backend con compresión previa de imágenes (máx 1600px, JPEG 0.8)
 * y cálculo de SHA-256 para anti-duplicados.
 */
export async function uploadAndEnqueueInvoice(params: {
  file: File;
  projectId: string;
  projectName?: string;
  targetFolderId: string;
  spreadsheetId?: string;
  sheetTab?: string;
  accessToken?: string;
  onProgress?: (percent: number, statusText: string) => void;
}): Promise<{
  success: boolean;
  jobId?: string;
  job?: BackendInvoiceJob;
  isDuplicate?: boolean;
  duplicateReason?: string;
  error?: string;
}> {
  const { file, projectId, projectName, targetFolderId, spreadsheetId, sheetTab, accessToken, onProgress } = params;

  try {
    onProgress?.(10, 'Comprimiendo imagen...');

    // 1. Compresión en cliente: imágenes max 1600px lado mayor y JPEG 0.8; PDF tal cual
    let base64ToSend: string;
    let mimeToSend = file.type || 'image/jpeg';

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64ToSend = btoa(binary);
      mimeToSend = 'application/pdf';
    } else {
      const optimized = await optimizeImageForAnalysis(file, 1600, 0.8);
      base64ToSend = optimized.base64.replace(/^data:[^;]+;base64,/, '');
      mimeToSend = optimized.mimeType;
    }

    onProgress?.(35, 'Calculando hash SHA-256...');
    const fileSha256 = await computeSha256(base64ToSend);

    onProgress?.(55, 'Subiendo… no cierres hasta ver ✓ Recibida. Después puedes cerrar la app: seguiremos leyendo.');

    // 2. Envío con reintento automático ante pérdida de conexión
    let attempts = 0;
    const maxAttempts = 3;
    let lastErr: any = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }

        const res = await fetch('/api/invoices/upload-and-enqueue', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            fileBase64: base64ToSend,
            fileName: file.name,
            mimeType: mimeToSend,
            fileSha256,
            fileSizeBytes: file.size,
            targetFolderId,
            projectId,
            projectName,
            spreadsheetId,
            sheetTab,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Error al procesar subida');
        }

        onProgress?.(100, '✓ Recibida. Puedes cerrar la app: seguiremos leyendo.');

        return {
          success: true,
          jobId: data.jobId,
          job: data.job,
          isDuplicate: data.isDuplicate,
          duplicateReason: data.duplicateReason,
        };
      } catch (uploadErr) {
        lastErr = uploadErr;
        console.warn(`[UploadQueue] Reintento de subida (${attempts}/${maxAttempts}) para "${file.name}":`, uploadErr);
        if (attempts < maxAttempts) {
          onProgress?.(55, `Reconectando subida (${attempts}/${maxAttempts})...`);
          await new Promise((r) => setTimeout(r, 2000 * attempts));
        }
      }
    }

    throw lastErr || new Error('No se pudo completar la subida tras 3 intentos.');
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Error durante la subida de factura',
    };
  }
}

/**
 * Consulta la lista de trabajos en segundo plano para una obra
 */
export async function fetchProjectJobs(projectId: string): Promise<BackendInvoiceJob[]> {
  try {
    const res = await fetch(`/api/invoices/jobs?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch (err) {
    console.warn('[QueueService] Error consultando trabajos:', err);
    return [];
  }
}

/**
 * Reintenta un trabajo que haya quedado en error o revisar
 */
export async function retryInvoiceJob(jobId: string): Promise<{ success: boolean; job?: BackendInvoiceJob; error?: string }> {
  try {
    const res = await fetch(`/api/invoices/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Error al reintentar trabajo' };
    }
    return { success: true, job: data.job };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de conexión al reintentar' };
  }
}

/**
 * Consulta la cantidad de facturas con estado "revisar"
 */
export async function fetchBadgeReviewCount(projectId?: string): Promise<number> {
  try {
    const url = projectId
      ? `/api/invoices/badge-review?projectId=${encodeURIComponent(projectId)}`
      : '/api/invoices/badge-review';
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.count) || 0;
  } catch {
    return 0;
  }
}

export { wakeLock };
