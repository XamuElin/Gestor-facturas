import React, { useState } from 'react';
import { InvoiceData, CONSTRUCTION_CATEGORIES, ConstructionCategory, ProjectFolder } from '../types';
import { buildProjectSpreadsheetTitle } from '../utils/duplicateChecker';
import {
  FileSpreadsheet,
  FolderOpen,
  CheckCircle2,
  X,
  AlertCircle,
  Sparkles,
  Calculator,
  ArrowRight,
  ShieldCheck,
  Loader2,
  Minus,
  Maximize2,
  Minimize2,
  FileText,
  PackagePlus,
  Package,
  Check,
} from 'lucide-react';

interface InvoiceReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (confirmedData: InvoiceData & { fileName?: string }) => Promise<void>;
  initialData: InvoiceData;
  project: ProjectFolder;
  fileName: string;
  isSaving: boolean;
  onAddToInventory?: (itemData: {
    nombre: string;
    cantidad: number;
    unidad: string;
    facturaVinculada: string;
  }) => void;
}

export const InvoiceReviewModal: React.FC<InvoiceReviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialData,
  project,
  fileName,
  isSaving,
  onAddToInventory,
}) => {
  const [formData, setFormData] = useState<InvoiceData>({ ...initialData });
  const [editableFileName, setEditableFileName] = useState<string>(
    fileName || (initialData as any).fileName || ''
  );
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [addedItems, setAddedItems] = useState<Record<string, boolean>>({});

  const handleAddItemToInventory = (itemDesc: string, qty: number, idxKey: string) => {
    if (!onAddToInventory) return;
    onAddToInventory({
      nombre: itemDesc,
      cantidad: Math.max(1, qty || 1),
      unidad: 'UN',
      facturaVinculada: editableFileName || formData.invoiceNumber || 'Factura leída',
    });
    setAddedItems((prev) => ({ ...prev, [idxKey]: true }));
  };

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#1ca330]/20 text-[#98d52c]">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold truncate max-w-[200px]">
              {formData.vendorName || fileName || 'Revisión Factura'}
            </span>
            <span className="text-[10px] text-slate-400">Revisión minimizada</span>
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

  const modalContainerClasses =
    'fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150';

  const modalBoxClasses =
    'w-full md:max-w-3xl h-[90vh] md:h-auto md:max-h-[90vh] bg-white rounded-t-[20px] md:rounded-[18px] border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 md:zoom-in-95 duration-200';

  const handleChange = (field: keyof InvoiceData, value: any) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };

      // Auto re-calculate total if subtotal or tax changes
      if (field === 'subtotal' || field === 'taxAmount') {
        const sub = field === 'subtotal' ? Number(value) || 0 : Number(prev.subtotal) || 0;
        const tax = field === 'taxAmount' ? Number(value) || 0 : Number(prev.taxAmount) || 0;
        updated.totalAmount = Math.round((sub + tax) * 100) / 100;
      }
      return updated;
    });
  };

  const handleRecalculateTaxRate = (percent: number) => {
    const sub = Number(formData.subtotal) || 0;
    const tax = Math.round(sub * (percent / 100) * 100) / 100;
    const tot = Math.round((sub + tax) * 100) / 100;
    setFormData((prev) => ({
      ...prev,
      taxRatePercent: percent,
      taxAmount: tax,
      totalAmount: tot,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalDocName = editableFileName.trim() || fileName;
    await onConfirm({
      ...formData,
      fileName: finalDocName,
    });
  };

  return (
    <div className={modalContainerClasses}>
      <div className={modalBoxClasses}>
        {/* Modal Header with window controls */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#1ca330]/10 text-[#157a24]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  Confirmación de Registro en Drive &amp; Sheets
                </h3>
                {isFullscreen && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hidden sm:inline-block">
                    Página Completa
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Revisa y ajusta los datos extraídos por la IA antes de guardarlos en tu Google Workspace.
              </p>
            </div>
          </div>

          {/* Window Control Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              id="btn-minimize-invoice-review-tab"
              onClick={() => setIsMinimized(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
              title="Minimizar pestaña (-)"
            >
              <Minus className="w-5 h-5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              id="btn-toggle-fullscreen-invoice-review-tab"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors hidden sm:inline-flex cursor-pointer"
              title={isFullscreen ? 'Restaurar tamaño ventana' : 'Abrir en página completa'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              id="btn-close-invoice-review-tab"
              onClick={onClose}
              disabled={isSaving}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              title="Cerrar pestaña (x)"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Modal Body with Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl w-full mx-auto">
          {/* Destination Notification Banner */}
          <div className="bg-[#1ca330]/5 border border-[#1ca330]/20 rounded-xl p-3.5 text-xs text-slate-800 space-y-2">
            <div className="font-semibold flex items-center gap-1.5 text-[#157a24]">
              <Sparkles className="w-4 h-4 text-[#1ca330]" /> Destino de la automatización en Google:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 bg-white/80 p-2 rounded-lg border border-slate-200">
                <FolderOpen className="w-4 h-4 text-[#1ca330] shrink-0" />
                <div className="truncate">
                  <span className="text-[10px] text-slate-500 block">Carpeta de Evidencias (Drive):</span>
                  <span className="font-semibold text-slate-800 truncate block">
                    {project.evidenceFolderName || project.name}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-white/80 p-2 rounded-lg border border-slate-200">
                <FileSpreadsheet className="w-4 h-4 text-[#1ca330] shrink-0" />
                <div className="truncate">
                  <span className="text-[10px] text-slate-500 block">Hoja de Cálculo (Sheets):</span>
                  <span className="font-semibold text-slate-800 truncate block">
                    {project.spreadsheetName || buildProjectSpreadsheetTitle(project.name)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Nombre del Documento / Archivo (Permite corregir si se guardó con nombre equivocado) */}
          <div className="bg-white border-2 border-emerald-400/80 rounded-2xl p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#157a24]" />
                <span>Nombre del Documento / Archivo de la Factura:</span>
              </label>
              <span className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 font-bold px-2.5 py-0.5 rounded-full">
                Editable
              </span>
            </div>
            <div className="relative">
              <input
                id="input-review-file-name"
                type="text"
                required
                value={editableFileName}
                onChange={(e) => setEditableFileName(e.target.value)}
                placeholder="Ej. FACTURA 13 ARENA Y CEMENTO.pdf"
                className="w-full bg-slate-50/80 hover:bg-white focus:bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330] transition-colors"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Puedes corregir el nombre aquí antes de confirmar. Se guardará con este nombre exacto en Google Drive y quedará registrado en tu hoja de Google Sheets.
            </p>
          </div>

          {/* Form Fields Grid */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Proveedor */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Proveedor / Razón Social:
                </label>
                <input
                  type="text"
                  required
                  value={formData.vendorName}
                  onChange={(e) => handleChange('vendorName', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* CIF / NIF */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  CIF / NIF del Emisor:
                </label>
                <input
                  type="text"
                  value={formData.vendorTaxId}
                  onChange={(e) => handleChange('vendorTaxId', e.target.value)}
                  placeholder="Ej: B-12345678"
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Nº Factura */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Número de Factura:
                </label>
                <input
                  type="text"
                  required
                  value={formData.invoiceNumber}
                  onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Fecha de Emisión:
                </label>
                <input
                  type="text"
                  value={formData.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  placeholder="YYYY-MM-DD"
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Concepto / Detalle */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Concepto / Descripción del Trabajo o Material:
                </label>
                {onAddToInventory && formData.concept && (
                  <button
                    type="button"
                    onClick={() => handleAddItemToInventory(formData.concept, 1, 'concept-main')}
                    disabled={addedItems['concept-main']}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0F766E] hover:text-[#0d655f] bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-lg border border-teal-200 transition-colors"
                  >
                    {addedItems['concept-main'] ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Agregado a inventario</span>
                      </>
                    ) : (
                      <>
                        <PackagePlus className="w-3.5 h-3.5" />
                        <span>Agregar concepto a inventario</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                value={formData.concept}
                onChange={(e) => handleChange('concept', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Partidas / Ítems detectados por la IA con botón Agregar a inventario */}
            {formData.items && formData.items.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-[#0F766E]" />
                    <span>Partidas detectadas en la factura ({formData.items.length})</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium">
                    Pulsa para ingresar directo a tu inventario de obra
                  </span>
                </div>
                <div className="divide-y divide-slate-200/80 max-h-48 overflow-y-auto pr-1">
                  {formData.items.map((item, idx) => {
                    const key = `item-${idx}`;
                    const isAdded = !!addedItems[key];
                    return (
                      <div
                        key={idx}
                        className="py-2 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {item.description}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            {item.quantity !== undefined && (
                              <span>Cant: {item.quantity}</span>
                            )}
                            {item.unitPrice !== undefined && (
                              <span>P. Unit: ${Number(item.unitPrice).toLocaleString('es-CO')}</span>
                            )}
                            {item.total !== undefined && (
                              <span className="font-bold text-slate-700">
                                Total: ${Number(item.total).toLocaleString('es-CO')}
                              </span>
                            )}
                          </div>
                        </div>

                        {onAddToInventory && (
                          <button
                            type="button"
                            onClick={() =>
                              handleAddItemToInventory(
                                item.description,
                                item.quantity || 1,
                                key
                              )
                            }
                            disabled={isAdded}
                            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              isAdded
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-[#0F766E]/10 hover:bg-[#0F766E]/20 text-[#0F766E] border border-[#0F766E]/30 cursor-pointer active:scale-95'
                            }`}
                          >
                            {isAdded ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Agregado</span>
                              </>
                            ) : (
                              <>
                                <PackagePlus className="w-3.5 h-3.5" />
                                <span>+ Inventario</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Categoría de Obra */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Categoría de Gasto de Obra:
              </label>
              <select
                value={formData.category}
                onChange={(e) =>
                  handleChange('category', e.target.value as ConstructionCategory)
                }
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
              >
                {CONSTRUCTION_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Importes Financieros */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-sky-600" /> Desglose Económico
                </span>
                <div className="flex gap-1 text-[11px]">
                  <span className="text-slate-400">Atajos IVA:</span>
                  <button
                    type="button"
                    onClick={() => handleRecalculateTaxRate(21)}
                    className="px-1.5 py-0.5 bg-white border border-slate-300 rounded hover:bg-sky-50 text-slate-700"
                  >
                    21%
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRecalculateTaxRate(10)}
                    className="px-1.5 py-0.5 bg-white border border-slate-300 rounded hover:bg-sky-50 text-slate-700"
                  >
                    10%
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRecalculateTaxRate(0)}
                    className="px-1.5 py-0.5 bg-white border border-slate-300 rounded hover:bg-sky-50 text-slate-700"
                  >
                    0%
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Base */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Base Imponible ($):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.subtotal !== undefined && formData.subtotal !== null ? formData.subtotal : ''}
                    placeholder="0.00"
                    onChange={(e) => {
                      const v = e.target.value;
                      handleChange('subtotal', v === '' ? ('' as any) : parseFloat(v) || 0);
                    }}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold"
                  />
                </div>

                {/* IVA */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    IVA / Impuesto ($):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.taxAmount !== undefined && formData.taxAmount !== null ? formData.taxAmount : ''}
                    placeholder="0.00"
                    onChange={(e) => {
                      const v = e.target.value;
                      handleChange('taxAmount', v === '' ? ('' as any) : parseFloat(v) || 0);
                    }}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold"
                  />
                </div>

                {/* Total */}
                <div>
                  <label className="block text-[11px] font-bold text-sky-900 mb-1">
                    Total Factura ($):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.totalAmount !== undefined && formData.totalAmount !== null ? formData.totalAmount : ''}
                    placeholder="0.00"
                    onChange={(e) => {
                      const v = e.target.value;
                      handleChange('totalAmount', v === '' ? ('' as any) : parseFloat(v) || 0);
                    }}
                    className="w-full bg-sky-50 border border-sky-300 text-sky-900 font-bold rounded-lg px-3 py-1.5 text-xs focus:ring-sky-500"
                  />
                </div>
              </div>
            </div>

            {formData.confidenceNotes && (
              <p className="text-[11px] text-slate-500 italic">
                Nota de IA: {formData.confidenceNotes}
              </p>
            )}
          </div>

          {/* Explicit User Confirmation Statement */}
          <div className="text-[11px] text-slate-500 bg-slate-100 p-2.5 rounded-lg border border-slate-200">
            Al pulsar "Confirmar y Subir", la imagen se guardará en la carpeta seleccionada de tu Google Drive y se insertará automáticamente una nueva fila con estos datos en la hoja de cálculo de la obra.
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              id="btn-cancel-review"
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="h-12 px-5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-[14px] transition-colors touch-target-48"
            >
              Cancelar
            </button>
            <button
              id="btn-confirm-upload"
              type="submit"
              disabled={isSaving}
              className="h-12 inline-flex items-center gap-2 bg-[#0F766E] hover:bg-[#0d655f] text-white font-bold text-xs px-6 rounded-[14px] shadow-sm transition-all active:scale-95 disabled:opacity-60 touch-target-48 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Guardando en Drive y Sheets...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirmar y Guardar en Sheets</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
