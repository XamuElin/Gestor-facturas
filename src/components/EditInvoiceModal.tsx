import React, { useState, useEffect, useRef } from 'react';
import { SheetInvoiceRecord, CONSTRUCTION_CATEGORIES, ConstructionCategory, ProjectFolder } from '../types';
import {
  downloadDriveFileContent,
  extractDriveFileId,
  searchDriveFilesByName,
  uploadInvoiceImageToDrive,
  fetchFolderDirectContents,
  parseLocaleAmount,
  renameDriveFile,
} from '../services/googleDriveSheets';
import { safeJsonFetch } from '../utils/safeApiFetch';
import {
  X,
  Save,
  Loader2,
  AlertCircle,
  FileEdit,
  DollarSign,
  Calendar,
  Building2,
  Hash,
  Calculator,
  Tag,
  FileText,
  ExternalLink,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Upload,
  FolderSearch,
  Link as LinkIcon,
  Search,
  Paperclip,
  ArrowRight,
  RotateCcw,
  Minus,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface EditInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: SheetInvoiceRecord | null;
  project?: ProjectFolder;
  onSave: (updatedInvoice: SheetInvoiceRecord) => Promise<void>;
  sheetTitle?: string;
  accessToken?: string;
  initialAutoRunAi?: boolean;
}

export const EditInvoiceModal: React.FC<EditInvoiceModalProps> = ({
  isOpen,
  onClose,
  invoice,
  project,
  onSave,
  sheetTitle,
  accessToken,
  initialAutoRunAi,
}) => {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorTaxId, setVendorTaxId] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState<ConstructionCategory>('Materiales');
  const [subtotal, setSubtotal] = useState<number>(0);
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [quantity, setQuantity] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<string>('');
  const [driveFileUrl, setDriveFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [isReReading, setIsReReading] = useState(false);
  const [reReadSuccessMsg, setReReadSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Snapshot of previous values before AI extraction
  const [previousValues, setPreviousValues] = useState<{
    invoiceNumber: string;
    issueDate: string;
    vendorName: string;
    vendorTaxId: string;
    concept: string;
    category: ConstructionCategory;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    quantity: string;
    unitPrice: string;
  } | null>(null);
  const [hasAiReplacement, setHasAiReplacement] = useState(false);

  // Auto-run guard ref
  const hasAutoRunRef = useRef(false);

  // In-modal attach / change file assistant
  const [showAttachPanel, setShowAttachPanel] = useState(false);
  const [attachTab, setAttachTab] = useState<'upload' | 'drive' | 'link'>('upload');
  const [isUploadingToDrive, setIsUploadingToDrive] = useState(false);
  const [driveSearchQuery, setDriveSearchQuery] = useState('');
  const [driveSearchResults, setDriveSearchResults] = useState<{ id: string; name: string; mimeType: string; webViewLink?: string; sizeFormatted?: string }[]>([]);
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);
  const [customDriveUrlInput, setCustomDriveUrlInput] = useState('');

  useEffect(() => {
    if (invoice) {
      setInvoiceNumber(invoice.invoiceNumber || '');
      setIssueDate(invoice.issueDate || '');
      setVendorName(invoice.vendorName || '');
      setVendorTaxId(invoice.vendorTaxId || '');
      setConcept(invoice.concept || '');
      setCategory(
        CONSTRUCTION_CATEGORIES.includes(invoice.category as ConstructionCategory)
          ? (invoice.category as ConstructionCategory)
          : 'Materiales'
      );
      setSubtotal(invoice.subtotal || 0);
      setTaxAmount(invoice.taxAmount || 0);
      setTotalAmount(invoice.totalAmount || 0);
      setQuantity(invoice.quantity !== undefined && invoice.quantity !== null ? String(invoice.quantity) : '');
      setUnitPrice(invoice.unitPrice !== undefined && invoice.unitPrice !== null ? String(invoice.unitPrice) : '');
      setDriveFileUrl(invoice.driveFileUrl || '');
      setFileName(invoice.fileName || '');
      setErrorMsg(null);
      setReReadSuccessMsg(null);
      setPreviousValues(null);
      setHasAiReplacement(false);
      setShowAttachPanel(false);
      setDriveSearchResults([]);
      setDriveSearchQuery('');
      setCustomDriveUrlInput('');
      hasAutoRunRef.current = false;
    }
  }, [invoice]);

  // Handle auto-start AI extraction if requested from quick action button
  useEffect(() => {
    if (isOpen && initialAutoRunAi && invoice && !hasAutoRunRef.current) {
      hasAutoRunRef.current = true;
      handleReReadInvoice();
    }
  }, [isOpen, initialAutoRunAi, invoice]);

  if (!isOpen || !invoice) return null;

  // Helper to apply AI extracted data into state, replacing previous values
  const applyExtractedData = (extracted: any) => {
    // 1. Snapshot previous values before replacement
    setPreviousValues({
      invoiceNumber,
      issueDate,
      vendorName,
      vendorTaxId,
      concept,
      category,
      subtotal,
      taxAmount,
      totalAmount,
      quantity,
      unitPrice,
    });

    // 2. Replace previous values with new AI extracted data
    if (extracted.numeroFactura || extracted.invoiceNumber) {
      setInvoiceNumber(extracted.numeroFactura || extracted.invoiceNumber || '');
    }
    if (extracted.fecha || extracted.date) {
      setIssueDate(extracted.fecha || extracted.date || '');
    }
    if (extracted.cliente || extracted.vendorName || extracted.emisor || extracted.proveedor) {
      setVendorName(extracted.cliente || extracted.vendorName || extracted.emisor || extracted.proveedor || '');
    }
    if (extracted.nitRut || extracted.vendorTaxId || extracted.cifNif) {
      setVendorTaxId(extracted.nitRut || extracted.vendorTaxId || extracted.cifNif || '');
    }
    if (extracted.concepto || extracted.concept || extracted.descripcion) {
      setConcept(extracted.concepto || extracted.concept || extracted.descripcion || '');
    }
    if (extracted.categoria || extracted.category) {
      const cat = (extracted.categoria || extracted.category) as ConstructionCategory;
      if (CONSTRUCTION_CATEGORIES.includes(cat)) {
        setCategory(cat);
      }
    }

    let newSubtotal = parseLocaleAmount(extracted.subtotal);
    let newTax = parseLocaleAmount(extracted.iva ?? extracted.taxAmount);
    let newTotal = parseLocaleAmount(extracted.total ?? extracted.totalAmount);

    if (newTotal === 0 && (newSubtotal > 0 || newTax > 0)) {
      newTotal = newSubtotal + newTax;
    } else if (newTotal > 0 && newSubtotal === 0 && newTax === 0) {
      newSubtotal = newTotal;
    }

    // Always replace subtotal, taxAmount, and totalAmount with the freshly extracted values
    setSubtotal(newSubtotal);
    setTaxAmount(newTax);
    setTotalAmount(newTotal);

    if (Array.isArray(extracted.items) && extracted.items.length > 0) {
      const first = extracted.items[0];
      if (first.cantidad !== undefined || first.quantity !== undefined) {
        setQuantity(String(first.cantidad ?? first.quantity ?? ''));
      }
      if (first.precioUnitario !== undefined || first.unitPrice !== undefined) {
        setUnitPrice(String(first.precioUnitario ?? first.unitPrice ?? ''));
      }
    }

    setHasAiReplacement(true);
  };

  // Helper to revert back to previous values
  const handleRestorePreviousValues = () => {
    if (!previousValues) return;
    setInvoiceNumber(previousValues.invoiceNumber);
    setIssueDate(previousValues.issueDate);
    setVendorName(previousValues.vendorName);
    setVendorTaxId(previousValues.vendorTaxId);
    setConcept(previousValues.concept);
    setCategory(previousValues.category);
    setSubtotal(previousValues.subtotal);
    setTaxAmount(previousValues.taxAmount);
    setTotalAmount(previousValues.totalAmount);
    setQuantity(previousValues.quantity);
    setUnitPrice(previousValues.unitPrice);
    setHasAiReplacement(false);
    setReReadSuccessMsg('Se han restaurado los valores anteriores de la factura.');
  };

  // Search or list files in Drive folder for selection
  const loadDriveFilesForSelection = async (explicitQuery?: string) => {
    if (!accessToken) return;
    setIsSearchingDrive(true);
    try {
      const folderId = project?.evidenceFolderId || project?.baseFolderId || project?.id;
      const queryToUse = explicitQuery !== undefined ? explicitQuery : driveSearchQuery;
      let results: any[] = [];

      if (queryToUse.trim()) {
        results = await searchDriveFilesByName(accessToken, queryToUse, folderId);
      } else if (folderId && folderId !== 'root') {
        const listing = await fetchFolderDirectContents(accessToken, folderId);
        results = listing.items
          .filter((i) => i.itemType !== 'folder')
          .map((i) => ({
            id: i.id,
            name: i.name,
            mimeType: i.mimeType,
            webViewLink: i.webViewLink,
            sizeFormatted: i.sizeFormatted,
          }));
      } else {
        // Broad search for invoices or pdfs
        results = await searchDriveFilesByName(accessToken, 'factura');
      }

      setDriveSearchResults(results);
    } catch (err) {
      console.warn('Error al consultar archivos en Drive:', err);
    } finally {
      setIsSearchingDrive(false);
    }
  };

  // Handler to re-read the invoice content from Google Drive with AI
  const handleReReadInvoice = async (
    overrideDriveFileId?: string,
    overrideUrl?: string,
    overrideFileName?: string
  ) => {
    setErrorMsg(null);
    setReReadSuccessMsg(null);

    let targetFileId = overrideDriveFileId || extractDriveFileId(overrideUrl || driveFileUrl || invoice.driveFileUrl);

    // If still no valid file ID from the URL, try automatic search in Google Drive
    if (!targetFileId && accessToken) {
      setIsReReading(true);
      try {
        const queryTerm = overrideFileName || fileName || invoice.fileName || invoice.invoiceNumber;
        const folderId = project?.evidenceFolderId || project?.baseFolderId || project?.id;

        if (queryTerm && queryTerm.trim().length >= 2) {
          const found = await searchDriveFilesByName(accessToken, queryTerm, folderId);
          if (found && found.length > 0) {
            targetFileId = found[0].id;
            setDriveFileUrl(found[0].webViewLink || `https://drive.google.com/file/d/${found[0].id}/view`);
            setFileName(found[0].name);
            setReReadSuccessMsg(`Se localizó automáticamente el archivo "${found[0].name}" en Google Drive.`);
          }
        }

        // Búsqueda adicional por número de fila si targetFileId sigue vacío (ej. "FACTURA 18" -> Fila 18)
        if (!targetFileId && invoice.rowIndex) {
          const foundByRow = await searchDriveFilesByName(accessToken, `FACTURA ${invoice.rowIndex}`, folderId);
          if (foundByRow && foundByRow.length > 0) {
            targetFileId = foundByRow[0].id;
            setDriveFileUrl(foundByRow[0].webViewLink || `https://drive.google.com/file/d/${foundByRow[0].id}/view`);
            setFileName(foundByRow[0].name);
            setReReadSuccessMsg(`Se localizó automáticamente el archivo "${foundByRow[0].name}" en Google Drive.`);
          }
        }
      } catch (searchErr) {
        console.warn('Error en búsqueda automática en Drive:', searchErr);
      }
    }

    // If still no file ID could be identified:
    if (!targetFileId) {
      setIsReReading(false);
      setShowAttachPanel(true);
      setAttachTab('upload');
      loadDriveFilesForSelection();
      setErrorMsg(
        'Esta factura no tiene un enlace de archivo identificable en Google Drive. Puedes subir tu comprobante (PDF o Imagen) o seleccionarlo de Drive aquí abajo para que la IA extraiga los datos de inmediato.'
      );
      return;
    }

    if (!accessToken) {
      setErrorMsg(
        'Se requiere una sesión activa con Google Drive para volver a leer el archivo. Por favor verifica tu conexión de Google.'
      );
      return;
    }

    setIsReReading(true);

    try {
      // 1. Detect mime type from file name or default
      const fileNameLower = (overrideFileName || fileName || invoice.fileName || '').toLowerCase();
      let guessedMime = 'application/pdf';
      if (fileNameLower.endsWith('.png')) guessedMime = 'image/png';
      else if (fileNameLower.endsWith('.jpg') || fileNameLower.endsWith('.jpeg')) guessedMime = 'image/jpeg';
      else if (fileNameLower.endsWith('.webp')) guessedMime = 'image/webp';
      else if (fileNameLower.endsWith('.xlsx')) guessedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (fileNameLower.endsWith('.csv')) guessedMime = 'text/csv';

      // 2. Download file content from Google Drive
      const downloaded = await downloadDriveFileContent(accessToken, targetFileId, guessedMime);

      // 3. Re-analyze with AI via /api/analyze-invoice
      const analyzeRes = await safeJsonFetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: downloaded.base64,
          mimeType: downloaded.mimeType || guessedMime,
          fileName: overrideFileName || fileName || invoice.fileName,
        }),
      });

      if (analyzeRes.data?.data) {
        applyExtractedData(analyzeRes.data.data);
        if (analyzeRes.data.isQuota || analyzeRes.data.data.aiExtracted === false) {
          setReReadSuccessMsg(
            'Se procesaron los datos preliminares del comprobante. La IA está experimentando alta demanda en este momento; puedes volver a pulsar "Realizar nuevamente la extracción" en unos segundos si deseas reintentar.'
          );
        } else {
          setReReadSuccessMsg(
            '¡Comprobante leído con éxito con Inteligencia Artificial! Revisa los valores actualizados antes de guardar los cambios en Google Sheets.'
          );
        }
        setShowAttachPanel(false);
      } else {
        throw new Error(
          analyzeRes.error || analyzeRes.data?.error || 'No se pudieron extraer los datos del comprobante.'
        );
      }
    } catch (err: any) {
      console.error('Error al volver a leer la factura con IA:', err);
      setErrorMsg(
        err.message || 'Ocurrió un error al volver a leer el comprobante desde Google Drive.'
      );
    } finally {
      setIsReReading(false);
    }
  };

  // Direct file upload handler (PDF or image from computer)
  const handleDirectFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setReReadSuccessMsg(null);
    setIsReReading(true);

    try {
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = String(reader.result || '');
          const cleanBase64 = res.replace(/^data:[^;]+;base64,/, '');
          resolve(cleanBase64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Analyze with AI
      const analyzeRes = await safeJsonFetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64Data,
          mimeType: file.type || 'application/pdf',
        }),
      });

      if (analyzeRes.data?.data) {
        applyExtractedData(analyzeRes.data.data);
        setFileName(file.name);
      } else {
        throw new Error(
          analyzeRes.error || analyzeRes.data?.error || 'No se pudieron extraer los datos del comprobante.'
        );
      }

      // Upload to Drive if project evidence folder and accessToken are available
      const targetFolderId = project?.evidenceFolderId || project?.baseFolderId || project?.id;
      if (accessToken && targetFolderId) {
        setIsUploadingToDrive(true);
        try {
          const uploaded = await uploadInvoiceImageToDrive(
            accessToken,
            targetFolderId,
            file.name,
            file.type || 'application/pdf',
            base64Data
          );
          const link = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.fileId}/view`;
          setDriveFileUrl(link);
          setReReadSuccessMsg(
            `¡Archivo "${file.name}" analizado con IA y guardado en Google Drive! Guarda los cambios para sincronizar la fila.`
          );
        } catch (uploadErr) {
          console.warn('No se pudo subir automáticamente a Drive:', uploadErr);
          setReReadSuccessMsg(
            `¡Archivo "${file.name}" analizado con IA! Los campos se actualizaron en el formulario.`
          );
        } finally {
          setIsUploadingToDrive(false);
        }
      } else {
        setReReadSuccessMsg(
          `¡Archivo "${file.name}" analizado con IA! Revisa los datos y haz clic en Guardar Cambios.`
        );
      }

      setShowAttachPanel(false);
    } catch (err: any) {
      console.error('Error al analizar archivo subido:', err);
      setErrorMsg(err.message || 'Error al procesar el archivo seleccionado.');
    } finally {
      setIsReReading(false);
      e.target.value = '';
    }
  };

  // Custom Drive link submission
  const handleCustomUrlAnalyze = async () => {
    const rawUrl = customDriveUrlInput.trim();
    if (!rawUrl) {
      setErrorMsg('Por favor ingresa un enlace de Google Drive.');
      return;
    }
    const extractedId = extractDriveFileId(rawUrl);
    if (!extractedId) {
      setErrorMsg('El enlace ingresado no contiene un ID de archivo de Google Drive identificable.');
      return;
    }
    setDriveFileUrl(rawUrl);
    await handleReReadInvoice(extractedId, rawUrl);
  };

  // Recalculate tax & total based on subtotal with 21% default if requested
  const handleRecalculateTotal = (customTaxRate: number = 21) => {
    const calcTax = Math.round(subtotal * (customTaxRate / 100) * 100) / 100;
    const calcTotal = Math.round((subtotal + calcTax) * 100) / 100;
    setTaxAmount(calcTax);
    setTotalAmount(calcTotal);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!invoiceNumber.trim() && !vendorName.trim()) {
      setErrorMsg('Por favor ingresa al menos el número de factura o el nombre del proveedor.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      const trimmedFileName = fileName.trim();
      const updatedRecord: SheetInvoiceRecord = {
        ...invoice,
        invoiceNumber: invoiceNumber.trim(),
        issueDate: issueDate.trim(),
        vendorName: vendorName.trim(),
        vendorTaxId: vendorTaxId.trim(),
        concept: concept.trim(),
        category,
        subtotal: Number(subtotal) || 0,
        taxAmount: Number(taxAmount) || 0,
        totalAmount: Number(totalAmount) || 0,
        quantity: quantity !== '' ? Number(quantity) : undefined,
        unitPrice: unitPrice !== '' ? Number(unitPrice) : undefined,
        driveFileUrl: driveFileUrl.trim(),
        fileName: trimmedFileName,
      };

      // Si el nombre del documento cambió y está en Google Drive, renombrar el archivo físico en Drive
      if (accessToken && trimmedFileName && trimmedFileName !== invoice.fileName) {
        const fileId =
          extractDriveFileId(driveFileUrl) ||
          extractDriveFileId(invoice.driveFileUrl) ||
          (invoice.id && !invoice.id.includes('_') ? invoice.id : null);
        if (fileId) {
          try {
            await renameDriveFile(accessToken, fileId, trimmedFileName);
          } catch (rErr) {
            console.warn('Aviso al renombrar archivo en Google Drive:', rErr);
          }
        }
      }

      await onSave(updatedRecord);
      onClose();
    } catch (err: any) {
      console.error('Error al guardar edición de factura:', err);
      setErrorMsg(err.message || 'Error al actualizar la factura en Google Sheets.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !invoice) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#1ca330]/20 text-[#98d52c]">
            <FileEdit className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold truncate max-w-[200px]">
              {vendorName || invoiceNumber || 'Editar Factura'}
            </span>
            <span className="text-[10px] text-slate-400">Edición minimizada (Fila #{invoice.rowIndex})</span>
          </div>
        </div>
        <div className="flex items-center gap-1 border-l border-slate-700/80 pl-2">
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Restaurar a página completa"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-rose-900/60 rounded-xl text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            title="Cerrar pestaña (x)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  const modalContainerClasses = isFullscreen
    ? 'fixed inset-0 z-50 flex flex-col w-full h-full bg-white overflow-hidden animate-in fade-in duration-150'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-150';

  const modalBoxClasses = isFullscreen
    ? 'w-full h-full flex flex-col bg-white overflow-hidden'
    : 'bg-white/95 backdrop-blur-xl rounded-2xl border border-white/60 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200';

  return (
    <div className={modalContainerClasses}>
      <div className={modalBoxClasses}>
        {/* Header with full-page controls and AI reading */}
        <div className="p-4 sm:p-5 border-b border-slate-100/90 flex items-center justify-between bg-gradient-to-r from-slate-50/80 via-white/80 to-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#1ca330]/10 text-[#157a24] border border-[#1ca330]/20 shadow-2xs">
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  Editar Factura
                </h3>
                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  Fila #{invoice.rowIndex ?? '—'}
                </span>
                {sheetTitle && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 hidden sm:inline-block">
                    {sheetTitle}
                  </span>
                )}
                {isFullscreen && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hidden sm:inline-block">
                    Página Completa
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Modifica los datos y actualiza la fila correspondiente en Google Sheets.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              id="btn-reread-invoice-ai"
              onClick={() => handleReReadInvoice()}
              disabled={isReReading || isSaving}
              title="Analizar o volver a leer el comprobante con IA para autocompletar y corregir datos"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-[#1ca330] hover:from-emerald-700 hover:to-[#157a24] text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isReReading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Leyendo con IA...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-emerald-100" />
                  <span className="hidden sm:inline">Leer con IA</span>
                  <span className="sm:hidden">IA</span>
                </>
              )}
            </button>

            {/* Window controls */}
            <button
              type="button"
              id="btn-minimize-edit-tab"
              onClick={() => setIsMinimized(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
              title="Minimizar pestaña (-)"
            >
              <Minus className="w-5 h-5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              id="btn-toggle-fullscreen-edit-tab"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors hidden sm:inline-flex cursor-pointer"
              title={isFullscreen ? 'Restaurar tamaño ventana' : 'Abrir en página completa'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              id="btn-close-edit-modal"
              onClick={onClose}
              disabled={isSaving || isReReading}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              title="Cerrar pestaña (x)"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 lg:p-8 overflow-y-auto space-y-6 flex-1 max-w-6xl w-full mx-auto">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start justify-between gap-2 text-xs text-rose-800 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-rose-400 hover:text-rose-600 shrink-0 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {reReadSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start justify-between gap-2 text-xs text-emerald-800 animate-in fade-in">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed font-medium">{reReadSuccessMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setReReadSuccessMsg(null)}
                className="text-emerald-500 hover:text-emerald-700 shrink-0 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* AI Replaced Values Card with Confirm & Re-extract Buttons */}
          {hasAiReplacement && (
            <div className="p-4 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-emerald-50 border-2 border-emerald-400 rounded-2xl shadow-md space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#1ca330] text-white flex items-center justify-center shadow-xs shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider flex items-center gap-1.5">
                      <span>Valores reemplazados con IA</span>
                      <span className="text-[10px] bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-full font-semibold normal-case">
                        Extracción completada
                      </span>
                    </h4>
                    <p className="text-[11px] text-emerald-800">
                      La IA ha leído el comprobante y reemplazó los valores anteriores del formulario con los datos detectados.
                    </p>
                  </div>
                </div>

                {previousValues && (
                  <button
                    type="button"
                    onClick={handleRestorePreviousValues}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-600 bg-white/80 hover:bg-white border border-slate-200 px-2 py-1 rounded-lg font-medium transition-colors cursor-pointer shrink-0"
                    title="Deshacer el reemplazo y restaurar los valores anteriores"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Deshacer</span>
                  </button>
                )}
              </div>

              {/* Quick diff / comparison */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white/90 p-3 rounded-xl border border-emerald-200/80 text-xs shadow-2xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Total a pagar</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    {previousValues && previousValues.totalAmount !== totalAmount && (
                      <span className="text-[11px] text-slate-400 line-through font-mono">
                        ${previousValues.totalAmount.toLocaleString()}
                      </span>
                    )}
                    <span className="font-bold text-emerald-700 font-mono text-sm">
                      ${totalAmount.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Subtotal</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    {previousValues && previousValues.subtotal !== subtotal && (
                      <span className="text-[11px] text-slate-400 line-through font-mono">
                        ${previousValues.subtotal.toLocaleString()}
                      </span>
                    )}
                    <span className="font-semibold text-slate-800 font-mono">
                      ${subtotal.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">IVA / Impuesto</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    {previousValues && previousValues.taxAmount !== taxAmount && (
                      <span className="text-[11px] text-slate-400 line-through font-mono">
                        ${previousValues.taxAmount.toLocaleString()}
                      </span>
                    )}
                    <span className="font-semibold text-slate-800 font-mono">
                      ${taxAmount.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Proveedor</span>
                  <span className="font-semibold text-slate-800 truncate block mt-0.5" title={vendorName}>
                    {vendorName || '—'}
                  </span>
                </div>
              </div>

              {/* The TWO explicit action buttons requested by the user */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-1 border-t border-emerald-200/80">
                {/* Button: Realizar nuevamente la extracción */}
                <button
                  type="button"
                  id="btn-reextract-ai"
                  onClick={() => handleReReadInvoice()}
                  disabled={isReReading || isSaving}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sky-800 bg-sky-100 hover:bg-sky-200 border border-sky-300 rounded-xl transition-all shadow-2xs active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Volver a ejecutar la extracción de datos con IA sobre la factura"
                >
                  {isReReading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Extrayendo datos con IA...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-sky-700" />
                      <span>Realizar nuevamente la extracción</span>
                    </>
                  )}
                </button>

                {/* Button: Confirmar el cambio */}
                <button
                  type="button"
                  id="btn-confirm-ai-change"
                  onClick={() => handleSubmit()}
                  disabled={isSaving || isReReading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[#1ca330] hover:bg-[#157a24] rounded-xl transition-all shadow-md hover:shadow-lg active:scale-95 disabled:opacity-60 cursor-pointer"
                  title="Confirmar los valores reemplazados y guardar en Google Sheets"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Guardando en Google Sheets...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-100" />
                      <span>Confirmar cambio</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Interactive Attach / Re-read Assistant Panel */}
          {showAttachPanel && (
            <div className="p-4 bg-emerald-50/70 border-2 border-emerald-300 rounded-2xl space-y-3 animate-in fade-in duration-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-700" />
                  <span className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                    Vincular comprobante para lectura con IA
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAttachPanel(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-xs text-slate-600">
                Selecciona una opción para que la IA extraiga los valores exactos (subtotal, IVA, proveedor, fecha, etc.) y actualice el formulario:
              </p>

              {/* Tabs */}
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-emerald-200">
                <button
                  type="button"
                  onClick={() => setAttachTab('upload')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                    attachTab === 'upload'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir archivo</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAttachTab('drive');
                    loadDriveFilesForSelection();
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                    attachTab === 'drive'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <FolderSearch className="w-3.5 h-3.5" />
                  <span>Elegir de Drive</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAttachTab('link')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                    attachTab === 'link'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Enlace de Drive</span>
                </button>
              </div>

              {/* Tab 1: Upload directly */}
              {attachTab === 'upload' && (
                <div className="bg-white p-4 rounded-xl border border-dashed-2 border-emerald-300 text-center space-y-2">
                  <label
                    htmlFor="edit-modal-file-upload"
                    className="cursor-pointer flex flex-col items-center justify-center gap-1.5 py-2 group"
                  >
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 group-hover:scale-110 transition-transform">
                      {isReReading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5" />
                      )}
                    </div>
                    <span className="text-xs font-bold text-slate-800 group-hover:text-emerald-700">
                      {isReReading ? 'Procesando con IA...' : 'Haz clic para seleccionar o arrastra tu archivo'}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Formatos soportados: PDF, JPG, PNG, WEBP, XLSX
                    </span>
                  </label>
                  <input
                    id="edit-modal-file-upload"
                    type="file"
                    accept=".pdf,image/png,image/jpeg,image/webp,.xlsx,.csv"
                    onChange={handleDirectFileUpload}
                    disabled={isReReading}
                    className="hidden"
                  />
                </div>
              )}

              {/* Tab 2: Pick from Drive */}
              {attachTab === 'drive' && (
                <div className="bg-white p-3 rounded-xl border border-emerald-200 space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar archivo por nombre en Drive..."
                        value={driveSearchQuery}
                        onChange={(e) => setDriveSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            loadDriveFilesForSelection(driveSearchQuery);
                          }
                        }}
                        className="w-full text-xs pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => loadDriveFilesForSelection(driveSearchQuery)}
                      disabled={isSearchingDrive}
                      className="px-3 py-1.5 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {isSearchingDrive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Buscar'}
                    </button>
                  </div>

                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                    {isSearchingDrive ? (
                      <div className="p-4 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                        <span>Buscando archivos en Google Drive...</span>
                      </div>
                    ) : driveSearchResults.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500">
                        No se encontraron archivos en Drive. Puedes escribir otro término de búsqueda o subir el comprobante.
                      </div>
                    ) : (
                      driveSearchResults.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between p-2 hover:bg-emerald-50/50 transition-colors text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="font-medium text-slate-800 truncate" title={f.name}>
                              {f.name}
                            </span>
                            {f.sizeFormatted && (
                              <span className="text-[10px] text-slate-400 shrink-0">({f.sizeFormatted})</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setDriveFileUrl(f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`);
                              setFileName(f.name);
                              handleReReadInvoice(f.id, f.webViewLink, f.name);
                            }}
                            disabled={isReReading}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-semibold text-[11px] transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>Leer con IA</span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Paste Drive link */}
              {attachTab === 'link' && (
                <div className="bg-white p-3 rounded-xl border border-emerald-200 space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Pega el enlace web de Google Drive del comprobante:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      placeholder="https://drive.google.com/file/d/..."
                      value={customDriveUrlInput}
                      onChange={(e) => setCustomDriveUrlInput(e.target.value)}
                      className="flex-1 text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleCustomUrlAnalyze}
                      disabled={isReReading || !customDriveUrlInput.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                    >
                      {isReReading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      <span>Analizar</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section 1: Identification */}
          <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200/60 space-y-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-[#157a24]" />
              <span>Identificación del Comprobante</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Número de Factura / Folio
                </label>
                <div className="relative">
                  <Hash className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Ej. FAC-2024-001"
                    className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330] font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Fecha de Emisión
                </label>
                <div className="relative">
                  <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>
              </div>
            </div>

            {/* Nombre del Documento / Archivo */}
            <div className="pt-2 border-t border-slate-200/60">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  Nombre del Documento / Archivo:
                </label>
                {driveFileUrl && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-medium">
                    Se sincronizará en Google Drive y Sheets
                  </span>
                )}
              </div>
              <div className="relative">
                <FileText className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#157a24]" />
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="Ej. FACTURA 13 ARENA.pdf"
                  className="w-full bg-white border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Edita aquí el nombre si el documento se guardó incorrectamente. Se actualizará en tu hoja de cálculo y se renombrará el archivo en Google Drive.
              </p>
            </div>
          </div>

          {/* Section 2: Vendor & Concept */}
          <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200/60 space-y-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-[#157a24]" />
              <span>Emisor y Concepto</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Proveedor / Razón Social
                </label>
                <div className="relative">
                  <Building2 className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    placeholder="Ej. Hormigones y Cementos S.A."
                    className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  NIT / CIF / NIF / RUT
                </label>
                <input
                  type="text"
                  value={vendorTaxId}
                  onChange={(e) => setVendorTaxId(e.target.value)}
                  placeholder="Ej. B-12345678"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330] font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Concepto / Detalle de la Partida
                </label>
                <input
                  type="text"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="Ej. Suministro de vigas de acero estructural"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Categoría de Obra
                </label>
                <div className="relative">
                  <Tag className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ConstructionCategory)}
                    className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  >
                    {CONSTRUCTION_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Optional Unit and Quantity */}
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Cantidad (opcional)
                </label>
                <input
                  type="number"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Ej. 10"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330] font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Precio Unitario (opcional)
                </label>
                <input
                  type="number"
                  step="any"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="Ej. 150.00"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330] font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Amounts & Taxes */}
          <div className="bg-emerald-50/40 p-4 rounded-xl border border-emerald-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-[#157a24]" />
                <span>Desglose Económico</span>
              </h4>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleRecalculateTotal(21)}
                  className="text-[10px] font-semibold text-emerald-700 bg-emerald-100/80 hover:bg-emerald-200 px-2 py-0.5 rounded transition-colors cursor-pointer"
                  title="Calcular 21% de IVA sobre Subtotal"
                >
                  Calc. IVA 21%
                </button>
                <button
                  type="button"
                  onClick={() => handleRecalculateTotal(19)}
                  className="text-[10px] font-semibold text-emerald-700 bg-emerald-100/80 hover:bg-emerald-200 px-2 py-0.5 rounded transition-colors cursor-pointer"
                  title="Calcular 19% de IVA sobre Subtotal"
                >
                  Calc. IVA 19%
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subtotal
                </label>
                <div className="relative">
                  <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    step="0.01"
                    value={subtotal || ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = raw === '' ? 0 : parseFloat(raw) || 0;
                      setSubtotal(raw === '' ? ('' as any) : val);
                      setTotalAmount(Math.round(((val || 0) + (Number(taxAmount) || 0)) * 100) / 100);
                    }}
                    placeholder="0.00"
                    className="w-full bg-white border border-slate-200 rounded-xl pl-7 pr-3 py-1.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  IVA / Impuestos
                </label>
                <div className="relative">
                  <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    step="0.01"
                    value={taxAmount || ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = raw === '' ? 0 : parseFloat(raw) || 0;
                      setTaxAmount(raw === '' ? ('' as any) : val);
                      setTotalAmount(Math.round(((Number(subtotal) || 0) + (val || 0)) * 100) / 100);
                    }}
                    placeholder="0.00"
                    className="w-full bg-white border border-slate-200 rounded-xl pl-7 pr-3 py-1.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-emerald-950 mb-1">
                  Total a Pagar
                </label>
                <div className="relative">
                  <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-600" />
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={totalAmount || ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setTotalAmount(raw === '' ? ('' as any) : parseFloat(raw) || 0);
                    }}
                    placeholder="0.00"
                    className="w-full bg-white border-2 border-emerald-300 rounded-xl pl-7 pr-3 py-1.5 text-xs font-bold font-mono text-emerald-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Drive file and evidence bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 bg-slate-50/90 rounded-xl border border-slate-200 text-xs shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-slate-600 truncate max-w-[260px] sm:max-w-[340px]">
                {fileName || driveFileUrl ? (
                  <>
                    Comprobante: <strong className="text-slate-800">{fileName || 'Archivo vinculado'}</strong>
                  </>
                ) : (
                  <span className="text-slate-400 italic">Sin comprobante digital vinculado</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowAttachPanel(!showAttachPanel)}
                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors shrink-0 cursor-pointer"
                title="Cambiar o vincular un comprobante en Google Drive"
              >
                <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                <span>{driveFileUrl ? 'Cambiar archivo' : 'Vincular comprobante'}</span>
              </button>

              {driveFileUrl && (
                <a
                  href={driveFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors shrink-0"
                >
                  <span>Ver en Drive</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/70">
          <p className="text-[11px] text-slate-500">
            Se actualizará la Fila #{invoice.rowIndex} en Google Sheets.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving || isReReading}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              id="btn-save-invoice-edit"
              onClick={handleSubmit}
              disabled={isSaving || isReReading}
              className="inline-flex items-center gap-2 bg-[#1ca330] hover:bg-[#157a24] text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-md active:scale-95 disabled:opacity-60 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Actualizando en Sheets...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Guardar Cambios</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
