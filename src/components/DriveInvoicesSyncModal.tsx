import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FolderSearch,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Check,
  X,
  Sparkles,
  Receipt,
  AlertTriangle,
  Eye,
  FileText,
  Filter,
  CheckSquare,
  Square,
  ArrowRight,
  Info,
  Pause,
  Play,
  RotateCcw,
  Clock,
  Zap,
  FileEdit,
} from 'lucide-react';
import { ProjectFolder, SheetInvoiceRecord, InvoiceData } from '../types';
import {
  fetchFolderDirectContents,
  appendInvoiceToSheet,
  renameDriveFile,
  DriveHierarchicalItem,
} from '../services/googleDriveSheets';
import { safeJsonFetch } from '../utils/safeApiFetch';
import { checkInvoiceDuplicate } from '../utils/duplicateChecker';

// ============================================================================
// 1. CONFIGURACIÓN DE CONCURRENCIA, LOTES Y REINTENTOS (PERSONALIZABLE)
// ============================================================================
export const MAX_CONCURRENCY = 2; // Concurrencia máxima: 2 archivos en paralelo
export const BATCH_SIZE = 5; // Divide los archivos en lotes de 5
export const BASE_FILE_DELAY_MS = 1500; // Entre cada archivo espera 1.5 segundos
export const BATCH_DELAY_MS = 10000; // Entre cada lote espera 10 segundos
export const MAX_RETRIES = 4; // Reintentos máximos (4 veces)
export const RETRY_DELAYS_MS = [3000, 6000, 12000, 24000]; // 3s, 6s, 12s, 24s
export const BACKUP_MODEL = 'gemini-3.5-flash'; // Modelo alternativo de respaldo de alta fidelidad

export type RowProcessingStatus = 'Pendiente' | 'Procesando' | 'Completada' | 'Fallida' | 'Reintentando';

export interface ScannedDriveInvoiceItem {
  id: string;
  name: string;
  mimeType: string;
  sizeFormatted: string;
  modifiedTime?: string;
  webViewLink?: string;
  status: 'already_read' | 'unread_pending';
  matchReason?: string;
  matchedInvoiceRecord?: SheetInvoiceRecord;
  selected: boolean;
  rowStatus?: RowProcessingStatus;
  retryCount?: number;
  errorMessage?: string;
  modelUsed?: string;
}

export interface BatchQueueProgress {
  currentBatch: number;
  totalBatches: number;
  processedInQueue: number;
  totalInQueue: number;
  activeProcessingNames: string[];
}

function cleanErrorMessage(msg: string): string {
  if (!msg) return 'Error desconocido al procesar la factura';
  if (
    msg.includes('<!DOCTYPE') ||
    msg.includes('<html') ||
    msg.includes('ppConfig') ||
    msg.includes('withgoogle.com')
  ) {
    return 'Respuesta inesperada al registrar en Google Sheets. Reintentando por canal seguro...';
  }
  if (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily')
  ) {
    return 'Alta demanda momentánea en los servidores de Gemini (503)';
  }
  if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return 'Límite temporal de consultas en API Gemini (429)';
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('504')) {
    return 'Tiempo de espera agotado con el servidor (timeout)';
  }
  return msg;
}

export interface AddedInvoiceResult {
  fileName: string;
  fileId: string;
  driveUrl: string;
  invoiceNumber: string;
  vendorName: string;
  date: string;
  total: number;
}

export interface SkippedDuplicateResult {
  fileName: string;
  reason: string;
  invoiceNumber?: string;
  vendorName?: string;
}

export interface DriveInvoicesSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectFolder;
  accessToken: string;
  existingInvoices: SheetInvoiceRecord[];
  activeTab?: string;
  onSyncComplete: (addedCount: number) => void;
}

export const DriveInvoicesSyncModal: React.FC<DriveInvoicesSyncModalProps> = ({
  isOpen,
  onClose,
  project,
  accessToken,
  existingInvoices = [],
  activeTab,
  onSyncComplete,
}) => {
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedFiles, setScannedFiles] = useState<ScannedDriveInvoiceItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'failed' | 'already_read'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Estados de control de la cola, lotes y pausas
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const [pauseCountdownText, setPauseCountdownText] = useState<string | null>(null);
  const [currentFileDelayMs, setCurrentFileDelayMs] = useState<number>(BASE_FILE_DELAY_MS);
  const fileDelayRef = useRef<number>(BASE_FILE_DELAY_MS);

  const [batchQueueProgress, setBatchQueueProgress] = useState<BatchQueueProgress | null>(null);

  // Estados para renombrar archivo directamente en Drive
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingFileNameInput, setEditingFileNameInput] = useState<string>('');
  const [isRenamingFile, setIsRenamingFile] = useState<boolean>(false);
  const [renameFileError, setRenameFileError] = useState<string | null>(null);

  const handleStartRename = (file: ScannedDriveInvoiceItem) => {
    setEditingFileId(file.id);
    setEditingFileNameInput(file.name);
    setRenameFileError(null);
  };

  // Final summary state
  const [completedSummary, setCompletedSummary] = useState<{
    totalAnalyzed: number;
    addedCount: number;
    skippedCount: number;
    errorCount: number;
    addedInvoices: AddedInvoiceResult[];
    skippedDuplicates: SkippedDuplicateResult[];
    errors: { fileName: string; error: string }[];
  } | null>(null);

  const folderIdToScan = project.evidenceFolderId || project.id;
  const folderNameToDisplay = project.evidenceFolderName || project.name || 'Carpeta de la obra';
  const storageKey = `svh_drive_sync_state_${project.id || 'default'}_${folderIdToScan || 'root'}`;

  // Persistencia: Guarda y actualiza el estado de cada fila en localStorage para no perder avance
  const updateFileRow = useCallback((fileId: string, updates: Partial<ScannedDriveInvoiceItem>) => {
    setScannedFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, ...updates } : f))
    );

    try {
      const existingRaw = localStorage.getItem(storageKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      existing[fileId] = {
        ...(existing[fileId] || {}),
        rowStatus: updates.rowStatus,
        retryCount: updates.retryCount,
        errorMessage: updates.errorMessage,
        modelUsed: updates.modelUsed,
        updatedAt: Date.now(),
      };
      localStorage.setItem(storageKey, JSON.stringify(existing));
    } catch (err) {
      console.warn('[Persistencia] No se pudo guardar estado de fila en localStorage:', err);
    }
  }, [storageKey]);

  const handleSaveRename = async (fileId: string) => {
    const trimmed = editingFileNameInput.trim();
    if (!trimmed) {
      setRenameFileError('El nombre del documento no puede estar vacío.');
      return;
    }
    setIsRenamingFile(true);
    setRenameFileError(null);
    try {
      await renameDriveFile(accessToken, fileId, trimmed);
      updateFileRow(fileId, { name: trimmed });
      setEditingFileId(null);
    } catch (err: any) {
      setRenameFileError(err?.message || 'Error al renombrar el archivo en Google Drive.');
    } finally {
      setIsRenamingFile(false);
    }
  };

  // 1. Escaneo exhaustivo de la carpeta de Drive y comparación contra Google Sheets
  const performDriveScan = useCallback(async () => {
    if (!accessToken || !folderIdToScan) return;
    setIsScanning(true);
    setScanError(null);
    setCompletedSummary(null);

    try {
      // Obtener el contenido directo de la carpeta de evidencias
      const folderData = await fetchFolderDirectContents(accessToken, folderIdToScan);
      const allItems = folderData.items || [];

      // Filtrar únicamente archivos que sean facturas o comprobantes
      const invoiceCandidateFiles = allItems.filter((item) => {
        if (item.itemType === 'folder') return false;
        const name = (item.name || '').toLowerCase();
        const mime = (item.mimeType || '').toLowerCase();
        return (
          mime === 'application/pdf' ||
          mime.startsWith('image/') ||
          name.endsWith('.pdf') ||
          name.endsWith('.png') ||
          name.endsWith('.jpg') ||
          name.endsWith('.jpeg') ||
          name.endsWith('.webp') ||
          name.endsWith('.xlsx') ||
          name.endsWith('.xls') ||
          name.endsWith('.csv')
        );
      });

      // Crear índices rápidos de facturas existentes en Google Sheets para detección anti-duplicados
      const registeredFileIds = new Set<string>();
      const registeredFileNames = new Set<string>();
      const registeredInvoicesMap = new Map<string, SheetInvoiceRecord>();

      existingInvoices.forEach((inv) => {
        const driveUrl = inv.driveFileUrl || '';
        const idMatch = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (idMatch && idMatch[1]) {
          registeredFileIds.add(idMatch[1]);
        }

        if (inv.fileName) {
          const cleanName = inv.fileName.trim().toLowerCase();
          registeredFileNames.add(cleanName);
          registeredInvoicesMap.set(cleanName, inv);
          const baseName = cleanName.replace(/\.[a-z0-9]+$/i, '');
          registeredFileNames.add(baseName);
        }

        if (inv.invoiceNumber && inv.invoiceNumber !== 'S/N' && inv.invoiceNumber !== 's/n') {
          const invKey = `${inv.invoiceNumber.trim().toLowerCase()}__${(inv.vendorName || '').trim().toLowerCase()}`;
          registeredInvoicesMap.set(invKey, inv);
        }
      });

      // Leer estado persistido de cada fila en localStorage para no perder progreso al recargar
      let persistedRows: Record<string, {
        rowStatus: RowProcessingStatus;
        retryCount?: number;
        errorMessage?: string;
        modelUsed?: string;
      }> = {};
      try {
        const rawSaved = localStorage.getItem(storageKey);
        if (rawSaved) {
          persistedRows = JSON.parse(rawSaved);
        }
      } catch (stErr) {
        console.warn('[Persistencia] Error leyendo estado guardado:', stErr);
      }

      // Clasificar cada archivo encontrado en Drive
      const classified: ScannedDriveInvoiceItem[] = invoiceCandidateFiles.map((file) => {
        const fileNameLower = file.name.trim().toLowerCase();
        const baseNameLower = fileNameLower.replace(/\.[a-z0-9]+$/i, '');

        let isRegistered = false;
        let matchReason = '';
        let matchedRecord: SheetInvoiceRecord | undefined;

        if (registeredFileIds.has(file.id)) {
          isRegistered = true;
          matchReason = 'Registrada en Sheets (Coincide ID único de Drive)';
          matchedRecord = existingInvoices.find((r) => (r.driveFileUrl || '').includes(file.id));
        }

        if (!isRegistered && (registeredFileNames.has(fileNameLower) || registeredFileNames.has(baseNameLower))) {
          isRegistered = true;
          matchReason = 'Registrada en Sheets (Coincide nombre de archivo)';
          matchedRecord = registeredInvoicesMap.get(fileNameLower) || registeredInvoicesMap.get(baseNameLower);
        }

        const savedRow = persistedRows[file.id];
        let rowStatus: RowProcessingStatus = 'Pendiente';
        if (savedRow?.rowStatus) {
          rowStatus = savedRow.rowStatus;
        } else if (isRegistered) {
          rowStatus = 'Completada';
        }

        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          sizeFormatted: file.sizeFormatted,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          status: isRegistered ? 'already_read' : 'unread_pending',
          matchReason: isRegistered
            ? `${matchReason}${matchedRecord?.vendorName ? ` • ${matchedRecord.vendorName}` : ''}${matchedRecord?.invoiceNumber ? ` (N° ${matchedRecord.invoiceNumber})` : ''}`
            : undefined,
          matchedInvoiceRecord: matchedRecord,
          selected: rowStatus === 'Pendiente' || rowStatus === 'Fallida',
          rowStatus,
          retryCount: savedRow?.retryCount || 0,
          errorMessage: savedRow?.errorMessage,
          modelUsed: savedRow?.modelUsed,
        };
      });

      // Ordenar: Pendientes y Fallidas primero para facilitar procesamiento
      classified.sort((a, b) => {
        const order: Record<RowProcessingStatus, number> = {
          Procesando: 0,
          Reintentando: 1,
          Pendiente: 2,
          Fallida: 3,
          Completada: 4,
        };
        const statusA = a.rowStatus || 'Pendiente';
        const statusB = b.rowStatus || 'Pendiente';
        if (order[statusA] !== order[statusB]) {
          return order[statusA] - order[statusB];
        }
        return a.name.localeCompare(b.name);
      });

      setScannedFiles(classified);
    } catch (err: any) {
      console.error('Error al escanear carpeta de Drive:', err);
      setScanError(err.message || 'Error al conectar con Google Drive y leer los archivos de la obra.');
    } finally {
      setIsScanning(false);
    }
  }, [accessToken, folderIdToScan, existingInvoices, storageKey]);

  useEffect(() => {
    if (isOpen) {
      performDriveScan();
    }
  }, [isOpen, performDriveScan]);

  // Contadores
  const totalCount = scannedFiles.length;
  const unreadCount = useMemo(() => scannedFiles.filter((f) => f.status === 'unread_pending').length, [scannedFiles]);
  const alreadyReadCount = useMemo(() => scannedFiles.filter((f) => f.status === 'already_read').length, [scannedFiles]);

  const completedCount = useMemo(
    () => scannedFiles.filter((f) => f.rowStatus === 'Completada').length,
    [scannedFiles]
  );
  const failedCount = useMemo(
    () => scannedFiles.filter((f) => f.rowStatus === 'Fallida').length,
    [scannedFiles]
  );
  const pendingCount = useMemo(
    () => scannedFiles.filter((f) => f.rowStatus === 'Pendiente' || !f.rowStatus).length,
    [scannedFiles]
  );
  const processingCount = useMemo(
    () => scannedFiles.filter((f) => f.rowStatus === 'Procesando' || f.rowStatus === 'Reintentando').length,
    [scannedFiles]
  );

  // Filtrado de la lista en pantalla
  const filteredFiles = useMemo(() => {
    let list = scannedFiles;
    if (statusFilter === 'pending') {
      list = list.filter((f) => f.rowStatus === 'Pendiente' || f.rowStatus === 'Procesando' || f.rowStatus === 'Reintentando');
    } else if (statusFilter === 'completed') {
      list = list.filter((f) => f.rowStatus === 'Completada');
    } else if (statusFilter === 'failed') {
      list = list.filter((f) => f.rowStatus === 'Fallida');
    } else if (statusFilter === 'already_read') {
      list = list.filter((f) => f.status === 'already_read');
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((f) => f.name.toLowerCase().includes(q) || (f.matchReason || '').toLowerCase().includes(q));
    }
    return list;
  }, [scannedFiles, statusFilter, searchQuery]);

  // Selección
  const handleToggleSelect = (id: string) => {
    setScannedFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f))
    );
  };

  const handleSelectAllUnread = () => {
    setScannedFiles((prev) =>
      prev.map((f) => (f.rowStatus !== 'Completada' ? { ...f, selected: true } : f))
    );
  };

  const handleDeselectAll = () => {
    setScannedFiles((prev) => prev.map((f) => ({ ...f, selected: false })));
  };

  // Helper para verificar y esperar si el usuario pausó el proceso
  const checkPauseAsync = async () => {
    while (isPausedRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };

  // 3. Procesamiento de un archivo individual con hasta 4 reintentos automáticos y backoff exponencial con jitter
  const processSingleFileWithRetries = async (
    file: ScannedDriveInvoiceItem,
    modelOverride?: string,
    activeKnownKeys?: Set<string>,
    on503Occurred?: (is503: boolean) => void
  ): Promise<{
    success: boolean;
    isDuplicate?: boolean;
    reason?: string;
    addedInvoice?: AddedInvoiceResult;
    error?: string;
  }> => {
    if (file.status === 'already_read' && !modelOverride) {
      updateFileRow(file.id, {
        rowStatus: 'Completada',
        errorMessage: undefined,
      });
      return {
        success: true,
        isDuplicate: true,
        reason: 'Omitida preventivamente: ya está registrada en Google Sheets',
      };
    }

    let attempts = 0;
    let lastErr = '';
    let file503Count = 0;

    while (attempts <= MAX_RETRIES) {
      await checkPauseAsync();

      if (attempts > 0) {
        updateFileRow(file.id, {
          rowStatus: 'Reintentando',
          retryCount: attempts,
          errorMessage: `Reintentando (${attempts}/${MAX_RETRIES}): ${lastErr}`,
        });

        // Espera creciente: 3s, 6s, 12s, 24s más jitter aleatorio de 0 a 1s
        const delayBase = RETRY_DELAYS_MS[attempts - 1] || 24000;
        const jitter = Math.floor(Math.random() * 1000);
        const totalWait = delayBase + jitter;

        let elapsedWait = 0;
        while (elapsedWait < totalWait) {
          await checkPauseAsync();
          const step = Math.min(250, totalWait - elapsedWait);
          await new Promise((r) => setTimeout(r, step));
          elapsedWait += step;
        }
      } else {
        updateFileRow(file.id, {
          rowStatus: 'Procesando',
          retryCount: 0,
          errorMessage: undefined,
        });
      }

      try {
        const res = await safeJsonFetch('/api/process-drive-file', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            folderId: folderIdToScan,
            spreadsheetId: project.spreadsheetId,
            sheetName: activeTab || project.activeSheetTab || 'Facturas',
            skipAppend: true,
            model: modelOverride,
          }),
        });

        if (!res.ok || !res.data?.success || !res.data?.extracted) {
          const msg = res.error || res.data?.error || `Error HTTP ${res.status}`;
          throw new Error(msg);
        }

        const extracted = res.data.extracted;
        const invNum = (extracted.numeroFactura || extracted.invoiceNumber || '').trim();
        const vendor = (extracted.cliente || extracted.vendorName || '').trim();
        const totalAmount = Number(extracted.total || extracted.totalAmount || 0);

        // Capa 2 Anti-Duplicados integral con checkInvoiceDuplicate
        const dupCheck = checkInvoiceDuplicate(
          {
            fileName: file.name,
            invoiceNumber: invNum,
            vendorName: vendor,
            vendorTaxId: extracted.nitRut || extracted.vendorTaxId,
            totalAmount: totalAmount,
            date: extracted.fecha || extracted.date,
          },
          existingInvoices,
          file.name,
          file.id
        );

        const duplicateKey =
          invNum && invNum !== 'S/N' && invNum !== 's/n' && vendor
            ? `${invNum.toLowerCase()}__${vendor.toLowerCase()}`
            : '';

        if (dupCheck.isDuplicate || (duplicateKey && activeKnownKeys?.has(duplicateKey))) {
          console.warn(`[Anti-Duplicado] Factura "${file.name}" omitida por duplicada.`);
          updateFileRow(file.id, {
            rowStatus: 'Completada',
            errorMessage: undefined,
            modelUsed: res.data?.extracted?.modelUsed || modelOverride,
          });
          return {
            success: true,
            isDuplicate: true,
            reason: dupCheck.reason || `La factura N° ${invNum || 'S/N'} de "${vendor || 'Proveedor'}" ya está en la hoja.`,
          };
        }

        // Si es válida y única, registrarla en Google Sheets usando appendInvoiceToSheet
        if (project.spreadsheetId) {
          const invoicePayload: InvoiceData = {
            date: (extracted.fecha || extracted.date || '').trim(),
            invoiceNumber: invNum,
            vendorName: vendor,
            vendorTaxId: (extracted.nitRut || extracted.vendorTaxId || '').trim(),
            concept: (extracted.concepto || extracted.concept || (extracted.items?.map((it: any) => it.descripcion || it.description).filter(Boolean).join(', ') || '')).trim(),
            category: (extracted.categoria || extracted.category || '').trim(),
            subtotal: Number(extracted.subtotal || 0),
            taxRatePercent: Number(extracted.taxRatePercent || extracted.porcentajeIva || (extracted.subtotal && extracted.iva ? Math.round((extracted.iva / extracted.subtotal) * 100) : 0)),
            taxAmount: Number(extracted.iva || extracted.taxAmount || 0),
            totalAmount: totalAmount,
            currency: (extracted.moneda || extracted.currency || 'COP').trim(),
            items: extracted.items || [],
          };

          const driveUrl = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
          await appendInvoiceToSheet(
            accessToken,
            project.spreadsheetId,
            invoicePayload,
            driveUrl,
            file.name,
            activeTab || project.activeSheetTab || 'Facturas'
          );

          if (duplicateKey && activeKnownKeys) {
            activeKnownKeys.add(duplicateKey);
          }

          const addedResult: AddedInvoiceResult = {
            fileName: file.name,
            fileId: file.id,
            driveUrl,
            invoiceNumber: invNum || 'S/N',
            vendorName: vendor || 'Proveedor',
            date: invoicePayload.date || '',
            total: totalAmount,
          };

          updateFileRow(file.id, {
            rowStatus: 'Completada',
            errorMessage: undefined,
            modelUsed: res.data?.extracted?.modelUsed || modelOverride,
          });

          return {
            success: true,
            addedInvoice: addedResult,
          };
        }

        updateFileRow(file.id, {
          rowStatus: 'Completada',
          errorMessage: undefined,
          modelUsed: res.data?.extracted?.modelUsed || modelOverride,
        });
        return { success: true };

      } catch (err: any) {
        const rawMsg = err?.message || String(err);
        lastErr = cleanErrorMessage(rawMsg);

        const is503 =
          rawMsg.includes('503') ||
          rawMsg.includes('UNAVAILABLE') ||
          rawMsg.includes('high demand') ||
          rawMsg.includes('overloaded');
        const is429 =
          rawMsg.includes('429') ||
          rawMsg.includes('quota') ||
          rawMsg.includes('RESOURCE_EXHAUSTED');
        const isTimeout =
          rawMsg.includes('timeout') ||
          rawMsg.includes('timed out') ||
          rawMsg.includes('504');
        const isRetryable = is503 || is429 || isTimeout || rawMsg.includes('fetch');

        // Si el error es 503 repetido, aumenta automáticamente la pausa entre archivos al doble
        if (is503) {
          file503Count++;
          if (on503Occurred) on503Occurred(true);
          if (file503Count >= 2) {
            fileDelayRef.current = Math.min(fileDelayRef.current * 2, 12000);
            setCurrentFileDelayMs(fileDelayRef.current);
            console.warn(`[Pausa Dinámica] 503 repetido en "${file.name}". Pausa entre archivos duplicada a ${fileDelayRef.current / 1000}s`);
          }
        }

        if (isRetryable && attempts < MAX_RETRIES) {
          attempts++;
          console.warn(`[Reintento ${attempts}/${MAX_RETRIES}] Archivo "${file.name}":`, rawMsg);
          continue;
        } else {
          // Tras 4 intentos sigue fallando: marca la fila como "Fallida" con el motivo real (nunca inventar datos)
          const finalReason = attempts >= MAX_RETRIES
            ? `Falló tras ${MAX_RETRIES} intentos de reintento: ${lastErr}`
            : lastErr;
          updateFileRow(file.id, {
            rowStatus: 'Fallida',
            errorMessage: finalReason,
            retryCount: attempts,
          });
          return { success: false, error: finalReason };
        }
      }
    }

    updateFileRow(file.id, {
      rowStatus: 'Fallida',
      errorMessage: lastErr || 'Error desconocido tras agotar reintentos',
      retryCount: attempts,
    });
    return { success: false, error: lastErr };
  };

  // 4. MOTOR PRINCIPAL DE COLA: Concurrencia máxima 2, lotes de 5, pausas de 1.5s entre archivos y 10s entre lotes
  const runQueueProcess = async (filesToProcess: ScannedDriveInvoiceItem[]) => {
    if (filesToProcess.length === 0) return;

    setIsProcessing(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setScanError(null);
    setPauseCountdownText(null);

    const totalFiles = filesToProcess.length;
    const totalBatches = Math.ceil(totalFiles / BATCH_SIZE);

    let addedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let processedCount = 0;

    const addedInvoices: AddedInvoiceResult[] = [];
    const skippedDuplicates: SkippedDuplicateResult[] = [];
    const errors: { fileName: string; error: string }[] = [];

    const activeKnownKeys = new Set<string>();
    existingInvoices.forEach((inv) => {
      if (inv.invoiceNumber && inv.invoiceNumber !== 'S/N' && inv.vendorName) {
        activeKnownKeys.add(`${inv.invoiceNumber.trim().toLowerCase()}__${inv.vendorName.trim().toLowerCase()}`);
      }
    });

    let global503Count = 0;

    // Procesar lote a lote (Lotes de 5 archivos)
    for (let bIndex = 0; bIndex < totalBatches; bIndex++) {
      await checkPauseAsync();

      const batchStart = bIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalFiles);
      const batchFiles = filesToProcess.slice(batchStart, batchEnd);

      setBatchQueueProgress({
        currentBatch: bIndex + 1,
        totalBatches,
        processedInQueue: processedCount,
        totalInQueue: totalFiles,
        activeProcessingNames: batchFiles.map((f) => f.name),
      });

      // Procesar dentro del lote con Concurrencia máxima: 2 archivos en paralelo (MAX_CONCURRENCY)
      let fileIdxInBatch = 0;
      const concurrencyLimit = Math.min(MAX_CONCURRENCY, batchFiles.length);

      const workers = Array.from({ length: concurrencyLimit }, async () => {
        while (fileIdxInBatch < batchFiles.length) {
          const curIdx = fileIdxInBatch++;
          const file = batchFiles[curIdx];
          if (!file) break;

          await checkPauseAsync();

          const result = await processSingleFileWithRetries(
            file,
            undefined, // modelo principal
            activeKnownKeys,
            (is503) => {
              if (is503) {
                global503Count++;
                if (global503Count >= 2) {
                  fileDelayRef.current = Math.min(fileDelayRef.current * 2, 12000);
                  setCurrentFileDelayMs(fileDelayRef.current);
                }
              }
            }
          );

          processedCount++;
          if (result.success) {
            if (result.isDuplicate) {
              skippedCount++;
              skippedDuplicates.push({
                fileName: file.name,
                reason: result.reason || 'Factura repetida ya registrada',
              });
            } else {
              addedCount++;
              if (result.addedInvoice) {
                addedInvoices.push(result.addedInvoice);
              }
            }
          } else {
            errorCount++;
            errors.push({
              fileName: file.name,
              error: result.error || 'Error desconocido',
            });
          }

          setBatchQueueProgress({
            currentBatch: bIndex + 1,
            totalBatches,
            processedInQueue: processedCount,
            totalInQueue: totalFiles,
            activeProcessingNames: [file.name],
          });

          // Entre cada archivo espera 1.5 segundos (o el doble si hubo 503 repetido)
          const targetDelay = fileDelayRef.current;
          let elapsed = 0;
          while (elapsed < targetDelay) {
            await checkPauseAsync();
            const step = Math.min(200, targetDelay - elapsed);
            await new Promise((r) => setTimeout(r, step));
            elapsed += step;
          }
        }
      });

      await Promise.all(workers);

      // Entre cada lote espera 10 segundos con aviso visible en pantalla
      if (bIndex < totalBatches - 1) {
        for (let sec = Math.round(BATCH_DELAY_MS / 1000); sec > 0; sec--) {
          await checkPauseAsync();
          setPauseCountdownText(`Pausa entre lotes: ${sec}s...`);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setPauseCountdownText(null);
      }
    }

    setIsProcessing(false);
    setBatchQueueProgress(null);
    setPauseCountdownText(null);

    setCompletedSummary({
      totalAnalyzed: totalFiles,
      addedCount,
      skippedCount,
      errorCount,
      addedInvoices,
      skippedDuplicates,
      errors,
    });

    if (addedCount > 0) {
      onSyncComplete(addedCount);
    }
  };

  // Botón: Iniciar procesamiento de seleccionadas (sin volver a procesar completadas)
  const handleProcessSelectedInvoices = async () => {
    const filesToProcess = scannedFiles.filter(
      (f) => f.selected && f.rowStatus !== 'Completada'
    );
    if (filesToProcess.length === 0) {
      const fallbackFiles = scannedFiles.filter(
        (f) => (f.rowStatus === 'Pendiente' || f.rowStatus === 'Fallida')
      );
      if (fallbackFiles.length === 0) return;
      await runQueueProcess(fallbackFiles);
      return;
    }

    await runQueueProcess(filesToProcess);
  };

  // Botón: Pausar y Reanudar
  const handleTogglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    isPausedRef.current = next;
  };

  // Botón: Reprocesar solo las fallidas (que no vuelva a procesar las completadas)
  const handleReprocessFailedOnly = async () => {
    const failedFiles = scannedFiles.filter((f) => f.rowStatus === 'Fallida');
    if (failedFiles.length === 0) return;

    setScannedFiles((prev) =>
      prev.map((f) =>
        f.rowStatus === 'Fallida'
          ? { ...f, rowStatus: 'Pendiente', errorMessage: undefined, retryCount: 0, selected: true }
          : { ...f, selected: false }
      )
    );

    const filesToRun = failedFiles.map((f) => ({
      ...f,
      rowStatus: 'Pendiente' as RowProcessingStatus,
      errorMessage: undefined,
      retryCount: 0,
      selected: true,
    }));

    await runQueueProcess(filesToRun);
  };

  // Botón: Modelo de Respaldo alternativo (manual por botón cuando una fila falla definitivamente)
  const handleRetryWithBackupModel = async (file: ScannedDriveInvoiceItem) => {
    setIsProcessing(true);
    updateFileRow(file.id, {
      rowStatus: 'Procesando',
      errorMessage: undefined,
      retryCount: 0,
    });

    try {
      const activeKnownKeys = new Set<string>();
      existingInvoices.forEach((inv) => {
        if (inv.invoiceNumber && inv.invoiceNumber !== 'S/N' && inv.vendorName) {
          activeKnownKeys.add(`${inv.invoiceNumber.trim().toLowerCase()}__${inv.vendorName.trim().toLowerCase()}`);
        }
      });

      const res = await processSingleFileWithRetries(file, BACKUP_MODEL, activeKnownKeys);
      if (res.success) {
        if (res.addedInvoice) {
          setCompletedSummary((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              addedCount: prev.addedCount + 1,
              addedInvoices: [...prev.addedInvoices, res.addedInvoice!],
              errorCount: Math.max(0, prev.errorCount - 1),
              errors: prev.errors.filter((e) => e.fileName !== file.name),
            };
          });
          onSyncComplete(1);
        }
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Botón: Limpiar avance persistido
  const handleClearPersistedState = () => {
    try {
      localStorage.removeItem(storageKey);
      performDriveScan();
    } catch (e) {
      console.warn('Error limpiando almacenamiento:', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        id="modal-drive-invoices-sync"
        className="w-full max-w-4xl bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header Modal */}
        <div className="p-4 sm:p-6 border-b border-slate-200 bg-gradient-to-r from-emerald-900 via-slate-900 to-slate-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#1ca330] to-[#98d52c] text-white flex items-center justify-center shadow-lg shadow-emerald-900/30">
              <FolderSearch className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Análisis de Facturas en Google Drive
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  Anti-Duplicados Activo
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Carpeta: <strong className="text-white font-semibold">{folderNameToDisplay}</strong> • Hoja destino: <strong className="text-emerald-300">{activeTab || project.activeSheetTab || 'Facturas'}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors disabled:opacity-40"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 bg-slate-50/50">
          {/* VISTA 1: RESUMEN FINAL TRAS PROCESAR (Información final solicitada por el usuario) */}
          {completedSummary ? (
            <div className="space-y-5 animate-in fade-in duration-300">
              {/* Banner de Felicitación / Éxito */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-400/80 shadow-sm text-slate-800">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-2xl bg-[#1ca330] text-white shadow-md shadow-emerald-600/30 shrink-0">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-base sm:text-lg font-extrabold text-emerald-950">
                      ¡Análisis y Sincronización de Facturas Finalizado!
                    </h4>
                    <p className="text-xs sm:text-sm text-emerald-900 mt-1">
                      Se examinaron los archivos de la carpeta en Google Drive y se integraron a tu hoja de cálculo oficial con protección contra duplicados.
                    </p>

                    {/* Tarjetas de Métricas Finales */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                      <div className="p-3.5 bg-white rounded-xl border border-emerald-200 shadow-2xs">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                          Facturas Añadidas a Sheets
                        </span>
                        <div className="text-2xl font-black text-emerald-700 mt-0.5 flex items-baseline gap-1">
                          <span>+{completedSummary.addedCount}</span>
                          <span className="text-xs font-semibold text-slate-500">nuevas</span>
                        </div>
                      </div>

                      <div className="p-3.5 bg-white rounded-xl border border-amber-200 shadow-2xs">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                          Omitidas (Sin Duplicados)
                        </span>
                        <div className="text-2xl font-black text-amber-700 mt-0.5 flex items-baseline gap-1">
                          <span>{completedSummary.skippedCount}</span>
                          <span className="text-xs font-semibold text-slate-500">prevenidas</span>
                        </div>
                      </div>

                      <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                          Total Procesadas
                        </span>
                        <div className="text-2xl font-black text-slate-800 mt-0.5">
                          {completedSummary.totalAnalyzed}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lista de Facturas Añadidas */}
              {completedSummary.addedInvoices.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-[#1ca330]" />
                      <span>Facturas Añadidas Exitosamente a Google Sheets ({completedSummary.addedInvoices.length})</span>
                    </h5>
                    {project.spreadsheetUrl && (
                      <a
                        href={project.spreadsheetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 hover:underline"
                      >
                        <span>Abrir libro de Sheets</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2.5">Archivo en Drive</th>
                          <th className="p-2.5">Proveedor</th>
                          <th className="p-2.5">N° Factura</th>
                          <th className="p-2.5">Fecha</th>
                          <th className="p-2.5 text-right">Total Registrado</th>
                          <th className="p-2.5 text-center">Enlace Drive</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {completedSummary.addedInvoices.map((inv, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                            <td className="p-2.5 font-semibold text-slate-900">{inv.fileName}</td>
                            <td className="p-2.5">{inv.vendorName}</td>
                            <td className="p-2.5 font-mono text-[11px]">{inv.invoiceNumber}</td>
                            <td className="p-2.5">{inv.date}</td>
                            <td className="p-2.5 text-right font-bold text-emerald-700">
                              $ {inv.total.toLocaleString('es-CO')}
                            </td>
                            <td className="p-2.5 text-center">
                              <a
                                href={inv.driveUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-800 font-semibold hover:underline"
                              >
                                <span>Ver archivo</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Lista de Duplicadas Omitidas */}
              {completedSummary.skippedDuplicates.length > 0 && (
                <div className="bg-amber-50/70 rounded-2xl border border-amber-200 p-4 shadow-2xs">
                  <h5 className="text-xs sm:text-sm font-bold text-amber-950 flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-4 h-4 text-amber-600" />
                    <span>Facturas Omitidas para Proteger la Facturación ({completedSummary.skippedDuplicates.length})</span>
                  </h5>
                  <p className="text-xs text-amber-900 mb-3">
                    El sistema detectó que estos comprobantes ya existían en tu hoja de cálculo o tenían el mismo número y proveedor, previniendo duplicidades de gasto.
                  </p>
                  <ul className="space-y-1.5 text-xs text-amber-900 font-medium">
                    {completedSummary.skippedDuplicates.map((dup, i) => (
                      <li key={i} className="flex items-center gap-2 bg-white/80 p-2 rounded-lg border border-amber-200">
                        <Check className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span className="font-semibold text-slate-800">{dup.fileName}:</span>
                        <span className="text-slate-600">{dup.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Lista de Errores si los hubo */}
              {completedSummary.errors.length > 0 && (
                <div className="bg-rose-50 rounded-2xl border border-rose-200 p-4 text-xs text-rose-900">
                  <h5 className="font-bold flex items-center gap-1.5 text-rose-950 mb-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Archivos con incidencia ({completedSummary.errors.length})</span>
                  </h5>
                  <ul className="space-y-1">
                    {completedSummary.errors.map((err, i) => (
                      <li key={i}>
                        <strong>{err.fileName}:</strong> {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            /* VISTA 2: LISTA DE ANÁLISIS Y AUDITORÍA DE ARCHIVOS EN DRIVE */
            <div className="space-y-4">
              {/* Barra de Estadísticas y Protección */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">
                      Total Facturas en Drive
                    </span>
                    <Receipt className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {totalCount}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">En carpeta de la obra</p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-emerald-200 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-800 uppercase">
                      Nuevas por Procesar
                    </span>
                    <Sparkles className="w-4 h-4 text-[#1ca330]" />
                  </div>
                  <div className="text-2xl font-black text-[#1ca330] mt-1">
                    {unreadCount}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">Aún no están en Google Sheets</p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600 uppercase">
                      Ya Leídas y Registradas
                    </span>
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-black text-slate-700 mt-1">
                    {alreadyReadCount}
                  </div>
                  <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">Protegidas contra duplicados</p>
                </div>
              </div>

              {/* Banner Informativo Anti-Duplicados */}
              <div className="p-3.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-950">
                <ShieldCheck className="w-4 h-4 text-[#1ca330] shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong className="font-bold">Garantía Anti-Duplicados:</strong> Comparamos cada archivo de Drive con los registros de tu Google Sheets (por ID único de Drive, nombre de archivo y N° de factura). Las facturas ya leídas quedan desmarcadas automáticamente para evitar cualquier error de doble facturación en la obra.
                </div>
              </div>

              {/* Barra de Filtros y Acciones de Selección */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-slate-200">
                {/* Conmutador de Filtros */}
                <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`h-8 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center ${
                      statusFilter === 'all'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    Todas ({totalCount})
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('pending')}
                    className={`h-8 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-1 ${
                      statusFilter === 'pending'
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>Pendientes ({pendingCount})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('completed')}
                    className={`h-8 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-1 ${
                      statusFilter === 'completed'
                        ? 'bg-[#1ca330] text-white shadow-xs'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Completadas ({completedCount})</span>
                  </button>

                  {failedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setStatusFilter('failed')}
                      className={`h-8 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-1 ${
                        statusFilter === 'failed'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Fallidas ({failedCount})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setStatusFilter('already_read')}
                    className={`h-8 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-1 ${
                      statusFilter === 'already_read'
                        ? 'bg-slate-700 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">En Sheets ({alreadyReadCount})</span>
                    <span className="sm:hidden">Sheets ({alreadyReadCount})</span>
                  </button>
                </div>

                {/* Acciones Rápidas */}
                <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleSelectAllUnread}
                      disabled={pendingCount === 0 || isProcessing}
                      className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-40"
                    >
                      Seleccionar pendientes
                    </button>

                    <span className="text-slate-300">|</span>

                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      disabled={isProcessing}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      Deseleccionar
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={performDriveScan}
                    disabled={isScanning || isProcessing}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors shrink-0"
                    title="Volver a escanear carpeta de Drive"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-[#1ca330]' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Mensaje de Error si ocurrió al escanear */}
              {scanError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{scanError}</span>
                </div>
              )}

              {/* Banner de Fallidas con opción de reprocesar solo las fallidas */}
              {failedCount > 0 && !isProcessing && (
                <div className="p-3.5 bg-rose-50/90 border-2 border-rose-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-950">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold text-rose-900">Se detectaron {failedCount} archivo(s) fallido(s) tras reintentos automáticos.</strong>
                      <p className="text-[11px] text-rose-800 mt-0.5">
                        Puedes reprocesar únicamente las fallidas sin volver a procesar las completadas, o utilizar el modelo de respaldo alternativo en cada fila.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleReprocessFailedOnly}
                    className="h-8 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-all shadow-xs shrink-0 self-start sm:self-auto cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reprocesar solo las fallidas ({failedCount})</span>
                  </button>
                </div>
              )}

              {/* BARRA DE PROGRESO GENERAL Y COLA DE PROCESAMIENTO (4. Estados y Progreso / 2. Lotes y Pausas / 5. Controles) */}
              {(isProcessing || batchQueueProgress) && (
                <div className="p-4 sm:p-5 bg-white rounded-2xl border-2 border-emerald-400 shadow-lg space-y-3.5 animate-in fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isPaused ? (
                        <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
                          <Pause className="w-4 h-4" />
                        </div>
                      ) : pauseCountdownText ? (
                        <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800 animate-pulse">
                          <Clock className="w-4 h-4" />
                        </div>
                      ) : (
                        <Loader2 className="w-4 h-4 animate-spin text-[#1ca330]" />
                      )}
                      <div>
                        <h4 className="text-xs sm:text-sm font-extrabold text-slate-900">
                          {batchQueueProgress ? (
                            <span>Lote {batchQueueProgress.currentBatch} de {batchQueueProgress.totalBatches} · {batchQueueProgress.processedInQueue} de {batchQueueProgress.totalInQueue} archivos</span>
                          ) : (
                            <span>Procesando archivos con cola segura...</span>
                          )}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] font-semibold">
                          {isPaused ? (
                            <span className="text-amber-700 font-bold">⏸️ Proceso en pausa (Pulsa "Reanudar" para continuar)</span>
                          ) : pauseCountdownText ? (
                            <span className="text-amber-700 font-bold animate-pulse">⏱️ {pauseCountdownText} (Enfriando servidores IA)</span>
                          ) : (
                            <span className="text-slate-500">
                              Concurrencia: {MAX_CONCURRENCY} en paralelo • Pausa entre archivos: {currentFileDelayMs / 1000}s
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Controles de Pausa / Reanudar y Porcentaje */}
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={handleTogglePause}
                        className={`h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer ${
                          isPaused
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                        title={isPaused ? 'Reanudar procesamiento de la cola' : 'Pausar temporalmente el procesamiento de la cola'}
                      >
                        {isPaused ? (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Reanudar</span>
                          </>
                        ) : (
                          <>
                            <Pause className="w-3.5 h-3.5 fill-current" />
                            <span>Pausar</span>
                          </>
                        )}
                      </button>

                      <span className="text-sm font-black text-[#1ca330] min-w-[3rem] text-right">
                        {batchQueueProgress && batchQueueProgress.totalInQueue > 0
                          ? `${Math.round((batchQueueProgress.processedInQueue / batchQueueProgress.totalInQueue) * 100)}%`
                          : '0%'}
                      </span>
                    </div>
                  </div>

                  {/* Barra de Progreso Visual */}
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-[#1ca330] via-[#98d52c] to-emerald-600 transition-all duration-300 rounded-full"
                      style={{
                        width: `${
                          batchQueueProgress && batchQueueProgress.totalInQueue > 0
                            ? Math.min(100, Math.round((batchQueueProgress.processedInQueue / batchQueueProgress.totalInQueue) * 100))
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  {/* Contadores: Completadas, Fallidas, Pendientes */}
                  <div className="flex items-center justify-between text-xs text-slate-600 font-semibold flex-wrap gap-2 pt-1 border-t border-slate-100">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Completadas: <strong className="text-emerald-700 font-bold">{completedCount}</strong></span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>Fallidas: <strong className="text-rose-700 font-bold">{failedCount}</strong></span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      <span>Pendientes: <strong className="text-slate-800 font-bold">{pendingCount}</strong></span>
                    </span>
                  </div>
                </div>
              )}

              {/* Lista de Archivos */}
              {isScanning ? (
                <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-[#1ca330] mx-auto" />
                  <h4 className="text-sm font-bold text-slate-800">Escaneando carpeta de Google Drive...</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Analizando archivos en "{folderNameToDisplay}" y verificando su estado frente a Google Sheets.
                  </p>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="p-10 text-center bg-white rounded-2xl border border-dashed border-slate-300 space-y-2">
                  <FolderSearch className="w-8 h-8 text-slate-400 mx-auto" />
                  <h4 className="text-sm font-bold text-slate-700">No se encontraron archivos en este filtro</h4>
                  <p className="text-xs text-slate-500">
                    {totalCount === 0
                      ? 'No hay archivos de factura (PDF, imágenes, Excel) en la carpeta de Drive de esta obra.'
                      : 'Cambia el filtro de estado arriba para ver todos los archivos.'}
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100 shadow-xs">
                  {filteredFiles.map((file) => {
                    const isRead = file.status === 'already_read';
                    return (
                      <div
                        key={file.id}
                        onClick={() => {
                          if (!isProcessing) handleToggleSelect(file.id);
                        }}
                        className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                          file.selected
                            ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                            : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Checkbox */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isProcessing) handleToggleSelect(file.id);
                            }}
                            className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all ${
                              file.selected
                                ? 'bg-[#1ca330] text-white shadow-2xs'
                                : 'border-2 border-slate-300 hover:border-slate-400 bg-white'
                            }`}
                          >
                            {file.selected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </button>

                          {/* Icono de Archivo */}
                          <div className={`p-2 rounded-xl shrink-0 ${isRead ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-[#1ca330]'}`}>
                            <FileText className="w-4 h-4" />
                          </div>

                          {/* Detalles del archivo */}
                          <div className="min-w-0">
                            {editingFileId === file.id ? (
                              <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="text"
                                  value={editingFileNameInput}
                                  onChange={(e) => setEditingFileNameInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveRename(file.id);
                                    if (e.key === 'Escape') setEditingFileId(null);
                                  }}
                                  className="bg-white border border-[#1ca330] rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                                  autoFocus
                                  disabled={isRenamingFile}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveRename(file.id)}
                                  disabled={isRenamingFile}
                                  className="p-1 bg-[#1ca330] hover:bg-[#157a24] text-white rounded-lg text-xs cursor-pointer"
                                  title="Guardar nuevo nombre en Google Drive"
                                >
                                  {isRenamingFile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingFileId(null)}
                                  disabled={isRenamingFile}
                                  className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs cursor-pointer"
                                  title="Cancelar"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                                {renameFileError && (
                                  <span className="text-[10px] text-rose-600 font-bold">{renameFileError}</span>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap group/rename">
                                <span className="text-xs font-bold text-slate-900 truncate max-w-sm" title={file.name}>
                                  {file.name}
                                </span>
                                {!isProcessing && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartRename(file);
                                    }}
                                    className="opacity-0 group-hover/rename:opacity-100 p-1 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-all cursor-pointer"
                                    title="Editar nombre del archivo en Google Drive"
                                  >
                                    <FileEdit className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <span className="text-[10px] text-slate-500 font-mono">
                                  ({file.sizeFormatted})
                                </span>
                              </div>
                            )}

                            {/* Estado visible de la fila: Pendiente, Procesando, Completada, Fallida, Reintentando (n/4) */}
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {file.rowStatus === 'Completada' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300 shadow-2xs">
                                  <CheckCircle2 className="w-3 h-3 text-[#1ca330]" />
                                  <span>Completada</span>
                                </span>
                              ) : file.rowStatus === 'Procesando' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-900 bg-sky-100 px-2 py-0.5 rounded-md border border-sky-300 animate-pulse shadow-2xs">
                                  <Loader2 className="w-3 h-3 text-sky-600 animate-spin" />
                                  <span>Procesando...</span>
                                </span>
                              ) : file.rowStatus === 'Reintentando' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300 shadow-2xs animate-pulse">
                                  <RotateCcw className="w-3 h-3 text-amber-600 animate-spin" />
                                  <span>Reintentando ({file.retryCount || 1}/4)</span>
                                </span>
                              ) : file.rowStatus === 'Fallida' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-900 bg-rose-100 px-2 py-0.5 rounded-md border border-rose-300 shadow-2xs">
                                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                                  <span>Fallida</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  <span>Pendiente</span>
                                </span>
                              )}

                              {/* Motivo de error visible si la fila falló */}
                              {file.rowStatus === 'Fallida' && file.errorMessage && (
                                <span
                                  className="text-[10px] font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 truncate max-w-xs sm:max-w-md"
                                  title={file.errorMessage}
                                >
                                  Motivo: {file.errorMessage}
                                </span>
                              )}

                              {file.rowStatus === 'Completada' && file.modelUsed && (
                                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 font-mono">
                                  {file.modelUsed.replace('gemini-', '')}
                                </span>
                              )}

                              {file.matchReason && file.rowStatus !== 'Fallida' && (
                                <span className="text-[10px] text-slate-500 truncate max-w-xs">
                                  {file.matchReason}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Acciones de Fila: Modelo de Respaldo Alternativo (si falló) + Enlace a Drive */}
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {/* 7. MODELO DE RESPALDO: Botón para reintentar con modelo alternativo cuando falla definitivamente */}
                          {file.rowStatus === 'Fallida' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetryWithBackupModel(file);
                              }}
                              disabled={isProcessing}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl transition-all shadow-2xs cursor-pointer disabled:opacity-50"
                              title="Reintentar exclusivamente esta factura con el modelo alternativo Flash de respaldo"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                              <span>Reintentar con modelo alternativo</span>
                            </button>
                          )}

                          {file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                              title="Abrir archivo en Google Drive"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-500" />
                              <span className="hidden sm:inline">Ver en Drive</span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 sm:p-5 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {completedSummary ? (
            <>
              <div className="text-xs text-slate-500 font-medium">
                {completedSummary.addedCount > 0 ? (
                  <span>
                    Se agregaron <strong>{completedSummary.addedCount}</strong> facturas nuevas a la pestaña "{activeTab || project.activeSheetTab || 'Facturas'}".
                  </span>
                ) : (
                  <span>Todas las facturas ya estaban registradas (0 duplicados).</span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {project.spreadsheetUrl && (
                  <a
                    href={project.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-9 px-3 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-[#157a24] bg-[#1ca330]/15 hover:bg-[#1ca330]/25 border border-[#1ca330]/30 transition-all shadow-2xs flex-1 sm:flex-initial whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-[#1ca330] shrink-0" />
                    <span>Ver en Sheets</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0" />
                  </a>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-xs active:scale-95 flex-1 sm:flex-initial whitespace-nowrap cursor-pointer"
                >
                  <span>Aceptar y Ver Tabla</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                <span>
                  Seleccionadas: <strong className="text-emerald-800">{scannedFiles.filter((f) => f.selected).length}</strong> de {totalCount} facturas
                </span>
                {failedCount > 0 && (
                  <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 text-[11px]">
                    {failedCount} fallidas
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-end">
                {/* Botón Reprocesar solo las fallidas (disponible en footer si hay fallidas) */}
                {failedCount > 0 && !isProcessing && (
                  <button
                    type="button"
                    onClick={handleReprocessFailedOnly}
                    className="h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-rose-900 bg-rose-100 hover:bg-rose-200 border border-rose-300 transition-all shadow-2xs cursor-pointer shrink-0"
                    title="Reprocesa únicamente las facturas fallidas sin tocar las ya completadas"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-rose-700" />
                    <span>Reprocesar solo las fallidas ({failedCount})</span>
                  </button>
                )}

                {/* Botón Pausar / Reanudar durante el procesamiento */}
                {isProcessing && (
                  <button
                    type="button"
                    onClick={handleTogglePause}
                    className={`h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer shrink-0 ${
                      isPaused
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-amber-500 hover:bg-amber-600 text-white'
                    }`}
                    title={isPaused ? 'Reanudar procesamiento de la cola' : 'Pausar temporalmente el procesamiento de la cola'}
                  >
                    {isPaused ? (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Reanudar cola</span>
                      </>
                    ) : (
                      <>
                        <Pause className="w-3.5 h-3.5 fill-current" />
                        <span>Pausar cola</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isProcessing}
                  className="h-9 px-3.5 inline-flex items-center justify-center rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-300 transition-colors disabled:opacity-40 shrink-0"
                >
                  Cerrar
                </button>

                <button
                  type="button"
                  id="btn-confirm-analyze-drive-invoices"
                  onClick={handleProcessSelectedInvoices}
                  disabled={isProcessing || scannedFiles.filter((f) => f.selected).length === 0 || isScanning}
                  className="h-9 px-3.5 sm:px-4 inline-flex items-center justify-center gap-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-[#1ca330] to-[#168826] hover:brightness-105 shadow-sm hover:shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer flex-1 sm:flex-initial whitespace-nowrap"
                  title="Leer con IA y añadir a Google Sheets con cola y protección contra saturación"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white shrink-0" />
                      <span>{isPaused ? 'En pausa...' : 'Procesando en cola...'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-[#98d52c] shrink-0" />
                      <span className="hidden sm:inline">
                        Leer y Añadir Facturas ({scannedFiles.filter((f) => f.selected).length})
                      </span>
                      <span className="sm:hidden">
                        Añadir ({scannedFiles.filter((f) => f.selected).length})
                      </span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
