import React, { useState, useEffect } from 'react';
import { SheetTabInfo } from '../types';
import {
  renameDriveFile,
  updateTabHeaders,
  getSpreadsheetTabs,
  getTabHeaders,
} from '../services/googleDriveSheets';
import {
  FileSpreadsheet,
  X,
  Sliders,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  RotateCcw,
  ExternalLink,
  Save,
  Table,
  Pencil,
  FileEdit,
} from 'lucide-react';

export const DEFAULT_FACTURACION_COLUMNS = [
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

export interface EditFacturacionModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string;
  spreadsheet: {
    id: string;
    name: string;
    webViewLink?: string;
  } | null;
  activeTab?: string;
  detectedTabs?: SheetTabInfo[];
  currentHeaders?: string[];
  onSpreadsheetRenamed?: (newTitle: string) => void;
  onHeadersUpdated?: (newHeaders: string[], tabTitle: string) => void;
}

export const EditFacturacionModal: React.FC<EditFacturacionModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  spreadsheet,
  activeTab,
  detectedTabs = [],
  currentHeaders = [],
  onSpreadsheetRenamed,
  onHeadersUpdated,
}) => {
  // Rename state
  const [sheetName, setSheetName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameSuccess, setRenameSuccess] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Tabs state
  const [tabs, setTabs] = useState<SheetTabInfo[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);

  // Columns / headers state
  const [columns, setColumns] = useState<string[]>([]);
  const [newColInput, setNewColInput] = useState('');
  const [isSavingHeaders, setIsSavingHeaders] = useState(false);
  const [headersSuccess, setHeadersSuccess] = useState<string | null>(null);
  const [headersError, setHeadersError] = useState<string | null>(null);

  // Initialize data on open
  useEffect(() => {
    if (!isOpen || !spreadsheet) return;

    setSheetName(spreadsheet.name || '');
    setRenameSuccess(null);
    setRenameError(null);
    setHeadersSuccess(null);
    setHeadersError(null);
    setNewColInput('');

    // Initialize tabs
    if (detectedTabs.length > 0) {
      setTabs(detectedTabs);
      setSelectedTab(activeTab || detectedTabs[0].title || 'Hoja 1');
    } else {
      setSelectedTab(activeTab || 'Hoja 1');
    }

    // Initialize columns
    if (currentHeaders && currentHeaders.length > 0) {
      setColumns([...currentHeaders]);
    } else {
      setColumns([...DEFAULT_FACTURACION_COLUMNS]);
    }

    // If tabs are empty but we have an ID, fetch them
    if (spreadsheet.id && accessToken && detectedTabs.length === 0) {
      setIsLoadingTabs(true);
      getSpreadsheetTabs(accessToken, spreadsheet.id)
        .then((fetchedTabs) => {
          if (fetchedTabs && fetchedTabs.length > 0) {
            setTabs(fetchedTabs);
            const targetTab = activeTab || fetchedTabs[0].title;
            setSelectedTab(targetTab);
            // Also fetch headers for this tab if we don't have them
            if (!currentHeaders || currentHeaders.length === 0) {
              return getTabHeaders(accessToken, spreadsheet.id, targetTab).then((hdrs) => {
                if (hdrs && hdrs.length > 0) {
                  setColumns(hdrs);
                }
              });
            }
          }
        })
        .catch((err) => {
          console.warn('Error fetching tabs in EditFacturacionModal:', err);
        })
        .finally(() => {
          setIsLoadingTabs(false);
        });
    }
  }, [isOpen, spreadsheet?.id, spreadsheet?.name, accessToken, activeTab, detectedTabs, currentHeaders]);

  // When switching tabs inside the modal, load that tab's headers
  const handleSelectTab = async (tabTitle: string) => {
    setSelectedTab(tabTitle);
    setHeadersSuccess(null);
    setHeadersError(null);
    if (!spreadsheet?.id || !accessToken) return;

    try {
      setIsLoadingTabs(true);
      const hdrs = await getTabHeaders(accessToken, spreadsheet.id, tabTitle);
      if (hdrs && hdrs.length > 0) {
        setColumns(hdrs);
      } else {
        setColumns([...DEFAULT_FACTURACION_COLUMNS]);
      }
    } catch (err) {
      console.warn('Error loading tab headers:', err);
    } finally {
      setIsLoadingTabs(false);
    }
  };

  if (!isOpen || !spreadsheet) return null;

  const handleSaveRename = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = sheetName.trim();
    if (!trimmed) {
      setRenameError('El nombre no puede estar vacío.');
      return;
    }
    if (!accessToken || !spreadsheet.id) return;

    setIsRenaming(true);
    setRenameError(null);
    setRenameSuccess(null);

    try {
      await renameDriveFile(accessToken, spreadsheet.id, trimmed);
      setRenameSuccess(`¡Nombre actualizado exitosamente a "${trimmed}" en Google Drive!`);
      if (onSpreadsheetRenamed) {
        onSpreadsheetRenamed(trimmed);
      }
      setTimeout(() => setRenameSuccess(null), 4000);
    } catch (err: any) {
      setRenameError(err?.message || 'Error al renombrar el archivo en Google Drive.');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleAddColumn = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newColInput.trim();
    if (!trimmed) return;
    if (columns.includes(trimmed)) {
      setHeadersError(`La columna "${trimmed}" ya existe en la lista.`);
      return;
    }
    setColumns([...columns, trimmed]);
    setNewColInput('');
    setHeadersError(null);
  };

  const handleRemoveColumn = (idx: number) => {
    setColumns(columns.filter((_, i) => i !== idx));
  };

  const handleResetDefaults = () => {
    setColumns([...DEFAULT_FACTURACION_COLUMNS]);
    setHeadersSuccess(null);
    setHeadersError(null);
  };

  const handleSaveHeaders = async () => {
    if (!accessToken || !spreadsheet.id) return;
    if (columns.length === 0) {
      setHeadersError('Debes tener al menos una columna definida.');
      return;
    }

    const targetTab = selectedTab || tabs[0]?.title || 'Hoja 1';
    setIsSavingHeaders(true);
    setHeadersError(null);
    setHeadersSuccess(null);

    try {
      const ok = await updateTabHeaders(accessToken, spreadsheet.id, targetTab, columns);
      if (ok) {
        setHeadersSuccess(`¡Columnas contables actualizadas en la pestaña "${targetTab}"!`);
        if (onHeadersUpdated) {
          onHeadersUpdated(columns, targetTab);
        }
        setTimeout(() => setHeadersSuccess(null), 4000);
      } else {
        setHeadersError('No se pudieron actualizar los encabezados en Google Sheets.');
      }
    } catch (err: any) {
      setHeadersError(err?.message || 'Error al guardar los encabezados en la hoja.');
    } finally {
      setIsSavingHeaders(false);
    }
  };

  return (
    <div
      id="edit-facturacion-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto"
    >
      <div
        id="edit-facturacion-modal"
        className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
              <Sliders className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                  Edición de Facturación
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                  Google Sheets
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate mt-0.5" title={spreadsheet.name}>
                Ajusta el nombre oficial del archivo en Drive y las columnas de registro contable.
              </p>
            </div>
          </div>

          <button
            id="btn-close-edit-facturacion-modal"
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Cerrar modal (x)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Section 1: Renombrar Hoja en Google Drive */}
          <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>1. Nombre del Archivo en Google Drive:</span>
              </label>

              {spreadsheet.webViewLink && (
                <a
                  href={spreadsheet.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 transition-colors"
                  title="Abrir hoja directamente en Google Sheets"
                >
                  <span>Abrir en Sheets</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <form onSubmit={handleSaveRename} className="flex flex-col sm:flex-row gap-2">
              <input
                id="input-rename-sheet-facturacion"
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Nombre de la hoja de cálculo..."
                className="flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                id="btn-save-rename-facturacion-sheet"
                type="submit"
                disabled={isRenaming || !sheetName.trim() || sheetName.trim() === spreadsheet.name}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold shadow-2xs transition-all disabled:opacity-50 cursor-pointer active:scale-95 whitespace-nowrap"
              >
                {isRenaming ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando en Drive...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Renombrar en Drive</span>
                  </>
                )}
              </button>
            </form>

            {renameSuccess && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{renameSuccess}</span>
              </div>
            )}

            {renameError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{renameError}</span>
              </div>
            )}
          </div>

          {/* Section 2: Pestaña de Destino */}
          {tabs.length > 1 && (
            <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Table className="w-4 h-4 text-emerald-600" />
                  <span>2. Pestaña de Destino:</span>
                </label>
                <span className="text-[10px] text-slate-500 font-medium">
                  {tabs.length} pestañas detectadas
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {tabs.map((tab) => {
                  const isActive = selectedTab === tab.title;
                  return (
                    <button
                      key={tab.sheetId}
                      type="button"
                      onClick={() => handleSelectTab(tab.title)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs ring-2 ring-emerald-200'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {tab.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 3: Columnas Contables de Facturación */}
          <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-emerald-600" />
                  <span>{tabs.length > 1 ? '3.' : '2.'} Columnas de Registro Contable:</span>
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Pestaña activa: <strong className="text-slate-800">{selectedTab || 'Hoja 1'}</strong>. Las facturas procesadas se registrarán siguiendo este orden de columnas.
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetDefaults}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
                title="Restaurar las columnas oficiales estándar de facturación contable"
              >
                <RotateCcw className="w-3 h-3 text-slate-500" />
                <span>Restaurar Estándar</span>
              </button>
            </div>

            {/* Column Chips List */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Columnas actuales ({columns.length}):
              </span>

              {isLoadingTabs ? (
                <div className="p-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  <span>Consultando encabezados de la pestaña...</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2 bg-white rounded-xl border border-slate-200">
                  {columns.map((col, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-950 border border-emerald-200 text-xs font-medium shadow-2xs group"
                    >
                      <span className="text-[10px] font-mono text-emerald-600 font-bold">
                        #{idx + 1}
                      </span>
                      <span>{col}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(idx)}
                        className="text-slate-400 hover:text-rose-600 p-0.5 rounded transition-colors cursor-pointer"
                        title={`Eliminar columna "${col}"`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {columns.length === 0 && (
                    <p className="text-xs text-slate-400 italic p-2">
                      No hay columnas definidas. Añade al menos una columna o pulsa "Restaurar Estándar".
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Add Column Input Form */}
            <form onSubmit={handleAddColumn} className="flex gap-2">
              <input
                id="input-new-facturacion-column"
                type="text"
                value={newColInput}
                onChange={(e) => setNewColInput(e.target.value)}
                placeholder="Nombre de nueva columna (ej: Centro de Costos, Obra, etc.)..."
                className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                id="btn-add-facturacion-column"
                type="submit"
                disabled={!newColInput.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl border border-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Añadir</span>
              </button>
            </form>

            {/* Save Headers Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-t border-slate-200">
              <span className="text-[11px] text-slate-500">
                Se actualizará la primera fila (Fila 1) de la hoja en Google Sheets.
              </span>
              <button
                id="btn-save-facturacion-headers"
                type="button"
                onClick={handleSaveHeaders}
                disabled={isSavingHeaders || columns.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-2xs transition-all disabled:opacity-50 cursor-pointer active:scale-95"
              >
                {isSavingHeaders ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando en Google Sheets...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Guardar Columnas en Sheets</span>
                  </>
                )}
              </button>
            </div>

            {headersSuccess && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{headersSuccess}</span>
              </div>
            )}

            {headersError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{headersError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Los cambios se guardan directamente en tu cuenta de Google.</span>
          </div>

          <button
            id="btn-done-edit-facturacion"
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shadow-xs cursor-pointer active:scale-95"
          >
            Listo / Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
