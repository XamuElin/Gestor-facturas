import React, { useState, useMemo } from 'react';
import {
  Receipt,
  Plus,
  Search,
  Calendar,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Pencil,
  UploadCloud,
  X,
  PackagePlus,
  ArrowUpDown,
  CheckSquare,
  Square,
  DollarSign,
  AlertCircle,
  ChevronDown,
  FolderOpen,
  Sparkles,
  Loader2,
} from 'lucide-react';
import {
  FacturaSismoItem,
  calculateTotalMateriales,
  countFacturasFaltantes,
  countFacturasPorRevisar,
  generateUUID,
} from '../utils/constructionCalculations';
import { formatCOP, formatDateCO } from '../utils/formatters';
import { ProjectFolder } from '../types';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

interface FacturasSismoSectionProps {
  project: ProjectFolder | null;
  facturas: FacturaSismoItem[];
  onSaveFactura: (factura: FacturaSismoItem) => Promise<void>;
  onDeleteFactura: (facturaId: string) => Promise<void>;
  onDeleteMultipleFacturas?: (ids: string[]) => Promise<void>;
  onOpenUploadScanModal: () => void;
  onOpenDriveScanModal?: () => void;
  onAddToInventory?: (item: { nombre: string; cantidad: number; unidad: string; facturaVinculada: string }) => void;
}

export const FacturasSismoSection: React.FC<FacturasSismoSectionProps> = ({
  project,
  facturas,
  onSaveFactura,
  onDeleteFactura,
  onDeleteMultipleFacturas,
  onOpenUploadScanModal,
  onOpenDriveScanModal,
  onAddToInventory,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'todas' | 'por_revisar' | 'falta_factura' | 'pagado'>('todas');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Modal / Bottom sheet de edición o creación manual
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFactura, setEditingFactura] = useState<FacturaSismoItem | null>(null);

  // Form states
  const [concepto, setConcepto] = useState('');
  const [costo, setCosto] = useState<number>(0);
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0]);
  const [observacion, setObservacion] = useState('PAGADO');
  const [estado, setEstado] = useState<FacturaSismoItem['estado']>('pagado');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Confirm delete dialog states
  const [itemToDelete, setItemToDelete] = useState<FacturaSismoItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Batch selection states
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false);

  // AI Menu states
  const [isAiMenuOpen, setIsAiMenuOpen] = useState(false);
  const [isReadingSelectedAi, setIsReadingSelectedAi] = useState(false);

  const handleReadSelectedAi = async () => {
    if (selectedIds.size === 0) return;
    setIsReadingSelectedAi(true);
    try {
      onOpenUploadScanModal();
    } finally {
      setIsReadingSelectedAi(false);
      setIsAiMenuOpen(false);
    }
  };

  // Totales
  const totalMateriales = useMemo(() => calculateTotalMateriales(facturas), [facturas]);
  const facturasFaltantesCount = useMemo(() => countFacturasFaltantes(facturas), [facturas]);
  const facturasPorRevisarCount = useMemo(() => countFacturasPorRevisar(facturas), [facturas]);

  // Filtrado y orden
  const filteredFacturas = useMemo(() => {
    return facturas
      .filter((f) => {
        const matchesSearch =
          !searchTerm ||
          f.concepto.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (f.observacion || '').toLowerCase().includes(searchTerm.toLowerCase());

        let matchesFilter = true;
        if (selectedFilter === 'por_revisar') {
          matchesFilter = f.estado === 'por_revisar';
        } else if (selectedFilter === 'falta_factura') {
          matchesFilter =
            f.estado === 'falta_factura' ||
            (f.observacion || '').toUpperCase().includes('FALTA FACTURA') ||
            !f.facturaVinculada?.url;
        } else if (selectedFilter === 'pagado') {
          matchesFilter =
            f.estado === 'pagado' ||
            (f.observacion || '').toUpperCase().includes('PAGADO');
        }

        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        const diff = (b.fecha || '').localeCompare(a.fecha || '');
        return sortOrder === 'desc' ? diff : -diff;
      });
  }, [facturas, searchTerm, selectedFilter, sortOrder]);

  const openNewGasto = () => {
    setEditingFactura(null);
    setConcepto('');
    setCosto(0);
    setFecha(new Date().toISOString().split('T')[0]);
    setObservacion('FALTA FACTURA');
    setEstado('falta_factura');
    setFileUrl('');
    setFileName('');
    setFormError(null);
    setSaveSuccess(false);
    setIsModalOpen(true);
  };

  const openEditGasto = (f: FacturaSismoItem) => {
    setEditingFactura(f);
    setConcepto(f.concepto);
    setCosto(f.costo);
    setFecha(f.fecha);
    setObservacion(f.observacion || 'PAGADO');
    setEstado(f.estado);
    setFileUrl(f.facturaVinculada?.url || f.facturaVinculada?.webViewLink || '');
    setFileName(f.facturaVinculada?.fileName || '');
    setFormError(null);
    setSaveSuccess(false);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concepto.trim()) {
      setFormError('El concepto del gasto es obligatorio');
      return;
    }
    const rawVal = Number(costo) || 0;
    if (rawVal <= 0) {
      setFormError('El costo debe ser mayor a 0');
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      const nextConsecutivo = editingFactura
        ? editingFactura.consecutivo
        : facturas.reduce((max, item) => Math.max(max, item.consecutivo || 0), 0) + 1;

      let determinedEstado: FacturaSismoItem['estado'] = estado;
      if (observacion.toUpperCase().includes('FALTA FACTURA') && !fileUrl) {
        determinedEstado = 'falta_factura';
      } else if (determinedEstado === 'falta_factura' && fileUrl) {
        determinedEstado = 'pagado';
      }

      const item: FacturaSismoItem = {
        id: editingFactura ? editingFactura.id : generateUUID(),
        obraId: project?.id,
        origen: editingFactura?.origen || 'manual',
        creadoEn: editingFactura?.creadoEn || Date.now(),
        actualizadoEn: Date.now(),
        consecutivo: nextConsecutivo,
        concepto: concepto.trim().toUpperCase(),
        costo: rawVal,
        fecha: fecha || new Date().toISOString().split('T')[0],
        observacion: observacion.trim(),
        estado: determinedEstado,
        facturaVinculada: fileUrl
          ? {
              url: fileUrl,
              webViewLink: fileUrl,
              fileName: fileName || `Factura #${nextConsecutivo}`,
            }
          : undefined,
      };

      await onSaveFactura(item);
      setSaveSuccess(true);
      setTimeout(() => {
        setIsModalOpen(false);
        setEditingFactura(null);
        setSaveSuccess(false);
      }, 700);
    } catch (err: any) {
      setFormError(err?.message || 'Error al guardar el gasto');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmInvoice = async (f: FacturaSismoItem) => {
    const confirmed: FacturaSismoItem = {
      ...f,
      estado: 'confirmada',
      observacion: f.observacion === 'POR REVISAR' ? 'PAGADO' : f.observacion,
      actualizadoEn: Date.now(),
    };
    await onSaveFactura(confirmed);
  };

  const handleConfirmSingleDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteFactura(itemToDelete.id);
      setItemToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar la factura. No se pudo completar la operación.');
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredFacturas.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredFacturas.map((f) => f.id)));
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const ids = Array.from(selectedIds);
      if (onDeleteMultipleFacturas) {
        await onDeleteMultipleFacturas(ids);
      } else {
        for (const id of ids) {
          await onDeleteFactura(id);
        }
      }
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setIsBatchDeleteDialogOpen(false);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar las facturas seleccionadas.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 pb-36 sm:pb-16">
      {deleteError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
            <span>{deleteError}</span>
          </div>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="p-1 text-rose-600 hover:text-rose-900 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* 1. Header con Resumen de Métricas */}
      <div className="bg-white p-4 sm:p-5 rounded-[14px] border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Facturas y Gastos de Obra</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-[#0F766E] border border-teal-200">
                Pestaña ADECUACIONES SISMO
              </span>
            </div>
            <p className="text-xs text-[#64748B]">
              Control de comprobantes en <strong className="text-slate-800">{project?.name || 'la obra'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {facturas.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsSelectionMode(!isSelectionMode);
                setSelectedIds(new Set());
              }}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all min-h-[44px] flex items-center gap-1.5 ${
                isSelectionMode
                  ? 'bg-slate-200 text-slate-800'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>{isSelectionMode ? 'Cancelar Selección' : 'Seleccionar'}</span>
            </button>
          )}

          {/* Menú desplegable Leer con IA (Gemini) */}
          <div className="relative">
            <button
              type="button"
              id="btn-subir-facturas-ia"
              onClick={() => setIsAiMenuOpen(!isAiMenuOpen)}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[14px] bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-2xs cursor-pointer min-h-[44px]"
              aria-expanded={isAiMenuOpen}
              aria-haspopup="true"
            >
              <UploadCloud className="w-4 h-4 text-emerald-400" />
              <span>Leer con IA (Gemini)</span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isAiMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isAiMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsAiMenuOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 z-40 p-2 space-y-1 animate-in fade-in zoom-in-95">
                  <button
                    type="button"
                    id="btn-ai-option-drive"
                    onClick={() => {
                      setIsAiMenuOpen(false);
                      if (onOpenDriveScanModal) {
                        onOpenDriveScanModal();
                      } else {
                        onOpenUploadScanModal();
                      }
                    }}
                    className="w-full flex items-start gap-3 p-3 rounded-xl text-left hover:bg-slate-50 transition-colors min-h-[44px] cursor-pointer"
                  >
                    <FolderOpen className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-slate-900">Leer carpeta de la obra en Drive</p>
                      <p className="text-[11px] text-slate-500">Detecta automáticamente imágenes y PDFs en la nube</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="btn-ai-option-local"
                    onClick={() => {
                      setIsAiMenuOpen(false);
                      onOpenUploadScanModal();
                    }}
                    className="w-full flex items-start gap-3 p-3 rounded-xl text-left hover:bg-slate-50 transition-colors min-h-[44px] cursor-pointer"
                  >
                    <UploadCloud className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-slate-900">Elegir archivos de mi celular o computador</p>
                      <p className="text-[11px] text-slate-500">Sube fotos de la cámara o archivos locales</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="btn-ai-option-selected"
                    disabled={selectedIds.size === 0 || isReadingSelectedAi}
                    onClick={() => {
                      handleReadSelectedAi();
                    }}
                    title={selectedIds.size === 0 ? 'Selecciona al menos una factura en la lista' : 'Leer solo las facturas seleccionadas'}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-colors min-h-[44px] ${
                      selectedIds.size === 0
                        ? 'opacity-50 cursor-not-allowed bg-slate-50'
                        : 'hover:bg-slate-50 cursor-pointer'
                    }`}
                  >
                    <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold text-slate-900">Leer solo las seleccionadas</p>
                        {selectedIds.size > 0 && (
                          <span className="text-[10px] bg-teal-100 text-teal-800 font-bold px-1.5 py-0.2 rounded-md">
                            {selectedIds.size}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {selectedIds.size === 0 ? 'Selecciona al menos una factura primero' : `Reextraer ${selectedIds.size} seleccionadas`}
                      </p>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            id="btn-crear-gasto-manual"
            onClick={openNewGasto}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[14px] bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all shadow-2xs cursor-pointer min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>+ Gasto Manual</span>
          </button>
        </div>
      </div>

      {/* 2. Tarjetas de Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Materiales */}
        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Total Materiales (Suma)
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-[#0F766E] tabular-nums">
            {formatCOP(totalMateriales)}
          </p>
          <span className="text-[10px] text-slate-500">{facturas.length} registros cargados</span>
        </div>

        {/* Facturas Faltantes */}
        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Facturas Faltantes
          </span>
          <div className="flex items-center gap-2">
            <p className={`text-xl sm:text-2xl font-extrabold tabular-nums ${
              facturasFaltantesCount > 0 ? 'text-[#DC2626]' : 'text-slate-800'
            }`}>
              {facturasFaltantesCount}
            </p>
            {facturasFaltantesCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                Pendientes
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-500">Gastos sin archivo adjunto</span>
        </div>

        {/* Facturas Por Revisar */}
        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Por Revisar (IA)
          </span>
          <div className="flex items-center gap-2">
            <p className="text-xl sm:text-2xl font-extrabold text-amber-600 tabular-nums">
              {facturasPorRevisarCount}
            </p>
            {facturasPorRevisarCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                Nuevas
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-500">Leídas en segundo plano</span>
        </div>

        {/* Facturas Pagadas */}
        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Pagadas con Soporte
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-emerald-600 tabular-nums">
            {facturas.filter((f) => f.observacion?.toUpperCase().includes('PAGADO') && f.facturaVinculada?.url).length}
          </p>
          <span className="text-[10px] text-slate-500">Con enlace en Drive</span>
        </div>
      </div>

      {/* Barra de Selección Múltiple Fija / Visible */}
      {isSelectionMode && (
        <div
          id="bar-seleccion-facturas"
          className="fixed bottom-20 lg:bottom-6 left-3 right-3 sm:left-6 sm:right-6 z-40 max-w-4xl mx-auto bg-slate-900/95 backdrop-blur-md text-white p-3.5 sm:p-4 rounded-2xl shadow-2xl border border-slate-700/80 flex flex-wrap items-center justify-between gap-3 animate-in slide-in-from-bottom duration-200"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              id="btn-select-all-facturas"
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-200 hover:text-white px-2.5 py-2 rounded-xl hover:bg-slate-800 transition-colors min-h-[44px] cursor-pointer"
            >
              {selectedIds.size === filteredFacturas.length && filteredFacturas.length > 0 ? (
                <CheckSquare className="w-5 h-5 text-teal-400" />
              ) : (
                <Square className="w-5 h-5 text-slate-400" />
              )}
              <span>{selectedIds.size === filteredFacturas.length ? 'Deseleccionar todas' : 'Seleccionar todas'}</span>
            </button>
            <span
              id="contador-seleccionadas"
              className="text-xs font-bold text-teal-300 bg-teal-950/60 border border-teal-800/60 px-3 py-1.5 rounded-xl"
            >
              {selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              id="btn-bar-leer-ia"
              disabled={selectedIds.size === 0 || isReadingSelectedAi}
              onClick={handleReadSelectedAi}
              title={selectedIds.size === 0 ? 'Selecciona al menos una factura' : 'Leer con IA las seleccionadas'}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] cursor-pointer shadow-xs active:scale-95"
            >
              {isReadingSelectedAi ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Sparkles className="w-4 h-4 text-emerald-300" />
              )}
              <span>Leer con IA</span>
            </button>

            <button
              type="button"
              id="btn-bar-eliminar-lote"
              disabled={selectedIds.size === 0}
              onClick={() => setIsBatchDeleteDialogOpen(true)}
              title={selectedIds.size === 0 ? 'Selecciona al menos una factura para eliminar' : 'Eliminar seleccionadas'}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] cursor-pointer shadow-xs active:scale-95"
            >
              <Trash2 className="w-4 h-4" />
              <span>Eliminar</span>
            </button>

            <button
              type="button"
              id="btn-bar-cancelar-seleccion"
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedIds(new Set());
              }}
              className="inline-flex items-center px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors min-h-[44px] cursor-pointer"
            >
              <span>Cancelar</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Filtros y Búsqueda */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por concepto u observación..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F766E] shadow-2xs"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'todas', label: 'Todas' },
            { id: 'por_revisar', label: `Por revisar (${facturasPorRevisarCount})` },
            { id: 'falta_factura', label: `Falta factura (${facturasFaltantesCount})` },
            { id: 'pagado', label: 'Pagado' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                selectedFilter === tab.id
                  ? 'bg-[#0F766E] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition-all cursor-pointer"
            title="Alternar orden por fecha"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4. Lista de Facturas (Desktop: Tabla / Mobile: Tarjetas) */}
      <div className="bg-white rounded-[14px] border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Registro de Adecuaciones Sismo ({filteredFacturas.length})
          </h3>
          <span className="text-xs text-slate-500 font-semibold tabular-nums">
            Total Sección: {formatCOP(calculateTotalMateriales(filteredFacturas))}
          </span>
        </div>

        {filteredFacturas.length === 0 ? (
          <div className="p-8 sm:p-12 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
              <Receipt className="w-7 h-7" />
            </div>
            <p className="text-sm font-bold text-slate-800">No hay facturas o gastos registrados</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Esta sección inicia en $0. Puedes subir fotos con Gemini para extracción automática o registrar compras de materiales a mano.
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={openNewGasto}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F766E] text-white text-xs font-bold shadow-sm hover:bg-[#0d655f] transition-all min-h-[44px]"
              >
                <Plus className="w-4 h-4" />
                <span>+ Crear Primer Gasto</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop Table (≥ 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F6F7F9] text-[#64748B] font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    {isSelectionMode && <th className="py-3 px-3 w-10"></th>}
                    <th className="py-3 px-3 text-center w-12">N.º</th>
                    <th className="py-3 px-4">Concepto</th>
                    <th className="py-3 px-4 text-right">Costo</th>
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Observación</th>
                    <th className="py-3 px-4 text-center">Factura (Drive)</th>
                    <th className="py-3 px-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFacturas.map((f) => {
                    const isMissing =
                      (f.observacion || '').toUpperCase().includes('FALTA FACTURA') ||
                      f.estado === 'falta_factura' ||
                      !f.facturaVinculada?.url;
                    const isReview = f.estado === 'por_revisar';

                    return (
                      <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                        {isSelectionMode && (
                          <td className="py-3.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleSelect(f.id)}
                              className="text-[#0F766E] p-1"
                            >
                              {selectedIds.has(f.id) ? (
                                <CheckSquare className="w-4 h-4" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-300" />
                              )}
                            </button>
                          </td>
                        )}
                        <td className="py-3 px-3 text-center font-bold text-slate-400 tabular-nums">
                          #{f.consecutivo}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900 max-w-xs truncate">
                          {f.concepto}
                          {isReview && (
                            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              Por revisar
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-[#0F766E] tabular-nums text-sm">
                          {formatCOP(f.costo)}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-600 whitespace-nowrap">
                          {formatDateCO(f.fecha)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide ${
                              isMissing
                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {f.observacion || 'PAGADO'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {f.facturaVinculada?.url || f.facturaVinculada?.webViewLink ? (
                            <a
                              href={f.facturaVinculada.url || f.facturaVinculada.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 text-[#0F766E] font-bold text-[11px] hover:bg-teal-100 transition-colors"
                              title="Abrir factura en Google Drive"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Ver Drive</span>
                            </a>
                          ) : (
                            <span className="text-rose-500 font-semibold text-[11px] flex items-center justify-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Sin soporte</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {isReview && (
                              <button
                                type="button"
                                onClick={() => handleConfirmInvoice(f)}
                                className="w-10 h-10 flex items-center justify-center text-emerald-600 hover:bg-emerald-50 rounded-xl border border-emerald-200 cursor-pointer"
                                title="Confirmar factura leída"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            )}
                            {onAddToInventory && (
                              <button
                                type="button"
                                onClick={() =>
                                  onAddToInventory({
                                    nombre: f.concepto,
                                    cantidad: 1,
                                    unidad: 'UN',
                                    facturaVinculada: `Factura #${f.consecutivo} - ${f.concepto}`,
                                  })
                                }
                                className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-[#0F766E] hover:bg-teal-50 rounded-xl border border-slate-200 cursor-pointer"
                                title="Agregar a inventario de obra"
                              >
                                <PackagePlus className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditGasto(f)}
                              aria-label={`Editar gasto ${f.concepto}`}
                              className="w-10 h-10 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 cursor-pointer"
                              title="Editar"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setItemToDelete(f)}
                              aria-label={`Eliminar gasto ${f.concepto}`}
                              className="w-10 h-10 flex items-center justify-center text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-rose-200 cursor-pointer"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards (< 768px) */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredFacturas.map((f) => {
                const isMissing =
                  (f.observacion || '').toUpperCase().includes('FALTA FACTURA') ||
                  f.estado === 'falta_factura' ||
                  !f.facturaVinculada?.url;
                const isReview = f.estado === 'por_revisar';

                return (
                  <div key={f.id} className="p-4 space-y-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        {isSelectionMode && (
                          <button
                            type="button"
                            onClick={() => toggleSelect(f.id)}
                            className="mt-1 text-[#0F766E] p-1 shrink-0"
                          >
                            {selectedIds.has(f.id) ? (
                              <CheckSquare className="w-5 h-5" />
                            ) : (
                              <Square className="w-5 h-5 text-slate-300" />
                            )}
                          </button>
                        )}
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-400">#{f.consecutivo}</span>
                            <span className="text-[11px] text-slate-500 font-medium">{formatDateCO(f.fecha)}</span>
                          </div>
                          <h4 className="text-xs font-bold text-[#0F172A] leading-snug">
                            {f.concepto}
                          </h4>
                        </div>
                      </div>
                      <span className="text-sm font-extrabold text-[#0F766E] tabular-nums shrink-0">
                        {formatCOP(f.costo)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            isMissing
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {f.observacion || 'PAGADO'}
                        </span>
                        {isReview && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            Por revisar
                          </span>
                        )}
                      </div>

                      {f.facturaVinculada?.url && (
                        <a
                          href={f.facturaVinculada.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-teal-700 bg-teal-50 rounded-lg text-xs font-bold"
                          title="Ver en Drive"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Drive</span>
                        </a>
                      )}
                    </div>

                    {/* Accessible Action Buttons */}
                    <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                      {isReview && (
                        <button
                          type="button"
                          onClick={() => handleConfirmInvoice(f)}
                          className="inline-flex items-center gap-1 px-3 py-2 text-emerald-700 bg-emerald-50 rounded-xl text-xs font-bold min-h-[44px]"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Confirmar</span>
                        </button>
                      )}
                      {onAddToInventory && (
                        <button
                          type="button"
                          onClick={() =>
                            onAddToInventory({
                              nombre: f.concepto,
                              cantidad: 1,
                              unidad: 'UN',
                              facturaVinculada: `Factura #${f.consecutivo} - ${f.concepto}`,
                            })
                          }
                          aria-label={`Agregar ${f.concepto} a inventario`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 min-h-[44px] min-w-[44px]"
                        >
                          <PackagePlus className="w-4 h-4 text-[#0F766E]" />
                          <span>+ Inventario</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditGasto(f)}
                        aria-label={`Editar gasto ${f.concepto}`}
                        className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4 text-slate-600" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemToDelete(f)}
                        aria-label={`Eliminar gasto ${f.concepto}`}
                        className="w-11 h-11 flex items-center justify-center rounded-xl border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-100/50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4 text-rose-600" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Modal / Bottom Sheet para Crear o Editar Gasto */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => !isSaving && setIsModalOpen(false)} />

          <div className="relative z-10 w-full sm:max-w-lg bg-white rounded-t-[28px] sm:rounded-2xl p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-[#0F766E] flex items-center justify-center font-bold">
                  <Receipt className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {editingFactura ? 'Editar Registro de Gasto' : 'Registrar Gasto de Obra'}
                  </h3>
                  <span className="text-[10px] text-slate-400">Pestaña ADECUACIONES SISMO</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={isSaving}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Concepto del Gasto *</label>
                <input
                  type="text"
                  placeholder="Ej: COMPRA CEMENTO Y ARENA"
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Costo (COP) *</label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="number"
                      step="any"
                      min="1"
                      placeholder="Ej: 450000"
                      value={costo || ''}
                      onChange={(e) => setCosto(Number(e.target.value) || 0)}
                      required
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-extrabold text-[#0F766E] bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                  </div>
                  {costo > 0 && (
                    <p className="text-[11px] font-bold text-teal-700 mt-1">
                      {formatCOP(costo)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Fecha *</label>
                  <input
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Observación Rápida *</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setObservacion('PAGADO')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      observacion === 'PAGADO'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    PAGADO
                  </button>
                  <button
                    type="button"
                    onClick={() => setObservacion('FALTA FACTURA')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      observacion === 'FALTA FACTURA'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    FALTA FACTURA
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Texto libre o detalle del pago"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Enlace a Factura / Drive (Opcional)</label>
                <input
                  type="url"
                  placeholder="https://drive.google.com/file/d/..."
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F766E] text-white text-xs font-bold hover:bg-[#0d655f] transition-all shadow-sm active:scale-95 disabled:opacity-50 min-h-[44px]"
                >
                  {saveSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                      <span>Guardado ✓</span>
                    </>
                  ) : (
                    <span>{isSaving ? 'Guardando...' : editingFactura ? 'Guardar Cambios' : 'Guardar Gasto'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog (Unitario) */}
      <ConfirmDeleteDialog
        isOpen={!!itemToDelete}
        itemName={itemToDelete ? `Gasto #${itemToDelete.consecutivo} (${itemToDelete.concepto})` : ''}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmSingleDelete}
        onCancel={() => setItemToDelete(null)}
      />

      {/* Confirm Delete Dialog (Lote) */}
      <ConfirmDeleteDialog
        isOpen={isBatchDeleteDialogOpen}
        itemName={`${selectedIds.size} gastos seleccionados`}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmBatchDelete}
        onCancel={() => setIsBatchDeleteDialogOpen(false)}
      />
    </div>
  );
};
