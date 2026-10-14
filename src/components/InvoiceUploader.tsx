import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud,
  Sparkles,
  Loader2,
  Camera,
  CheckCircle,
  AlertCircle,
  X,
  Check,
  FileText,
  Eye,
  FileCheck2,
  PlusCircle,
  Trash2,
  Layers,
  Lock,
  ArrowRight,
  Info,
  Play,
  Pause,
  RotateCcw,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  FolderOpen,
  Compass,
  ExternalLink,
  FolderSearch,
  Clock,
} from 'lucide-react';
import { InvoiceData, MAX_INVOICES_LIMIT, SheetInvoiceRecord } from '../types';
import { DriveFolderNavigator } from './DriveFolderNavigator';
import { checkInvoiceDuplicate } from '../utils/duplicateChecker';

// ============================================================================
// CONFIGURACIÓN DE COLA Y LOTES (Personalizable)
// ============================================================================
export const UPLOADER_MAX_CONCURRENCY = 2; // Concurrencia máxima: 2 archivos en paralelo
export const UPLOADER_BATCH_SIZE = 5; // Divide los archivos en lotes de 5
export const UPLOADER_BASE_FILE_DELAY_MS = 1500; // Entre cada archivo espera 1.5 segundos
export const UPLOADER_BATCH_DELAY_MS = 10000; // Entre cada lote espera 10 segundos
export const UPLOADER_MAX_RETRIES = 4; // Reintentos máximos (4 veces)
export const UPLOADER_RETRY_DELAYS_MS = [3000, 6000, 12000, 24000]; // 3s, 6s, 12s, 24s
export const UPLOADER_BACKUP_MODEL = 'gemini-3.1-flash-lite'; // Modelo alternativo de respaldo

export type UploaderItemStatus = 'pending' | 'analyzing' | 'retrying' | 'saved' | 'error';

export interface QueuedInvoiceItem {
  id: string;
  fileName: string;
  fileSizeFormatted: string;
  fileSizeBytes: number;
  mimeType: string;
  base64: string;
  status: UploaderItemStatus;
  retryCount?: number;
  errorMessage?: string;
  modelUsed?: string;
  createdAt: number;
}

export interface InvoiceUploaderProps {
  onImageSelected: (base64: string, fileName: string, mimeType: string) => void;
  onAnalyze: (base64: string, mimeType: string) => Promise<void>;
  onProcessInvoiceItem: (item: QueuedInvoiceItem, targetFolderId?: string, preferredModel?: string) => Promise<{
    success: boolean;
    data?: InvoiceData;
    driveUrl?: string;
    error?: string;
  }>;
  onReviewInvoiceItem?: (item: QueuedInvoiceItem) => void;
  onBatchFinished?: (savedCount: number) => void;
  isAnalyzing: boolean;
  selectedProjectName?: string;
  lastSavedFileName?: string | null;
  existingInvoices?: SheetInvoiceRecord[];
  // Destination Folder in Google Drive
  accessToken?: string;
  evidenceFolderId?: string;
  evidenceFolderName?: string;
  evidenceFolderUrl?: string;
  onFolderChange?: (folder: { id: string; name: string; path?: string; webViewLink?: string }) => void;
  onSpreadsheetConnected?: (sheet: { id: string; name: string; url: string; folderId?: string; folderName?: string }) => void;
  onOpenDriveInvoiceAnalysis?: () => void;
}

function cleanErrorMessage(msg: string): string {
  if (!msg) return 'Error desconocido al procesar la factura';
  if (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('temporarily')
  ) {
    return 'Alta demanda momentánea en los servidores de IA (503). Pulsa en "Procesar y Guardar Directo" para reintentar.';
  }
  if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return 'Límite temporal de consultas en Google Gemini. Puedes reintentar en unos instantes.';
  }
  return msg;
}

export const InvoiceUploader: React.FC<InvoiceUploaderProps> = ({
  onImageSelected,
  onAnalyze,
  onProcessInvoiceItem,
  onReviewInvoiceItem,
  onBatchFinished,
  isAnalyzing,
  selectedProjectName,
  lastSavedFileName,
  existingInvoices = [],
  accessToken,
  evidenceFolderId,
  evidenceFolderName,
  evidenceFolderUrl,
  onFolderChange,
  onSpreadsheetConnected,
  onOpenDriveInvoiceAnalysis,
}) => {
  const [invoicesQueue, setInvoicesQueue] = useState<QueuedInvoiceItem[]>([]);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [previewModalName, setPreviewModalName] = useState<string | null>(null);

  // Batch processing state
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isBatchPaused, setIsBatchPaused] = useState(false);
  const isBatchPausedRef = useRef(false);
  const [batchPauseCountdown, setBatchPauseCountdown] = useState<string | null>(null);
  const [uploaderFileDelayMs, setUploaderFileDelayMs] = useState(UPLOADER_BASE_FILE_DELAY_MS);
  const uploaderFileDelayRef = useRef(UPLOADER_BASE_FILE_DELAY_MS);

  const [batchProgress, setBatchProgress] = useState<{
    currentBatch: number;
    totalBatches: number;
    currentIndex: number;
    total: number;
    currentName: string;
    savedCount: number;
    errorCount: number;
  } | null>(null);

  const [batchSummary, setBatchSummary] = useState<{
    total: number;
    saved: string[];
    errors: { fileName: string; reason: string }[];
  } | null>(null);

  // Estados de edición del nombre del documento en la cola
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingFileNameInput, setEditingFileNameInput] = useState<string>('');

  const handleStartRenameQueued = (item: QueuedInvoiceItem) => {
    setEditingInvoiceId(item.id);
    setEditingFileNameInput(item.fileName);
  };

  const handleSaveRenameQueued = (id: string) => {
    const trimmed = editingFileNameInput.trim();
    if (trimmed) {
      setInvoicesQueue((prev) =>
        prev.map((it) => (it.id === id ? { ...it, fileName: trimmed } : it))
      );
    }
    setEditingInvoiceId(null);
  };

  const uploaderStorageKey = `svh_uploader_queue_${selectedProjectName || 'default'}`;

  // Persistencia: cargar cola guardada al iniciar si existe
  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(uploaderStorageKey);
      if (savedRaw) {
        const savedQueue = JSON.parse(savedRaw);
        if (Array.isArray(savedQueue) && savedQueue.length > 0) {
          setInvoicesQueue(savedQueue);
        }
      }
    } catch (e) {
      console.warn('[Persistencia] Error leyendo cola guardada:', e);
    }
  }, [uploaderStorageKey]);

  // Persistencia: guardar cola cada vez que cambia
  useEffect(() => {
    try {
      if (invoicesQueue.length > 0) {
        localStorage.setItem(uploaderStorageKey, JSON.stringify(invoicesQueue));
      } else {
        localStorage.removeItem(uploaderStorageKey);
      }
    } catch (e) {
      console.warn('[Persistencia] Error guardando cola:', e);
    }
  }, [invoicesQueue, uploaderStorageKey]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploaderContainerRef = useRef<HTMLDivElement>(null);

  // Google Drive destination folder state
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [customTargetFolder, setCustomTargetFolder] = useState<{
    id: string;
    name: string;
    path?: string;
    webViewLink?: string;
  } | null>(null);

  const activeFolderId = customTargetFolder?.id || evidenceFolderId || 'root';
  const activeFolderName = customTargetFolder?.name || evidenceFolderName || selectedProjectName || 'Carpeta de la obra';
  const activeFolderUrl = customTargetFolder?.webViewLink || evidenceFolderUrl;

  // Cerrar modal de Drive automáticamente cuando se ejecuta una hoja desde el navegador
  useEffect(() => {
    const handleClose = () => setIsDriveModalOpen(false);
    window.addEventListener('svh:execute-sheet', handleClose);
    return () => window.removeEventListener('svh:execute-sheet', handleClose);
  }, []);

  // When lastSavedFileName updates, mark that invoice as saved
  useEffect(() => {
    if (lastSavedFileName) {
      setInvoicesQueue((prev) =>
        prev.map((item) =>
          item.fileName === lastSavedFileName || item.id === activeInvoiceId
            ? { ...item, status: 'saved' as const }
            : item
        )
      );

      // Find next pending invoice to activate
      setInvoicesQueue((currentQueue) => {
        const pending = currentQueue.find(
          (inv) => inv.status === 'pending' && inv.id !== activeInvoiceId
        );
        if (pending) {
          setActiveInvoiceId(pending.id);
          onImageSelected(pending.base64, pending.fileName, pending.mimeType);
        }
        return currentQueue;
      });
    }
  }, [lastSavedFileName]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const activeInvoice =
    invoicesQueue.find((item) => item.id === activeInvoiceId) || invoicesQueue[0] || null;

  // Process incoming files, enforcing MAX_INVOICES_LIMIT (15)
  const processFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

    setErrorMsg(null);
    setInfoNotice(null);
    setBatchSummary(null);

    const currentCount = invoicesQueue.length;
    if (currentCount >= MAX_INVOICES_LIMIT) {
      setErrorMsg(
        `Has alcanzado el límite máximo de ${MAX_INVOICES_LIMIT} facturas. Procesa o elimina algunas para agregar más.`
      );
      return;
    }

    const availableSlots = MAX_INVOICES_LIMIT - currentCount;
    const fileArray = Array.from(files);

    const validFiles: File[] = [];
    let hasInvalidType = false;
    let hasTooBig = false;

    for (const file of fileArray) {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        hasInvalidType = true;
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        hasTooBig = true;
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      if (hasInvalidType) {
        setErrorMsg('Formato no soportado. Por favor selecciona imágenes válidas (PNG, JPG, JPEG o WEBP).');
      } else if (hasTooBig) {
        setErrorMsg('Uno o más archivos superan el límite de 20MB.');
      }
      return;
    }

    // Filtrar facturas repetidas contra la cola activa y contra las registradas en la hoja
    const nonDuplicateFiles: File[] = [];
    const duplicateNames: string[] = [];

    for (const f of validFiles) {
      const fNameLower = f.name.trim().toLowerCase();
      const baseLower = fNameLower.replace(/\.[a-z0-9]+$/i, '');
      const inQueue = invoicesQueue.some(
        (q) => q.fileName.trim().toLowerCase() === fNameLower
      );
      const inSheets = existingInvoices.some((ext) => {
        const extName = (ext.fileName || '').trim().toLowerCase();
        return extName === fNameLower || (baseLower.length > 3 && extName.replace(/\.[a-z0-9]+$/i, '') === baseLower);
      });

      if (inQueue || inSheets) {
        duplicateNames.push(f.name);
      } else {
        nonDuplicateFiles.push(f);
      }
    }

    if (duplicateNames.length > 0) {
      setInfoNotice(
        `Se omitieron ${duplicateNames.length} comprobante(s) repetidos o ya registrados en la hoja de cálculo (${duplicateNames.slice(0, 2).join(', ')}${duplicateNames.length > 2 ? '...' : ''}). Doble facturación prevenida.`
      );
    }

    if (nonDuplicateFiles.length === 0) {
      if (duplicateNames.length > 0) {
        setErrorMsg('Los comprobantes seleccionados ya están registrados en la hoja de cálculo. No se pueden facturar nuevamente.');
      }
      return;
    }

    const filesToLoad = nonDuplicateFiles.slice(0, availableSlots);

    if (nonDuplicateFiles.length > availableSlots) {
      setInfoNotice(
        `Se añadieron ${availableSlots} facturas para no exceder el límite máximo permitido de ${MAX_INVOICES_LIMIT} facturas.`
      );
    }

    let loadedCount = 0;
    const newItems: QueuedInvoiceItem[] = [];

    filesToLoad.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Result = e.target?.result as string;
        const newItem: QueuedInvoiceItem = {
          id: `inv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          fileName: file.name,
          fileSizeFormatted: formatFileSize(file.size),
          fileSizeBytes: file.size,
          mimeType: file.type || 'image/jpeg',
          base64: base64Result,
          status: 'pending',
          createdAt: Date.now(),
        };

        newItems.push(newItem);
        loadedCount++;

        if (loadedCount === filesToLoad.length) {
          setInvoicesQueue((prev) => {
            const combined = [...prev, ...newItems];
            if (!activeInvoiceId || prev.length === 0) {
              const firstNew = newItems[0];
              setActiveInvoiceId(firstNew.id);
              onImageSelected(firstNew.base64, firstNew.fileName, firstNew.mimeType);
            }
            return combined;
          });
        }
      };

      reader.onerror = () => {
        setErrorMsg(`Error al leer el archivo ${file.name}.`);
      };

      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleSelectActiveInvoice = (item: QueuedInvoiceItem) => {
    setActiveInvoiceId(item.id);
    onImageSelected(item.base64, item.fileName, item.mimeType);
  };

  const handleRemoveInvoice = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setInvoicesQueue((prev) => {
      const filtered = prev.filter((item) => item.id !== id);
      if (activeInvoiceId === id) {
        if (filtered.length > 0) {
          const next = filtered[0];
          setActiveInvoiceId(next.id);
          onImageSelected(next.base64, next.fileName, next.mimeType);
        } else {
          setActiveInvoiceId(null);
        }
      }
      return filtered;
    });
  };

  const handleClearAll = () => {
    setInvoicesQueue([]);
    setActiveInvoiceId(null);
    setErrorMsg(null);
    setInfoNotice(null);
    setBatchSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Direct single invoice processing (no mandatory confirmation modal)
  const handleProcessSingleDirect = async (item: QueuedInvoiceItem) => {
    // Verificación anti-duplicados previa
    const dupCheck = checkInvoiceDuplicate({ fileName: item.fileName }, existingInvoices, item.fileName);
    if (dupCheck.isDuplicate) {
      setInvoicesQueue((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'error', errorMessage: 'Factura repetida ya registrada en Sheets' } : it))
      );
      setErrorMsg(`Factura repetida "${item.fileName}": ya se encuentra registrada en la hoja de cálculo. No se puede facturar nuevamente.`);
      return;
    }

    setInvoicesQueue((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: 'analyzing', errorMessage: undefined } : it))
    );
    setErrorMsg(null);

    try {
      const result = await onProcessInvoiceItem(item, activeFolderId);
      if (result.success) {
        setInvoicesQueue((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'saved' } : it))
        );
        setInfoNotice(`Factura "${item.fileName}" procesada y guardada exitosamente en Drive y Sheets.`);
        if (onBatchFinished) onBatchFinished(1);
      } else {
        const err = cleanErrorMessage(result.error || 'Error procesando la factura');
        setInvoicesQueue((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'error', errorMessage: err } : it))
        );
        setErrorMsg(`Error en factura "${item.fileName}": ${err}`);
      }
    } catch (err: any) {
      const msg = cleanErrorMessage(err.message || 'Error desconocido al procesar la factura');
      setInvoicesQueue((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'error', errorMessage: msg } : it))
      );
      setErrorMsg(`Error en factura "${item.fileName}": ${msg}`);
    }
  };

  // Process full batch of 1 to 15 invoices automatically
  const handleProcessBatch = async () => {
    const pendingItems = invoicesQueue.filter(
      (item) => item.status === 'pending' || item.status === 'error'
    );

    if (pendingItems.length === 0) {
      setErrorMsg('No hay facturas pendientes en el lote para procesar.');
      return;
    }

    setIsProcessingBatch(true);
    setErrorMsg(null);
    setInfoNotice(null);
    setBatchSummary(null);

    const savedNames: string[] = [];
    const errorList: { fileName: string; reason: string }[] = [];

    for (let i = 0; i < pendingItems.length; i++) {
      const currentItem = pendingItems[i];

      // Verificación estricta anti-duplicados por archivo en lote
      const dupCheck = checkInvoiceDuplicate({ fileName: currentItem.fileName }, existingInvoices, currentItem.fileName);
      if (dupCheck.isDuplicate) {
        errorList.push({
          fileName: currentItem.fileName,
          reason: `Factura repetida (${dupCheck.reason || 'Ya registrada en la hoja de cálculo'}). No se permite doble facturación.`,
        });
        setInvoicesQueue((prev) =>
          prev.map((it) => (it.id === currentItem.id ? { ...it, status: 'error', errorMessage: 'Factura repetida ya registrada' } : it))
        );
        continue;
      }

      // Update progress
      setBatchProgress({
        currentIndex: i + 1,
        total: pendingItems.length,
        currentName: currentItem.fileName,
        savedCount: savedNames.length,
        errorCount: errorList.length,
      });

      // Mark current item as analyzing
      setInvoicesQueue((prev) =>
        prev.map((it) => (it.id === currentItem.id ? { ...it, status: 'analyzing' } : it))
      );
      setActiveInvoiceId(currentItem.id);
      onImageSelected(currentItem.base64, currentItem.fileName, currentItem.mimeType);

      try {
        const result = await onProcessInvoiceItem(currentItem, activeFolderId);
        if (result.success) {
          savedNames.push(currentItem.fileName);
          setInvoicesQueue((prev) =>
            prev.map((it) => (it.id === currentItem.id ? { ...it, status: 'saved' } : it))
          );
        } else {
          const reason = cleanErrorMessage(result.error || 'Error al extraer o guardar datos');
          errorList.push({ fileName: currentItem.fileName, reason });
          setInvoicesQueue((prev) =>
            prev.map((it) =>
              it.id === currentItem.id ? { ...it, status: 'error', errorMessage: reason } : it
            )
          );
        }
      } catch (err: any) {
        const reason = cleanErrorMessage(err.message || 'Error de conexión o lectura');
        errorList.push({ fileName: currentItem.fileName, reason });
        setInvoicesQueue((prev) =>
          prev.map((it) =>
            it.id === currentItem.id ? { ...it, status: 'error', errorMessage: reason } : it
          )
        );
      }

      // Pausa entre archivos (1.5s) y entre lotes de 5 (10s) para evitar picos y errores 503/429
      if (i < pendingItems.length - 1) {
        if ((i + 1) % 5 === 0) {
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    setIsProcessingBatch(false);
    setBatchProgress(null);

    setBatchSummary({
      total: pendingItems.length,
      saved: savedNames,
      errors: errorList,
    });

    if (savedNames.length > 0 && onBatchFinished) {
      onBatchFinished(savedNames.length);
    }
  };

  // Optional manual review trigger
  const handleReviewManually = (item: QueuedInvoiceItem) => {
    if (onReviewInvoiceItem) {
      onReviewInvoiceItem(item);
    } else {
      onAnalyze(item.base64, item.mimeType);
    }
  };

  const totalCount = invoicesQueue.length;
  const isLimitReached = totalCount >= MAX_INVOICES_LIMIT;
  const slotsRemaining = Math.max(0, MAX_INVOICES_LIMIT - totalCount);
  const pendingCount = invoicesQueue.filter((inv) => inv.status === 'pending').length;
  const savedCount = invoicesQueue.filter((inv) => inv.status === 'saved').length;
  const errorCount = invoicesQueue.filter((inv) => inv.status === 'error').length;
  const canBatchProcess = pendingCount > 0 || errorCount > 0;

  return (
    <div
      ref={uploaderContainerRef}
      id="invoice-uploader-container"
      className="bg-white/85 backdrop-blur-md rounded-2xl border border-white/60 shadow-xl shadow-slate-200/50 p-5 sm:p-6 space-y-4 transition-all"
    >
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/jpg"
        className="hidden"
        onChange={(e) => processFiles(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => processFiles(e.target.files)}
      />

      {/* Main Header & Capacity Bar with Glassmorphism */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/70 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#1ca330]/20 to-[#98d52c]/20 text-[#157a24] border border-[#1ca330]/30 shadow-xs backdrop-blur-xs">
            <UploadCloud className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                Carga y Extracción de Facturas
              </h3>
              {totalCount > 0 && (
                <span
                  id="badge-invoice-counter"
                  className={`text-xs font-bold px-2.5 py-0.5 rounded-full border transition-all backdrop-blur-xs ${
                    isLimitReached
                      ? 'bg-amber-50/90 text-amber-900 border-amber-300'
                      : 'bg-[#1ca330]/10 text-[#157a24] border-[#1ca330]/30'
                  }`}
                >
                  {totalCount} / {MAX_INVOICES_LIMIT} facturas
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Sube de 1 a {MAX_INVOICES_LIMIT} facturas. La IA las procesa y guarda directamente en Sheets y Drive.
            </p>
          </div>
        </div>

        {/* Top Interactive Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Add more invoices */}
          <button
            id="btn-add-more-invoices"
            type="button"
            onClick={() => {
              if (!isLimitReached) {
                fileInputRef.current?.click();
              }
            }}
            disabled={isLimitReached || isAnalyzing || isProcessingBatch}
            className={`h-9 px-3 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold rounded-xl transition-all shadow-xs active:scale-95 whitespace-nowrap ${
              isLimitReached
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                : 'bg-gradient-to-r from-[#1ca330] to-[#168826] hover:brightness-105 text-white border border-[#1ca330]/60 hover:shadow-md'
            }`}
            title={
              isLimitReached
                ? `Límite máximo de ${MAX_INVOICES_LIMIT} facturas alcanzado`
                : `Agregar más facturas (${slotsRemaining} disponibles)`
            }
          >
            {isLimitReached ? (
              <>
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Límite (15/15)</span>
              </>
            ) : (
              <>
                <PlusCircle className="w-3.5 h-3.5 text-[#98d52c] shrink-0" />
                <span className="hidden sm:inline">
                  + Agregar facturas{' '}
                  <span className="opacity-90 font-normal">
                    ({slotsRemaining} libre{slotsRemaining === 1 ? '' : 's'})
                  </span>
                </span>
                <span className="sm:hidden">
                  + Facturas ({slotsRemaining})
                </span>
              </>
            )}
          </button>

          {/* Quick Camera Snapshot */}
          {!isLimitReached && (
            <button
              id="btn-add-camera-invoice"
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isAnalyzing || isProcessingBatch}
              className="h-9 px-3 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-white/90 hover:bg-slate-50 text-slate-700 border border-slate-300/80 rounded-xl transition-all shadow-xs backdrop-blur-xs active:scale-95 whitespace-nowrap"
              title="Tomar una nueva foto con la cámara"
            >
              <Camera className="w-4 h-4 text-[#1ca330] shrink-0" />
              <span className="hidden sm:inline">Cámara</span>
            </button>
          )}

          {totalCount > 0 && (
            <button
              id="btn-clear-all-invoices"
              type="button"
              onClick={handleClearAll}
              disabled={isAnalyzing || isProcessingBatch}
              className="h-9 w-9 inline-flex items-center justify-center text-xs text-slate-500 hover:text-rose-600 font-medium rounded-xl hover:bg-rose-50/80 transition-colors"
              title="Quitar todas las facturas del lote"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* Google Drive Destination Folder Selection Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-50/90 border border-slate-200/90 hover:border-slate-300 transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-100 text-[#1ca330] shrink-0">
            <FolderOpen className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Carpeta de destino en Google Drive:
              </span>
              {activeFolderUrl && (
                <a
                  href={activeFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-sky-600 hover:text-sky-800 hover:underline flex items-center gap-0.5"
                  title="Abrir carpeta en Google Drive"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900 truncate">
                {activeFolderName}
              </span>
              {customTargetFolder?.path && (
                <span className="text-[11px] text-slate-500 truncate max-w-xs font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                  {customTargetFolder.path}
                </span>
              )}
            </div>
          </div>
        </div>

        {accessToken && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex items-center gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
            {onOpenDriveInvoiceAnalysis && (
              <button
                type="button"
                onClick={onOpenDriveInvoiceAnalysis}
                disabled={isProcessingBatch || isAnalyzing}
                className="h-9 px-3 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-2xs hover:shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 whitespace-nowrap w-full sm:w-auto"
                title="Analizar facturas en esta carpeta de Google Drive, detectar cuáles ya se leyeron y cuáles no, y añadirlas a Sheets sin duplicados"
              >
                <FolderSearch className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Analizar Facturas de Drive</span>
                <span className="sm:hidden">Analizar Facturas de Drive</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsDriveModalOpen(true)}
              disabled={isProcessingBatch || isAnalyzing}
              className="h-9 px-3 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-white hover:bg-emerald-50 text-[#1ca330] border border-emerald-300 hover:border-emerald-400 shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 whitespace-nowrap w-full sm:w-auto"
            >
              <Compass className="w-3.5 h-3.5 text-[#1ca330] shrink-0" />
              <span className="hidden sm:inline">Cambiar carpeta / Explorar</span>
              <span className="sm:hidden">Cambiar Carpeta</span>
            </button>
          </div>
        )}
      </div>

      {/* Modal Drive Folder Navigator */}
      {isDriveModalOpen && accessToken && (
        <DriveFolderNavigator
          accessToken={accessToken}
          isModal={true}
          onClose={() => setIsDriveModalOpen(false)}
          initialFolderId={activeFolderId === 'root' ? 'root' : activeFolderId}
          initialFolderName={activeFolderName}
          selectedFolderId={activeFolderId}
          onSelectFolder={(folder) => {
            setCustomTargetFolder(folder);
            onFolderChange?.(folder);
          }}
          onSelectSpreadsheet={(sheet) => {
            onSpreadsheetConnected?.({
              id: sheet.id,
              name: sheet.name,
              url: sheet.webViewLink || `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`,
              folderId: (sheet as any).parentId || (sheet as any).folderId || activeFolderId,
              folderName: (sheet as any).folderName || activeFolderName,
            });
            setIsDriveModalOpen(false);
          }}
          onSpreadsheetCreated={(sheet) => {
            onSpreadsheetConnected?.(sheet);
            setIsDriveModalOpen(false);
          }}
          title="Seleccionar Carpeta de Destino en Google Drive"
          subtitle="Navega por la jerarquía real de carpetas y subcarpetas para elegir dónde guardar las facturas"
          selectButtonLabel="Guardar facturas en esta carpeta"
        />
      )}

      {/* Batch Processing Status Bar (Live Progress) */}
      {isProcessingBatch && batchProgress && (
        <div className="p-4 bg-emerald-50/90 backdrop-blur-md border border-emerald-300 rounded-2xl shadow-sm space-y-2.5 animate-in fade-in">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>
                Procesando factura {batchProgress.currentIndex} de {batchProgress.total}...
              </span>
              <span className="font-normal text-emerald-800 truncate max-w-[200px] sm:max-w-xs">
                ({batchProgress.currentName})
              </span>
            </div>
            <span className="text-emerald-700 bg-white/80 px-2 py-0.5 rounded-full border border-emerald-200">
              {Math.round((batchProgress.currentIndex / batchProgress.total) * 100)}%
            </span>
          </div>

          {/* Smooth Progress Track */}
          <div className="w-full bg-emerald-200/80 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-[#1ca330] transition-all duration-300 rounded-full"
              style={{
                width: `${Math.max(5, (batchProgress.currentIndex / batchProgress.total) * 100)}%`,
              }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-emerald-800">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <strong>{batchProgress.savedCount}</strong> guardada{batchProgress.savedCount === 1 ? '' : 's'} en Drive & Sheets
            </span>
            {batchProgress.errorCount > 0 && (
              <span className="text-rose-700 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-rose-600" />
                {batchProgress.errorCount} con error (continúa con las demás)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Batch Summary Completion Banner */}
      {batchSummary && !isProcessingBatch && (
        <div className="p-4 bg-white/95 backdrop-blur-md border border-emerald-200 rounded-2xl shadow-md space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">
                  Procesamiento del lote finalizado
                </h4>
                <p className="text-[11px] text-slate-500">
                  {batchSummary.saved.length} factura{batchSummary.saved.length === 1 ? '' : 's'} guardada{batchSummary.saved.length === 1 ? '' : 's'} directamente en Google Sheets y Google Drive.
                </p>
              </div>
            </div>
            <button
              onClick={() => setBatchSummary(null)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Detailed results */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-emerald-900">
              <span className="font-bold flex items-center gap-1.5 mb-1">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                Guardadas con éxito ({batchSummary.saved.length}):
              </span>
              <div className="max-h-24 overflow-y-auto space-y-0.5 text-[11px] text-emerald-800">
                {batchSummary.saved.map((name, i) => (
                  <div key={i} className="truncate">• {name}</div>
                ))}
              </div>
            </div>

            {batchSummary.errors.length > 0 && (
              <div className="p-2.5 rounded-xl bg-rose-50/80 border border-rose-200 text-rose-900">
                <span className="font-bold flex items-center gap-1.5 mb-1">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                  Requieren revisión ({batchSummary.errors.length}):
                </span>
                <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-rose-800">
                  {batchSummary.errors.map((err, i) => (
                    <div key={i} className="truncate" title={err.reason}>
                      • <strong>{err.fileName}</strong>: {err.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Capacity Progress Bar */}
      {totalCount > 0 && (
        <div className="bg-slate-50/80 backdrop-blur-xs p-3 rounded-xl border border-slate-200/80 text-xs">
          <div className="flex items-center justify-between mb-1.5 font-medium text-slate-700">
            <span className="flex items-center gap-1.5 flex-wrap">
              <Layers className="w-3.5 h-3.5 text-[#1ca330]" />
              <span>
                Lote actual: <strong>{totalCount} de {MAX_INVOICES_LIMIT}</strong>
              </span>
              {pendingCount > 0 && (
                <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 text-[10px] font-semibold">
                  {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
                </span>
              )}
              {savedCount > 0 && (
                <span className="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[10px] font-semibold">
                  {savedCount} guardada{savedCount > 1 ? 's' : ''}
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-rose-800 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200 text-[10px] font-semibold">
                  {errorCount} con error
                </span>
              )}
            </span>
            <span className="text-slate-500 text-[11px]">
              {isLimitReached
                ? 'Límite de 15 alcanzado'
                : `${slotsRemaining} cupo${slotsRemaining === 1 ? '' : 's'} libre${slotsRemaining === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isLimitReached
                  ? 'bg-amber-500'
                  : totalCount >= 10
                  ? 'bg-emerald-500'
                  : 'bg-[#1ca330]'
              }`}
              style={{ width: `${Math.min(100, (totalCount / MAX_INVOICES_LIMIT) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Notifications */}
      {errorMsg && (
        <div className="p-3 bg-rose-50/90 backdrop-blur-xs border border-rose-200 rounded-xl flex items-center justify-between gap-2 text-xs text-rose-700 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="p-1 hover:bg-rose-100 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {infoNotice && (
        <div className="p-3 bg-blue-50/90 backdrop-blur-xs border border-blue-200 rounded-xl flex items-center justify-between gap-2 text-xs text-blue-800 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0 text-blue-600" />
            <span>{infoNotice}</span>
          </div>
          <button onClick={() => setInfoNotice(null)} className="p-1 hover:bg-blue-100 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Empty State / Initial Dropzone */}
      {totalCount === 0 ? (
        <div
          id="dropzone-invoice"
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-all ${
            dragActive
              ? 'border-[#1ca330] bg-[#1ca330]/5 scale-[0.99]'
              : 'border-slate-300 hover:border-[#1ca330] hover:bg-slate-50/50'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1ca330]/20 to-[#98d52c]/20 text-[#1ca330] flex items-center justify-center mx-auto mb-4 border border-[#1ca330]/30 shadow-xs">
            <UploadCloud className="w-7 h-7" />
          </div>

          <p className="text-sm sm:text-base font-bold text-slate-800">
            Arrastra aquí las fotos o facturas de la obra
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Puedes subir de <strong>1 a {MAX_INVOICES_LIMIT} facturas</strong> por lote. Se leerán automáticamente con IA y se guardarán en la hoja de cálculo.
          </p>

          {/* Action Buttons */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              id="btn-browse-file"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-sm transition-all active:scale-95"
            >
              <FileText className="w-4 h-4" />
              <span>Examinar archivos (hasta {MAX_INVOICES_LIMIT})</span>
            </button>

            <button
              type="button"
              id="btn-take-photo"
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-[#1ca330]/10 text-slate-800 border border-slate-300 hover:border-[#1ca330]/40 text-xs font-semibold rounded-xl transition-all active:scale-95 shadow-xs"
              title="Abrir la cámara del dispositivo"
            >
              <Camera className="w-4 h-4 text-[#1ca330]" />
              <span>Tomar foto con la cámara</span>
            </button>
          </div>
        </div>
      ) : (
        /* Multi-Invoice Queue & Batch Controls */
        <div className="space-y-4">
          {/* Main Batch Execution Bar */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#98d52c]" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Extracción y Guardado Automático
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Procesa todo el lote con IA y guarda en Google Sheets directamente sin ventanas intermedias.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                id="btn-process-full-batch"
                type="button"
                onClick={handleProcessBatch}
                disabled={isProcessingBatch || isAnalyzing || !canBatchProcess}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#1ca330] to-[#98d52c] hover:brightness-110 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessingBatch ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Procesando Lote...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-slate-950 text-slate-950" />
                    <span>
                      Procesar Lote Completo ({pendingCount + errorCount} pendiente{pendingCount + errorCount === 1 ? '' : 's'})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Invoices Cards Grid (1 to 15) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Facturas en el lote ({totalCount}/{MAX_INVOICES_LIMIT})
              </span>
              <span className="text-[11px] text-slate-500">
                Selecciona una factura para verla o procesarla individualmente
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 max-h-72 overflow-y-auto p-1">
              {invoicesQueue.map((item, idx) => {
                const isSelected = activeInvoice?.id === item.id;
                return (
                  <div
                    key={item.id}
                    id={`invoice-queue-card-${item.id}`}
                    onClick={() => handleSelectActiveInvoice(item)}
                    className={`relative rounded-xl border p-2.5 transition-all cursor-pointer text-left group flex flex-col justify-between backdrop-blur-xs ${
                      isSelected
                        ? 'border-[#1ca330] bg-[#1ca330]/5 ring-2 ring-[#1ca330]/30 shadow-sm'
                        : item.status === 'saved'
                        ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300'
                        : item.status === 'error'
                        ? 'border-rose-300 bg-rose-50/40 hover:border-rose-400'
                        : 'border-slate-200 bg-white/90 hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    {/* Top Index & Remove */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        #{idx + 1}
                      </span>
                      <button
                        id={`btn-remove-invoice-${item.id}`}
                        type="button"
                        onClick={(e) => handleRemoveInvoice(item.id, e)}
                        disabled={isAnalyzing || isProcessingBatch}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Quitar esta factura"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Thumbnail Preview with Zoom button */}
                    <div className="h-24 bg-slate-100 rounded-lg overflow-hidden relative border border-slate-200 mb-2 flex items-center justify-center">
                      <img
                        src={item.base64}
                        alt={item.fileName}
                        className="w-full h-full object-contain p-1"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewModalUrl(item.base64);
                          setPreviewModalName(item.fileName);
                        }}
                        className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1"
                        title="Ampliar vista previa"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Ver</span>
                      </button>
                    </div>

                    {/* Meta info & Status */}
                    <div className="space-y-1">
                      {editingInvoiceId === item.id ? (
                        <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingFileNameInput}
                            onChange={(e) => setEditingFileNameInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.stopPropagation();
                                handleSaveRenameQueued(item.id);
                              }
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setEditingInvoiceId(null);
                              }
                            }}
                            className="w-full bg-white border border-[#1ca330] rounded-md px-1.5 py-0.5 text-[11px] font-bold text-slate-900 focus:outline-none"
                            autoFocus
                          />
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSaveRenameQueued(item.id);
                              }}
                              className="px-1.5 py-0.5 bg-[#1ca330] text-white rounded text-[10px] font-bold hover:bg-[#157a24]"
                              title="Guardar nombre"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingInvoiceId(null);
                              }}
                              className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] hover:bg-slate-300"
                              title="Cancelar"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-1 group/tile">
                          <p
                            className="text-xs font-semibold text-slate-900 truncate flex-1"
                            title={item.fileName}
                          >
                            {item.fileName}
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartRenameQueued(item);
                            }}
                            className="opacity-0 group-hover/tile:opacity-100 p-0.5 text-slate-400 hover:text-emerald-700 rounded transition-opacity"
                            title="Editar nombre del documento"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>{item.fileSizeFormatted}</span>
                        {item.status === 'saved' ? (
                          <span className="text-emerald-700 font-bold flex items-center gap-0.5">
                            <CheckCircle className="w-3 h-3" /> Guardada
                          </span>
                        ) : item.status === 'analyzing' ? (
                          <span className="text-sky-700 font-bold flex items-center gap-0.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> IA
                          </span>
                        ) : item.status === 'error' ? (
                          <span className="text-rose-700 font-bold flex items-center gap-0.5">
                            <AlertCircle className="w-3 h-3" /> Error
                          </span>
                        ) : isSelected ? (
                          <span className="text-[#157a24] font-bold">Activa</span>
                        ) : (
                          <span className="text-slate-400">Pendiente</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add more tile inside the grid */}
              {!isLimitReached && (
                <button
                  type="button"
                  id="btn-add-more-tile"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzing || isProcessingBatch}
                  className="rounded-xl border-2 border-dashed border-slate-300 hover:border-[#1ca330] bg-slate-50/50 hover:bg-[#1ca330]/5 p-3 flex flex-col items-center justify-center text-center transition-all group min-h-[140px]"
                  title={`Agregar más facturas (${slotsRemaining} cupos disponibles)`}
                >
                  <div className="w-9 h-9 rounded-full bg-[#1ca330]/10 text-[#1ca330] flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">
                    + Agregar factura
                  </span>
                  <span className="text-[10px] text-slate-500 mt-0.5">
                    ({slotsRemaining} restante{slotsRemaining === 1 ? '' : 's'})
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Active Invoice Detailed Action Box (Glassmorphic) */}
          {activeInvoice && (
            <div className="p-4 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-md shadow-sm flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-44 h-36 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center relative group shrink-0">
                <img
                  src={activeInvoice.base64}
                  alt={activeInvoice.fileName}
                  className="w-full h-full object-contain p-1.5"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPreviewModalUrl(activeInvoice.base64);
                    setPreviewModalName(activeInvoice.fileName);
                  }}
                  className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold gap-1.5"
                >
                  <Eye className="w-4 h-4" />
                  <span>Ampliar</span>
                </button>
              </div>

              <div className="flex-1 w-full space-y-2 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-lg bg-[#1ca330]/10 text-[#157a24] text-xs font-bold border border-[#1ca330]/20 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Factura seleccionada
                  </span>

                  {activeInvoice.status === 'saved' && (
                    <span className="px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300">
                      Ya registrada en Drive y Sheets
                    </span>
                  )}

                  {activeInvoice.status === 'error' && (
                    <span className="px-2.5 py-0.5 rounded-lg bg-rose-100 text-rose-800 text-xs font-bold border border-rose-300">
                      Hubo un error de extracción
                    </span>
                  )}
                </div>

                {editingInvoiceId === activeInvoice.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingFileNameInput}
                      onChange={(e) => setEditingFileNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRenameQueued(activeInvoice.id);
                        if (e.key === 'Escape') setEditingInvoiceId(null);
                      }}
                      className="flex-1 bg-white border border-[#1ca330] rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRenameQueued(activeInvoice.id)}
                      className="p-1.5 bg-[#1ca330] hover:bg-[#157a24] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                      title="Guardar nombre"
                    >
                      <Check className="w-4 h-4 stroke-[2.5]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingInvoiceId(null)}
                      className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs transition-colors cursor-pointer"
                      title="Cancelar"
                    >
                      <X className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 group/title">
                    <h4 className="text-sm font-bold text-slate-900 truncate" title={activeInvoice.fileName}>
                      {activeInvoice.fileName}
                    </h4>
                    <button
                      type="button"
                      onClick={() => handleStartRenameQueued(activeInvoice)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg border border-emerald-200 transition-colors cursor-pointer"
                      title="Editar nombre del documento de esta factura"
                    >
                      <Edit3 className="w-3 h-3 text-[#1ca330]" />
                      <span>Editar nombre</span>
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                  <span>Tamaño: <strong>{activeInvoice.fileSizeFormatted}</strong></span>
                  <span>Formato: <strong>{activeInvoice.mimeType}</strong></span>
                  <span>Obra: <strong className="text-slate-800">{selectedProjectName || 'Obra actual'}</strong></span>
                </div>

                {activeInvoice.errorMessage && (
                  <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
                    <strong>Motivo del fallo:</strong> {activeInvoice.errorMessage}
                  </p>
                )}

                {/* Direct Action Buttons */}
                <div className="pt-2 flex flex-wrap items-center gap-2.5">
                  {/* Direct Save Button (Without mandatory confirmation modal) */}
                  <button
                    id="btn-process-single-direct"
                    type="button"
                    onClick={() => handleProcessSingleDirect(activeInvoice)}
                    disabled={isProcessingBatch || isAnalyzing}
                    className="inline-flex items-center gap-2 bg-[#1ca330] hover:bg-[#168826] text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-60"
                    title="Extraer con IA y guardar directamente en Google Sheets"
                  >
                    {activeInvoice.status === 'analyzing' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Guardando en Sheets...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-[#98d52c]" />
                        <span>Procesar y Guardar Directo</span>
                      </>
                    )}
                  </button>

                  {/* Optional Manual Review Button */}
                  <button
                    id="btn-review-manually"
                    type="button"
                    onClick={() => handleReviewManually(activeInvoice)}
                    disabled={isProcessingBatch || isAnalyzing}
                    className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-xs px-3.5 py-2.5 rounded-xl transition-all shadow-xs active:scale-95"
                    title="Revisar los datos extraídos en una ventana antes de guardar"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Revisar campos manualmente</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Zoom Preview */}
      {previewModalUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900 truncate">
                {previewModalName || 'Vista previa de factura'}
              </span>
              <button
                onClick={() => setPreviewModalUrl(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 flex items-center justify-center bg-slate-950/5">
              <img
                src={previewModalUrl}
                alt="Factura completa"
                className="max-h-[70vh] object-contain rounded-lg shadow-sm border border-slate-200"
              />
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setPreviewModalUrl(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg"
              >
                Cerrar vista
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
