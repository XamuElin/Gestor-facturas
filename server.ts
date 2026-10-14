import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import * as XLSX from 'xlsx';
import { google } from 'googleapis';
import { PDFParse } from 'pdf-parse';
import crypto from 'crypto';
import {
  WORKER_CONCURRENCY,
  enqueueInvoiceJob,
  getJobsForProject,
  retryJob,
  getBadgeReviewCount,
} from './src/server/invoiceWorker';
import { getGenAI, callGemini, isTransientError, isDailyQuotaError } from './src/server/gemini';
import { extractInvoice, cleanLocaleAmount, InvoiceExtractionError } from './src/server/invoiceExtraction';
import {
  ensureSheetLayout,
  appendRowWithLayout,
  SheetDuplicateIndex,
  mapWithConcurrency,
  getSheetSession,
  invalidateSheetSession,
  isGoogleRateLimitError,
  withGoogleRetry,
} from './src/server/sheetsWriter';

dotenv.config();

const app = express();
const PORT = 3000;

// Handle JSON bodies up to 50MB for image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/**
 * Extrae y valida el token OAuth de Google desde Authorization header o body.
 * Filtra valores corruptos o vacíos como "null", "undefined", o cadenas cortas.
 */
export function extractOAuthToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  let rawToken: string | null = null;
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.substring(7).trim();
    } else {
      rawToken = authHeader.trim();
    }
  } else if (req.body && typeof req.body.accessToken === 'string') {
    rawToken = req.body.accessToken.trim();
  }
  if (
    !rawToken ||
    rawToken === 'null' ||
    rawToken === 'undefined' ||
    rawToken === 'Bearer null' ||
    rawToken === 'Bearer undefined' ||
    rawToken.length < 15
  ) {
    return null;
  }
  return rawToken;
}

/**
 * Detecta si un error originado en Google APIs o Gaxios corresponde a credenciales expiradas o faltantes.
 */
export function isGoogleAuthError(err: any): boolean {
  if (!err) return false;
  const rawStatus =
    err?.status ??
    err?.code ??
    err?.response?.status ??
    err?.response?.statusCode ??
    err?.response?.data?.error?.code;
  const numStatus = Number(rawStatus);

  const errorString = [
    err?.message,
    err?.name,
    String(err),
    err?.response?.statusText,
    err?.response?.data?.error?.message,
    err?.response?.data?.error?.status,
    typeof err?.response?.data === 'string' ? err?.response?.data : '',
    JSON.stringify(err?.response?.data || {}),
    JSON.stringify(err?.errors || []),
    err?.data?.error?.message,
    JSON.stringify(err?.data || {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Ojo: no buscar "401" como texto suelto; aparece en IDs de archivos, importes o mensajes de cuota
  return (
    numStatus === 401 ||
    rawStatus === '401' ||
    rawStatus === 'UNAUTHENTICATED' ||
    /\b401\b.*unauthori|unauthori[sz]ed/.test(errorString) ||
    errorString.includes('invalid authentication credentials') ||
    errorString.includes('invalid credentials') ||
    errorString.includes('expected oauth 2') ||
    errorString.includes('unauthenticated') ||
    errorString.includes('invalid_grant') ||
    errorString.includes('login cookie') ||
    errorString.includes('invalid_token') ||
    errorString.includes('token has been expired') ||
    errorString.includes('token de autenticación') ||
    errorString.includes('autherror') ||
    errorString.includes('auth error')
  );
}

/**
 * Responde uniformemente a errores de Google APIs devolviendo HTTP 401 estructurado si las credenciales expiraron.
 */
export function handleGoogleApiError(res: express.Response, prefix: string, error: any) {
  if (isGoogleAuthError(error)) {
    console.warn(`[Google Auth Error] 401 en ${prefix}: Token expirado o inválido.`);
    return res.status(401).json({
      success: false,
      isAuthError: true,
      error: 'Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para renovar tus credenciales.',
    });
  }

  if (isGoogleRateLimitError(error)) {
    console.warn(`[Google Quota] 429 en ${prefix}`);
    return res.status(429).json({
      success: false,
      isQuota: true,
      error: 'Google Drive/Sheets pidió esperar un momento por exceso de peticiones. Se reintentará automáticamente.',
    });
  }

  console.error(`Error en ${prefix}:`, error);
  const errMsg = String(
    error?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error ||
    ''
  );
  return res.status(500).json({
    success: false,
    error: `${prefix}: ${errMsg || 'Error desconocido'}`,
  });
}

/**
 * Extracción de facturas con IA: toda la lógica vive en src/server/invoiceExtraction.ts y
 * src/server/gemini.ts. Estas funciones mantienen la firma que usan los endpoints existentes.
 */
export { cleanLocaleAmount };

function isTransientCapacityError(err: any): boolean {
  return isTransientError(err);
}

// Mantiene la firma anterior (ai, contents, config, tarea, modelo) para los endpoints de nóminas y análisis
async function callGeminiWithRetry(
  _ai: GoogleGenAI,
  contents: any,
  schemaConfig: any,
  taskDescription: string = 'Inferencia IA',
  preferredModel?: string
): Promise<{ success: boolean; text?: string; error?: any; modelUsed?: string }> {
  const r = await callGemini(contents, schemaConfig, { task: taskDescription, preferredModel });
  return { success: r.success, text: r.text, error: r.error, modelUsed: r.modelUsed };
}

export async function extractInvoiceWithStructuredOutput(
  _ai: GoogleGenAI,
  fileBase64: string,
  mimeType: string,
  fileName: string = 'factura',
  preferredModel?: string
): Promise<any> {
  const result = await extractInvoice({ base64: fileBase64, mimeType, fileName, preferredModel });
  return { ...result.data, status: result.status, durationMs: result.durationMs };
}

/**
 * Descarga de manera robusta un archivo binario desde Google Drive.
 * Soporta Google Docs (exportándolos a PDF), maneja permisos con supportsAllDrives,
 * y previene errores 403 por descarga indebida de archivos de Google Workspace (Hojas de cálculo, formularios, etc.)
 */
async function downloadDriveFileBuffer(
  drive: any,
  fileId: string,
  providedMimeType?: string,
  providedFileName?: string
): Promise<{ buffer: Buffer; mimeType: string; fileName: string; isGoogleDoc?: boolean }> {
  if (!fileId) throw new Error('Se requiere un ID de archivo de Google Drive válido.');

  let meta: any = null;
  try {
    const metaRes = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, webViewLink, size',
      supportsAllDrives: true,
    });
    meta = metaRes.data;
  } catch (err: any) {
    const status = err?.status || err?.code || err?.response?.status;
    const msg = err?.response?.data?.error?.message || err?.message || 'Error de acceso a Drive';
    if (status === 403 || status === 404) {
      throw new Error(`Permisos insuficientes o archivo no accesible en Google Drive (ID: ${fileId}): ${msg}`);
    }
    throw err;
  }

  const effectiveMime = meta?.mimeType || providedMimeType || '';
  const fileName = meta?.name || providedFileName || `archivo_${fileId}`;

  // Archivos de Google Workspace no convertibles a imagen o PDF de factura
  if (
    effectiveMime === 'application/vnd.google-apps.spreadsheet' ||
    effectiveMime === 'application/vnd.google-apps.presentation' ||
    effectiveMime === 'application/vnd.google-apps.folder' ||
    effectiveMime === 'application/vnd.google-apps.form' ||
    effectiveMime === 'application/vnd.google-apps.site' ||
    effectiveMime === 'application/vnd.google-apps.map' ||
    effectiveMime === 'application/vnd.google-apps.shortcut'
  ) {
    throw new Error(
      `El elemento "${fileName}" es un recurso de Google Workspace (${effectiveMime}) y no un comprobante descargable.`
    );
  }

  // Si es un documento de Google Docs, exportarlo directamente a PDF
  if (effectiveMime === 'application/vnd.google-apps.document') {
    const exportRes = await drive.files.export(
      { fileId, mimeType: 'application/pdf', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    return {
      buffer: Buffer.from(exportRes.data as ArrayBuffer),
      mimeType: 'application/pdf',
      fileName: fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`,
      isGoogleDoc: true,
    };
  }

  // Descarga binaria estándar (PDF, JPG, PNG, WEBP, XLSX, CSV, etc.)
  const fileStream = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const fileBuffer = Buffer.from(fileStream.data as ArrayBuffer);

  let detectedMime = effectiveMime;
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.pdf')) detectedMime = 'application/pdf';
  else if (lowerName.endsWith('.png')) detectedMime = 'image/png';
  else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) detectedMime = 'image/jpeg';
  else if (lowerName.endsWith('.webp')) detectedMime = 'image/webp';
  else if (lowerName.endsWith('.xlsx')) detectedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  else if (lowerName.endsWith('.csv')) detectedMime = 'text/csv';

  return {
    buffer: fileBuffer,
    mimeType: detectedMime || 'application/pdf',
    fileName,
  };
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Analiza una factura subida desde el navegador y devuelve los datos para el modal de revisión
app.post('/api/analyze-invoice', async (req, res) => {
  try {
    const { imageBase64, mimeType, fileName, model } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: 'Falta el archivo de la factura.' });
    }

    const result = await extractInvoice({ base64: imageBase64, mimeType, fileName, preferredModel: model });
    console.log(`[Factura] "${fileName || 'doc'}" leída en ${result.durationMs} ms con ${result.modelUsed} → ${result.status}`);

    return res.json({
      success: true,
      data: result.data,
      status: result.status,
      reasons: result.reasons,
      modelUsed: result.modelUsed,
      durationMs: result.durationMs,
    });
  } catch (error: any) {
    const isQuota = isTransientCapacityError(error?.cause ?? error);
    console.warn('[Factura] Error al analizar:', error?.message || error);
    return res.status(isQuota ? 429 : 422).json({
      success: false,
      isQuota,
      isDailyQuota: isDailyQuotaError(error),
      error: error?.message || 'No se pudo leer la factura.',
    });
  }
});

/**
 * NUEVO FLUJO EN SEGUNDO PLANO:
 * 1. El cliente sube archivo comprimido o PDF tal cual.
 * 2. El backend lo guarda de inmediato en Drive si se proveen credenciales,
 *    crea el trabajo con estado "en_cola" y responde de inmediato "recibida".
 * 3. El worker en segundo plano procesa hasta 4 concurrentes llamando a Gemini.
 */
app.post('/api/invoices/upload-and-enqueue', async (req, res) => {
  try {
    const {
      fileBase64,
      fileName,
      mimeType,
      fileSha256,
      fileSizeBytes,
      targetFolderId,
      projectId,
      projectName,
      spreadsheetId,
      sheetTab,
    } = req.body;

    if (!fileBase64 || !fileName) {
      return res.status(400).json({ success: false, error: 'Falta el archivo o nombre del documento.' });
    }

    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : req.body.accessToken;

    const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
    let calculatedSha256 = fileSha256;
    if (!calculatedSha256) {
      calculatedSha256 = crypto.createHash('sha256').update(Buffer.from(cleanBase64, 'base64')).digest('hex');
    }

    // Guardar archivo en Google Drive de inmediato en la subcarpeta de esa obra
    let driveFileId: string | undefined;
    let driveWebViewLink: string | undefined;

    if (token && targetFolderId && targetFolderId !== 'root') {
      try {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: token });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const fileBuffer = Buffer.from(cleanBase64, 'base64');
        const { Readable } = await import('stream');
        const mediaStream = new Readable();
        mediaStream.push(fileBuffer);
        mediaStream.push(null);

        const driveRes = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [targetFolderId],
          },
          media: {
            mimeType: mimeType || (cleanBase64.startsWith('JVBERi0') ? 'application/pdf' : 'image/jpeg'),
            body: mediaStream,
          },
          fields: 'id, name, webViewLink',
        });

        driveFileId = driveRes.data.id || undefined;
        driveWebViewLink = driveRes.data.webViewLink || undefined;
      } catch (driveErr: any) {
        console.warn('[Upload-Enqueue] Aviso subiendo archivo a Google Drive:', driveErr?.message || driveErr);
      }
    }

    // Encolar trabajo para el worker en segundo plano
    const { job, isDuplicate, duplicateReason } = enqueueInvoiceJob({
      projectId: projectId || targetFolderId || 'obra_default',
      projectName,
      fileName,
      fileSha256: calculatedSha256,
      fileSizeBytes: fileSizeBytes || Math.round(cleanBase64.length * 0.75),
      mimeType: mimeType || (cleanBase64.startsWith('JVBERi0') ? 'application/pdf' : 'image/jpeg'),
      fileBase64: cleanBase64,
      targetFolderId: targetFolderId || 'root',
      spreadsheetId,
      sheetTab,
      driveFileId,
      driveWebViewLink,
      userToken: token,
    });

    // Responder de inmediato "recibida" (cumple criterio y permite cerrar la app)
    return res.json({
      success: true,
      status: 'recibida',
      message: '✓ Recibida. Guardada en Drive y encolada para lectura en segundo plano.',
      jobId: job.id,
      job,
      isDuplicate,
      duplicateReason,
      driveFileId,
      driveWebViewLink,
    });
  } catch (error: any) {
    console.error('Error en /api/invoices/upload-and-enqueue:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al encolar factura: ' + (error?.message || error),
    });
  }
});

// Consultar trabajos de la obra (para polling cada 3 s o recuperación al abrir la app)
app.get('/api/invoices/jobs', (req, res) => {
  const projectId = String(req.query.projectId || '');
  const jobs = getJobsForProject(projectId);
  return res.json({ success: true, jobs });
});

// Reintentar manualmente un trabajo en estado 'error' o 'revisar'
app.post('/api/invoices/jobs/:id/retry', (req, res) => {
  const { id } = req.params;
  const job = retryJob(id, extractOAuthToken(req) || undefined);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Trabajo no encontrado.' });
  }
  return res.json({ success: true, job });
});

// Contador de facturas con estado "revisar" para la insignia (badge)
app.get('/api/invoices/badge-review', (req, res) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
  const count = getBadgeReviewCount(projectId);
  return res.json({ success: true, count });
});

/**
 * 2. PROCESAMIENTO EN LOTE (LEER CARPETA COMPLETA DE GOOGLE DRIVE)
 * + 3. INYECCIÓN AUTOMÁTICA EN GOOGLE SHEETS CON FORMATO POR DEFECTO
 * Endpoint: POST /api/process-folder
 */
app.post('/api/process-folder', async (req, res) => {
  try {
    const { folderId, spreadsheetId, sheetName } = req.body;
    const token = extractOAuthToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        isAuthError: true,
        error:
          'Se requiere token de autenticación OAuth de Google válido. Por favor inicia sesión o renueva tu conexión.',
      });
    }

    if (!folderId || folderId === 'root' || folderId === 'shared-with-me' || folderId === 'shared-drives') {
      return res.status(400).json({
        success: false,
        error:
          'Por favor selecciona una carpeta específica de la obra dentro de Google Drive para procesar sus comprobantes.',
      });
    }

    if (!getGenAI()) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY no está configurada en el servidor. Añádela al archivo .env y reinicia.',
      });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Listar archivos de la carpeta (paginado)
    const allFiles: any[] = [];
    let pageToken: string | undefined;
    do {
      const list = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, name, mimeType, webViewLink, size)',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      allFiles.push(...(list.data.files || []));
      pageToken = list.data.nextPageToken || undefined;
    } while (pageToken && allFiles.length < 1000);

    const supportedFiles = allFiles.filter((file) => {
      const name = (file.name || '').toLowerCase();
      const mime = (file.mimeType || '').toLowerCase();
      return (
        mime === 'application/pdf' ||
        mime.startsWith('image/') ||
        mime === 'application/vnd.google-apps.document' ||
        /\.(pdf|png|jpe?g|webp|heic|xlsx|xls|csv)$/.test(name)
      );
    });

    if (supportedFiles.length === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron facturas o comprobantes soportados (PDF, imagen, Excel) en esta carpeta.',
        folderId,
        totalFilesInFolder: allFiles.length,
        supportedFilesCount: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
      });
    }

    // 2. Hoja de destino: la indicada, una existente en la carpeta o una nueva
    let targetSpreadsheetId: string | null | undefined = spreadsheetId;
    if (!targetSpreadsheetId) {
      const existingSheet = allFiles.find((f) => f.mimeType === 'application/vnd.google-apps.spreadsheet');
      if (existingSheet) {
        targetSpreadsheetId = existingSheet.id;
      } else {
        const folderMeta = await drive.files.get({ fileId: folderId, fields: 'name' }).catch(() => null);
        const rawFolderName = folderMeta?.data?.name || 'Facturas';
        const baseProject = rawFolderName.replace(/^(Obra:\s*|Proyecto:\s*)/i, '').replace(/[:\/\\?*|"]/g, ' ').trim() || rawFolderName;
        const title = /facturaci[oó]n/i.test(baseProject) ? baseProject : `${baseProject} Facturación`;
        const created = await sheets.spreadsheets.create({ requestBody: { properties: { title } } });
        targetSpreadsheetId = created.data.spreadsheetId;
        if (targetSpreadsheetId) {
          await drive.files.update({ fileId: targetSpreadsheetId, addParents: folderId, fields: 'id, parents' });
        }
      }
    }
    if (!targetSpreadsheetId) throw new Error('No se pudo preparar la hoja de cálculo de destino.');

    const layout = await ensureSheetLayout(sheets, targetSpreadsheetId, sheetName);
    const dupIndex = await SheetDuplicateIndex.load(sheets, layout);

    // 3. Procesar en paralelo con un límite de tiempo por lote; el cliente puede pedir el siguiente lote
    const maxFiles = Math.min(Number(req.body.maxFiles) || 12, 40);
    const pending = supportedFiles.filter((f) => !dupIndex.checkFile(f.id, f.name));
    const skippedUpfront = supportedFiles.filter((f) => dupIndex.checkFile(f.id, f.name));
    const filesToProcess = pending.slice(0, maxFiles);
    const deadline = Date.now() + (Number(req.body.timeBudgetMs) || 50_000);

    const processed = await mapWithConcurrency(filesToProcess, WORKER_CONCURRENCY, async (file) => {
      let fileName = file.name || file.id;
      if (Date.now() > deadline) {
        return { fileId: file.id, fileName, status: 'deferred', message: 'Pendiente para el siguiente lote.' };
      }
      try {
        const downloaded = await downloadDriveFileBuffer(drive, file.id!, file.mimeType, fileName);
        fileName = downloaded.fileName || fileName;
        const result = await extractInvoice({
          base64: downloaded.buffer.toString('base64'),
          mimeType: downloaded.mimeType,
          fileName,
        });
        const extracted = result.data;

        const dupReason = dupIndex.checkInvoice(extracted);
        if (dupReason) {
          return { fileId: file.id, fileName, status: 'skipped_duplicate', message: `Factura repetida: ${dupReason}`, extracted };
        }
        dupIndex.add(file.id, fileName, extracted);

        const driveUrl = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
        await appendRowWithLayout(sheets, layout, extracted, driveUrl, fileName);
        return { fileId: file.id, fileName, status: 'success', reviewStatus: result.status, reasons: result.reasons, extracted };
      } catch (fileError: any) {
        console.warn(`[Carpeta] Error en "${fileName}": ${fileError?.message || fileError}`);
        return { fileId: file.id, fileName, status: 'error', error: fileError?.message || String(fileError) };
      }
    });

    const results = [
      ...skippedUpfront.map((f) => ({
        fileId: f.id,
        fileName: f.name,
        status: 'skipped_duplicate',
        message: `Factura repetida: ${dupIndex.checkFile(f.id, f.name)}`,
      })),
      ...processed,
    ];
    const successCount = processed.filter((r) => r.status === 'success').length;
    const failureCount = processed.filter((r) => r.status === 'error').length;
    const deferred = processed.filter((r) => r.status === 'deferred').length;
    const remainingCount = pending.length - filesToProcess.length + deferred;

    let message = `Procesamiento completado: ${successCount} facturas registradas en Sheets.`;
    if (remainingCount > 0) message += ` Quedan ${remainingCount} comprobantes por procesar.`;

    return res.json({
      success: true,
      message,
      folderId,
      spreadsheetId: targetSpreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
      sheetTitle: layout.tab,
      totalFilesInFolder: allFiles.length,
      supportedFilesCount: supportedFiles.length,
      processedThisBatch: filesToProcess.length - deferred,
      remainingCount,
      successCount,
      failureCount,
      results,
    });
  } catch (error: any) {
    return handleGoogleApiError(res, 'Error al procesar la carpeta', error);
  }
});

/**
 * Endpoint: POST /api/process-drive-file
 * Procesa un archivo individual de Drive y lo registra en Sheets.
 * Ultra rápido (1-3s), permitiendo progreso interactivo sin riesgo de timeouts.
 */
app.post('/api/process-drive-file', async (req, res) => {
  try {
    const { fileId, fileName, mimeType, folderId, spreadsheetId, sheetName, skipAppend, model } = req.body;
    const token = extractOAuthToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        isAuthError: true,
        error: 'Se requiere token de autenticación OAuth de Google válido. Por favor inicia sesión o renueva tu conexión.',
      });
    }
    if (!fileId) {
      return res.status(400).json({ success: false, error: 'El parámetro "fileId" es obligatorio.' });
    }
    if (!getGenAI()) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY no está configurada en el servidor. Añádela al archivo .env y reinicia.',
      });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Hoja de destino (la indicada o la primera hoja de cálculo de la carpeta).
    //    Se resuelve y se lee una sola vez por lote (caché de unos minutos compartida entre peticiones).
    let targetSpreadsheetId: string | null | undefined = spreadsheetId;
    if (!targetSpreadsheetId && folderId) {
      targetSpreadsheetId = await findFolderSpreadsheet(drive, token, folderId);
    }
    const session = targetSpreadsheetId ? await getSheetSession(sheets, token, targetSpreadsheetId, sheetName) : null;
    const layout = session?.layout ?? null;
    const dupIndex = session?.dupIndex ?? null;
    const fileViewUrl = `https://drive.google.com/file/d/${fileId}/view`;

    // 2. Si el archivo ya está en la hoja, no gastar una lectura de IA
    const fileDup = dupIndex?.checkFile(fileId, fileName);
    if (fileDup) {
      return res.json({
        success: true,
        isDuplicate: true,
        message: `Factura repetida: ${fileDup} Omitida para evitar doble facturación.`,
        fileId,
        fileName,
        driveUrl: fileViewUrl,
        spreadsheetId: targetSpreadsheetId,
      });
    }

    // 3. Descargar y leer con IA
    const downloaded = await downloadDriveFileBuffer(drive, fileId, mimeType, fileName);
    const safeName = downloaded.fileName;
    const result = await extractInvoice({
      base64: downloaded.buffer.toString('base64'),
      mimeType: downloaded.mimeType,
      fileName: safeName,
      preferredModel: model,
    });
    const extracted: any = {
      ...result.data,
      status: result.status,
      driveUrl: fileViewUrl,
      webViewLink: fileViewUrl,
      fileId,
      fileName: safeName,
    };

    const invoiceDup = dupIndex?.checkInvoice(extracted);
    if (invoiceDup) {
      return res.json({
        success: true,
        isDuplicate: true,
        message: `Factura repetida: ${invoiceDup} Omitida para evitar doble facturación.`,
        fileId,
        fileName: safeName,
        driveUrl: fileViewUrl,
        extracted,
        spreadsheetId: targetSpreadsheetId,
      });
    }

    let sheetAppended = false;
    if (layout && !skipAppend) {
      try {
        await appendRowWithLayout(sheets, layout, extracted, fileViewUrl, safeName);
        dupIndex?.add(fileId, safeName, extracted);
        sheetAppended = true;
      } catch (appendErr: any) {
        invalidateSheetSession(token, targetSpreadsheetId!, sheetName);
        throw appendErr;
      }
    }

    return res.json({
      success: true,
      fileId,
      fileName: safeName,
      driveUrl: fileViewUrl,
      extracted,
      sheetAppended,
      reviewStatus: result.status,
      reasons: result.reasons,
      spreadsheetId: targetSpreadsheetId,
      spreadsheetUrl: targetSpreadsheetId ? `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit` : undefined,
    });
  } catch (err: any) {
    const name = req.body?.fileName || req.body?.fileId;
    if (err instanceof InvoiceExtractionError) {
      const transient = isTransientError(err.cause);
      console.error(`[process-drive-file] ${name}: ${err.message}`);
      return res
        .status(transient ? 429 : 422)
        .json({ success: false, isQuota: transient, isDailyQuota: isDailyQuotaError(err), error: err.message });
    }
    console.error(`[process-drive-file] ${name}: ${err?.message || err}`);
    return handleGoogleApiError(res, `Error al procesar "${name}"`, err);
  }
});

// Carpeta de Drive → primera hoja de cálculo que contiene (en caché unos minutos por usuario)
const folderSheetCache = new Map<string, { expires: number; id: string | null }>();
async function findFolderSpreadsheet(drive: any, token: string, folderId: string): Promise<string | null> {
  const key = `${token.slice(-24)}|${folderId}`;
  const hit = folderSheetCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.id;
  const found = await withGoogleRetry(
    () =>
      drive.files.list({
        q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        fields: 'files(id, name)',
        orderBy: 'createdTime',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
    'Drive buscar hoja'
  ).catch(() => null);
  const id: string | null = (found as any)?.data?.files?.[0]?.id ?? null;
  folderSheetCache.set(key, { expires: Date.now() + 5 * 60 * 1000, id });
  return id;
}

/**
 * Endpoint: POST /api/append-invoice-row
 * Inserta de forma segura y robusta una fila en Google Sheets usando el SDK oficial de Google.
 * Evita problemas de CORS, URL encoding de métodos personalizados (:append) y bloqueos de cliente.
 */
app.post('/api/append-invoice-row', async (req, res) => {
  try {
    const { spreadsheetId, sheetTitle = 'Facturas', rowValues } = req.body;
    const token = extractOAuthToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        isAuthError: true,
        error: 'Se requiere token de autenticación de Google OAuth válido.',
      });
    }

    if (!spreadsheetId || !rowValues || !Array.isArray(rowValues)) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros requeridos: spreadsheetId y rowValues.',
      });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // Determinar la pestaña real en el libro
    let targetTitle = sheetTitle;
    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title',
      });
      const titles = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean) as string[];
      if (!titles.includes(targetTitle)) {
        const found = titles.find((t) => t.toLowerCase() === targetTitle.toLowerCase());
        if (found) {
          targetTitle = found;
        } else if (titles.length > 0) {
          targetTitle = titles[0];
        }
      }
    } catch (metaErr) {
      console.warn('Aviso obteniendo metadatos de hojas:', metaErr);
    }

    const range = `'${targetTitle.replace(/'/g, "''")}'!A:Z`;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowValues],
      },
    });

    return res.json({
      success: true,
      message: 'Fila agregada exitosamente a Google Sheets.',
      sheetTitle: targetTitle,
    });
  } catch (err: any) {
    return handleGoogleApiError(res, 'Error registrando fila en Sheets', err);
  }
});

/**
 * Endpoint: POST /api/rename-drive-file
 * Renombra un archivo existente en Google Drive.
 */
app.post('/api/rename-drive-file', async (req, res) => {
  try {
    const { fileId, newFileName } = req.body;
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : req.body.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Se requiere token de autenticación de Google OAuth.',
      });
    }

    if (!fileId || !newFileName || typeof newFileName !== 'string' || !newFileName.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros requeridos: fileId y newFileName.',
      });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const trimmedName = newFileName.trim();
    await drive.files.update({
      fileId,
      requestBody: {
        name: trimmedName,
      },
    });

    console.log(`[Drive] Archivo ${fileId} renombrado a "${trimmedName}" exitosamente.`);

    return res.json({
      success: true,
      message: `Archivo renombrado en Google Drive a "${trimmedName}".`,
      fileId,
      newFileName: trimmedName,
    });
  } catch (err: any) {
    console.error('Error en /api/rename-drive-file:', err);
    return res.status(500).json({
      success: false,
      error: 'Error renombrando archivo en Drive: ' + (err?.message || 'Error desconocido'),
    });
  }
});

/**
 * ====================================================================
 * ENDPOINT DE EXPORTACIÓN INFALIBLE CON LOGO Y PALETA CORPORATIVA SVH
 * POST /api/export-invoices-styled
 * ====================================================================
 * 1. Inserta la fórmula =IMAGE("https://i.postimg.cc/Hn6LNwm0/image.png", 1) en A1.
 * 2. Combina (mergeCells) el rango A1:E3 (o columnas A:I) para dar espacio al logo como banner.
 * 3. Escribe los títulos en la fila 4 con fondo verde oscuro #337337, texto blanco y negrita.
 * 4. Escribe los datos a partir de la fila 5.
 * 5. Aplica alternancia de color (banding) con verde suave corporativo (#94C23D con transparencia / tint) o gris claro.
 * 6. Aplica formato CURRENCY ("$"#,##0.00) a las columnas de Subtotal, IVA y Total.
 * 7. Ejecuta autoResizeDimensions en todas las columnas para que ningún texto quede cortado.
 */
app.post('/api/export-invoices-styled', async (req, res) => {
  try {
    const token = extractOAuthToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        isAuthError: true,
        error: 'Se requiere token de autenticación de Google OAuth válido. Por favor inicia sesión o renueva tu conexión.',
      });
    }

    const {
      invoices = [],
      folderId,
      spreadsheetId: existingSpreadsheetId,
      sheetTitle = 'Control Facturas',
      projectName = 'Proyecto SVH',
    } = req.body;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    let targetSpreadsheetId = existingSpreadsheetId;

    // Si no se proporcionó ID de hoja, crear un nuevo Google Sheet corporativo con el nombre del proyecto más "Facturación"
    if (!targetSpreadsheetId) {
      const baseProject = projectName.replace(/^(Obra:\s*|Proyecto:\s*)/i, '').replace(/[:\/\\?*|"]/g, ' ').trim() || projectName;
      const cleanProj = /facturaci[oó]n/i.test(baseProject) ? baseProject : `${baseProject} Facturación`;
      const createSheetRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: cleanProj,
          },
        },
      });
      targetSpreadsheetId = createSheetRes.data.spreadsheetId;

      // Mover a la carpeta de Drive elegida si se especificó folderId
      if (folderId && targetSpreadsheetId && folderId !== 'root') {
        try {
          const fileMeta = await drive.files.get({
            fileId: targetSpreadsheetId,
            fields: 'parents',
          });
          const previousParents = (fileMeta.data.parents || []).join(',');
          await drive.files.update({
            fileId: targetSpreadsheetId,
            addParents: folderId,
            removeParents: previousParents || undefined,
            fields: 'id, parents',
          });
          console.log(`[export-invoices-styled] Hoja ${targetSpreadsheetId} vinculada y movida exitosamente a la carpeta elegida: ${folderId}`);
        } catch (moveErr) {
          console.warn('Aviso organizando archivo en carpeta de Drive:', moveErr);
        }
      }
    }

    if (!targetSpreadsheetId) {
      return res.status(500).json({
        success: false,
        error: 'No se pudo crear ni resolver el Spreadsheet de destino.',
      });
    }

    // Obtener información del Sheet y sheetId de la primera pestaña
    const sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId: targetSpreadsheetId,
      fields: 'sheets(properties(sheetId,title))',
    });

    const primarySheet = sheetMeta.data.sheets?.[0];
    const targetSheetIdNumber = primarySheet?.properties?.sheetId || 0;
    const activeTabTitle = primarySheet?.properties?.title || sheetTitle;

    // 1. Limpiar o asegurar que la hoja esté lista para el diseño ejecutivo
    // Escribir la fórmula del Logo en A1 y los encabezados en la Fila 4 (A4:I4)
    const logoFormula = '=IMAGE("https://i.postimg.cc/Hn6LNwm0/image.png", 1)';
    const headers = [
      'Fecha',
      'Cliente / Proveedor',
      'NIT / RUT',
      'Concepto / Detalle',
      'Categoría',
      'Subtotal',
      'IVA',
      'Total a Pagar',
      'Comprobante / Archivo',
    ];

    // Mapear archivos de Drive en folderId para enlazar cualquier foto/PDF faltante
    const driveFileMap = new Map<string, string>();
    if (folderId) {
      try {
        const driveFiles = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'files(id, name, webViewLink)',
          pageSize: 200,
        });
        (driveFiles.data.files || []).forEach((f) => {
          if (f.name && f.webViewLink) {
            driveFileMap.set(f.name.toLowerCase().trim(), f.webViewLink);
            const noExt = f.name.replace(/\.[^/.]+$/, '').toLowerCase().trim();
            driveFileMap.set(noExt, f.webViewLink);
          }
        });
      } catch (listErr) {
        console.warn('No se pudo listar archivos para mapear enlaces en folderId:', listErr);
      }
    }

    // Preparar filas de datos (a partir de la fila 5) con enlaces cliqueables =HYPERLINK()
    const dataRows = (invoices || []).map((inv: any) => {
      const fecha = inv.fecha || inv.date || new Date().toISOString().split('T')[0];
      const cliente = inv.cliente || inv.vendorName || 'Sin especificar';
      const nitRut = inv.nitRut || inv.vendorTaxId || '';
      const concepto = inv.concepto || inv.concept || 'Factura de obra';
      const categoria = inv.categoria || inv.category || 'Materiales';
      const subtotal = Number(inv.subtotal ?? 0);
      const iva = Number(inv.iva ?? inv.taxAmount ?? 0);
      const total = Number(inv.total ?? inv.totalAmount ?? 0);

      const rawFileName = inv.fileName || inv.name || 'Comprobante.pdf';
      let resolvedLink = inv.driveUrl || inv.webViewLink;
      if (!resolvedLink && rawFileName) {
        resolvedLink =
          driveFileMap.get(rawFileName.toLowerCase().trim()) ||
          driveFileMap.get(rawFileName.replace(/\.[^/.]+$/, '').toLowerCase().trim());
      }

      const safeName = String(rawFileName).replace(/"/g, '""');
      const docLink = resolvedLink
        ? `=HYPERLINK("${resolvedLink}", "${safeName}")`
        : safeName;

      return [fecha, cliente, nitRut, concepto, categoria, subtotal, iva, total, docLink];
    });

    // Inyectar Logo en A1
    await sheets.spreadsheets.values.update({
      spreadsheetId: targetSpreadsheetId,
      range: `'${activeTabTitle}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[logoFormula]],
      },
    });

    // Inyectar Encabezados en A4:I4
    await sheets.spreadsheets.values.update({
      spreadsheetId: targetSpreadsheetId,
      range: `'${activeTabTitle}'!A4:I4`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers],
      },
    });

    // Inyectar Filas de datos a partir de A5
    if (dataRows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: targetSpreadsheetId,
        range: `'${activeTabTitle}'!A5:I${4 + dataRows.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: dataRows,
        },
      });
    }

    // 2 y 3. Construir array exacto de requests para batchUpdate
    // - Merge A1:E3 para el logotipo con suficiente espacio
    // - Estilo corporativo Verde Oscuro #337337 para fila 4 (headers)
    // - Colores alternos (banding) verde suave #94C23D / gris claro
    // - Formato de Moneda para Subtotal (Col E), IVA (Col F), Total (Col G) -> startColumnIndex 5 a 8
    // - AutoResizeDimensions en todas las columnas (0 a 9)
    const totalDataRowsCount = Math.max(dataRows.length, 1);
    const endRowIndexForData = 4 + totalDataRowsCount;

    // Paleta corporativa SVH Arquitectos:
    // Verde Oscuro #337337 -> R: 51/255 = 0.20, G: 115/255 = 0.45098, B: 55/255 = 0.21568
    const darkGreenColor = { red: 0.2, green: 0.451, blue: 0.216 };
    // Verde Claro #94C23D -> R: 148/255 = 0.58, G: 194/255 = 0.7607, B: 61/255 = 0.2392
    // Para fondo de celda alterno ultra suave, aplicamos tinte suave (~10% opacidad visual o gris verdoso suave)
    const softGreenRowColor = { red: 0.94, green: 0.98, blue: 0.92 };
    const whiteColor = { red: 1.0, green: 1.0, blue: 1.0 };

    const batchRequests: any[] = [
      // 1. Merge de celdas A1:E3 (Filas 0 a 3, Columnas 0 a 5)
      {
        mergeCells: {
          range: {
            sheetId: targetSheetIdNumber,
            startRowIndex: 0,
            endRowIndex: 3,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
          mergeType: 'MERGE_ALL',
        },
      },
      // Centrar y dar fondo blanco limpio al área combinada del logo
      {
        repeatCell: {
          range: {
            sheetId: targetSheetIdNumber,
            startRowIndex: 0,
            endRowIndex: 3,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: whiteColor,
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)',
        },
      },
      // 2. Fila de Títulos (Fila 4 -> startRowIndex: 3, endRowIndex: 4)
      // Fondo verde oscuro #337337, texto blanco, negrita, centrado
      {
        repeatCell: {
          range: {
            sheetId: targetSheetIdNumber,
            startRowIndex: 3,
            endRowIndex: 4,
            startColumnIndex: 0,
            endColumnIndex: 9,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: darkGreenColor,
              textFormat: {
                foregroundColor: whiteColor,
                fontSize: 11,
                bold: true,
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
        },
      },
      // 3. Formato de Moneda (CURRENCY) para columnas F, G, H (Subtotal, IVA, Total -> Cols 5, 6, 7)
      {
        repeatCell: {
          range: {
            sheetId: targetSheetIdNumber,
            startRowIndex: 4,
            endRowIndex: endRowIndexForData + 1,
            startColumnIndex: 5,
            endColumnIndex: 8,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'CURRENCY',
                pattern: '"$"#,##0.00',
              },
              horizontalAlignment: 'RIGHT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // 4. Centrar columna de Fecha (Col 0) y NIT (Col 2)
      {
        repeatCell: {
          range: {
            sheetId: targetSheetIdNumber,
            startRowIndex: 4,
            endRowIndex: endRowIndexForData + 1,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
        },
      },
      {
        repeatCell: {
          range: {
            sheetId: targetSheetIdNumber,
            startRowIndex: 4,
            endRowIndex: endRowIndexForData + 1,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
        },
      },
      // 5. Destacar la columna de Total (Col 7) con negrita
      {
        repeatCell: {
          range: {
            sheetId: targetSheetIdNumber,
            startRowIndex: 4,
            endRowIndex: endRowIndexForData + 1,
            startColumnIndex: 7,
            endColumnIndex: 8,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                bold: true,
              },
            },
          },
          fields: 'userEnteredFormat(textFormat)',
        },
      },
      // 6. Inmovilizar fila de títulos (fila 4)
      {
        updateSheetProperties: {
          properties: {
            sheetId: targetSheetIdNumber,
            gridProperties: {
              frozenRowCount: 4,
            },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      // 7. AutoResizeDimensions para que ninguna columna quede cortada
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: targetSheetIdNumber,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 9,
          },
        },
      },
    ];

    // Ejecutar el lote principal de formateo
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: targetSpreadsheetId,
      requestBody: {
        requests: batchRequests,
      },
    });

    // 8. Aplicar Banding (colores alternos de fila) con verde suave #94C23D
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: targetSpreadsheetId,
        requestBody: {
          requests: [
            {
              addBanding: {
                bandedRange: {
                  range: {
                    sheetId: targetSheetIdNumber,
                    startRowIndex: 3, // Inicia en encabezados (fila 4)
                    endRowIndex: endRowIndexForData + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 9,
                  },
                  rowProperties: {
                    headerColor: darkGreenColor,
                    firstBandColor: whiteColor,
                    secondBandColor: softGreenRowColor,
                  },
                },
              },
            },
          ],
        },
      });
    } catch (bandingError) {
      // Si el banding ya existía o falla, aplicar estilo de celdas alternadas directamente
      console.log('[Batch Sheets] Banding opcional ya configurado o omitido.');
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`;

    return res.json({
      success: true,
      message: 'Facturas exportadas exitosamente a Google Sheets con diseño corporativo SVH.',
      spreadsheetId: targetSpreadsheetId,
      spreadsheetUrl,
      spreadsheetName: `Control Facturas SVH - ${projectName.replace(/[:\/\\?*|"]/g, '_')}`,
      folderId,
      projectName,
      rowsCount: dataRows.length,
    });
  } catch (error: any) {
    return handleGoogleApiError(res, 'Error al exportar facturas con diseño corporativo', error);
  }
});

/**
 * POST /api/repair-invoice-links
 * Escanea la carpeta del proyecto en Google Drive, localiza los archivos correspondientes a las facturas
 * registradas y actualiza la columna 'Comprobante / Archivo' en Google Sheets con la fórmula =HYPERLINK()
 * para que el usuario pueda hacer clic y abrir la foto/PDF directamente desde Google Sheets.
 */
app.post('/api/repair-invoice-links', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : req.body.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Se requiere token de autenticación de Google OAuth.',
      });
    }

    const {
      spreadsheetId,
      sheetTitle = 'Control Facturas',
      folderId,
    } = req.body;

    if (!spreadsheetId) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere spreadsheetId.',
      });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Obtener archivos de la carpeta de Drive (y carpetas hijas si las hay)
    const fileMap = new Map<string, { id: string; name: string; webViewLink: string }>();

    // Helper para indexar archivo con normalización
    const indexFile = (file: any) => {
      if (!file.name || !file.webViewLink) return;
      const cleanLower = file.name.toLowerCase().trim();
      const noExt = cleanLower.replace(/\.[^/.]+$/, '').trim();
      const normalizedNumbers = cleanLower.replace(/[^a-z0-9]/g, '');

      fileMap.set(cleanLower, file);
      fileMap.set(noExt, file);
      if (normalizedNumbers) {
        fileMap.set(normalizedNumbers, file);
      }
    };

    if (folderId) {
      try {
        const driveFiles = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'files(id, name, mimeType, webViewLink)',
          pageSize: 200,
        });
        (driveFiles.data.files || []).forEach(indexFile);

        // Si hay subcarpetas dentro de folderId, buscar también en ellas
        const subFolders = (driveFiles.data.files || []).filter(
          (f) => f.mimeType === 'application/vnd.google-apps.folder'
        );
        for (const sf of subFolders) {
          try {
            const subRes = await drive.files.list({
              q: `'${sf.id}' in parents and trashed = false`,
              fields: 'files(id, name, mimeType, webViewLink)',
              pageSize: 200,
            });
            (subRes.data.files || []).forEach(indexFile);
          } catch (e) {
            console.warn('Error leyendo subcarpeta en Drive:', e);
          }
        }
      } catch (err) {
        console.warn('Error listando archivos de Drive en folderId:', err);
      }
    }

    // Si aún faltan archivos o no había folderId, buscar archivos PDF e imágenes creados recientemente
    if (fileMap.size === 0) {
      try {
        const anyFiles = await drive.files.list({
          q: "trashed = false and (mimeType = 'application/pdf' or mimeType contains 'image/')",
          fields: 'files(id, name, mimeType, webViewLink)',
          pageSize: 100,
        });
        (anyFiles.data.files || []).forEach(indexFile);
      } catch (e) {
        console.warn('Error en búsqueda amplia de Drive:', e);
      }
    }

    // 2. Leer datos actuales del Google Sheet
    const sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title))',
    });
    const sheetsList = sheetMeta.data.sheets || [];
    const activeTabObj = sheetsList.find((s) => s.properties?.title === sheetTitle) || sheetsList[0];
    const activeTabTitle = activeTabObj?.properties?.title || sheetTitle;

    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${activeTabTitle}'!A1:Z500`,
      valueRenderOption: 'FORMULA',
    });
    const grid = valuesRes.data.values || [];

    if (grid.length === 0) {
      return res.json({
        success: true,
        updatedCount: 0,
        message: 'La hoja de cálculo está vacía.',
      });
    }

    // 3. Detectar fila de encabezados y columna de 'Comprobante / Archivo'
    let headerRowIdx = -1;
    let comprobanteColIdx = -1;
    let conceptoColIdx = -1;
    let facturaColIdx = -1;

    for (let r = 0; r < Math.min(10, grid.length); r++) {
      const row = grid[r] || [];
      const colIdx = row.findIndex((c: any) =>
        /comprobante|archivo|drive|soporte|enlace|link/i.test(String(c || ''))
      );
      if (colIdx >= 0) {
        headerRowIdx = r;
        comprobanteColIdx = colIdx;
        conceptoColIdx = row.findIndex((c: any) => /concepto|detalle|descripcion/i.test(String(c || '')));
        facturaColIdx = row.findIndex((c: any) => /factura|numero|n[ºo]/i.test(String(c || '')));
        break;
      }
    }

    if (headerRowIdx === -1 || comprobanteColIdx === -1) {
      comprobanteColIdx = 8; // Column I (default SVH layout)
      headerRowIdx = 3; // Row 4 (0-indexed 3)
    }

    // 4. Recorrer filas de datos y construir actualizaciones de celdas
    const colLetter = String.fromCharCode(65 + comprobanteColIdx);
    const updates: { range: string; values: any[][] }[] = [];
    let updatedCount = 0;

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const currentCell = String(row[comprobanteColIdx] || '').trim();
      const rowNumber = r + 1;

      // Si la fila es una fila de totales (ej. 'TOTAL GENERAL'), saltarla
      const firstCell = String(row[0] || '').toUpperCase();
      if (firstCell.includes('TOTAL') || firstCell.includes('SUBTOTAL')) {
        continue;
      }

      // Si la fila está vacía
      if (row.every((c: any) => !c || String(c).trim() === '')) {
        continue;
      }

      // Comprobar si ya tiene una fórmula =HYPERLINK funcional
      let hasValidHyperlink = false;
      if (currentCell.startsWith('=')) {
        const linkMatch = currentCell.match(/=HYPERLINK\("([^"]+)"/i);
        if (linkMatch && linkMatch[1] && (linkMatch[1].startsWith('http') || linkMatch[1].includes('drive.google.com'))) {
          hasValidHyperlink = true;
        }
      }

      if (hasValidHyperlink) {
        continue;
      }

      // Extraer nombre de archivo candidato
      let candidateName = currentCell;
      if (candidateName.startsWith('=')) {
        const nameMatch = candidateName.match(/,\s*"([^"]+)"/i);
        if (nameMatch) candidateName = nameMatch[1];
      }

      // Si la celda está vacía, intentar con concepto o factura
      if (!candidateName && conceptoColIdx >= 0) {
        candidateName = String(row[conceptoColIdx] || '').trim();
      }
      if (!candidateName && facturaColIdx >= 0) {
        candidateName = String(row[facturaColIdx] || '').trim();
      }

      if (!candidateName) continue;

      // Buscar en el mapa de archivos de Drive
      const cleanCand = candidateName.toLowerCase().trim();
      const candNoExt = cleanCand.replace(/\.[^/.]+$/, '').trim();
      const candNumbers = cleanCand.replace(/[^a-z0-9]/g, '');

      let matched = fileMap.get(cleanCand) || fileMap.get(candNoExt) || (candNumbers ? fileMap.get(candNumbers) : undefined);

      if (!matched) {
        for (const [key, f] of fileMap.entries()) {
          if (cleanCand.length > 5 && (key.includes(cleanCand) || cleanCand.includes(key))) {
            matched = f;
            break;
          }
          if (candNoExt.length > 5 && (key.includes(candNoExt) || candNoExt.includes(key))) {
            matched = f;
            break;
          }
        }
      }

      if (matched && matched.webViewLink) {
        const displayLabel = (candidateName || matched.name).replace(/"/g, '""');
        const formula = `=HYPERLINK("${matched.webViewLink}", "${displayLabel}")`;
        updates.push({
          range: `'${activeTabTitle}'!${colLetter}${rowNumber}`,
          values: [[formula]],
        });
        updatedCount++;
      } else if (candidateName.startsWith('http')) {
        const formula = `=HYPERLINK("${candidateName}", "Ver Comprobante")`;
        updates.push({
          range: `'${activeTabTitle}'!${colLetter}${rowNumber}`,
          values: [[formula]],
        });
        updatedCount++;
      }
    }

    // 5. Aplicar actualizaciones por lotes en Google Sheets
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates,
        },
      });
    }

    return res.json({
      success: true,
      updatedCount,
      totalRowsScanned: grid.length - (headerRowIdx + 1),
      message: updatedCount > 0
        ? `Se actualizaron ${updatedCount} enlaces de comprobantes en Google Sheets con acceso directo a Google Drive.`
        : 'Todos los enlaces ya estaban sincronizados y actualizados con Google Drive.',
    });
  } catch (error: any) {
    console.error('Error en /api/repair-invoice-links:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al reparar y actualizar enlaces en Google Sheets.',
    });
  }
});

function detectSheetColumnIndices(headers: string[]) {
  const norm = (headers || []).map((h) => (h ? String(h).toLowerCase().trim() : ''));
  const find = (rx: RegExp, excl?: RegExp) =>
    norm.findIndex((h) => h && rx.test(h) && (!excl || !excl.test(h)));

  let dateCol = find(/fecha.*factura|fecha.*emision|fecha.*expedicion/);
  if (dateCol === -1) dateCol = find(/^fecha$|^date$/, /reg/);
  if (dateCol === -1) dateCol = find(/fecha/);

  const invNumCol = find(/factura|folio|invoice|num.*fac|no.*fac|n.*fac|nro.*fac/i, /fecha/);
  const vendorCol = find(/proveedor|emisor|supplier|vendor|empresa|razon.*social/);
  const taxIdCol = find(/cif|nif|rfc|rut|cuit|tax.*id|nit|id.*fiscal/);
  const conceptCol = find(/concepto|detalle|descripcion|descripcion.*material|producto|material|articulo/);
  const categoryCol = find(/categoria|tipo.*gasto|partida|capitulo/);
  const subtotalCol = find(/\bsub[- ]?total\b|base.*imponible|\bbase\b|neto/);
  const taxCol = find(/\biva\b|cuota.*iva|impuesto|tax/);
  const totalCol = find(/total.*pagar|total.*factura|importe.*total|valor.*total|\btotal\b/);
  let driveCol = find(/drive|enlace|link|url|comprobante|soporte|archivo/, /tipo.*comp|num.*comp|serie|fecha|nombre.*archivo/);
  const fileCol = find(/nombre.*archivo|archivo.*original|file.*name/);

  return {
    dateCol,
    invNumCol,
    vendorCol,
    taxIdCol,
    conceptCol,
    categoryCol,
    subtotalCol,
    taxCol,
    totalCol,
    driveCol,
    fileCol,
  };
}

/**
 * POST /api/reprocess-invoice
 * Re-analiza un comprobante con Gemini 3.8 Flash y actualiza la fila en Google Sheets
 */
app.post('/api/reprocess-invoice', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : req.body.accessToken;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Se requiere token de Google OAuth.' });
    }

    const {
      fileId,
      fileName,
      spreadsheetId,
      sheetTitle = 'Control Facturas',
      rowIndex,
      folderId,
      evidenceFolderId,
      invoiceNumber,
      vendorName,
    } = req.body;

    if (!fileId && !fileName && !invoiceNumber) {
      return res.status(400).json({ success: false, error: 'Se requiere fileId, fileName o invoiceNumber.' });
    }

    const ai = getGenAI();
    if (!ai) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY no configurada.' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    let resolvedFileId = fileId;
    let resolvedName = fileName;
    let webViewLink = '';

    const isControlSpreadsheet = (id?: string, name?: string, mime?: string) => {
      if (id && spreadsheetId && id === spreadsheetId) return true;
      if (mime === 'application/vnd.google-apps.spreadsheet' || mime === 'application/vnd.google-apps.folder') return true;
      const n = (name || '').toLowerCase();
      if (/control[-_ ]*facturas/i.test(n) || n.includes('control_facturas') || n.includes('hoja de cálculo')) return true;
      return false;
    };

    if (resolvedFileId && (resolvedFileId === spreadsheetId || isControlSpreadsheet(resolvedFileId, resolvedName))) {
      resolvedFileId = '';
    }

    if (resolvedName && isControlSpreadsheet(undefined, resolvedName)) {
      resolvedName = '';
    }

    // 0. Si no tenemos resolvedFileId pero tenemos spreadsheetId y rowIndex, LEER directamente la fila de Sheets
    // para recuperar cualquier enlace a Drive, fórmula HYPERLINK o nombre de archivo guardado en sus celdas
    const rowKeywords: string[] = [];
    if (spreadsheetId && rowIndex && rowIndex >= 1) {
      try {
        const rowDataRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetTitle}'!A${rowIndex}:Z${rowIndex}`,
          valueRenderOption: 'FORMULA',
        });
        const currentCells = (rowDataRes.data.values && rowDataRes.data.values[0]) ? rowDataRes.data.values[0] : [];
        for (const cell of currentCells) {
          const cStr = String(cell || '').trim();
          if (!cStr) continue;

          // Extraer keywords de la celda para búsqueda en Drive
          const words = cStr.replace(/https?:\/\/[^\s]+/g, '').replace(/[=(),"]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
          rowKeywords.push(...words);

          if (cStr.startsWith('=')) {
            const m = cStr.match(/=HYPERLINK\("([^"]+)"(?:,\s*"([^"]*)")?/i) || cStr.match(/=HIPERVINCULO\("([^"]+)"(?:,\s*"([^"]*)")?/i);
            if (m && m[1]) {
              const url = m[1];
              if (!url.includes('/spreadsheets/') && !url.includes('docs.google.com/spreadsheets')) {
                const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
                if (idMatch && idMatch[1] && idMatch[1] !== spreadsheetId) {
                  resolvedFileId = idMatch[1];
                  webViewLink = url;
                }
              }
              if (m[2] && (!resolvedName || isControlSpreadsheet(undefined, resolvedName))) {
                resolvedName = m[2];
              }
            }
          } else if (cStr.includes('drive.google.com/file/d/')) {
            const idMatch = cStr.match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1] && idMatch[1] !== spreadsheetId) {
              resolvedFileId = idMatch[1];
              webViewLink = cStr;
            }
          } else if (/\.(pdf|png|jpe?g|webp)$/i.test(cStr)) {
            if (!resolvedName) resolvedName = cStr;
          }
        }
      } catch (errRow) {
        console.warn('[Reprocesar Individual] Aviso leyendo fila actual:', errRow);
      }
    }

    // 1. Si tenemos resolvedFileId, verificar metadatos
    if (resolvedFileId) {
      try {
        const meta = await drive.files.get({
          fileId: resolvedFileId,
          fields: 'id, name, mimeType, webViewLink',
          supportsAllDrives: true,
        });
        const metaMime = meta.data.mimeType || '';
        const metaName = meta.data.name || '';
        if (
          metaMime === 'application/vnd.google-apps.spreadsheet' ||
          metaMime === 'application/vnd.google-apps.folder' ||
          isControlSpreadsheet(meta.data.id, metaName, metaMime)
        ) {
          console.log(`[Reprocesar Individual] ID ${resolvedFileId} (${metaName}) no es comprobante. Buscando en Drive...`);
          resolvedFileId = '';
        } else {
          resolvedName = metaName || resolvedName;
          webViewLink = meta.data.webViewLink || webViewLink || '';
        }
      } catch (e: any) {
        console.log(`[Reprocesar Individual] Archivo ${resolvedFileId} no accesible directamente, buscando en carpetas...`);
        resolvedFileId = '';
      }
    }

    // 2. Si aún no tenemos resolvedFileId, buscar minuciosamente en carpetas de evidencias y subcarpetas
    if (!resolvedFileId && (evidenceFolderId || folderId)) {
      const searchFolders = [evidenceFolderId, folderId].filter(Boolean) as string[];
      const candidates: any[] = [];

      for (const fId of searchFolders) {
        try {
          const listRes = await drive.files.list({
            q: `'${fId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.spreadsheet'`,
            fields: 'files(id, name, mimeType, webViewLink, createdTime)',
            pageSize: 200,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          });
          (listRes.data.files || []).forEach((f) => {
            if (!isControlSpreadsheet(f.id, f.name, f.mimeType) && !candidates.some((c) => c.id === f.id)) {
              candidates.push(f);
            }
          });

          // Buscar también en subcarpetas
          const subRes = await drive.files.list({
            q: `'${fId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
            fields: 'files(id, name)',
            pageSize: 50,
          });
          for (const subF of subRes.data.files || []) {
            try {
              const subItems = await drive.files.list({
                q: `'${subF.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.spreadsheet'`,
                fields: 'files(id, name, mimeType, webViewLink, createdTime)',
                pageSize: 100,
              });
              (subItems.data.files || []).forEach((f) => {
                if (!isControlSpreadsheet(f.id, f.name, f.mimeType) && !candidates.some((c) => c.id === f.id)) {
                  candidates.push(f);
                }
              });
            } catch (errSub) {
              // ignore
            }
          }
        } catch (e) {
          // ignore folder list error
        }
      }

      // 2.A: Coincidencia por nombre exacto o normalizado
      if (resolvedName && !isControlSpreadsheet(undefined, resolvedName)) {
        const cleanFN = resolvedName.toLowerCase().trim().replace(/\.[a-z0-9]+$/i, '');
        const found = candidates.find((c: any) => {
          const cName = (c.name || '').toLowerCase().trim().replace(/\.[a-z0-9]+$/i, '');
          return cName === cleanFN || cName.includes(cleanFN) || cleanFN.includes(cName);
        });
        if (found) {
          resolvedFileId = found.id;
          resolvedName = found.name;
          webViewLink = found.webViewLink || '';
        }
      }

      // 2.B: Coincidencia por número de factura
      if (!resolvedFileId && invoiceNumber && invoiceNumber !== 'S/N' && String(invoiceNumber).trim().length >= 1) {
        const cleanInv = String(invoiceNumber).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const found = candidates.find(
          (c: any) => c.name && c.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(cleanInv)
        );
        if (found) {
          resolvedFileId = found.id;
          resolvedName = found.name;
          webViewLink = found.webViewLink || '';
        }
      }

      // 2.C: Coincidencia por número de fila (ej. "FACTURA 18" -> Fila 18, "FACTURA 19" -> Fila 19, "FACTURA 20" -> Fila 20)
      if (!resolvedFileId && rowIndex && rowIndex >= 1) {
        const rowRegex = new RegExp(`\\b(?:factura|fac|f)?[ _-]*${rowIndex}\\b`, 'i');
        const found = candidates.find((c: any) => rowRegex.test(c.name || ''));
        if (found) {
          resolvedFileId = found.id;
          resolvedName = found.name;
          webViewLink = found.webViewLink || '';
          console.log(`[Reprocesar Individual] Coincidencia por número de fila ${rowIndex} -> Archivo "${found.name}"`);
        }
      }

      // 2.D: Coincidencia por palabras clave de la fila (ej. "enchape", "sanitarios", "sikapañete", etc.)
      if (!resolvedFileId && rowKeywords.length > 0) {
        const significant = rowKeywords.filter((w) => !/^(fila|factura|control|hoja|drive|fecha|total|subtotal|importe|pesos|dolares|revision|proveedor|local)$/i.test(w));
        for (const kw of significant) {
          const kwLow = kw.toLowerCase();
          const found = candidates.find((c: any) => (c.name || '').toLowerCase().includes(kwLow));
          if (found) {
            resolvedFileId = found.id;
            resolvedName = found.name;
            webViewLink = found.webViewLink || '';
            console.log(`[Reprocesar Individual] Coincidencia por palabra clave "${kw}" -> Archivo "${found.name}"`);
            break;
          }
        }
      }

      // 2.E: Coincidencia por proveedor
      if (!resolvedFileId && vendorName && !vendorName.toLowerCase().includes('proveedor local') && !vendorName.toLowerCase().includes('sin proveedor') && vendorName.length >= 4) {
        const cleanVendor = String(vendorName).toLowerCase().trim().slice(0, 8);
        const found = candidates.find((c: any) => (c.name || '').toLowerCase().includes(cleanVendor));
        if (found) {
          resolvedFileId = found.id;
          resolvedName = found.name;
          webViewLink = found.webViewLink || '';
        }
      }

      // 2.F: Fallback inteligente de archivo disponible si hay candidatos
      if (!resolvedFileId && candidates.length > 0) {
        // Seleccionar el candidato que mejor corresponda a la posición
        const sorted = [...candidates].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const indexToPick = Math.min((rowIndex ? rowIndex - 2 : 0), sorted.length - 1);
        const picked = sorted[Math.max(0, indexToPick)];
        if (picked) {
          resolvedFileId = picked.id;
          resolvedName = picked.name;
          webViewLink = picked.webViewLink || '';
          console.log(`[Reprocesar Individual] Asignando archivo candidato "${picked.name}" a fila ${rowIndex}`);
        }
      }
    }

    if (!resolvedFileId) {
      return res.status(200).json({
        success: false,
        skipped: true,
        error: 'No se encontró un archivo comprobante (PDF o imagen) en Google Drive para esta fila. El enlace existente corresponde a la hoja de cálculo de Google Sheets.',
      });
    }

    // Descargar binario de forma segura
    let downloaded;
    try {
      downloaded = await downloadDriveFileBuffer(drive, resolvedFileId, undefined, resolvedName);
    } catch (dlErr: any) {
      console.warn(`[Reprocesar Individual] Aviso descarga para ${resolvedFileId}:`, dlErr.message);
      return res.status(200).json({
        success: false,
        skipped: true,
        error: dlErr.message || 'No se pudo descargar el archivo binario desde Google Drive.',
      });
    }

    if (!downloaded || !downloaded.buffer) {
      return res.status(200).json({
        success: false,
        skipped: true,
        error: 'No se pudo descargar el archivo binario desde Google Drive.',
      });
    }

    const base64Data = downloaded.buffer.toString('base64');
    const mimeType = downloaded.mimeType;
    resolvedName = downloaded.fileName || resolvedName;

    // Extraer con Gemini
    const extracted = await extractInvoiceWithStructuredOutput(ai, base64Data, mimeType, resolvedName);

    // Reconciliación de totales: NUNCA dejar en 0 si hay partidas o subtotal
    let finalSubtotal = cleanLocaleAmount(extracted.subtotal);
    let finalTax = cleanLocaleAmount(extracted.taxAmount ?? extracted.iva);
    let finalTotal = cleanLocaleAmount(extracted.totalAmount ?? extracted.total);

    if (Array.isArray(extracted.items) && extracted.items.length > 0) {
      const itemsSum = extracted.items.reduce((acc: number, it: any) => acc + (cleanLocaleAmount(it.total) || 0), 0);
      if (finalSubtotal === 0 && itemsSum > 0) {
        finalSubtotal = itemsSum;
      }
      if (finalTotal === 0 && itemsSum > 0) {
        finalTotal = itemsSum + finalTax;
      }
    }

    if (finalTotal === 0 && finalSubtotal > 0) {
      finalTotal = finalSubtotal + finalTax;
    }

    // Asegurar que el proveedor no quede como "Sin proveedor" o "Proveedor Local" si el nombre de archivo contiene pistas
    let finalVendor = (extracted.vendorName || extracted.cliente || '').trim();
    if (!finalVendor || finalVendor.toLowerCase().includes('proveedor local') || finalVendor.toLowerCase().includes('sin proveedor')) {
      const cleanBase = resolvedName.replace(/\.[a-z0-9]+$/i, '').replace(/^factura\s*\d+\s*/i, '').trim();
      if (cleanBase.length > 3) {
        finalVendor = cleanBase;
      } else {
        finalVendor = 'Proveedor Comercial';
      }
    }

    // Actualizar extracted con los valores numéricos limpios
    extracted.subtotal = finalSubtotal;
    extracted.taxAmount = finalTax;
    extracted.totalAmount = finalTotal;
    extracted.vendorName = finalVendor;

    // Si viene rowIndex y spreadsheetId, actualizar en Google Sheets respetando la estructura de columnas
    if (spreadsheetId && rowIndex && rowIndex >= 1) {
      const link = webViewLink || `https://drive.google.com/file/d/${resolvedFileId}/view`;
      const linkFormula = `=HYPERLINK("${link}", "${resolvedName.replace(/"/g, '""')}")`;

      // 1. Obtener fila de encabezados y fila actual
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTitle}'!A1:Z5`,
      });
      const headerRows = headerRes.data.values || [];
      let headerRow = headerRows[0] || [];
      for (const hr of headerRows) {
        if (hr && hr.some((c: any) => /factura|proveedor|total|concepto/i.test(String(c || '')))) {
          headerRow = hr;
          break;
        }
      }

      const cols = detectSheetColumnIndices(headerRow);

      // Leer la fila actual para no sobreescribir columnas intactas
      const currentRowRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTitle}'!A${rowIndex}:Z${rowIndex}`,
        valueRenderOption: 'FORMULA',
      });
      const rowVals: any[] = (currentRowRes.data.values && currentRowRes.data.values[0]) ? [...currentRowRes.data.values[0]] : [];
      while (rowVals.length < Math.max(headerRow.length, 11)) {
        rowVals.push('');
      }

      const conceptText = extracted.concept || (extracted.items?.map((i: any) => i.descripcion || i.description || '').filter(Boolean).join(', ') || 'Materiales');

      if (cols.dateCol >= 0) rowVals[cols.dateCol] = extracted.date || extracted.fecha || new Date().toISOString().split('T')[0];
      if (cols.invNumCol >= 0) rowVals[cols.invNumCol] = extracted.invoiceNumber || extracted.numeroFactura || 'S/N';
      if (cols.vendorCol >= 0) rowVals[cols.vendorCol] = finalVendor;
      if (cols.taxIdCol >= 0) rowVals[cols.taxIdCol] = extracted.vendorTaxId || extracted.nitRut || '';
      if (cols.conceptCol >= 0) rowVals[cols.conceptCol] = conceptText;
      if (cols.categoryCol >= 0) rowVals[cols.categoryCol] = extracted.category || extracted.categoria || 'Materiales';
      if (cols.subtotalCol >= 0) rowVals[cols.subtotalCol] = finalSubtotal;
      if (cols.taxCol >= 0) rowVals[cols.taxCol] = finalTax;
      if (cols.totalCol >= 0) rowVals[cols.totalCol] = finalTotal;
      if (cols.driveCol >= 0) rowVals[cols.driveCol] = linkFormula;
      if (cols.fileCol >= 0) rowVals[cols.fileCol] = resolvedName;

      // Fallback si no se detectó mapeo
      if (cols.vendorCol === -1 && cols.totalCol === -1) {
        rowVals[0] = extracted.date || extracted.fecha || new Date().toISOString().split('T')[0];
        rowVals[1] = finalVendor;
        rowVals[2] = extracted.vendorTaxId || extracted.nitRut || '';
        rowVals[3] = conceptText;
        rowVals[4] = extracted.category || extracted.categoria || 'Materiales';
        rowVals[5] = finalSubtotal;
        rowVals[6] = finalTax;
        rowVals[7] = finalTotal;
        rowVals[8] = linkFormula;
      }

      const endColLetter = String.fromCharCode(65 + Math.min(rowVals.length - 1, 25));
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetTitle}'!A${rowIndex}:${endColLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowVals],
        },
      });
    }

    return res.json({
      success: true,
      message: 'Factura reprocesada con éxito.',
      extracted,
      webViewLink: webViewLink || `https://drive.google.com/file/d/${resolvedFileId}/view`,
    });
  } catch (err: any) {
    const errMsg = String(err?.message || '');
    if (
      errMsg.includes('application/vnd.google-apps.spreadsheet') ||
      errMsg.includes('Google Workspace') ||
      errMsg.includes('Control_Facturas')
    ) {
      console.log(`[Reprocesar Individual] Omitido por ser recurso de Google Workspace: ${errMsg}`);
      return res.status(200).json({
        success: false,
        skipped: true,
        error: 'El archivo vinculado corresponde a la hoja de cálculo de Google Sheets y no a un comprobante contable descargable.',
      });
    }
    console.error('Error en /api/reprocess-invoice:', err);
    return res.status(500).json({ success: false, error: err.message || 'Error al reprocesar factura.' });
  }
});

/**
 * POST /api/reprocess-all-invoices
 * Re-analiza en lote con IA todas las facturas mal procesadas, con importe 0 o con errores de lectura,
 * buscando sus archivos de foto correspondientes en Google Drive y actualizando la hoja de cálculo.
 */
app.post('/api/reprocess-all-invoices', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : req.body.accessToken;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Se requiere token de Google OAuth.' });
    }

    const {
      spreadsheetId,
      sheetTitle = 'Control Facturas',
      folderId,
      evidenceFolderId,
      invoicesToReprocess = [],
      reprocessAllMode = false,
    } = req.body;

    if (!spreadsheetId) {
      return res.status(400).json({ success: false, error: 'Se requiere spreadsheetId.' });
    }

    const ai = getGenAI();
    if (!ai) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY no configurada.' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Recopilar archivos de Google Drive (carpeta de evidencias y subcarpetas)
    const targetFolders = [evidenceFolderId, folderId].filter(Boolean) as string[];
    const driveFilesList: any[] = [];

    const isNonInvoiceMime = (mime?: string, name?: string) => {
      if (!mime) return false;
      const m = mime.toLowerCase();
      const n = (name || '').toLowerCase();
      if (
        m === 'application/vnd.google-apps.folder' ||
        m === 'application/vnd.google-apps.spreadsheet' ||
        m === 'application/vnd.google-apps.presentation' ||
        m === 'application/vnd.google-apps.form' ||
        m === 'application/vnd.google-apps.site' ||
        m === 'application/vnd.google-apps.map' ||
        m === 'application/vnd.google-apps.shortcut'
      ) return true;
      if (n.startsWith('control facturas') && (n.endsWith('.xlsx') || m.includes('spreadsheet'))) return true;
      return false;
    };

    for (const fId of targetFolders) {
      try {
        const driveRes = await drive.files.list({
          q: `'${fId}' in parents and trashed = false`,
          fields: 'files(id, name, mimeType, webViewLink, createdTime)',
          pageSize: 200,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        const items = driveRes.data.files || [];
        for (const item of items) {
          if (item.id === spreadsheetId) continue;
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            // Buscar en subcarpeta
            try {
              const subRes = await drive.files.list({
                q: `'${item.id}' in parents and trashed = false`,
                fields: 'files(id, name, mimeType, webViewLink, createdTime)',
                pageSize: 200,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
              });
              const subFiles = (subRes.data.files || []).filter(
                (f) => f.id !== spreadsheetId && !isNonInvoiceMime(f.mimeType, f.name)
              );
              driveFilesList.push(...subFiles);
            } catch (e) {
              console.log('[Subcarpeta Drive] Aviso listando subcarpeta:', item.name);
            }
          } else if (!isNonInvoiceMime(item.mimeType, item.name)) {
            driveFilesList.push(item);
          }
        }
      } catch (e) {
        console.log('[Carpeta Drive] Aviso listando carpeta:', fId);
      }
    }

    // Si aún no hay archivos o son muy pocos, buscar archivos de imagen y PDF recientes en Drive
    if (driveFilesList.length === 0) {
      try {
        const broadRes = await drive.files.list({
          q: "trashed = false and (mimeType contains 'image/' or mimeType = 'application/pdf')",
          fields: 'files(id, name, mimeType, webViewLink, createdTime)',
          pageSize: 150,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        const broadFiles = (broadRes.data.files || []).filter(
          (f) => f.id !== spreadsheetId && !isNonInvoiceMime(f.mimeType, f.name)
        );
        driveFilesList.push(...broadFiles);
      } catch (be) {
        console.log('[Búsqueda Amplia Drive] Aviso:', be?.message || be);
      }
    }

    // 2. Leer encabezados y datos actuales de la hoja
    const sheetValuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle}'!A1:Z500`,
      valueRenderOption: 'FORMULA',
    });
    const grid = sheetValuesRes.data.values || [];

    if (grid.length < 2) {
      return res.json({
        success: true,
        reprocessedCount: 0,
        message: 'No hay filas de datos para reprocesar en la hoja.',
      });
    }

    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(5, grid.length); r++) {
      if (grid[r] && grid[r].some((c: any) => /factura|proveedor|total|concepto/i.test(String(c || '')))) {
        headerRowIdx = r;
        break;
      }
    }
    const headerRow = grid[headerRowIdx] || [];
    const cols = detectSheetColumnIndices(headerRow);

    // 3. Determinar filas candidatas a reprocesar
    let targetRows: { rowIndex: number; rowData: any[]; invNum?: string; vendor?: string; fileName?: string; fileId?: string }[] = [];

    if (reprocessAllMode) {
      // Modo RELEER TODAS LAS FACTURAS REGISTRADAS: procesar cada fila contable de la pestaña
      for (let r = headerRowIdx + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const firstCell = String(row[0] || '').toUpperCase();
        if (firstCell.includes('TOTAL') || firstCell.includes('SUBTOTAL')) continue;
        if (row.every((c: any) => !c || String(c).trim() === '')) continue;

        let fileId = '';
        const driveCell = cols.driveCol >= 0 ? String(row[cols.driveCol] || '').trim() : '';
        const idMatch = driveCell.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (idMatch && idMatch[1] && idMatch[1] !== spreadsheetId) fileId = idMatch[1];

        if (!fileId) {
          for (let c = 0; c < row.length; c++) {
            const m = String(row[c] || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (m && m[1] && m[1] !== spreadsheetId) {
              fileId = m[1];
              break;
            }
          }
        }

        targetRows.push({
          rowIndex: r + 1,
          rowData: row,
          invNum: cols.invNumCol >= 0 ? String(row[cols.invNumCol] || '') : '',
          vendor: cols.vendorCol >= 0 ? String(row[cols.vendorCol] || '').trim() : '',
          fileName: cols.fileCol >= 0 ? String(row[cols.fileCol] || '').trim() : '',
          fileId,
        });
      }
    } else if (Array.isArray(invoicesToReprocess) && invoicesToReprocess.length > 0) {
      targetRows = invoicesToReprocess.map((inv: any) => {
        const rIdx = inv.rowIndex;
        const rowData = grid[rIdx - 1] || [];
        const fId = inv.fileId && inv.fileId !== spreadsheetId ? inv.fileId : '';
        return {
          rowIndex: rIdx,
          rowData,
          invNum: inv.invoiceNumber,
          vendor: inv.vendorName,
          fileName: inv.fileName,
          fileId: fId,
        };
      });
    } else {
      // Auto-detectar filas con errores: importe $0, sin proveedor o concepto vacío
      for (let r = headerRowIdx + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const isTotalRow = String(row[0] || '').toUpperCase().includes('TOTAL');
        if (isTotalRow || row.every((c: any) => !c || String(c).trim() === '')) continue;

        const totalVal = cols.totalCol >= 0 ? parseFloat(String(row[cols.totalCol] || '0').replace(/[^0-9.-]+/g, '')) : 0;
        const vendorVal = cols.vendorCol >= 0 ? String(row[cols.vendorCol] || '').trim() : '';
        const conceptVal = cols.conceptCol >= 0 ? String(row[cols.conceptCol] || '').trim() : '';
        const fileCell = cols.fileCol >= 0 ? String(row[cols.fileCol] || '').trim() : '';
        const driveCell = cols.driveCol >= 0 ? String(row[cols.driveCol] || '').trim() : '';

        const hasError = !totalVal || totalVal === 0 || !vendorVal || vendorVal.toLowerCase().includes('sin proveedor') || !conceptVal;

        if (hasError) {
          let fileId = '';
          const idMatch = driveCell.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (idMatch && idMatch[1] && idMatch[1] !== spreadsheetId) fileId = idMatch[1];

          if (!fileId) {
            for (let c = 0; c < row.length; c++) {
              const m = String(row[c] || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
              if (m && m[1] && m[1] !== spreadsheetId) {
                fileId = m[1];
                break;
              }
            }
          }

          targetRows.push({
            rowIndex: r + 1,
            rowData: row,
            invNum: cols.invNumCol >= 0 ? String(row[cols.invNumCol] || '') : '',
            vendor: vendorVal,
            fileName: fileCell,
            fileId,
          });
        }
      }
    }

    if (targetRows.length === 0) {
      return res.json({
        success: true,
        reprocessedCount: 0,
        message: 'No se detectaron facturas con errores de lectura o valores incompletos.',
      });
    }

    // 4. Reprocesar cada fila con IA
    const batchUpdates: any[] = [];
    const results: any[] = [];
    let reprocessedCount = 0;

    for (const target of targetRows) {
      try {
        if (target.fileId && target.fileId === spreadsheetId) {
          target.fileId = '';
        }

        // Encontrar archivo en Drive
        let matchedDriveFile = driveFilesList.find((f) => target.fileId && f.id === target.fileId);

        if (!matchedDriveFile && target.fileId) {
          try {
            const metaRes = await drive.files.get({
              fileId: target.fileId,
              fields: 'id, name, mimeType, webViewLink',
              supportsAllDrives: true,
            });
            if (
              metaRes.data &&
              metaRes.data.id !== spreadsheetId &&
              !isNonInvoiceMime(metaRes.data.mimeType, metaRes.data.name)
            ) {
              matchedDriveFile = metaRes.data;
            }
          } catch (e) {
            // ID no accesible
          }
        }

        if (!matchedDriveFile && target.fileName) {
          const cleanF = target.fileName.toLowerCase().trim();
          matchedDriveFile = driveFilesList.find((f) => f.name && f.name.toLowerCase().trim() === cleanF);
        }

        if (!matchedDriveFile && target.invNum && target.invNum !== 'S/N') {
          const cleanInv = target.invNum.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          matchedDriveFile = driveFilesList.find((f) => f.name && f.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(cleanInv));
        }

        if (!matchedDriveFile && target.vendor && target.vendor.toLowerCase() !== 'sin proveedor') {
          const cleanVen = target.vendor.toLowerCase().slice(0, 6);
          matchedDriveFile = driveFilesList.find((f) => f.name && f.name.toLowerCase().includes(cleanVen));
        }

        // Si no se encuentra y hay archivos sin asignar, usar por posición si es válido
        if (!matchedDriveFile && driveFilesList.length > 0) {
          const unassigned = driveFilesList.find(
            (df) =>
              !results.some((resItem) => resItem.fileId === df.id) &&
              df.id !== spreadsheetId &&
              !isNonInvoiceMime(df.mimeType, df.name)
          );
          if (unassigned) matchedDriveFile = unassigned;
        }

        if (!matchedDriveFile) {
          results.push({ rowIndex: target.rowIndex, success: false, error: 'No se localizó el comprobante en Google Drive' });
          continue;
        }

        // Descargar binario usando el helper seguro
        let downloaded;
        try {
          downloaded = await downloadDriveFileBuffer(
            drive,
            matchedDriveFile.id,
            matchedDriveFile.mimeType,
            matchedDriveFile.name
          );
        } catch (dlErr: any) {
          console.warn(`[Batch Loop] Aviso descarga comprobante fila ${target.rowIndex}:`, dlErr.message);
          results.push({ rowIndex: target.rowIndex, success: false, error: dlErr.message || 'Comprobante no descargable o inaccesible' });
          continue;
        }

        if (!downloaded || !downloaded.buffer) {
          results.push({ rowIndex: target.rowIndex, success: false, error: 'Comprobante no descargable o inaccesible' });
          continue;
        }

        const fileBuffer = downloaded.buffer;
        const base64Data = fileBuffer.toString('base64');
        const mimeType = downloaded.mimeType;
        const finalName = downloaded.fileName;

        // Extraer con Gemini
        const extracted = await extractInvoiceWithStructuredOutput(ai, base64Data, mimeType, finalName);

        const link = matchedDriveFile.webViewLink || `https://drive.google.com/file/d/${matchedDriveFile.id}/view`;
        const linkFormula = `=HYPERLINK("${link}", "${finalName.replace(/"/g, '""')}")`;

        const rowVals = [...target.rowData];
        while (rowVals.length < Math.max(headerRow.length, 11)) {
          rowVals.push('');
        }

        const conceptText = extracted.concept || (extracted.items?.map((i: any) => i.descripcion || i.description || '').filter(Boolean).join(', ') || 'Materiales');

        if (cols.dateCol >= 0) rowVals[cols.dateCol] = extracted.date || new Date().toISOString().split('T')[0];
        if (cols.invNumCol >= 0) rowVals[cols.invNumCol] = extracted.invoiceNumber || 'S/N';
        if (cols.vendorCol >= 0) rowVals[cols.vendorCol] = extracted.vendorName || 'Sin especificar';
        if (cols.taxIdCol >= 0) rowVals[cols.taxIdCol] = extracted.vendorTaxId || '';
        if (cols.conceptCol >= 0) rowVals[cols.conceptCol] = conceptText;
        if (cols.categoryCol >= 0) rowVals[cols.categoryCol] = extracted.category || 'Materiales';
        if (cols.subtotalCol >= 0) rowVals[cols.subtotalCol] = extracted.subtotal || 0;
        if (cols.taxCol >= 0) rowVals[cols.taxCol] = extracted.taxAmount || 0;
        if (cols.totalCol >= 0) rowVals[cols.totalCol] = extracted.totalAmount || 0;
        if (cols.driveCol >= 0) rowVals[cols.driveCol] = linkFormula;
        if (cols.fileCol >= 0) rowVals[cols.fileCol] = finalName;

        const endColLetter = String.fromCharCode(65 + Math.min(rowVals.length - 1, 25));
        batchUpdates.push({
          range: `'${sheetTitle}'!A${target.rowIndex}:${endColLetter}${target.rowIndex}`,
          values: [rowVals],
        });

        results.push({
          rowIndex: target.rowIndex,
          fileId: matchedDriveFile.id,
          fileName: finalName,
          extracted,
          success: true,
        });
        reprocessedCount++;
      } catch (itemErr: any) {
        const errorMsg = itemErr?.response?.data?.error?.message || itemErr?.message || 'Error en descarga o lectura del comprobante';
        console.log(`[Reprocesar Fila ${target.rowIndex}] Aviso: ${errorMsg}`);
        results.push({ rowIndex: target.rowIndex, success: false, error: errorMsg });
      }
    }

    // 5. Aplicar actualizaciones en Sheets
    if (batchUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: batchUpdates,
        },
      });
    }

    const failCount = results.filter((r) => !r.success).length;
    let message = `Se releeron y actualizaron ${reprocessedCount} facturas con IA exitosamente en Google Sheets.`;
    if (failCount > 0 && reprocessedCount > 0) {
      message += ` (${failCount} fila(s) omitida(s) por no disponer de archivo comprobante descargable)`;
    } else if (reprocessedCount === 0 && failCount > 0) {
      message = `No se pudieron reprocesar las ${failCount} fila(s): comprueba los permisos de los archivos o enlaces en Drive.`;
    }

    return res.json({
      success: true,
      reprocessedCount,
      totalRequested: targetRows.length,
      results,
      message,
    });
  } catch (err: any) {
    console.error('Error en /api/reprocess-all-invoices:', err);
    return res.status(500).json({ success: false, error: err.message || 'Error al reprocesar facturas con IA.' });
  }
});

/**
 * ====================================================================
 * MÓDULO DE PRESUPUESTOS Y NÓMINAS (PAYROLL) - ENDPOINTS DEL BACKEND
 * ====================================================================
 */

const OBREROS_HEADERS = [
  'ID',
  'Nombre Completo',
  'Documento / Cédula',
  'Rol / Especialidad',
  'Frecuencia Pago',
  'Unidad Tarifa',
  'Valor Base ($)',
  'Valor Hora Extra ($)',
  'Teléfono',
  'Estado',
  'Fecha Ingreso',
];

const NOMINA_CONSOLIDADA_HEADERS = [
  'ID Obrero',
  'Nombre Completo',
  'Cargo / Rol',
  'Días Totales',
  'Horas Regulares',
  'Horas Extras',
  'Tarifa Base ($)',
  'Tarifa Extras ($)',
  'Subtotal Base ($)',
  'Subtotal Extras ($)',
  'Total a Pagar ($)',
];

const TIEMPOS_HEADERS = NOMINA_CONSOLIDADA_HEADERS;

// No se inyecta foto de logo por requerimiento explícito del usuario
const SVH_LOGO_FORMULA = '';

// Helper para obtener cliente OAuth de Google autenticado
function getGoogleAuthClient(req: express.Request): any {
  const token = extractOAuthToken(req);

  if (!token) {
    const err: any = new Error('Token de autenticación OAuth no proporcionado o inválido.');
    err.status = 401;
    throw err;
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  return oauth2Client;
}

// Helper para capturar y devolver errores de nómina y autenticación de forma amigable
function handlePayrollError(res: express.Response, prefix: string, error: any) {
  return handleGoogleApiError(res, prefix, error);
}

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Escapa el nombre de la hoja según la notación A1 de Google Sheets
 * y construye un rango seguro
 */
function getSafeRange(sheetTitle: string, rangeA1: string): string {
  const cleanTitle = (sheetTitle || 'Sheet1').replace(/'/g, "''");
  return `'${cleanTitle}'!${rangeA1}`;
}

function isOfficialNominaTab(title: string): boolean {
  const t = (title || '').trim().toLowerCase();
  return (
    t === 'nomina mes actual' ||
    t === 'nómina mes actual' ||
    t === 'tiempos_mesactual' ||
    t.startsWith('nomina') ||
    t.startsWith('nómina') ||
    t.includes('tiempo')
  );
}

function isOfficialWorkerTab(title: string): boolean {
  const t = (title || '').trim().toLowerCase();
  return t === 'informacion obrero' || t === 'información obrero' || t === 'obreros' || t.includes('obrero');
}

/**
 * Normaliza y resuelve las 2 pestañas oficiales de nómina en Google Sheets:
 * 1. "Informacion obrero" (datos completos de los obreros: teléfono, identificación, cargo, etc.)
 * 2. "Nomina [Mes Actual]" (o "Nomina mes actual", registros de jornadas)
 * Elimina pestañas de conflicto redundantes y asegura formato corporativo con foto/logo.
 */
async function resolvePayrollSheets(sheets: any, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  });
  const sheetsList: any[] = meta.data.sheets || [];

  const now = new Date();
  const currentMonthTabTitle = `Nomina ${MONTH_NAMES_ES[now.getMonth()]}`;

  // Buscar pestaña de obreros
  let obrerosSheet = sheetsList.find((s: any) => {
    const t = (s.properties?.title || '').trim().toLowerCase();
    return t === 'informacion obrero' || t === 'información obrero' || t === 'obreros' || t.includes('obrero');
  });

  // Si se llamaba "Obreros", renombrarla a "Informacion obrero"
  if (obrerosSheet && obrerosSheet.properties?.title === 'Obreros') {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: obrerosSheet.properties.sheetId,
                  title: 'Informacion obrero',
                },
                fields: 'title',
              },
            },
          ],
        },
      });
      obrerosSheet.properties.title = 'Informacion obrero';
    } catch (e: any) {
      console.warn('Aviso renombrando pestaña Obreros a Informacion obrero:', e?.message || e);
    }
  }

  // Buscar pestaña de tiempos / nómina activa:
  const currentMonthName = MONTH_NAMES_ES[now.getMonth()].toLowerCase();

  // 1. Coincidencia con el mes actual (ej: "Nomina Octubre", "Nomina Octubre 2026", "Nomina_Octubre_2026")
  let tiemposSheet = sheetsList.find((s: any) => {
    const t = (s.properties?.title || '').trim().toLowerCase();
    return (t.includes('nomina') || t.includes('nómina')) && t.includes(currentMonthName);
  });

  // 2. Si no, buscar "Nomina mes actual" o "Tiempos_MesActual"
  if (!tiemposSheet) {
    tiemposSheet = sheetsList.find((s: any) => {
      const t = (s.properties?.title || '').trim().toLowerCase();
      return (
        t === 'nomina mes actual' ||
        t === 'nómina mes actual' ||
        t === 'tiempos_mesactual'
      );
    });
  }

  // 3. Si hay varias pestañas de nómina históricas, tomar la más reciente (última pestaña de nómina creada)
  if (!tiemposSheet) {
    const nominaSheets = sheetsList.filter((s: any) => {
      const t = (s.properties?.title || '').trim().toLowerCase();
      return t.startsWith('nomina') || t.startsWith('nómina');
    });
    if (nominaSheets.length > 0) {
      tiemposSheet = nominaSheets[nominaSheets.length - 1];
    }
  }

  // 4. Fallback genérico a cualquier pestaña con tiempos o jornada
  if (!tiemposSheet) {
    tiemposSheet = sheetsList.find((s: any) => {
      const t = (s.properties?.title || '').trim().toLowerCase();
      return t.includes('tiempo') || t.includes('jornada');
    });
  }

  // Si se llamaba "Tiempos_MesActual", renombrarla al nombre del mes actual (ej. "Nomina Septiembre")
  if (tiemposSheet && tiemposSheet.properties?.title === 'Tiempos_MesActual') {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: tiemposSheet.properties.sheetId,
                  title: currentMonthTabTitle,
                },
                fields: 'title',
              },
            },
          ],
        },
      });
      tiemposSheet.properties.title = currentMonthTabTitle;
    } catch (e: any) {
      console.warn('Aviso renombrando pestaña Tiempos_MesActual:', e?.message || e);
    }
  }

  const obrerosTitle = obrerosSheet?.properties?.title || 'Informacion obrero';
  const tiemposTitle = tiemposSheet?.properties?.title || currentMonthTabTitle;

  return {
    obrerosSheet,
    tiemposSheet,
    obrerosTitle,
    tiemposTitle,
    sheetsList,
  };
}

/**
 * 1. Sincroniza / crea las pestañas oficiales: "Informacion obrero" y "Nomina mes actual"
 * Endpoint: POST /api/payroll/sync-sheets
 */
app.post('/api/payroll/sync-sheets', async (req, res) => {
  try {
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ success: false, error: 'spreadsheetId es obligatorio.' });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    let { obrerosSheet, tiemposSheet, obrerosTitle, tiemposTitle } = await resolvePayrollSheets(sheets, spreadsheetId);
    let workersTabCreated = false;
    let timesTabCreated = false;

    // Crear pestaña 'Informacion obrero' si no existe
    if (!obrerosSheet) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: 'Informacion obrero',
                    gridProperties: { rowCount: 150, columnCount: 15 },
                    tabColor: { red: 0.11, green: 0.64, blue: 0.19 }, // Verde SVH
                  },
                },
              },
            ],
          },
        });

        // Insertar encabezados en A1:K1 (sin foto de logo)
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: getSafeRange('Informacion obrero', 'A1:K1'),
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [OBREROS_HEADERS],
          },
        });
        workersTabCreated = true;
        obrerosTitle = 'Informacion obrero';
        obrerosSheet = { properties: { title: 'Informacion obrero' } };
      } catch (addErr: any) {
        console.warn('[sync-sheets] Aviso al crear pestaña Informacion obrero:', addErr?.message || addErr);
      }
    }

    // Crear pestaña de tiempos (ej. 'Nomina Septiembre' o 'Nomina mes actual') si no existe
    const now = new Date();
    const targetTimesTitle = tiemposTitle || `Nomina ${MONTH_NAMES_ES[now.getMonth()]}`;
    if (!tiemposSheet) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: targetTimesTitle,
                    gridProperties: { rowCount: 150, columnCount: 15 },
                    tabColor: { red: 0.11, green: 0.64, blue: 0.19 }, // Verde SVH
                  },
                },
              },
            ],
          },
        });

        // Insertar encabezados consolidados en A1:K1 (sin logo)
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: getSafeRange(targetTimesTitle, 'A1:K1'),
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [NOMINA_CONSOLIDADA_HEADERS],
          },
        });
        timesTabCreated = true;
        tiemposTitle = targetTimesTitle;
        tiemposSheet = { properties: { title: targetTimesTitle } };
      } catch (addErr: any) {
        console.warn(`[sync-sheets] Aviso al crear pestaña ${targetTimesTitle}:`, addErr?.message || addErr);
        // Si falló crear con ese nombre, re-consultar metadatos para tomar la pestaña real si ya existía
        try {
          const freshMeta = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties(sheetId,title)',
          });
          const freshList = freshMeta.data.sheets || [];
          const found = freshList.find((s: any) => isOfficialNominaTab(s.properties?.title || ''));
          if (found?.properties?.title) {
            tiemposTitle = found.properties.title;
            tiemposSheet = found;
          }
        } catch (mErr) {
          // ignorar
        }
      }
    }

    // Leer obreros registrados (filtrando encabezados y logo de forma resiliente)
    let workerRows: any[][] = [];
    if (obrerosSheet || workersTabCreated) {
      try {
        const workersRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: getSafeRange(obrerosTitle, 'A1:K150'),
        });
        const allRows = workersRes.data.values || [];
        workerRows = allRows.filter((row) => {
          if (!row || row.length === 0) return false;
          const c0 = String(row[0] || '').trim();
          const c1 = String(row[1] || '').trim();
          if (c0.startsWith('=IMAGE') || c0.startsWith('=image')) return false;
          if (c0.toLowerCase() === 'id' || c1.toLowerCase() === 'nombre completo' || c0.toLowerCase() === 'codigo') return false;
          // Un obrero real DEBE tener nombre válido. Ignorar filas vacías, errores de fórmula (#REF!) o celdas sin nombre
          if (!c1 || c1.startsWith('#') || c1.toLowerCase().includes('ref')) return false;
          if (c0.startsWith('#') && !c1) return false;
          return true;
        });
      } catch (readWorkersErr: any) {
        console.warn('[sync-sheets] Aviso al consultar pestaña de obreros:', readWorkersErr?.message || readWorkersErr);
      }
    }

    const workers = workerRows.map((row) => ({
      id: row[0] || '',
      name: row[1] || '',
      dni: row[2] || '',
      role: row[3] || 'Ayudante',
      paymentFrequency: row[4] || 'Semanal',
      rateUnit: row[5] === 'Hora' ? 'Hora' : 'Dia',
      baseRate: parseFloat(String(row[6]).replace(/[^0-9.-]+/g, '')) || 0,
      overtimeRate: parseFloat(String(row[7]).replace(/[^0-9.-]+/g, '')) || 0,
      phone: row[8] || '',
      active: String(row[9]).toLowerCase() !== 'inactivo',
      joinedDate: row[10] || new Date().toISOString().split('T')[0],
    }));

    // Leer registros de tiempos del mes actual (soporta formato consolidado y formato histórico)
    const timeRecords: any[] = [];
    const seenRecordIds = new Set<string>();

    if (tiemposSheet || timesTabCreated) {
      try {
        const timesRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: getSafeRange(tiemposTitle, 'A1:K1000'),
        });
        const allTimeRows = timesRes.data.values || [];
        for (let rIdx = 0; rIdx < allTimeRows.length; rIdx++) {
          const row = allTimeRows[rIdx];
          if (!row || row.length === 0) continue;
          const c0 = String(row[0] || '').trim();
          const c1 = String(row[1] || '').trim();
          if (c0.startsWith('=IMAGE') || c0.startsWith('=image')) continue;
          if (c0.toLowerCase() === 'id registro' || c0.toLowerCase() === 'id obrero' || c1.toLowerCase() === 'fecha' || c1.toLowerCase() === 'nombre completo' || c0.toLowerCase() === 'id') continue;
          if (c0.toLowerCase().startsWith('total') || c1.toLowerCase().startsWith('total')) continue;
          // Ignorar filas totalmente vacías
          if (!c0 && !c1 && !row[2] && !row[3]) continue;

          // Detectar si la fila es formato consolidado (Col 0: ID Obrero, Col 1: Nombre, Col 3: Días Totales, Col 4: Horas Regulares, Col 5: Horas Extras)
          // O formato legacy (Col 0: LOG-xxx, Col 1: Fecha, Col 2: Worker ID, Col 4: Horas Regulares, Col 5: Horas Extras, Col 6: Días Trabajados)
          const isDateInCol1 = /^\d{4}-\d{2}-\d{2}/.test(c1) || c1.includes('/') || c0.startsWith('LOG-');
          if (!isDateInCol1 && (row[3] !== undefined || row[4] !== undefined)) {
            // Formato Consolidado por Obrero (1 fila por obrero con sus acumulados)
            const workerId = c0;
            const workerName = c1;
            const daysWorked = parseFloat(row[3]) || 0;
            const regularHours = parseFloat(row[4]) || 0;
            const overtimeHours = parseFloat(row[5]) || 0;
            let recId = `REC-${workerId || rIdx + 1}`;
            if (seenRecordIds.has(recId)) {
              recId = `${recId}-${rIdx + 1}`;
            }
            seenRecordIds.add(recId);

            timeRecords.push({
              id: recId,
              rawId: workerId,
              sheetRowIndex: rIdx,
              date: new Date().toISOString().split('T')[0],
              workerId,
              workerName,
              regularHours,
              overtimeHours,
              daysWorked,
              activityNotes: 'Consolidado mensual',
              siteLocation: 'Obra',
            });
          } else {
            // Formato histórico línea por línea
            const rawId = c0;
            const isFormulaErr = rawId.startsWith('#') || rawId.toLowerCase().includes('ref');
            let uniqueId = isFormulaErr || !rawId ? `LOG-ROW-${rIdx + 1}` : rawId;
            if (seenRecordIds.has(uniqueId)) {
              uniqueId = `${uniqueId}-${rIdx + 1}`;
            }
            seenRecordIds.add(uniqueId);

            timeRecords.push({
              id: uniqueId,
              rawId: rawId,
              sheetRowIndex: rIdx,
              date: row[1] || new Date().toISOString().split('T')[0],
              workerId: row[2] || '',
              workerName: row[3] || '',
              regularHours: parseFloat(row[4]) || 0,
              overtimeHours: parseFloat(row[5]) || 0,
              daysWorked: parseFloat(row[6]) || 0,
              activityNotes: row[7] || '',
              siteLocation: row[7] || '',
            });
          }
        }
      } catch (readTimesErr: any) {
        console.warn('[sync-sheets] Aviso al consultar pestaña de tiempos:', readTimesErr?.message || readTimesErr);
      }
    }

    return res.json({
      success: true,
      message: 'Pestañas de nómina sincronizadas con éxito ("Informacion obrero" y "Nomina mes actual").',
      workersTabCreated,
      timesTabCreated,
      workers,
      timeRecords,
    });
  } catch (error: any) {
    return handlePayrollError(res, 'Error sincronizando hojas de nómina', error);
  }
});

/**
 * Aplica el diseño oficial de SVH Arquitectos a las pestañas de obreros y tiempos de nómina:
 * - Inserta la foto/logo del arquitecto en A1 con fórmula =IMAGE("https://i.postimg.cc/Hn6LNwm0/image.png", 1)
 * - Combina celdas A1:E3
 * - Fila 4 con encabezados corporativos verde esmeralda #1ca330, texto blanco y negrita
 * - Formato de moneda CURRENCY ("$"#,##0) en columnas salariales y devengados
 * - Auto-ajuste de dimensiones de columnas para visualización clara
 */
async function applyCorporateStylingToPayrollSheets(
  sheets: any,
  spreadsheetId: string,
  obrerosTitle: string,
  tiemposTitle: string,
  obrerosSheetId?: number,
  tiemposSheetId?: number
) {
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const sheetsList = meta.data.sheets || [];
    const oSheet =
      sheetsList.find((s: any) => s.properties?.title === obrerosTitle) ||
      sheetsList.find((s: any) => isOfficialWorkerTab(s.properties?.title || ''));
    const tSheet =
      sheetsList.find((s: any) => s.properties?.title === tiemposTitle) ||
      sheetsList.find((s: any) => isOfficialNominaTab(s.properties?.title || ''));

    const oId = obrerosSheetId ?? oSheet?.properties?.sheetId;
    const tId = tiemposSheetId ?? tSheet?.properties?.sheetId;

    // Paleta Profesional de la Aplicación
    // Header corporativo oscuro: Slate-900 (#0f172a)
    const headerBgColor = { red: 15 / 255, green: 23 / 255, blue: 42 / 255 };
    const whiteColor = { red: 1.0, green: 1.0, blue: 1.0 };
    const altRowBgColor = { red: 248 / 255, green: 250 / 255, blue: 252 / 255 }; // Slate-50 (#f8fafc)
    const borderColor = { red: 226 / 255, green: 232 / 255, blue: 240 / 255 }; // Slate-200 (#e2e8f0)
    const totalBgColor = { red: 236 / 255, green: 253 / 255, blue: 245 / 255 }; // Emerald-50 (#ecfdf5)
    const totalTextColor = { red: 6 / 255, green: 78 / 255, blue: 59 / 255 }; // Emerald-900 (#064e3b)

    const batchRequests: any[] = [];

    // 1. Formatear pestaña de Obreros (Informacion obrero) - Sin logo, encabezados en fila 1
    if (oId !== undefined) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: getSafeRange(obrerosTitle, 'A1:K1'),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [OBREROS_HEADERS] },
      }).catch(console.warn);

      batchRequests.push(
        // Congelar fila 1 de encabezados
        {
          updateSheetProperties: {
            properties: {
              sheetId: oId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        // Altura de fila de encabezados
        {
          updateDimensionProperties: {
            range: { sheetId: oId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 38 },
            fields: 'pixelSize',
          },
        },
        // Estilo de encabezados: Fondo Slate-900, texto blanco y negrita
        {
          repeatCell: {
            range: { sheetId: oId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
            cell: {
              userEnteredFormat: {
                backgroundColor: headerBgColor,
                textFormat: { bold: true, fontSize: 10, foregroundColor: whiteColor },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
          },
        },
        // Formato moneda en Tarifas (Columnas G y H, index 6 y 7)
        {
          repeatCell: {
            range: { sheetId: oId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 6, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' },
                horizontalAlignment: 'RIGHT',
              },
            },
            fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
          },
        },
        // Bordes finos y alineaciones limpias
        {
          updateBorders: {
            range: { sheetId: oId, startRowIndex: 0, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 11 },
            bottom: { style: 'SOLID', color: borderColor },
            top: { style: 'SOLID', color: borderColor },
            left: { style: 'SOLID', color: borderColor },
            right: { style: 'SOLID', color: borderColor },
            innerHorizontal: { style: 'SOLID', color: borderColor },
            innerVertical: { style: 'SOLID', color: borderColor },
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: oId, dimension: 'COLUMNS', startIndex: 0, endIndex: 11 },
          },
        }
      );
    }

    // 2. Formatear pestaña de Nómina: Tabla Consolidada por Obrero con Totales al Frente
    if (tId !== undefined) {
      // Leer obreros registrados para generar la tabla consolidada oficial
      const [workersRes, timesRes] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: getSafeRange(obrerosTitle, 'A1:K150'),
        }).catch(() => ({ data: { values: [] } })),
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: getSafeRange(tiemposTitle, 'A1:K1000'),
        }).catch(() => ({ data: { values: [] } })),
      ]);

      const rawWorkers = workersRes.data?.values || [];
      const validWorkers = rawWorkers.filter((r: any) => {
        if (!r || r.length === 0) return false;
        const c0 = String(r[0] || '').trim();
        const c1 = String(r[1] || '').trim();
        if (c0.startsWith('=IMAGE') || c0.startsWith('=image')) return false;
        if (c0.toLowerCase() === 'id' || c1.toLowerCase() === 'nombre completo') return false;
        return Boolean(c1 && !c1.startsWith('#'));
      });

      const rawTimes = timesRes.data?.values || [];

      // Mapear acumulados de cada obrero (Días totales, Horas Regulares, Horas Extras)
      const workerTotalsMap = new Map<string, { daysWorked: number; regularHours: number; overtimeHours: number }>();

      for (const row of rawTimes) {
        if (!row || row.length === 0) continue;
        const c0 = String(row[0] || '').trim();
        const c1 = String(row[1] || '').trim();
        if (c0.startsWith('=IMAGE') || c0.toLowerCase() === 'id registro' || c0.toLowerCase() === 'id obrero' || c0.toLowerCase().startsWith('total')) continue;

        const isDateInCol1 = /^\d{4}-\d{2}-\d{2}/.test(c1) || c1.includes('/') || c0.startsWith('LOG-');
        if (!isDateInCol1 && (row[3] !== undefined || row[4] !== undefined)) {
          // Ya era fila consolidada
          const wId = c0;
          const curr = workerTotalsMap.get(wId) || { daysWorked: 0, regularHours: 0, overtimeHours: 0 };
          curr.daysWorked += parseFloat(row[3]) || 0;
          curr.regularHours += parseFloat(row[4]) || 0;
          curr.overtimeHours += parseFloat(row[5]) || 0;
          workerTotalsMap.set(wId, curr);
        } else if (row[2]) {
          // Fila legacy por jornadas
          const wId = String(row[2]).trim();
          const curr = workerTotalsMap.get(wId) || { daysWorked: 0, regularHours: 0, overtimeHours: 0 };
          curr.regularHours += parseFloat(row[4]) || 0;
          curr.overtimeHours += parseFloat(row[5]) || 0;
          curr.daysWorked += parseFloat(row[6]) || 0;
          workerTotalsMap.set(wId, curr);
        }
      }

      // Generar filas de la tabla consolidada: 1 fila por obrero con sus totales al frente
      const consolidatedRows = validWorkers.map((w: any) => {
        const wId = String(w[0] || '').trim();
        const wName = String(w[1] || '').trim();
        const wRole = String(w[3] || 'Ayudante').trim();
        const rateUnit = w[5] === 'Hora' ? 'Hora' : 'Dia';
        const baseRate = parseFloat(String(w[6]).replace(/[^0-9.-]+/g, '')) || 0;
        const overtimeRate = parseFloat(String(w[7]).replace(/[^0-9.-]+/g, '')) || 0;

        const totals = workerTotalsMap.get(wId) || { daysWorked: 0, regularHours: 0, overtimeHours: 0 };
        const subtotalBase = rateUnit === 'Hora' ? totals.regularHours * baseRate : totals.daysWorked * baseRate;
        const subtotalExtras = totals.overtimeHours * overtimeRate;
        const totalDevengado = subtotalBase + subtotalExtras;

        return [
          wId,
          wName,
          wRole,
          totals.daysWorked,
          totals.regularHours,
          totals.overtimeHours,
          baseRate,
          overtimeRate,
          subtotalBase,
          subtotalExtras,
          totalDevengado,
        ];
      });

      const firstDataRow = 2; // Fila 2 en Google Sheets (1-indexed)
      const lastDataRow = firstDataRow + consolidatedRows.length - 1;
      const totalRowNumber = lastDataRow + 1;

      // Fila final de TOTAL GENERAL con fórmulas nativas de Google Sheets
      const totalSummaryRow = [
        '',
        'TOTAL GENERAL',
        '',
        consolidatedRows.length > 0 ? `=SUM(D${firstDataRow}:D${lastDataRow})` : 0,
        consolidatedRows.length > 0 ? `=SUM(E${firstDataRow}:E${lastDataRow})` : 0,
        consolidatedRows.length > 0 ? `=SUM(F${firstDataRow}:F${lastDataRow})` : 0,
        '',
        '',
        consolidatedRows.length > 0 ? `=SUM(I${firstDataRow}:I${lastDataRow})` : 0,
        consolidatedRows.length > 0 ? `=SUM(J${firstDataRow}:J${lastDataRow})` : 0,
        consolidatedRows.length > 0 ? `=SUM(K${firstDataRow}:K${lastDataRow})` : 0,
      ];

      const fullPayrollValues = [
        NOMINA_CONSOLIDADA_HEADERS,
        ...consolidatedRows,
        totalSummaryRow,
      ];

      // Actualizar tabla en A1:K
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: getSafeRange(tiemposTitle, `A1:K${fullPayrollValues.length}`),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: fullPayrollValues },
      }).catch(console.warn);

      // Limpiar filas residuales anteriores que pudieran quedar más abajo
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: getSafeRange(tiemposTitle, `A${fullPayrollValues.length + 1}:K1000`),
      }).catch(() => null);

      batchRequests.push(
        // Congelar fila 1 de encabezados
        {
          updateSheetProperties: {
            properties: {
              sheetId: tId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        // Altura de fila de encabezados
        {
          updateDimensionProperties: {
            range: { sheetId: tId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 38 },
            fields: 'pixelSize',
          },
        },
        // Formato Encabezado: Fondo Slate-900, texto blanco, negrita y centrado
        {
          repeatCell: {
            range: { sheetId: tId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
            cell: {
              userEnteredFormat: {
                backgroundColor: headerBgColor,
                textFormat: { bold: true, fontSize: 10, foregroundColor: whiteColor },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
          },
        },
        // Formato Filas de Datos: Altura 28px
        {
          updateDimensionProperties: {
            range: { sheetId: tId, dimension: 'ROWS', startIndex: 1, endIndex: Math.max(2, totalRowNumber - 1) },
            properties: { pixelSize: 28 },
            fields: 'pixelSize',
          },
        },
        // Alineación y Formato Columnas Días y Horas (Col D, E, F: index 3, 4, 5): Centrado y número
        {
          repeatCell: {
            range: { sheetId: tId, startRowIndex: 1, endRowIndex: totalRowNumber, startColumnIndex: 3, endColumnIndex: 6 },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'NUMBER', pattern: '#,##0' },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
          },
        },
        // Formato Moneda en Tarifas, Subtotales y Total Devengado (Col G, H, I, J, K: index 6 a 11): Moneda "$"#,##0
        {
          repeatCell: {
            range: { sheetId: tId, startRowIndex: 1, endRowIndex: totalRowNumber, startColumnIndex: 6, endColumnIndex: 11 },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' },
                horizontalAlignment: 'RIGHT',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
          },
        },
        // Columna K (Total Devengado): Negrita para resaltar
        {
          repeatCell: {
            range: { sheetId: tId, startRowIndex: 1, endRowIndex: totalRowNumber, startColumnIndex: 10, endColumnIndex: 11 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat(textFormat)',
          },
        },
        // Fila de TOTAL GENERAL: Fondo verde suave, texto negrita
        {
          repeatCell: {
            range: { sheetId: tId, startRowIndex: totalRowNumber - 1, endRowIndex: totalRowNumber, startColumnIndex: 0, endColumnIndex: 11 },
            cell: {
              userEnteredFormat: {
                backgroundColor: totalBgColor,
                textFormat: { bold: true, fontSize: 11, foregroundColor: totalTextColor },
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
          },
        },
        // Altura de fila de totales
        {
          updateDimensionProperties: {
            range: { sheetId: tId, dimension: 'ROWS', startIndex: totalRowNumber - 1, endIndex: totalRowNumber },
            properties: { pixelSize: 34 },
            fields: 'pixelSize',
          },
        },
        // Bordes limpios en toda la tabla
        {
          updateBorders: {
            range: { sheetId: tId, startRowIndex: 0, endRowIndex: totalRowNumber, startColumnIndex: 0, endColumnIndex: 11 },
            bottom: { style: 'SOLID', color: borderColor },
            top: { style: 'SOLID', color: borderColor },
            left: { style: 'SOLID', color: borderColor },
            right: { style: 'SOLID', color: borderColor },
            innerHorizontal: { style: 'SOLID', color: borderColor },
            innerVertical: { style: 'SOLID', color: borderColor },
          },
        },
        // Borde doble o grueso debajo de la fila TOTAL GENERAL
        {
          updateBorders: {
            range: { sheetId: tId, startRowIndex: totalRowNumber - 1, endRowIndex: totalRowNumber, startColumnIndex: 0, endColumnIndex: 11 },
            bottom: { style: 'SOLID_MEDIUM', color: { red: 16 / 255, green: 185 / 255, blue: 129 / 255 } },
            top: { style: 'SOLID', color: { red: 16 / 255, green: 185 / 255, blue: 129 / 255 } },
          },
        },
        // Ancho de columnas óptimo para visualización limpia
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 230 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 125 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 125 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: tId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } }
      );
    }

    if (batchRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: batchRequests },
      });
      console.log('[applyCorporateStylingToPayrollSheets] Formato consolidado profesional aplicado con éxito a las hojas de nómina.');
    }
  } catch (err: any) {
    console.warn('[applyCorporateStylingToPayrollSheets] Aviso aplicando formato:', err?.message || err);
  }
}

/**
 * 1b. Endpoint para aplicar el formato corporativo oficial SVH a las pestañas de nómina
 * (Foto del arquitecto en A1:E3, encabezados verdes corporativos #1ca330, moneda y dimensiones)
 * Endpoint: POST /api/payroll/apply-styling
 */
app.post('/api/payroll/apply-styling', async (req, res) => {
  try {
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ success: false, error: 'spreadsheetId es obligatorio.' });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const { obrerosSheet, tiemposSheet, obrerosTitle, tiemposTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    await applyCorporateStylingToPayrollSheets(
      sheets,
      spreadsheetId,
      obrerosTitle,
      tiemposTitle,
      obrerosSheet?.properties?.sheetId,
      tiemposSheet?.properties?.sheetId
    );

    return res.json({
      success: true,
      message: '¡Formato oficial de SVH Arquitectos con foto y estilos corporativos aplicado exitosamente a Google Sheets!',
    });
  } catch (error: any) {
    return handlePayrollError(res, 'Error aplicando formato corporativo a nómina', error);
  }
});

/**
 * 2. Registrar jornada y horas extras en 'Nomina mes actual'
 * Endpoint: POST /api/payroll/log-time
 */
app.post('/api/payroll/log-time', async (req, res) => {
  try {
    const { spreadsheetId, entry } = req.body;
    if (!spreadsheetId || !entry || !entry.workerId) {
      return res.status(400).json({ success: false, error: 'Faltan datos obligatorios del registro.' });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const { obrerosTitle, tiemposTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    // Obtener información del obrero para calcular valores en la fila
    const workersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${obrerosTitle}'!A1:K150`,
    });

    const rawWorkerRows = workersRes.data.values || [];
    const targetWorkerRow = rawWorkerRows.find((r) => r[0] === entry.workerId);

    const workerName = entry.workerName || (targetWorkerRow ? targetWorkerRow[1] : 'Obrero');
    const rateUnit = targetWorkerRow ? targetWorkerRow[5] : 'Dia';
    const baseRate = targetWorkerRow ? parseFloat(String(targetWorkerRow[6]).replace(/[^0-9.-]+/g, '')) || 0 : 0;
    const overtimeRate = targetWorkerRow ? parseFloat(String(targetWorkerRow[7]).replace(/[^0-9.-]+/g, '')) || 0 : 0;

    const regularHours = Number(entry.regularHours) || 0;
    const overtimeHours = Number(entry.overtimeHours) || 0;
    const daysWorked = Number(entry.daysWorked) || (regularHours >= 4 ? (regularHours >= 8 ? 1 : 0.5) : 0);

    const subtotalBase = rateUnit === 'Hora' ? regularHours * baseRate : daysWorked * baseRate;
    const subtotalExtras = overtimeHours * overtimeRate;
    const total = subtotalBase + subtotalExtras;

    // Verificar si la hoja de tiempos está en formato consolidado por obrero
    const currentTimesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tiemposTitle}'!A1:K150`,
    }).catch(() => ({ data: { values: [] } }));

    const currentRows = currentTimesRes.data?.values || [];
    const isConsolidated = currentRows.length > 0 && (
      String(currentRows[0]?.[0] || '').toLowerCase() === 'id obrero' ||
      String(currentRows[0]?.[3] || '').toLowerCase().includes('días')
    );

    if (isConsolidated) {
      const workerRowIdx = currentRows.findIndex(
        (r, idx) => idx > 0 && (String(r[0] || '').trim() === entry.workerId || String(r[1] || '').trim().toLowerCase() === workerName.toLowerCase())
      );

      if (workerRowIdx > 0) {
        const existing = currentRows[workerRowIdx];
        const prevDays = parseFloat(existing[3]) || 0;
        const prevReg = parseFloat(existing[4]) || 0;
        const prevOt = parseFloat(existing[5]) || 0;

        const newDays = prevDays + daysWorked;
        const newReg = prevReg + regularHours;
        const newOt = prevOt + overtimeHours;

        const newSubtotalBase = rateUnit === 'Hora' ? newReg * baseRate : newDays * baseRate;
        const newSubtotalExtras = newOt * overtimeRate;
        const newTotal = newSubtotalBase + newSubtotalExtras;

        const updatedRow = [
          entry.workerId,
          workerName,
          targetWorkerRow ? targetWorkerRow[3] : (existing[2] || 'Ayudante'),
          newDays,
          newReg,
          newOt,
          baseRate,
          overtimeRate,
          newSubtotalBase,
          newSubtotalExtras,
          newTotal,
        ];

        const sheetRowNumber = workerRowIdx + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tiemposTitle}'!A${sheetRowNumber}:K${sheetRowNumber}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [updatedRow] },
        });

        return res.json({
          success: true,
          message: `Jornada sumada exitosamente al obrero ${workerName}. Total: ${newDays} días y ${newOt}h extras.`,
          id: entry.workerId,
          rowValues: updatedRow,
        });
      } else {
        // Obrero no estaba en la tabla consolidada: agregarlo antes de TOTAL GENERAL
        const totalRowIdx = currentRows.findIndex(
          (r, idx) => idx > 0 && String(r[1] || '').toUpperCase().includes('TOTAL')
        );

        const newRow = [
          entry.workerId,
          workerName,
          targetWorkerRow ? targetWorkerRow[3] : 'Ayudante',
          daysWorked,
          regularHours,
          overtimeHours,
          baseRate,
          overtimeRate,
          subtotalBase,
          subtotalExtras,
          total,
        ];

        if (totalRowIdx > 0) {
          const updatedRows = [...currentRows.slice(0, totalRowIdx), newRow, currentRows[totalRowIdx]];
          const firstDataRow = 2;
          const lastDataRow = totalRowIdx + 1;
          const totalSummaryRow = [
            '',
            'TOTAL GENERAL',
            '',
            `=SUM(D${firstDataRow}:D${lastDataRow})`,
            `=SUM(E${firstDataRow}:E${lastDataRow})`,
            `=SUM(F${firstDataRow}:F${lastDataRow})`,
            '',
            '',
            `=SUM(I${firstDataRow}:I${lastDataRow})`,
            `=SUM(J${firstDataRow}:J${lastDataRow})`,
            `=SUM(K${firstDataRow}:K${lastDataRow})`,
          ];
          updatedRows[updatedRows.length - 1] = totalSummaryRow;

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${tiemposTitle}'!A1:K${updatedRows.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: updatedRows },
          });
        } else {
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${tiemposTitle}'!A:K`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [newRow] },
          });
        }

        return res.json({
          success: true,
          message: `Obrero ${workerName} incorporado a la nómina con ${daysWorked} días y ${overtimeHours}h extras.`,
          id: entry.workerId,
          rowValues: newRow,
        });
      }
    }

    const logId = `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const rowValues = [
      logId,
      entry.date || new Date().toISOString().split('T')[0],
      entry.workerId,
      workerName,
      regularHours,
      overtimeHours,
      daysWorked,
      entry.activityNotes || entry.siteLocation || 'Trabajo general de obra',
      subtotalBase,
      subtotalExtras,
      total,
    ];

    // Inyectar en 'Nomina mes actual' como nueva fila al final
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tiemposTitle}'!A:K`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowValues],
      },
    });

    return res.json({
      success: true,
      message: 'Jornada y horas extras registradas exitosamente.',
      id: logId,
      rowValues,
    });
  } catch (error: any) {
    console.error('Error en /api/payroll/log-time:', error);
    return res.status(500).json({
      success: false,
      error: 'Error registrando tiempo en Sheets: ' + (error?.message || error),
    });
  }
});

/**
 * 3. Agregar nuevo obrero a la pestaña 'Informacion obrero'
 * Endpoint: POST /api/payroll/add-worker
 */
app.post('/api/payroll/add-worker', async (req, res) => {
  try {
    const { spreadsheetId, worker } = req.body;
    if (!spreadsheetId || !worker || !worker.name) {
      return res.status(400).json({ success: false, error: 'Faltan datos del obrero.' });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const { obrerosTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    // Determinar siguiente ID
    const workersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${obrerosTitle}'!A1:A200`,
    });
    const allRows = (workersRes.data.values || []).filter((r) => {
      const c = String(r[0] || '').trim();
      return c && !c.startsWith('=IMAGE') && c.toLowerCase() !== 'id';
    });
    const count = allRows.length;
    const newId = worker.id || `OBR-${String(count + 1).padStart(3, '0')}`;

    const newWorkerRow = [
      newId,
      worker.name,
      worker.dni || '',
      worker.role || 'Ayudante',
      worker.paymentFrequency || 'Semanal',
      worker.rateUnit || 'Dia',
      Number(worker.baseRate) || 60000,
      Number(worker.overtimeRate) || 12000,
      worker.phone || '',
      worker.active !== false ? 'Activo' : 'Inactivo',
      worker.joinedDate || new Date().toISOString().split('T')[0],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${obrerosTitle}'!A:K`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [newWorkerRow],
      },
    });

    return res.json({
      success: true,
      message: `Obrero ${worker.name} agregado correctamente a Informacion obrero.`,
      worker: {
        id: newId,
        name: worker.name,
        dni: worker.dni || '',
        role: worker.role || 'Ayudante',
        paymentFrequency: worker.paymentFrequency || 'Semanal',
        rateUnit: worker.rateUnit || 'Dia',
        baseRate: Number(worker.baseRate) || 60000,
        overtimeRate: Number(worker.overtimeRate) || 12000,
        phone: worker.phone || '',
        active: true,
        joinedDate: worker.joinedDate || new Date().toISOString().split('T')[0],
      },
    });
  } catch (error: any) {
    console.error('Error en /api/payroll/add-worker:', error);
    return res.status(500).json({
      success: false,
      error: 'Error agregando obrero: ' + (error?.message || error),
    });
  }
});

/**
 * 3b. Agregar múltiples obreros en lote a 'Informacion obrero'
 * Endpoint: POST /api/payroll/add-workers-batch
 */
app.post('/api/payroll/add-workers-batch', async (req, res) => {
  try {
    const { spreadsheetId, workers } = req.body;
    if (!spreadsheetId || !Array.isArray(workers) || workers.length === 0) {
      return res.status(400).json({ success: false, error: 'Lista de obreros o spreadsheetId inválido.' });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const { obrerosTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    // Obtener obreros existentes para calcular IDs consecutivos únicos
    const workersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${obrerosTitle}'!A1:A500`,
    });
    const allRows = (workersRes.data.values || []).filter((r) => {
      const c = String(r[0] || '').trim();
      return c && !c.startsWith('=IMAGE') && c.toLowerCase() !== 'id';
    });
    let currentCount = allRows.length;

    const rowsToAppend = workers.map((w: any) => {
      currentCount++;
      const id = w.id || `OBR-${String(currentCount).padStart(3, '0')}`;
      const baseRate = Number(w.baseRate) || 70000;
      const rateUnit = w.rateUnit === 'Hora' ? 'Hora' : 'Dia';
      const overtimeRate =
        Number(w.overtimeRate) ||
        (rateUnit === 'Hora' ? Math.round(baseRate * 1.5) : Math.round((baseRate / 8) * 1.5)) ||
        14000;

      return [
        id,
        w.name || 'Obrero sin nombre',
        w.dni || '',
        w.role || 'Ayudante',
        w.paymentFrequency || 'Semanal',
        rateUnit,
        baseRate,
        overtimeRate,
        w.phone || '',
        w.active !== false ? 'Activo' : 'Inactivo',
        w.joinedDate || new Date().toISOString().split('T')[0],
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${obrerosTitle}'!A:K`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rowsToAppend,
      },
    });

    const added = rowsToAppend.map((r) => ({
      id: r[0],
      name: r[1],
      dni: r[2],
      role: r[3],
      paymentFrequency: r[4],
      rateUnit: r[5],
      baseRate: r[6],
      overtimeRate: r[7],
      phone: r[8],
      active: true,
      joinedDate: r[10],
    }));

    return res.json({
      success: true,
      message: `Se registraron con éxito ${added.length} obreros en Google Sheets.`,
      addedWorkers: added,
    });
  } catch (error: any) {
    console.error('Error en /api/payroll/add-workers-batch:', error);
    return res.status(500).json({
      success: false,
      error: 'Error registrando lote de obreros: ' + (error?.message || error),
    });
  }
});

/**
 * 3c. Analizar y extraer obreros, tarifas y datos desde un documento (Excel, CSV, PDF, Imagen)
 * Endpoint: POST /api/payroll/parse-workers-document
 */
app.post('/api/payroll/parse-workers-document', async (req, res) => {
  try {
    const { fileBase64, mimeType, fileName = 'documento_obreros' } = req.body;
    if (!fileBase64) {
      return res.status(400).json({ success: false, error: 'Se requiere el contenido del archivo en base64.' });
    }

    const lowerName = fileName.toLowerCase();
    const effectiveMime = (mimeType || '').toLowerCase();
    const isExcelOrCsv =
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.csv') ||
      effectiveMime.includes('spreadsheet') ||
      effectiveMime.includes('excel') ||
      effectiveMime.includes('csv');

    // 1. Intento de extracción directa con SheetJS si es Excel / CSV
    if (isExcelOrCsv) {
      try {
        const fileBuffer = Buffer.from(fileBase64, 'base64');
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetNames = workbook.SheetNames;

        if (sheetNames.length > 0) {
          const firstSheet = workbook.Sheets[sheetNames[0]];
          const rawRows: any[] = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

          if (rawRows.length > 0) {
            const detectedWorkers: any[] = [];

            for (const row of rawRows) {
              // Buscar claves comunes en minúsculas y sin acentos
              const keys = Object.keys(row);
              let name = '';
              let role = '';
              let dni = '';
              let baseRate = 0;
              let overtimeRate = 0;
              let rateUnit: 'Dia' | 'Hora' = 'Dia';
              let paymentFrequency: 'Semanal' | 'Quincenal' | 'Mensual' = 'Semanal';
              let phone = '';

              for (const k of keys) {
                const cleanKey = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                const val = String(row[k] || '').trim();

                if (/^(nombre|name|obrero|empleado|trabajador|personal|colaborador)$/i.test(cleanKey) || (!name && /nombre/i.test(cleanKey))) {
                  name = val;
                } else if (/^(cargo|rol|oficio|puesto|ocupacion|labor)$/i.test(cleanKey) || (!role && /(cargo|oficio|rol)/i.test(cleanKey))) {
                  role = val;
                } else if (/^(dni|cedula|cc|identificacion|documento|id)$/i.test(cleanKey) || (!dni && /(cedula|dni|cc)/i.test(cleanKey))) {
                  dni = val;
                } else if (/(tarifa|precio|sueldo|salario|jornal|base|valor.*dia|valor.*hora)/i.test(cleanKey) && !/extra/i.test(cleanKey)) {
                  const cleanedVal = val.replace(/[^0-9]/g, '');
                  if (cleanedVal) baseRate = parseInt(cleanedVal, 10);
                } else if (/(extra|h\.?e|recargo)/i.test(cleanKey)) {
                  const cleanedVal = val.replace(/[^0-9]/g, '');
                  if (cleanedVal) overtimeRate = parseInt(cleanedVal, 10);
                } else if (/(unidad|tipo.*tarifa)/i.test(cleanKey)) {
                  if (/hora/i.test(val)) rateUnit = 'Hora';
                } else if (/(frecuencia|periodo|pago)/i.test(cleanKey)) {
                  if (/quincen/i.test(val)) paymentFrequency = 'Quincenal';
                  else if (/mensual/i.test(val)) paymentFrequency = 'Mensual';
                } else if (/(telefono|celular|movil|contacto)/i.test(cleanKey)) {
                  phone = val;
                }
              }

              // Si encontramos al menos un nombre razonable (no fila de totales o encabezados vacíos)
              if (name && name.length >= 3 && !/^(total|resumen|subtotal|observacion)/i.test(name)) {
                if (!role) role = 'Oficial de Obra';
                if (!baseRate || baseRate <= 0) baseRate = 80000;
                if (!overtimeRate || overtimeRate <= 0) {
                  overtimeRate = rateUnit === 'Hora' ? Math.round(baseRate * 1.5) : Math.round((baseRate / 8) * 1.5);
                }
                detectedWorkers.push({
                  name,
                  role,
                  dni,
                  baseRate,
                  overtimeRate,
                  rateUnit,
                  paymentFrequency,
                  phone,
                });
              }
            }

            if (detectedWorkers.length > 0) {
              return res.json({
                success: true,
                formatDetected: 'Excel / CSV Estructurado',
                documentSummary: `Archivo "${fileName}" con ${detectedWorkers.length} obreros detectados`,
                workers: detectedWorkers,
              });
            }
          }
        }
      } catch (xlsxErr) {
        console.warn('[parse-workers-document] Falló lectura local XLSX, intentando con IA Gemini:', xlsxErr);
      }
    }

    // 2. Extracción multimodal con Gemini 3.8 Flash (para PDF, imágenes escaneadas, fotos o Excel complejo)
    const ai = getGenAI();
    if (!ai) {
      return res.status(500).json({
        success: false,
        error: 'No se ha configurado la API de IA (GEMINI_API_KEY) para procesar documentos escaneados o PDF.',
      });
    }

    const promptText = `Eres un asistente experto en ingeniería civil, arquitectura y nómina de obras de construcción en Colombia y Latinoamérica.
Analiza detenidamente el documento adjunto (puede ser una planilla de cuadrilla, listado de obreros, contrato de mano de obra, cotización o formato de asistencia) y extrae todos los trabajadores/obreros con sus tarifas y datos.

Reglas críticas de extracción de valores:
1. En Colombia (COP) y Latinoamérica, las tarifas de construcción suelen rondar entre $50.000 y $250.000 pesos por día (o $7.000 a $30.000 por hora). Si el documento dice "$ 85.000", el valor entero numérico es 85000 (NO 85.00). Nunca trunques los ceros ni tomes el punto de miles como coma decimal.
2. Identifica el Oficio o Rol de cada obrero (ej: Maestro de Obra, Oficial Albañil, Ayudante, Electricista, Fierrero, Pintor, Plomero, Soldador, etc.). Si no está explícito, asígnale "Oficial de Obra" o "Ayudante".
3. Identifica la tarifa base acordada y si es por Día ('Dia') o por Hora ('Hora').
4. Si la tarifa de horas extras no viene explícita, calcula un estimado de 1.5 veces el valor de la hora ordinaria (por ejemplo si el día es 80.000, la hora ordinaria es 10.000 y la extra 15.000).
5. Extrae Cédula (DNI) y Teléfono si aparecen. Si no están presentes, déjalos como cadena vacía.
6. Ignora filas de subtotales, totales generales o firmas.`;

    const contents = [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              data: fileBase64,
              mimeType: effectiveMime || (lowerName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ];

    const workersExtractionSchema = {
      type: Type.OBJECT,
      properties: {
        documentSummary: {
          type: Type.STRING,
          description: 'Breve resumen del documento detectado (ej: Listado de Cuadrilla Frente 3)',
        },
        workers: {
          type: Type.ARRAY,
          description: 'Lista de obreros o trabajadores identificados en el documento',
          items: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: 'Nombre completo del obrero o empleado',
              },
              role: {
                type: Type.STRING,
                description: 'Cargo u oficio (ej: Maestro de Obra, Oficial Albañil, Ayudante, etc.)',
              },
              dni: {
                type: Type.STRING,
                description: 'Número de cédula, CC o DNI si se especifica, o vacío',
              },
              baseRate: {
                type: Type.NUMBER,
                description: 'Tarifa base o precio pactado por día o por hora en valor entero numérico (ej: 85000 para $85.000)',
              },
              overtimeRate: {
                type: Type.NUMBER,
                description: 'Tarifa por hora extra (valor entero numérico)',
              },
              rateUnit: {
                type: Type.STRING,
                enum: ['Dia', 'Hora'],
                description: 'Unidad de la tarifa: Dia u Hora',
              },
              paymentFrequency: {
                type: Type.STRING,
                enum: ['Semanal', 'Quincenal', 'Mensual'],
                description: 'Frecuencia de liquidación o pago',
              },
              phone: {
                type: Type.STRING,
                description: 'Teléfono o celular del trabajador si aparece, o vacío',
              },
            },
            required: ['name', 'baseRate'],
          },
        },
      },
      required: ['workers'],
    };

    const schemaConfig = {
      systemInstruction: 'Analiza el documento y extrae la lista de obreros y sus precios/tarifas exactamente según el esquema JSON solicitado.',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: workersExtractionSchema,
      },
    };

    const aiRes = await callGeminiWithRetry(ai, contents, schemaConfig, `Extracción de obreros desde ${fileName}`);
    if (!aiRes.success || !aiRes.text) {
      throw new Error(aiRes.error?.message || 'No se pudo extraer la lista de obreros del documento con IA.');
    }

    const parsedJson = JSON.parse(aiRes.text);
    const workers = (parsedJson.workers || []).map((w: any) => ({
      name: String(w.name || '').trim(),
      role: String(w.role || 'Oficial de Obra').trim(),
      dni: String(w.dni || '').trim(),
      baseRate: Number(w.baseRate) || 80000,
      overtimeRate: Number(w.overtimeRate) || (w.rateUnit === 'Hora' ? Math.round(Number(w.baseRate) * 1.5) : Math.round((Number(w.baseRate) / 8) * 1.5)) || 15000,
      rateUnit: w.rateUnit === 'Hora' ? 'Hora' : 'Dia',
      paymentFrequency: w.paymentFrequency || 'Semanal',
      phone: String(w.phone || '').trim(),
    }));

    return res.json({
      success: true,
      formatDetected: `IA Gemini 3.8 Flash (${aiRes.modelUsed || 'multimodal'})`,
      documentSummary: parsedJson.documentSummary || `Archivo "${fileName}" procesado con éxito`,
      workers,
    });
  } catch (error: any) {
    console.error('Error en /api/payroll/parse-workers-document:', error);
    return res.status(500).json({
      success: false,
      error: 'Error analizando documento de obreros: ' + (error?.message || error),
    });
  }
});

/**
 * 4. Automatización de Cierre de Mes (Rollover)
 * Genera una NUEVA Hoja de Cálculo independiente en Google Drive con los datos del mes cerrado,
 * la almacena en la carpeta de la obra, y resetea 'Nomina mes actual' en la hoja principal a cero
 * asegurando que la hoja principal conserve únicamente "Informacion obrero" y "Nomina mes actual".
 * Endpoint: POST /api/payroll/rollover
 */
app.post('/api/payroll/rollover', async (req, res) => {
  try {
    const { spreadsheetId, archiveMonthName, folderId, projectName = 'Obra' } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ success: false, error: 'spreadsheetId es obligatorio.' });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    const now = new Date();
    const defaultArchiveName = `Nomina_${MONTH_NAMES_ES[now.getMonth()]}_${now.getFullYear()}`;
    const archiveSheetTitle = archiveMonthName || defaultArchiveName;

    // 1. Obtener pestañas y datos actuales de la hoja principal
    const { obrerosSheet, tiemposSheet, obrerosTitle, tiemposTitle, sheetsList } = await resolvePayrollSheets(sheets, spreadsheetId);

    // Leer registros de tiempos y obreros actuales
    const timesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: getSafeRange(tiemposTitle, 'A1:K1000'),
    });
    const rawTimes = timesRes.data.values || [];
    const recordedTimes = rawTimes.filter((r) => {
      const c0 = String(r[0] || '').trim();
      return c0 && !c0.startsWith('=IMAGE') && c0.toLowerCase() !== 'id registro';
    });

    const workersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: getSafeRange(obrerosTitle, 'A1:K150'),
    });
    const rawWorkers = workersRes.data.values || [];
    const activeWorkers = rawWorkers.filter((r) => {
      const c0 = String(r[0] || '').trim();
      const status = String(r[9] || '').toLowerCase();
      return c0 && !c0.startsWith('=IMAGE') && c0.toLowerCase() !== 'id' && status !== 'inactivo';
    });

    // 2. CREAR NUEVA HOJA DE CÁLCULO INDEPENDIENTE EN GOOGLE DRIVE PARA EL MES CERRADO
    const cleanProj = String(projectName).replace(/[:\/\\?*|"]/g, '_');
    const newSheetTitle = `Cierre Nómina SVH - ${cleanProj} - ${archiveSheetTitle}`;

    const createSheetRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: newSheetTitle,
        },
      },
    });

    const newSpreadsheetId = createSheetRes.data.spreadsheetId;
    if (!newSpreadsheetId) {
      throw new Error('No se pudo crear el archivo independiente de Google Sheets para el cierre de mes.');
    }

    // Mover el nuevo archivo a la carpeta elegida de Drive si se especificó folderId
    if (folderId && folderId !== 'root') {
      try {
        const fileMeta = await drive.files.get({
          fileId: newSpreadsheetId,
          fields: 'parents',
        });
        const previousParents = (fileMeta.data.parents || []).join(',');
        await drive.files.update({
          fileId: newSpreadsheetId,
          addParents: folderId,
          removeParents: previousParents || undefined,
          fields: 'id, parents',
        });
        console.log(`[Rollover] Nueva hoja de cálculo ${newSpreadsheetId} movida exitosamente a carpeta ${folderId}`);
      } catch (moveErr) {
        console.warn('Aviso organizando nueva hoja de cierre en carpeta de Drive:', moveErr);
      }
    }

    // Obtener la primera pestaña de la nueva hoja independiente de respaldo y renombrarla
    const newMeta = await sheets.spreadsheets.get({
      spreadsheetId: newSpreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const firstTab = newMeta.data.sheets?.[0];
    const firstTabId = firstTab?.properties?.sheetId || 0;
    const closedTabName = `Nomina_${archiveSheetTitle.replace(/^Nomina_/i, '')}`;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: newSpreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: firstTabId,
                title: closedTabName,
                tabColor: { red: 0.11, green: 0.64, blue: 0.19 },
              },
              fields: 'title,tabColor',
            },
          },
        ],
      },
    });

    // Inyectar encabezados en A1:K1 (sin foto de logo) y filas registradas del mes en A2
    await sheets.spreadsheets.values.update({
      spreadsheetId: newSpreadsheetId,
      range: `'${closedTabName}'!A1:K1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [NOMINA_CONSOLIDADA_HEADERS] },
    });

    if (recordedTimes.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: newSpreadsheetId,
        range: `'${closedTabName}'!A2:K`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: recordedTimes },
      });
    }

    // Agregar pestaña "Informacion obrero" en la nueva hoja de archivo
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: newSpreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: 'Informacion obrero',
                  gridProperties: { rowCount: 150, columnCount: 15 },
                  tabColor: { red: 0.11, green: 0.64, blue: 0.19 },
                },
              },
            },
          ],
        },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: newSpreadsheetId,
        range: "'Informacion obrero'!A1:K1",
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [OBREROS_HEADERS] },
      });

      const workerDataToArchive = rawWorkers.filter((r) => {
        const c0 = String(r[0] || '').trim();
        return c0 && !c0.startsWith('=IMAGE') && c0.toLowerCase() !== 'id';
      });
      if (workerDataToArchive.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: newSpreadsheetId,
          range: "'Informacion obrero'!A2:K",
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: workerDataToArchive },
        });
      }
    } catch (archiveWorkersErr) {
      console.warn('[Rollover] Aviso agregando Informacion obrero a hoja archivada:', archiveWorkersErr);
    }

    // 3. CONSERVACIÓN EN LA HOJA PRINCIPAL:
    // NUNCA eliminar pestañas existentes (se preserva Facturación, Información Obrero, y meses previos).
    // Dejar la nómina del mes cerrado en su pestaña actual, y crear una NUEVA pestaña para el mes siguiente.
    const nextMonthIndex = (now.getMonth() + 1) % 12;
    let newMonthTabName = `Nomina ${MONTH_NAMES_ES[nextMonthIndex]} ${now.getFullYear()}`;

    // Si ya existe una pestaña con ese nombre exacto, agregar sufijo
    const existingTitles = (sheetsList || []).map((s: any) => s.properties?.title || '');
    let tabSuffixCounter = 1;
    while (existingTitles.includes(newMonthTabName)) {
      newMonthTabName = `Nomina ${MONTH_NAMES_ES[nextMonthIndex]} (${tabSuffixCounter++})`;
    }

    // Si la pestaña cerrada se llamaba genéricamente "Nomina mes actual" o similar,
    // renombrarla al nombre del mes cerrado para que el usuario conserve claramente ese mes en su libro
    const closedPersistentTitle = archiveSheetTitle.startsWith('Nomina') ? archiveSheetTitle : `Nomina ${archiveSheetTitle}`;
    if (tiemposSheet?.properties?.sheetId !== undefined && (tiemposTitle.toLowerCase() === 'nomina mes actual' || tiemposTitle.toLowerCase() === 'tiempos_mesactual')) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: tiemposSheet.properties.sheetId,
                    title: closedPersistentTitle,
                  },
                  fields: 'title',
                },
              },
            ],
          },
        });
        console.log(`[Rollover] Pestaña previa renombrada a "${closedPersistentTitle}" para preservar el histórico de nómina.`);
      } catch (renameErr) {
        console.warn('[Rollover] Aviso renombrando pestaña anterior:', renameErr);
      }
    }

    // 4. CREAR NUEVA PESTAÑA PARA EL NUEVO PERIODO (sin borrar ninguna pestaña anterior)
    const addSheetRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: newMonthTabName,
                gridProperties: { rowCount: Math.max(50, activeWorkers.length + 15), columnCount: 15 },
                tabColor: { red: 0.11, green: 0.64, blue: 0.19 },
              },
            },
          },
        ],
      },
    });

    const newTabSheetId = addSheetRes.data?.replies?.[0]?.addSheet?.properties?.sheetId;

    // Inicializar la nueva pestaña con la tabla consolidada en cero para cada obrero activo
    const newMonthRows = activeWorkers.map((w) => {
      const wId = String(w[0] || '').trim();
      const wName = String(w[1] || '').trim();
      const wRole = String(w[3] || 'Ayudante').trim();
      const baseRate = parseFloat(String(w[6]).replace(/[^0-9.-]+/g, '')) || 0;
      const overtimeRate = parseFloat(String(w[7]).replace(/[^0-9.-]+/g, '')) || 0;

      return [
        wId,
        wName,
        wRole,
        0, // Días totales en 0
        0, // Horas regulares en 0
        0, // Horas extras en 0
        baseRate,
        overtimeRate,
        0, // Subtotal base en 0
        0, // Subtotal extras en 0
        0, // Total devengado en 0
      ];
    });

    const firstDataRow = 2;
    const lastDataRow = firstDataRow + newMonthRows.length - 1;
    const totalRowNumber = lastDataRow + 1;

    const totalSummaryRow = [
      '',
      'TOTAL GENERAL',
      '',
      newMonthRows.length > 0 ? `=SUM(D${firstDataRow}:D${lastDataRow})` : 0,
      newMonthRows.length > 0 ? `=SUM(E${firstDataRow}:E${lastDataRow})` : 0,
      newMonthRows.length > 0 ? `=SUM(F${firstDataRow}:F${lastDataRow})` : 0,
      '',
      '',
      newMonthRows.length > 0 ? `=SUM(I${firstDataRow}:I${lastDataRow})` : 0,
      newMonthRows.length > 0 ? `=SUM(J${firstDataRow}:J${lastDataRow})` : 0,
      newMonthRows.length > 0 ? `=SUM(K${firstDataRow}:K${lastDataRow})` : 0,
    ];

    const fullValues = [
      NOMINA_CONSOLIDADA_HEADERS,
      ...newMonthRows,
      totalSummaryRow,
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${newMonthTabName}'!A1:K${fullValues.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: fullValues },
    });

    // Aplicar diseño corporativo profesional a la nueva pestaña
    if (newTabSheetId !== undefined) {
      const headerBgColor = { red: 15 / 255, green: 23 / 255, blue: 42 / 255 }; // Slate-900
      const whiteColor = { red: 1.0, green: 1.0, blue: 1.0 };
      const borderColor = { red: 226 / 255, green: 232 / 255, blue: 240 / 255 };
      const totalBgColor = { red: 236 / 255, green: 253 / 255, blue: 245 / 255 };
      const totalTextColor = { red: 6 / 255, green: 78 / 255, blue: 59 / 255 };

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            { updateSheetProperties: { properties: { sheetId: newTabSheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } },
            {
              repeatCell: {
                range: { sheetId: newTabSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: headerBgColor,
                    textFormat: { bold: true, fontSize: 10, foregroundColor: whiteColor },
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE',
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
              },
            },
            {
              repeatCell: {
                range: { sheetId: newTabSheetId, startRowIndex: 1, endRowIndex: totalRowNumber, startColumnIndex: 3, endColumnIndex: 6 },
                cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
                fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
              },
            },
            {
              repeatCell: {
                range: { sheetId: newTabSheetId, startRowIndex: 1, endRowIndex: totalRowNumber, startColumnIndex: 6, endColumnIndex: 11 },
                cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' }, horizontalAlignment: 'RIGHT', verticalAlignment: 'MIDDLE' } },
                fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
              },
            },
            {
              repeatCell: {
                range: { sheetId: newTabSheetId, startRowIndex: totalRowNumber - 1, endRowIndex: totalRowNumber, startColumnIndex: 0, endColumnIndex: 11 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: totalBgColor,
                    textFormat: { bold: true, fontSize: 11, foregroundColor: totalTextColor },
                    verticalAlignment: 'MIDDLE',
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
              },
            },
            {
              updateBorders: {
                range: { sheetId: newTabSheetId, startRowIndex: 0, endRowIndex: totalRowNumber, startColumnIndex: 0, endColumnIndex: 11 },
                bottom: { style: 'SOLID', color: borderColor },
                top: { style: 'SOLID', color: borderColor },
                left: { style: 'SOLID', color: borderColor },
                right: { style: 'SOLID', color: borderColor },
                innerHorizontal: { style: 'SOLID', color: borderColor },
                innerVertical: { style: 'SOLID', color: borderColor },
              },
            },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 230 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 125 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 125 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: newTabSheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } }
          ],
        },
      }).catch(console.warn);
    }

    const newSpreadsheetUrl = `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`;

    return res.json({
      success: true,
      message: `¡Cierre de mes exitoso! Los datos de nómina de ${archiveSheetTitle} se mantuvieron intactos en la hoja de cálculo. Se habilitó la nueva pestaña "${newMonthTabName}" con horas en cero y se conservó toda la información anterior (incluida la facturación).`,
      newSpreadsheetId,
      newSpreadsheetUrl,
      archivedSheetTitle: archiveSheetTitle,
      newSheetTitle: newMonthTabName,
      workersPreservedCount: activeWorkers.length,
    });
  } catch (error: any) {
    console.error('Error en /api/payroll/rollover:', error);
    return res.status(500).json({
      success: false,
      error: 'Error ejecutando cierre de mes: ' + (error?.message || error),
    });
  }
});

/**
 * 4.1 Importar una hoja de cálculo existente de Google Drive como pestaña en la hoja activa
 * Endpoint: POST /api/payroll/import-sheet-tab
 */
app.post('/api/payroll/import-sheet-tab', async (req, res) => {
  try {
    const { destinationSpreadsheetId, sourceSpreadsheetIdOrUrl, newTabTitle } = req.body;
    if (!destinationSpreadsheetId || !sourceSpreadsheetIdOrUrl) {
      return res.status(400).json({
        success: false,
        error: 'destinationSpreadsheetId y sourceSpreadsheetIdOrUrl son obligatorios.',
      });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    // Extraer ID de la hoja de origen si viene como URL
    let sourceId = String(sourceSpreadsheetIdOrUrl).trim();
    const urlMatch = sourceId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
      sourceId = urlMatch[1];
    }

    const sourceMeta = await sheets.spreadsheets.get({
      spreadsheetId: sourceId,
      fields: 'sheets.properties(sheetId,title)',
    });

    const sourceSheets = sourceMeta.data.sheets || [];
    if (sourceSheets.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No se encontraron pestañas en la hoja de origen.',
      });
    }

    const firstSourceSheet = sourceSheets[0];
    const sourceSheetId = firstSourceSheet.properties?.sheetId || 0;
    const finalTitle = newTabTitle?.trim() || `Importada_${firstSourceSheet.properties?.title || 'Hoja'}`;

    // Copiar la pestaña a la hoja de cálculo de destino usando la API nativa copyTo
    const copyRes = await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId: sourceId,
      sheetId: sourceSheetId,
      requestBody: {
        destinationSpreadsheetId,
      },
    });

    const newCopiedSheetId = copyRes.data.sheetId;

    if (newCopiedSheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: destinationSpreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: newCopiedSheetId,
                  title: finalTitle,
                },
                fields: 'title',
              },
            },
          ],
        },
      }).catch((renameErr) => console.warn('Aviso renombrando pestaña copiada:', renameErr));
    }

    return res.json({
      success: true,
      message: `Pestaña "${finalTitle}" importada exitosamente a la hoja de cálculo activa.`,
      sheetTitle: finalTitle,
      sheetId: newCopiedSheetId,
    });
  } catch (error: any) {
    console.error('Error en /api/payroll/import-sheet-tab:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al importar hoja existente como pestaña: ' + (error?.message || error),
    });
  }
});

/**
 * 5. Actualizar datos de un obrero existente (Nombre, Rol, Frecuencia, Valor Base, etc.)
 * Endpoint: PUT /api/payroll/worker/:id
 */
app.put('/api/payroll/worker/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { spreadsheetId, worker } = req.body;

    if (!spreadsheetId || !id || !worker) {
      return res.status(400).json({
        success: false,
        error: 'spreadsheetId y datos del obrero son obligatorios.',
      });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    // Resolver pestaña oficial de obreros (sea "Informacion obrero", "Obreros", etc.)
    const { obrerosTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    // 1. Obtener todas las filas de Obreros para localizar el índice exacto
    const workersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: getSafeRange(obrerosTitle, 'A1:K150'),
    });

    const rows = workersRes.data.values || [];
    const rowIndex = rows.findIndex((row, idx) => idx > 0 && String(row[0]).trim() === String(id).trim());

    if (rowIndex === -1) {
      return res.status(404).json({
        success: false,
        error: `No se encontró el obrero con ID "${id}" en la hoja de cálculo (${obrerosTitle}).`,
      });
    }

    const existingRow = rows[rowIndex];
    const sheetRowNumber = rowIndex + 1; // 1-indexed para el rango A1

    // 2. Construir la fila actualizada preservando campos no modificados
    const updatedRow = [
      id,
      worker.name !== undefined ? String(worker.name).trim() : existingRow[1] || '',
      worker.dni !== undefined ? String(worker.dni).trim() : existingRow[2] || '',
      worker.role !== undefined ? String(worker.role).trim() : existingRow[3] || 'Ayudante',
      worker.paymentFrequency !== undefined ? String(worker.paymentFrequency).trim() : existingRow[4] || 'Semanal',
      worker.rateUnit !== undefined ? String(worker.rateUnit).trim() : existingRow[5] || 'Dia',
      worker.baseRate !== undefined ? Number(worker.baseRate) : Number(existingRow[6]) || 0,
      worker.overtimeRate !== undefined ? Number(worker.overtimeRate) : Number(existingRow[7]) || 0,
      worker.phone !== undefined ? String(worker.phone).trim() : existingRow[8] || '',
      worker.active !== undefined ? (worker.active ? 'Activo' : 'Inactivo') : existingRow[9] || 'Activo',
      worker.joinedDate !== undefined ? String(worker.joinedDate).trim() : existingRow[10] || new Date().toISOString().split('T')[0],
    ];

    // 3. Actualizar la fila en Sheets
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: getSafeRange(obrerosTitle, `A${sheetRowNumber}:K${sheetRowNumber}`),
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [updatedRow],
      },
    });

    const updatedWorker = {
      id,
      name: updatedRow[1],
      dni: updatedRow[2],
      role: updatedRow[3],
      paymentFrequency: updatedRow[4],
      rateUnit: updatedRow[5] as 'Dia' | 'Hora',
      baseRate: Number(updatedRow[6]) || 0,
      overtimeRate: Number(updatedRow[7]) || 0,
      phone: updatedRow[8],
      active: String(updatedRow[9]).toLowerCase() !== 'inactivo',
      joinedDate: updatedRow[10],
    };

    return res.json({
      success: true,
      message: `Obrero ${updatedWorker.name} actualizado exitosamente.`,
      worker: updatedWorker,
    });
  } catch (error: any) {
    console.error('Error en PUT /api/payroll/worker/:id:', error);
    return res.status(500).json({
      success: false,
      error: 'Error actualizando obrero: ' + (error?.message || error),
    });
  }
});

/**
 * 6. Eliminar un obrero de la pestaña oficial de obreros
 * Endpoint: DELETE /api/payroll/worker/:id
 */
app.delete('/api/payroll/worker/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const spreadsheetId = (req.query.spreadsheetId as string) || req.body?.spreadsheetId;
    const workerName = (req.body?.name as string) || (req.query.name as string);
    const workerDni = (req.body?.dni as string) || (req.query.dni as string);
    const hintedRowIndex = req.body?.sheetRowIndex || req.body?.rowIndex || req.query.rowIndex;

    if (!spreadsheetId || !id) {
      return res.status(400).json({
        success: false,
        error: 'spreadsheetId y el ID del obrero son obligatorios.',
      });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Obtener metadatos y resolver pestaña de obreros
    let obrerosSheet: any = null;
    let obrerosTitle = 'Informacion obrero';

    try {
      const resolved = await resolvePayrollSheets(sheets, spreadsheetId);
      obrerosSheet = resolved.obrerosSheet;
      obrerosTitle = resolved.obrerosTitle || 'Informacion obrero';
    } catch (resolveErr) {
      console.warn('Aviso en resolvePayrollSheets durante eliminación:', resolveErr);
    }

    // Si no se encontró mediante resolvePayrollSheets, buscar dinámicamente entre las pestañas
    if (!obrerosSheet || obrerosSheet.properties?.sheetId === undefined) {
      try {
        const meta = await sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets.properties(sheetId,title)',
        });
        const allSheets = meta.data.sheets || [];
        obrerosSheet = allSheets.find((s: any) => {
          const t = (s.properties?.title || '').trim().toLowerCase();
          return t.includes('obrero') || t.includes('trabajador') || t.includes('personal') || t.includes('nomina');
        }) || allSheets[0];

        if (obrerosSheet?.properties?.title) {
          obrerosTitle = obrerosSheet.properties.title;
        }
      } catch (metaErr) {
        console.warn('Aviso buscando pestañas alternativas en eliminación:', metaErr);
      }
    }

    if (!obrerosSheet || obrerosSheet.properties?.sheetId === undefined) {
      // Si no existe la pestaña, el obrero ya no puede existir en Google Sheets
      return res.json({
        success: true,
        message: 'No se encontró pestaña de obreros en la hoja de cálculo. Se removió del registro local.',
        deletedId: id,
      });
    }

    const sheetId = obrerosSheet.properties.sheetId;

    // 2. Leer filas para ubicar el índice de fila exacto con múltiples estrategias de búsqueda
    const workersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: getSafeRange(obrerosTitle, 'A1:K300'),
    });

    const rows = workersRes.data.values || [];
    let rowIndex = -1;

    const cleanId = String(id || '').trim().toLowerCase();
    const cleanName = String(workerName || '').trim().toLowerCase();
    const cleanDni = String(workerDni || '').trim().toLowerCase();
    const isFormulaError = cleanId.startsWith('#') || cleanId.includes('ref') || cleanId.includes('error');

    // Estrategia 1: Coincidencia por ID limpio en columna A
    if (cleanId && !isFormulaError) {
      rowIndex = rows.findIndex(
        (row, idx) => idx > 0 && String(row[0] || '').trim().toLowerCase() === cleanId
      );
    }

    // Estrategia 2: Coincidencia por Nombre en columna B o cualquier columna
    if (rowIndex === -1 && cleanName) {
      rowIndex = rows.findIndex(
        (row, idx) => idx > 0 && String(row[1] || '').trim().toLowerCase() === cleanName
      );
      if (rowIndex === -1) {
        rowIndex = rows.findIndex((row, idx) => {
          if (idx === 0) return false;
          return row.some((cell: any) => String(cell || '').trim().toLowerCase() === cleanName);
        });
      }
    }

    // Estrategia 3: Coincidencia por Cédula / DNI en columna C o cualquier columna
    if (rowIndex === -1 && cleanDni) {
      rowIndex = rows.findIndex(
        (row, idx) => idx > 0 && String(row[2] || '').trim().toLowerCase() === cleanDni
      );
      if (rowIndex === -1) {
        rowIndex = rows.findIndex((row, idx) => {
          if (idx === 0) return false;
          return row.some((cell: any) => String(cell || '').trim().toLowerCase() === cleanDni);
        });
      }
    }

    // Estrategia 4: Coincidencia por ID en cualquier otra columna
    if (rowIndex === -1 && cleanId && !isFormulaError) {
      rowIndex = rows.findIndex((row, idx) => {
        if (idx === 0) return false;
        return row.some((cell: any) => String(cell || '').trim().toLowerCase() === cleanId);
      });
    }

    // Estrategia 5: Error de fórmula en columna A (#REF!)
    if (rowIndex === -1 && isFormulaError) {
      rowIndex = rows.findIndex((row, idx) => {
        if (idx === 0) return false;
        const c0 = String(row[0] || '').trim().toLowerCase();
        return c0.includes('ref') || c0.startsWith('#');
      });
    }

    // Estrategia 6: Índice de fila pasado como sugerencia directa desde la app
    if (rowIndex === -1 && hintedRowIndex !== undefined) {
      const num = Number(hintedRowIndex);
      const idxCandidate = num >= rows.length ? num - 1 : num;
      if (idxCandidate > 0 && idxCandidate < rows.length) {
        rowIndex = idxCandidate;
      }
    }

    // Si no se encontró en la hoja de cálculo, consideramos que ya fue retirado
    if (rowIndex === -1) {
      return res.json({
        success: true,
        message: `El obrero ${workerName || id} no se encontraba en la hoja de cálculo (ya estaba retirado). Registro eliminado de la aplicación.`,
        deletedId: id,
      });
    }

    // 3. Eliminar la dimensión de fila (0-indexed: startIndex = rowIndex, endIndex = rowIndex + 1)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    });

    return res.json({
      success: true,
      message: `Obrero ${workerName || id} eliminado correctamente de la hoja de cálculo.`,
      deletedId: id,
    });
  } catch (error: any) {
    console.error('Error en DELETE /api/payroll/worker/:id:', error);
    // Si la eliminación falló por permisos o error de red pero el usuario solicitó eliminar,
    // devolvemos un mensaje descriptivo pero permitimos que el cliente no se quede bloqueado
    return res.status(500).json({
      success: false,
      error: 'Error eliminando obrero de Google Sheets: ' + (error?.message || error),
    });
  }
});

/**
 * 7. Actualizar un registro de jornada o tiempo
 * Endpoint: PUT /api/payroll/time/:id
 */
app.put('/api/payroll/time/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { spreadsheetId, entry } = req.body;

    if (!spreadsheetId || !id || !entry) {
      return res.status(400).json({
        success: false,
        error: 'spreadsheetId y datos del registro de tiempo son obligatorios.',
      });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const { obrerosTitle, tiemposTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    // 1. Obtener todas las filas de la pestaña de nómina activa
    const timesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: getSafeRange(tiemposTitle, 'A1:K1000'),
    });

    const rows = timesRes.data.values || [];
    const cleanId = String(id || '').trim();
    let rowIndex = rows.findIndex((row, idx) => idx > 0 && String(row[0]).trim().toLowerCase() === cleanId.toLowerCase());

    if (rowIndex === -1 && entry.sheetRowIndex !== undefined) {
      const idxCandidate = Number(entry.sheetRowIndex);
      if (idxCandidate > 0 && idxCandidate < rows.length) {
        rowIndex = idxCandidate;
      }
    }

    if (rowIndex === -1 && (cleanId.startsWith('#') || cleanId.toLowerCase().includes('ref'))) {
      rowIndex = rows.findIndex((row, idx) => {
        if (idx === 0) return false;
        const c0 = String(row[0] || '').toLowerCase();
        return c0.includes('ref') || c0.startsWith('#');
      });
    }

    if (rowIndex === -1) {
      return res.status(404).json({
        success: false,
        error: `No se encontró el registro de tiempo con ID "${id}" en "${tiemposTitle}".`,
      });
    }

    const existingRow = rows[rowIndex];
    const sheetRowNumber = rowIndex + 1;

    // Obtener obrero para recalcular tarifas si cambió horas o el obrero
    const workerId = entry.workerId || existingRow[2];
    const workersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: getSafeRange(obrerosTitle, 'A2:K100'),
    });
    const workerRows = workersRes.data.values || [];
    const targetWorkerRow = workerRows.find((r) => r[0] === workerId);

    const workerName = entry.workerName || (targetWorkerRow ? targetWorkerRow[1] : existingRow[3]);
    const rateUnit = targetWorkerRow ? targetWorkerRow[5] : 'Dia';
    const baseRate = targetWorkerRow ? parseFloat(String(targetWorkerRow[6]).replace(/[^0-9.-]+/g, '')) || 0 : 0;
    const overtimeRate = targetWorkerRow ? parseFloat(String(targetWorkerRow[7]).replace(/[^0-9.-]+/g, '')) || 0 : 0;

    const regularHours = entry.regularHours !== undefined ? Number(entry.regularHours) : Number(existingRow[4]) || 0;
    const overtimeHours = entry.overtimeHours !== undefined ? Number(entry.overtimeHours) : Number(existingRow[5]) || 0;
    const daysWorked =
      entry.daysWorked !== undefined
        ? Number(entry.daysWorked)
        : regularHours >= 4
        ? regularHours >= 8
          ? 1
          : 0.5
        : Number(existingRow[6]) || 0;

    const subtotalBase = rateUnit === 'Hora' ? regularHours * baseRate : daysWorked * baseRate;
    const subtotalExtras = overtimeHours * overtimeRate;
    const total = subtotalBase + subtotalExtras;

    // Si el ID original era un error de fórmula (#REF!), generar un ID limpio
    const isFormulaId = !cleanId || cleanId.startsWith('#') || cleanId.toLowerCase().includes('ref');
    const safePersistedId = isFormulaId ? (entry.id && !entry.id.startsWith('#') ? entry.id : `LOG-${Date.now()}`) : cleanId;

    const updatedRow = [
      safePersistedId,
      entry.date || existingRow[1] || new Date().toISOString().split('T')[0],
      workerId,
      workerName,
      regularHours,
      overtimeHours,
      daysWorked,
      entry.activityNotes !== undefined ? entry.activityNotes : existingRow[7] || '',
      subtotalBase,
      subtotalExtras,
      total,
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: getSafeRange(tiemposTitle, `A${sheetRowNumber}:K${sheetRowNumber}`),
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [updatedRow],
      },
    });

    return res.json({
      success: true,
      message: 'Registro de jornada actualizado exitosamente.',
      timeRecord: {
        id: safePersistedId,
        date: updatedRow[1],
        workerId: updatedRow[2],
        workerName: updatedRow[3],
        regularHours: Number(updatedRow[4]),
        overtimeHours: Number(updatedRow[5]),
        daysWorked: Number(updatedRow[6]),
        activityNotes: updatedRow[7],
      },
    });
  } catch (error: any) {
    return handlePayrollError(res, 'Error actualizando registro de tiempo', error);
  }
});

/**
 * 8. Eliminar un registro de jornada o tiempo
 * Endpoint: DELETE /api/payroll/time/:id
 * Con búsqueda multi-estrategia resiliente a errores de fórmula (#REF!, #¡REF!) y fallbacks tolerantes.
 */
app.delete('/api/payroll/time/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const spreadsheetId = (req.query.spreadsheetId as string) || req.body?.spreadsheetId;
    const {
      workerId,
      workerName,
      date,
      sheetRowIndex,
      rowIndex: hintedRowIndex,
    } = req.body || {};

    if (!spreadsheetId || !id) {
      return res.status(400).json({
        success: false,
        error: 'spreadsheetId y el ID del registro son obligatorios.',
      });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const { tiemposSheet, tiemposTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    if (!tiemposSheet || tiemposSheet.properties?.sheetId === undefined) {
      return res.status(404).json({
        success: false,
        error: `No se encontró la pestaña de nómina ("${tiemposTitle}") en la hoja de cálculo.`,
      });
    }

    const sheetId = tiemposSheet.properties.sheetId;

    // 2. Ubicar la fila exacta con rango extendido A1:K1000
    const timesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: getSafeRange(tiemposTitle, 'A1:K1000'),
    });

    const rows = timesRes.data.values || [];
    const cleanId = String(id || '').trim();
    const cleanWorkerName = String(workerName || '').trim().toLowerCase();
    const cleanWorkerId = String(workerId || '').trim().toLowerCase();
    const cleanDate = String(date || '').trim();
    const isFormulaError =
      cleanId.startsWith('#') ||
      cleanId.toLowerCase().includes('ref') ||
      cleanId.toLowerCase().includes('error') ||
      cleanId.toLowerCase().includes('n/a') ||
      cleanId.toLowerCase().includes('valor');

    let rowIndex = -1;

    // Estrategia 1: Coincidencia exacta por ID en columna A (ignorando mayúsculas y espacios)
    rowIndex = rows.findIndex(
      (row, idx) => idx > 0 && String(row[0] || '').trim().toLowerCase() === cleanId.toLowerCase()
    );

    // Estrategia 2: Sugerencia directa de índice de fila desde el cliente (sheetRowIndex o hintedRowIndex)
    if (rowIndex === -1) {
      const candidateIdx =
        sheetRowIndex !== undefined
          ? Number(sheetRowIndex)
          : (hintedRowIndex !== undefined ? Number(hintedRowIndex) : undefined);
      if (candidateIdx !== undefined && candidateIdx > 0 && candidateIdx < rows.length) {
        const candidateRow = rows[candidateIdx];
        if (candidateRow) {
          const c0 = String(candidateRow[0] || '').trim().toLowerCase();
          const cDate = String(candidateRow[1] || '').trim();
          const cWorkerId = String(candidateRow[2] || '').trim().toLowerCase();
          const cWorkerName = String(candidateRow[3] || '').trim().toLowerCase();
          if (
            isFormulaError ||
            c0 === cleanId.toLowerCase() ||
            (cleanDate && cDate === cleanDate) ||
            (cleanWorkerName && cWorkerName === cleanWorkerName) ||
            (cleanWorkerId && cWorkerId === cleanWorkerId)
          ) {
            rowIndex = candidateIdx;
          }
        }
      }
    }

    // Estrategia 3: Si el ID es error de fórmula (#REF!), buscar filas con error en columna A o columnas de obrero
    if (rowIndex === -1 && isFormulaError) {
      // 3a: Fila con error que coincida además con fecha u obrero
      if (cleanDate || cleanWorkerName || cleanWorkerId) {
        rowIndex = rows.findIndex((row, idx) => {
          if (idx === 0) return false;
          const c0 = String(row[0] || '').toLowerCase();
          const cDate = String(row[1] || '').trim();
          const cWorkerId = String(row[2] || '').trim().toLowerCase();
          const cWorkerName = String(row[3] || '').trim().toLowerCase();
          const hasError =
            c0.includes('ref') || c0.startsWith('#') || cWorkerId.includes('ref') || cWorkerName.includes('ref');
          if (!hasError) return false;
          if (cleanDate && cDate === cleanDate) return true;
          if (cleanWorkerName && cWorkerName === cleanWorkerName) return true;
          if (cleanWorkerId && cWorkerId === cleanWorkerId) return true;
          return false;
        });
      }

      // 3b: Cualquier fila en la hoja que tenga #REF! o empiece por #
      if (rowIndex === -1) {
        rowIndex = rows.findIndex((row, idx) => {
          if (idx === 0) return false;
          const c0 = String(row[0] || '').toLowerCase();
          const cWorkerId = String(row[2] || '').toLowerCase();
          const cWorkerName = String(row[3] || '').toLowerCase();
          return c0.includes('ref') || c0.startsWith('#') || cWorkerId.includes('ref') || cWorkerName.includes('ref');
        });
      }
    }

    // Estrategia 4: Coincidencia por Fecha y Obrero (ID o Nombre)
    if (rowIndex === -1 && cleanDate && (cleanWorkerId || cleanWorkerName)) {
      rowIndex = rows.findIndex((row, idx) => {
        if (idx === 0) return false;
        const cDate = String(row[1] || '').trim();
        const cWorkerId = String(row[2] || '').trim().toLowerCase();
        const cWorkerName = String(row[3] || '').trim().toLowerCase();
        const dateMatches = cDate === cleanDate;
        const workerMatches =
          (cleanWorkerId && cWorkerId === cleanWorkerId) ||
          (cleanWorkerName && cWorkerName === cleanWorkerName);
        return dateMatches && workerMatches;
      });
    }

    // Estrategia 5: Coincidencia en cualquier celda de la fila con el ID
    if (rowIndex === -1 && cleanId && !isFormulaError) {
      rowIndex = rows.findIndex((row, idx) => {
        if (idx === 0) return false;
        return row.some((cell: any) => String(cell || '').trim().toLowerCase() === cleanId.toLowerCase());
      });
    }

    // Si ya no se encuentra en la hoja, significa que ya no está presente (por ejemplo, ya fue eliminada o corregida)
    if (rowIndex === -1) {
      return res.json({
        success: true,
        message: `El registro de jornada "${id}" ya no se encontraba en la hoja de cálculo (ya estaba retirado o resuelto). Registro depurado con éxito.`,
        deletedId: id,
      });
    }

    // 3. Eliminar la dimensión de fila en Google Sheets
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    });

    return res.json({
      success: true,
      message: `Registro de jornada ${id} eliminado correctamente de la hoja de cálculo.`,
      deletedId: id,
    });
  } catch (error: any) {
    return handlePayrollError(res, 'Error eliminando registro de tiempo', error);
  }
});

/**
 * 9. Exportar Reporte Ejecutivo de Nómina a Google Sheets con Branding SVH Arquitectos,
 * Formato Financiero, Fórmulas Automáticas (=SUM), Logo e Inserción Dimensional.
 * Endpoint: POST /api/payroll/export-report
 */
app.post('/api/payroll/export-report', async (req, res) => {
  try {
    const { spreadsheetId, projectName = 'Obra Activa', reportTitle = 'Liquidación de Nómina de Obra', logoUrl } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ success: false, error: 'spreadsheetId es obligatorio.' });
    }

    const auth = getGoogleAuthClient(req);
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Obtener datos de Obreros y Tiempos de las pestañas actuales
    const { obrerosTitle, tiemposTitle } = await resolvePayrollSheets(sheets, spreadsheetId);

    const [workersGet, timesGet, meta] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: getSafeRange(obrerosTitle, 'A2:K100') }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: getSafeRange(tiemposTitle, 'A2:K500') }),
      sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' }),
    ]);

    const workerRows = workersGet.data.values || [];
    const timeRows = timesGet.data.values || [];

    // Si no hay obreros registrados
    if (workerRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay obreros registrados en la hoja de cálculo para generar el reporte.',
      });
    }

    // 2. Calcular los acumulados de cada obrero
    const reportData = workerRows
      .filter((w) => String(w[9]).toLowerCase() !== 'inactivo')
      .map((w) => {
        const workerId = w[0];
        const name = w[1];
        const dni = w[2] || '';
        const role = w[3] || 'Ayudante';
        const paymentFrequency = w[4] || 'Semanal';
        const rateUnit = w[5] === 'Hora' ? 'Hora' : 'Dia';
        const baseRate = parseFloat(String(w[6]).replace(/[^0-9.-]+/g, '')) || 0;
        const overtimeRate = parseFloat(String(w[7]).replace(/[^0-9.-]+/g, '')) || 0;

        // Filtrar jornadas del obrero
        const records = timeRows.filter((t) => String(t[2]).trim() === String(workerId).trim());
        let totalRegularHours = 0;
        let totalOvertimeHours = 0;
        let totalDaysWorked = 0;

        records.forEach((r) => {
          totalRegularHours += parseFloat(r[4]) || 0;
          totalOvertimeHours += parseFloat(r[5]) || 0;
          totalDaysWorked += parseFloat(r[6]) || 0;
        });

        // Cálculos devengados
        const basePay = rateUnit === 'Hora' ? totalRegularHours * baseRate : totalDaysWorked * baseRate;
        const overtimePay = totalOvertimeHours * overtimeRate;
        const totalPay = basePay + overtimePay;

        return {
          id: workerId,
          name,
          dni,
          role,
          paymentFrequency,
          rateUnit,
          baseRate,
          overtimeRate,
          totalWorked: rateUnit === 'Hora' ? totalRegularHours : totalDaysWorked,
          totalOvertimeHours,
          basePay,
          overtimePay,
          totalPay,
        };
      });

    // 3. Crear pestaña para el reporte ejecutivo (ej: "Reporte_Nomina_SVH" o con fecha)
    const now = new Date();
    const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    let newTabTitle = `Reporte_Nomina_${dateStamp}`;
    
    // Evitar colisión de nombres
    const existingTitles = (meta.data.sheets || []).map((s) => s.properties?.title || '');
    let counter = 1;
    while (existingTitles.includes(newTabTitle)) {
      newTabTitle = `Reporte_Nomina_${dateStamp}_${counter++}`;
    }

    const addSheetRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: newTabTitle,
                gridProperties: {
                  rowCount: Math.max(100, reportData.length + 30),
                  columnCount: 12,
                },
              },
            },
          },
        ],
      },
    });

    const newSheetId = addSheetRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newSheetId === undefined) {
      throw new Error('No se pudo obtener el identificador de la nueva pestaña de reporte.');
    }

    // 4. Preparar el contenido textual de la hoja (Filas 1 a N) - Sin imagen de logo
    const rowTitle = ['SVH ARQUITECTOS & ASOCIADOS - GESTIÓN Y CONTROL DE OBRA'];
    const rowSubtitle = [`Proyecto: ${projectName}   |   Reporte: ${reportTitle}   |   Fecha de Generación: ${now.toLocaleDateString('es-CO')} ${now.toLocaleTimeString('es-CO')}`];
    const rowEmpty = [''];

    const reportHeaders = [
      'ID Obrero',
      'Nombre y Apellidos',
      'Documento / DNI',
      'Especialidad / Cargo',
      'Periodo Pago',
      'Tarifa Base ($)',
      'Unidad',
      'Tiempo Trab.',
      'Horas Extras',
      'Subtotal Base ($)',
      'Subtotal Extras ($)',
      'Total a Pagar ($)',
    ];

    const dataRows = reportData.map((d) => [
      d.id,
      d.name,
      d.dni,
      d.role,
      d.paymentFrequency,
      d.baseRate,
      d.rateUnit === 'Dia' ? 'Días' : 'Horas',
      d.totalWorked,
      d.totalOvertimeHours,
      d.basePay,
      d.overtimePay,
      d.totalPay,
    ]);

    const headerRowIndex = 4; // Fila 4 (1-indexed es 4, 0-indexed es 3)
    const firstDataRow = 5;  // Fila 5 (1-indexed)
    const lastDataRow = firstDataRow + reportData.length - 1; // Fila final de obreros (1-indexed)
    const totalRowIndex = lastDataRow + 2; // Fila de totales (1-indexed)

    const fullValues = [
      rowTitle,     // Fila 1 (Índice 0)
      rowSubtitle,  // Fila 2 (Índice 1)
      rowEmpty,     // Fila 3 (Índice 2)
      reportHeaders,// Fila 4 (Índice 3)
      ...dataRows,  // Filas 5 a N
      rowEmpty,
      ['', '', '', '', '', '', '', '', 'TOTAL NÓMINA', `=SUM(J${firstDataRow}:J${lastDataRow})`, `=SUM(K${firstDataRow}:K${lastDataRow})`, `=SUM(L${firstDataRow}:L${lastDataRow})`],
    ];

    // 5. Inyectar todos los valores a la nueva pestaña
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${newTabTitle}'!A1:L${fullValues.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: fullValues,
      },
    });

    const primaryColor = { red: 28 / 255, green: 163 / 255, blue: 48 / 255 }; // #1ca330
    const primaryDark = { red: 20 / 255, green: 110 / 255, blue: 34 / 255 };
    const secondaryLight = { red: 248 / 255, green: 250 / 255, blue: 252 / 255 }; // #f8fafc
    const whiteColor = { red: 1, green: 1, blue: 1 };
    const slateDark = { red: 15 / 255, green: 23 / 255, blue: 42 / 255 }; // #0f172a
    const totalBgColor = { red: 232 / 255, green: 245 / 255, blue: 233 / 255 }; // #e8f5e9

    const batchRequests: any[] = [
      // A. Estilo para el Título Principal (Fila 1: Índice 0)
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.96, green: 0.98, blue: 0.96 },
              textFormat: {
                bold: true,
                fontSize: 13,
                foregroundColor: primaryDark,
              },
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
        },
      },
      // Combinar Fila 1 A1:L1
      {
        mergeCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          mergeType: 'MERGE_ALL',
        },
      },
      // B. Estilo para el Subtítulo (Fila 2: Índice 1)
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 1,
            endRowIndex: 2,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                italic: true,
                fontSize: 10,
                foregroundColor: { red: 0.35, green: 0.4, blue: 0.45 },
              },
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(textFormat,verticalAlignment)',
        },
      },
      {
        mergeCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 1,
            endRowIndex: 2,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          mergeType: 'MERGE_ALL',
        },
      },
      // C. Estilo de ENCABEZADOS (Fila 4: Índice 3): Fondo Verde #1ca330, Texto Blanco en Negrita
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 3,
            endRowIndex: 4,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: primaryColor,
              textFormat: {
                bold: true,
                fontSize: 10,
                foregroundColor: whiteColor,
                fontFamily: 'Arial',
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
        },
      },
      // Altura a los encabezados
      {
        updateDimensionProperties: {
          range: {
            sheetId: newSheetId,
            dimension: 'ROWS',
            startIndex: 3,
            endIndex: 4,
          },
          properties: {
            pixelSize: 38,
          },
          fields: 'pixelSize',
        },
      },
      // D. Banding (Colores Alternados) para las filas de los obreros
      {
        addBanding: {
          bandedRange: {
            range: {
              sheetId: newSheetId,
              startRowIndex: 3,
              endRowIndex: 3 + 1 + reportData.length, // Desde el encabezado hasta el último obrero
              startColumnIndex: 0,
              endColumnIndex: 12,
            },
            rowProperties: {
              headerColor: primaryColor,
              firstBandColor: whiteColor,
              secondBandColor: secondaryLight,
            },
          },
        },
      },
      // E. Formato de Moneda ($#,##0) para las columnas monetarias (F: Tarifa Base, J: Subtotal Base, K: Extras, L: Total a Pagar)
      // Columnas F (índice 5), J (índice 9), K (índice 10), L (índice 11)
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 4,
            endRowIndex: 4 + reportData.length,
            startColumnIndex: 5,
            endColumnIndex: 6, // Tarifa Base
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'CURRENCY',
                pattern: '$#,##0',
              },
              horizontalAlignment: 'RIGHT',
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
        },
      },
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 4,
            endRowIndex: 4 + reportData.length,
            startColumnIndex: 9,
            endColumnIndex: 12, // Subtotales y Total Devengado
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'CURRENCY',
                pattern: '$#,##0',
              },
              horizontalAlignment: 'RIGHT',
              textFormat: {
                bold: true,
              },
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)',
        },
      },
      // G. Alineaciones de columnas de datos (ID centrado, horas centradas)
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 5,
            endRowIndex: 5 + reportData.length,
            startColumnIndex: 0,
            endColumnIndex: 1, // ID
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              textFormat: { fontFamily: 'Consolas', fontSize: 9 },
            },
          },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat)',
        },
      },
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 5,
            endRowIndex: 5 + reportData.length,
            startColumnIndex: 7,
            endColumnIndex: 9, // Tiempos trabajados y extras
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(horizontalAlignment)',
        },
      },
      // H. Fila "TOTAL NÓMINA" (Fila especial con fondo verde suave, bordes y negrita sobresaliente)
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: totalRowIndex - 1,
            endRowIndex: totalRowIndex,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: totalBgColor,
              textFormat: {
                bold: true,
                fontSize: 11,
                foregroundColor: primaryDark,
              },
              verticalAlignment: 'MIDDLE',
              borders: {
                top: { style: 'SOLID', color: primaryColor },
                bottom: { style: 'SOLID_DOUBLE', color: primaryDark },
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,borders)',
        },
      },
      // Formato de Moneda para las celdas de suma J, K, L en la fila de Total
      {
        repeatCell: {
          range: {
            sheetId: newSheetId,
            startRowIndex: totalRowIndex - 1,
            endRowIndex: totalRowIndex,
            startColumnIndex: 9,
            endColumnIndex: 12,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'CURRENCY',
                pattern: '$#,##0',
              },
              horizontalAlignment: 'RIGHT',
              textFormat: {
                bold: true,
                fontSize: 12,
                foregroundColor: primaryDark,
              },
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)',
        },
      },
      // I. Ajuste automático / ancho fijo visualmente armónico de columnas
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: newSheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 12,
          },
        },
      },
    ];

    // Ejecutar todo el batchUpdate de estilo de una sola vez
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: batchRequests,
      },
    });

    return res.json({
      success: true,
      message: `Reporte de nómina generado con éxito en la pestaña "${newTabTitle}".`,
      sheetTitle: newTabTitle,
      sheetId: newSheetId,
      workersCount: reportData.length,
      batchRequestsCount: batchRequests.length,
    });
  } catch (error: any) {
    console.error('Error en /api/payroll/export-report:', error);
    return res.status(500).json({
      success: false,
      error: 'Error generando reporte financiero en Sheets: ' + (error?.message || error),
    });
  }
});

/**
 * 10. Exportar la Hoja de Cálculo completa en formato nativo Excel (.xlsx)
 * utilizando el convertidor oficial de Google Drive API (drive.files.export),
 * respetando el 100% de la estructura, pestañas, diseño corporativo (#337337),
 * colores alternos (#94C23D), celdas combinadas, formato moneda ($) y fórmulas.
 * Endpoint: POST /api/payroll/export-excel
 */
app.post('/api/payroll/export-excel', async (req, res) => {
  try {
    const { spreadsheetId, projectName = 'Obra' } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ success: false, error: 'spreadsheetId es obligatorio.' });
    }

    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : (req.body.accessToken || '').trim();

    const auth = getGoogleAuthClient(req);
    const drive = google.drive({ version: 'v3', auth });

    // 1. Obtener metadatos reales del archivo en Google Drive (nombre y tipo MIME)
    let authErrorDetected: any = null;
    const fileMeta = await drive.files
      .get({
        fileId: spreadsheetId,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      })
      .catch((err) => {
        const rawStatus = err?.status ?? err?.code ?? err?.response?.status;
        const numStatus = Number(rawStatus);
        const msg = String(err?.message || '').toLowerCase();
        if (
          numStatus === 401 ||
          rawStatus === '401' ||
          msg.includes('401') ||
          msg.includes('invalid authentication credentials') ||
          msg.includes('expected oauth 2') ||
          msg.includes('unauthenticated')
        ) {
          authErrorDetected = err;
        } else {
          console.warn('Aviso obteniendo metadatos para exportar Excel:', err?.message);
        }
        return null;
      });

    if (authErrorDetected) {
      return handlePayrollError(res, 'export-excel', authErrorDetected);
    }

    const cleanProjectFallback = projectName.replace(/^(Obra:\s*|Proyecto:\s*)/i, '').replace(/[:\/\\?*|"]/g, ' ').trim() || projectName;
    const realFileName = fileMeta?.data?.name || cleanProjectFallback;
    const cleanFileName = realFileName.toLowerCase().endsWith('.xlsx')
      ? realFileName
      : `${realFileName.replace(/[:\/\\?*|"]/g, '_')}.xlsx`;
    const mimeType = fileMeta?.data?.mimeType;

    let buffer: Buffer | null = null;

    // 2. Si es una hoja nativa de Google Sheets:
    // Google Drive API exporta directamente la hoja a .xlsx manteniendo 100% la fidelidad de diseño,
    // todas las pestañas ('Informacion obrero', 'Nomina mes actual', 'Control Facturas', etc.),
    // logo corporativo en A1:E3, paleta de colores SVH, anchos de columna y fórmulas.
    if (!mimeType || mimeType === 'application/vnd.google-apps.spreadsheet') {
      try {
        const exportRes: any = await drive.files.export(
          {
            fileId: spreadsheetId,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          } as any,
          { responseType: 'arraybuffer' }
        );
        if (exportRes && exportRes.data) {
          if (Buffer.isBuffer(exportRes.data)) {
            buffer = exportRes.data;
          } else if (exportRes.data instanceof ArrayBuffer) {
            buffer = Buffer.from(exportRes.data);
          } else if (exportRes.data.buffer instanceof ArrayBuffer) {
            buffer = Buffer.from(exportRes.data.buffer);
          } else {
            buffer = Buffer.from(exportRes.data);
          }
        }
      } catch (exportErr: any) {
        const rawStatus = exportErr?.status ?? exportErr?.code ?? exportErr?.response?.status;
        const numStatus = Number(rawStatus);
        const msg = String(exportErr?.message || '').toLowerCase();
        if (
          numStatus === 401 ||
          rawStatus === '401' ||
          msg.includes('401') ||
          msg.includes('invalid authentication credentials') ||
          msg.includes('expected oauth 2') ||
          msg.includes('unauthenticated')
        ) {
          return handlePayrollError(res, 'export-excel', exportErr);
        }
        console.warn('[export-excel] Aviso en drive.files.export directo:', exportErr?.message);
      }

      // Si drive.files.export del SDK no devolvió buffer, intentar descarga directa HTTPS con token
      if (!buffer && token) {
        try {
          const directUrl = `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&supportsAllDrives=true`;
          const directRes = await fetch(directUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (directRes.ok) {
            const arrBuf = await directRes.arrayBuffer();
            buffer = Buffer.from(arrBuf);
          } else if (directRes.status === 401) {
            return handlePayrollError(res, 'export-excel', { status: 401, message: 'OAuth token expired' });
          } else {
            console.warn('[export-excel] Fallback directo HTTPS devolvió status:', directRes.status);
          }
        } catch (fetchErr: any) {
          console.warn('[export-excel] Error en fetch HTTPS directo:', fetchErr?.message);
        }
      }
    } else {
      // Si el archivo en Drive ya era un archivo binario de Excel (.xlsx), descargarlo directamente
      try {
        const getMediaRes = await drive.files.get(
          {
            fileId: spreadsheetId,
            alt: 'media',
            supportsAllDrives: true,
          },
          { responseType: 'arraybuffer' }
        );
        if (getMediaRes.data) {
          if (Buffer.isBuffer(getMediaRes.data)) {
            buffer = getMediaRes.data;
          } else if (getMediaRes.data instanceof ArrayBuffer) {
            buffer = Buffer.from(getMediaRes.data);
          } else {
            buffer = Buffer.from(getMediaRes.data as any);
          }
        }
      } catch (mediaErr: any) {
        const rawStatus = mediaErr?.status ?? mediaErr?.code ?? mediaErr?.response?.status;
        const numStatus = Number(rawStatus);
        const msg = String(mediaErr?.message || '').toLowerCase();
        if (
          numStatus === 401 ||
          rawStatus === '401' ||
          msg.includes('401') ||
          msg.includes('invalid authentication credentials') ||
          msg.includes('expected oauth 2') ||
          msg.includes('unauthenticated')
        ) {
          return handlePayrollError(res, 'export-excel', mediaErr);
        }
        console.warn('[export-excel] Aviso en drive.files.get media:', mediaErr?.message);
      }

      if (!buffer && token) {
        try {
          const directMediaUrl = `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?alt=media&supportsAllDrives=true`;
          const directRes = await fetch(directMediaUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (directRes.ok) {
            const arrBuf = await directRes.arrayBuffer();
            buffer = Buffer.from(arrBuf);
          } else if (directRes.status === 401) {
            return handlePayrollError(res, 'export-excel', { status: 401, message: 'OAuth token expired' });
          }
        } catch (fetchMediaErr: any) {
          console.warn('[export-excel] Error en fetch media HTTPS directo:', fetchMediaErr?.message);
        }
      }
    }

    // 3. Fallback de contingencia: si no se pudo convertir directamente por Drive,
    // consultar todas las pestañas de la hoja y compilar el workbook con XLSX con formato limpio
    if (!buffer) {
      try {
        const sheets = google.sheets({ version: 'v4', auth });
        const sheetMeta = await sheets.spreadsheets.get({
          spreadsheetId,
          includeGridData: false,
        });

        const sheetsList = sheetMeta.data.sheets || [];
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();

        for (const s of sheetsList) {
          const title = s.properties?.title || 'Hoja';
          const valuesRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${title.replace(/'/g, "''")}'!A1:ZZ1000`,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING',
          }).catch(() => null);

          const rows = valuesRes?.data?.values || [];
          if (rows.length > 0) {
            // Limpiar fórmulas específicas de Google Sheets que rompen Excel como =IMAGE(...)
            const cleanRows = rows.map((r: any[]) =>
              (r || []).map((cell: any) => {
                if (typeof cell === 'string' && cell.startsWith('=IMAGE')) {
                  return 'SVH ARQUITECTOS';
                }
                return cell;
              })
            );

            const ws = XLSX.utils.aoa_to_sheet(cleanRows);

            // Calcular anchos de columna automáticos para que ningún texto quede cortado ni muestre ###
            const maxCols = Math.max(...cleanRows.map((r: any[]) => r.length), 0);
            const colWidths: { wch: number }[] = [];
            for (let c = 0; c < maxCols; c++) {
              let maxLen = 10;
              for (const row of cleanRows) {
                const val = row[c];
                if (val !== undefined && val !== null) {
                  const sLen = typeof val === 'number' ? val.toLocaleString('es-CO').length + 3 : String(val).length;
                  if (sLen > maxLen) maxLen = Math.min(sLen, 50);
                }
              }
              colWidths.push({ wch: maxLen + 3 });
            }
            ws['!cols'] = colWidths;

            XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
          }
        }

        if (wb.SheetNames.length === 0) {
          const ws = XLSX.utils.aoa_to_sheet([['Hoja de Cálculo SVH'], ['Sin datos registrados']]);
          ws['!cols'] = [{ wch: 25 }, { wch: 25 }];
          XLSX.utils.book_append_sheet(wb, ws, 'Datos');
        }

        buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      } catch (fallbackErr: any) {
        return handlePayrollError(res, 'export-excel', fallbackErr);
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}"`);
    return res.send(buffer);
  } catch (error: any) {
    return handlePayrollError(res, 'export-excel', error);
  }
});

// Universal file analyzer endpoint (Excel, CSV, PDF, Word, Images, Text, etc.)
app.post('/api/analyze-any-file', async (req, res) => {
  try {
    const { fileBase64, fileName = 'archivo', mimeType = '', fileText = '' } = req.body;

    if (!fileBase64 && !fileText) {
      return res.status(400).json({ success: false, error: 'Falta el contenido del archivo (base64 o texto).' });
    }

    const cleanBase64 = fileBase64 ? fileBase64.replace(/^data:[^;]+;base64,/, '') : '';
    const lowerName = fileName.toLowerCase();
    const isSpreadsheet =
      mimeType.includes('spreadsheet') ||
      mimeType.includes('excel') ||
      mimeType.includes('csv') ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.ods');

    // 1. If it is an Excel / CSV spreadsheet, parse directly using XLSX for 100% data fidelity
    if (isSpreadsheet && (cleanBase64 || fileText)) {
      try {
        const workbook = cleanBase64
          ? XLSX.read(Buffer.from(cleanBase64, 'base64'), { type: 'buffer', cellDates: true, cellFormula: true })
          : XLSX.read(fileText!, { type: 'string', cellDates: true });
        
        const sheetsData: { name: string; headers: string[]; rows: any[][]; totalRows: number }[] = [];
        let totalItemsFound = 0;

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rawGrid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (rawGrid.length > 0) {
            // Header detection: first non-empty row
            let headerRowIndex = 0;
            for (let r = 0; r < Math.min(rawGrid.length, 5); r++) {
              if (rawGrid[r].some((c) => c !== undefined && String(c).trim() !== '')) {
                headerRowIndex = r;
                break;
              }
            }
            const headers = (rawGrid[headerRowIndex] || []).map((h, i) => String(h || '').trim() || `Columna ${i + 1}`);
            const dataRows = rawGrid.slice(headerRowIndex + 1).filter((r) => r.some((c) => c !== undefined && String(c).trim() !== ''));
            totalItemsFound += dataRows.length;

            sheetsData.push({
              name: sheetName,
              headers,
              rows: dataRows.slice(0, 100), // Preview up to 100 rows
              totalRows: dataRows.length,
            });
          }
        }

        const primarySheet = sheetsData[0];
        const keyDetails = [
          { label: 'Formato', value: lowerName.endsWith('.csv') ? 'CSV (Valores separados por coma)' : 'Microsoft Excel (.xlsx/.xls)' },
          { label: 'Pestañas detectadas', value: sheetsData.map((s) => s.name).join(', ') || 'Hoja1' },
          { label: 'Total de filas de datos', value: `${totalItemsFound} registros` },
          { label: 'Encabezados principales', value: primarySheet?.headers.slice(0, 6).join(', ') || 'N/A' },
        ];

        return res.json({
          success: true,
          data: {
            documentType: 'Hoja de Cálculo (Excel / CSV)',
            title: fileName.replace(/\.[^/.]+$/, ''),
            summary: `Hoja de cálculo con ${sheetsData.length} pestaña(s) detectada(s) ("${sheetsData.map((s) => s.name).join('", "')}"). Contiene ${totalItemsFound} fila(s) de datos estructurados listos para consulta o integración contable.`,
            keyDetails,
            sheets: sheetsData,
            tables: sheetsData.map((s) => ({
              title: s.name,
              headers: s.headers,
              rows: s.rows.slice(0, 20),
            })),
            isInvoiceCompatible: sheetsData.some((s) =>
              s.headers.some((h) => /factura|invoice|total|proveedor|emisor|precio|importe/i.test(h))
            ),
          },
        });
      } catch (xlsxErr) {
        console.warn('Fallo en lectura directa XLSX, recurriendo a análisis IA:', xlsxErr);
      }
    }

    // 2. For PDF, DOCX, Images, Text or fallback: Use Gemini multimodal extraction
    const ai = getGenAI();
    if (!ai) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY no está configurada en las variables de entorno del servidor.',
      });
    }

    const prompt = `Analiza con máxima rigurosidad y síntesis este archivo/documento ("${fileName}").
Extrae la información útil y estructurada de forma fidedigna:
1. documentType: Tipo exacto de documento (ej: "Factura", "Presupuesto / Cotización", "Albarán / Remisión", "Contrato de Obra", "Informe Técnico", "Ficha Técnica", "Documento Administrativo", etc.).
2. title: Título o asunto representativo.
3. issuer: Emisor, empresa o autor (si aplica).
4. recipient: Receptor, cliente o destinatario (si aplica).
5. date: Fecha principal del documento (YYYY-MM-DD si es reconocible).
6. currency: Moneda utilizada si contiene importes (EUR, USD, MXN, etc.).
7. totalAmount: Importe total numérico principal si existe, redondeado a 2 decimales (o 0 si no aplica).
8. summary: Resumen ejecutivo conciso y claro de máximo 3 frases en español.
9. keyDetails: Array con hasta 8 pares clave-valor más importantes (ej: [{ label: "Nº Documento", value: "..." }, { label: "Plazo", value: "..." }]).
10. tables: Tablas detectadas en el documento (máximo 3 tablas principales, cada una con title, headers, y hasta 15 rows).
11. items: Partidas o conceptos detallados si se trata de una factura o cotización (description, quantity, unitPrice, total).
12. isInvoiceCompatible: Booleano true si es una factura, ticket, comprobante o recibo que pueda registrarse contablemente.
13. suggestedCategory: Si aplica a costes de obra: Materiales, Mano de Obra, Maquinaria y Equipos, Transporte y Logística, Subcontratas, Seguridad y Salud, Servicios y Licencias o Varios.

Devuelve estrictamente un JSON válido con la estructura solicitada y asegúrate de cerrar siempre el JSON.`;

    const schemaConfig = {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: { type: Type.STRING },
          title: { type: Type.STRING },
          issuer: { type: Type.STRING },
          recipient: { type: Type.STRING },
          date: { type: Type.STRING },
          currency: { type: Type.STRING },
          totalAmount: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          keyDetails: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                value: { type: Type.STRING },
              },
              required: ['label', 'value'],
            },
          },
          tables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                headers: { type: Type.ARRAY, items: { type: Type.STRING } },
                rows: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
              },
            },
          },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                unitPrice: { type: Type.NUMBER },
                total: { type: Type.NUMBER },
              },
            },
          },
          isInvoiceCompatible: { type: Type.BOOLEAN },
          suggestedCategory: { type: Type.STRING },
        },
        required: ['documentType', 'title', 'summary', 'keyDetails'],
      },
    };

    // Determine payload format
    let contentParts: any[] = [];
    let actualMime = mimeType || 'application/octet-stream';
    if (lowerName.endsWith('.pdf')) actualMime = 'application/pdf';
    else if (lowerName.endsWith('.png')) actualMime = 'image/png';
    else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) actualMime = 'image/jpeg';
    else if (lowerName.endsWith('.webp')) actualMime = 'image/webp';
    else if (lowerName.endsWith('.txt')) actualMime = 'text/plain';

    if (cleanBase64) {
      contentParts.push({
        inlineData: {
          mimeType: actualMime,
          data: cleanBase64,
        },
      });
    } else if (fileText) {
      contentParts.push({
        text: `Contenido del archivo (${fileName}):\n\n${fileText.slice(0, 40000)}`,
      });
    }

    contentParts.push(prompt);

    const geminiResult = await callGeminiWithRetry(
      ai,
      contentParts,
      schemaConfig,
      `Análisis universal (${fileName})`
    );

    if (geminiResult.success && geminiResult.text) {
      try {
        let cleanJsonText = geminiResult.text.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
        let parsedData: any = null;

        try {
          parsedData = JSON.parse(cleanJsonText);
        } catch {
          // If the JSON was truncated (e.g. token limits reached or unterminated string),
          // safely attempt to repair unclosed braces/brackets/quotes
          try {
            let repaired = cleanJsonText;
            // Close unclosed string if odd number of unescaped quotes
            const quotesCount = (repaired.match(/(?<!\\)"/g) || []).length;
            if (quotesCount % 2 !== 0) {
              repaired += '"';
            }
            // Count unclosed braces and brackets
            let openBraces = 0;
            let openBrackets = 0;
            let inString = false;
            for (let i = 0; i < repaired.length; i++) {
              const c = repaired[i];
              if (c === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
                inString = !inString;
              } else if (!inString) {
                if (c === '{') openBraces++;
                else if (c === '}') openBraces = Math.max(0, openBraces - 1);
                else if (c === '[') openBrackets++;
                else if (c === ']') openBrackets = Math.max(0, openBrackets - 1);
              }
            }
            while (openBrackets > 0) {
              repaired += ']';
              openBrackets--;
            }
            while (openBraces > 0) {
              repaired += '}';
              openBraces--;
            }
            parsedData = JSON.parse(repaired);
          } catch {
            // repair failed, will proceed to structured fallback
          }
        }

        if (parsedData && (parsedData.documentType || parsedData.title || parsedData.summary)) {
          return res.json({ success: true, data: parsedData, modelUsed: geminiResult.modelUsed });
        }
      } catch (parseErr) {
        console.warn('Fallo al interpretar JSON de Gemini, aplicando fallback estructurado:', parseErr);
      }
    }

    // 3. Fallback extraction: if Gemini is temporarily overwhelmed (503 / 429), preserve file data and provide structural analysis
    console.log(`[Universal File] Creando análisis de respaldo local para "${fileName}" debido a saturación temporal de IA...`);
    
    // Determine title & type
    const cleanTitle = fileName.replace(/\.[^/.]+$/, '');
    let docType = 'Documento';
    let suggestedCat = 'Varios';
    let isInvoice = false;

    if (lowerName.includes('factura') || lowerName.includes('inv') || lowerName.includes('ticket') || lowerName.includes('recibo')) {
      docType = 'Factura / Comprobante';
      isInvoice = true;
      suggestedCat = 'Materiales';
    } else if (lowerName.includes('presupuesto') || lowerName.includes('cotiz') || lowerName.includes('oferta')) {
      docType = 'Presupuesto / Cotización';
      suggestedCat = 'Subcontratas';
    } else if (lowerName.includes('albaran') || lowerName.includes('remision') || lowerName.includes('entrega')) {
      docType = 'Albarán / Nota de Entrega';
      suggestedCat = 'Transporte y Logística';
    } else if (lowerName.includes('contrato') || lowerName.includes('acuerdo')) {
      docType = 'Contrato de Obra';
      suggestedCat = 'Servicios y Licencias';
    } else if (lowerName.endsWith('.pdf')) {
      docType = 'Documento PDF';
    } else if (lowerName.match(/\.(png|jpe?g|webp)$/)) {
      docType = 'Imagen / Foto de Comprobante';
      isInvoice = true;
    } else if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
      docType = 'Documento Microsoft Word';
    } else if (lowerName.endsWith('.txt')) {
      docType = 'Documento de Texto Plano';
    }

    // Inspect text if available for dates, totals, key details
    let detectedTotal = 0;
    let detectedCurrency = 'EUR';
    let detectedDate = '';
    const keyDetails: { label: string; value: string }[] = [
      { label: 'Nombre de archivo', value: fileName },
      { label: 'Tipo detectado', value: docType },
      { label: 'Estado del motor IA', value: 'Alta demanda en Google Gemini (503)' },
    ];

    if (fileText) {
      // Regex for date
      const dateMatch = fileText.match(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\b/);
      if (dateMatch) {
        detectedDate = dateMatch[1];
        keyDetails.push({ label: 'Fecha identificada', value: detectedDate });
      }

      // Regex for currency amounts
      const amounts = [...fileText.matchAll(/(?:[\$€]|EUR|USD|MXN)\s*([\d.,]+)|([\d.,]+)\s*(?:[\$€]|EUR|USD|MXN)/gi)];
      if (amounts.length > 0) {
        const lastAmountMatch = amounts[amounts.length - 1];
        const rawNumStr = (lastAmountMatch[1] || lastAmountMatch[2] || '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
        const parsedNum = parseFloat(rawNumStr);
        if (!isNaN(parsedNum) && parsedNum > 0) {
          detectedTotal = Math.round(parsedNum * 100) / 100;
          keyDetails.push({ label: 'Total detectado', value: `${detectedTotal} ${detectedCurrency}` });
        }
      }
    }

    return res.json({
      success: true,
      data: {
        documentType: docType,
        title: cleanTitle,
        summary: `El documento "${fileName}" ha sido analizado en modo estructural. Los servidores de IA de Google experimentan una saturación temporal de demanda (código 503). La estructura y metadatos se han preservado con total fidelidad. Puedes pulsar "Reintentar análisis con IA" cuando disminuya el tráfico de la red.`,
        keyDetails,
        totalAmount: detectedTotal,
        currency: detectedCurrency,
        date: detectedDate,
        isInvoiceCompatible: isInvoice,
        suggestedCategory: suggestedCat,
        isAiTemporarilyUnavailable: true,
      },
      isFallback: true,
    });
  } catch (error: any) {
    console.error('Error analyzing generic file:', error);
    const errMsg = error?.message || '';
    const isQuota = isTransientCapacityError(error) || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED');

    return res.status(422).json({
      success: false,
      error: isQuota
        ? 'Los servidores de IA de Google están experimentando alta demanda momentánea (503). Por favor, pulsa en "Reintentar análisis con IA".'
        : 'Error al procesar el archivo: ' + (errMsg || 'Error desconocido'),
    });
  }
});

async function startServer() {
  // Vite middleware in dev / static in prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor ejecutándose en http://0.0.0.0:${PORT}`);
  });
}

startServer();
