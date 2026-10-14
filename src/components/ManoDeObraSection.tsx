import React, { useState, useMemo } from 'react';
import {
  HardHat,
  Plus,
  Calendar,
  ChevronDown,
  ChevronUp,
  Trash2,
  Pencil,
  Minus,
  Users,
  CheckCircle2,
  X,
  FileSpreadsheet,
  CheckSquare,
  Square,
  AlertCircle,
  DollarSign,
} from 'lucide-react';
import {
  BitacoraRecord,
  FilaBitacora,
  WorkerCatalogItem,
  calculateSubtotalFilaBitacora,
  calculateTotalFilaBitacora,
  calculateTotalBitacora,
  groupBitacorasByMonth,
  recalculateFilaBitacora,
  generateUUID,
} from '../utils/constructionCalculations';
import { formatCOP, formatDateCO } from '../utils/formatters';
import { ProjectFolder } from '../types';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

interface ManoDeObraSectionProps {
  project: ProjectFolder | null;
  bitacoras: BitacoraRecord[];
  workers: WorkerCatalogItem[];
  onSaveBitacora: (bitacora: BitacoraRecord) => Promise<void>;
  onDeleteBitacora: (bitacoraId: string) => Promise<void>;
  onOpenCatalog: () => void;
}

export const ManoDeObraSection: React.FC<ManoDeObraSectionProps> = ({
  project,
  bitacoras,
  workers,
  onSaveBitacora,
  onDeleteBitacora,
  onOpenCatalog,
}) => {
  const [selectedBitacoraId, setSelectedBitacoraId] = useState<string | null>(
    bitacoras[0]?.id || null
  );

  // Modal para crear o renombrar bitácora
  const [isBitacoraModalOpen, setIsBitacoraModalOpen] = useState(false);
  const [editingBitacora, setEditingBitacora] = useState<BitacoraRecord | null>(null);
  const [titulo, setTitulo] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');

  // Modal para agregar/editar trabajador en la bitácora activa
  const [isFilaModalOpen, setIsFilaModalOpen] = useState(false);
  const [editingFila, setEditingFila] = useState<FilaBitacora | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [concepto, setConcepto] = useState('');
  const [dia, setDia] = useState<number>(80000);
  const [salud, setSalud] = useState<number>(15000);
  const [liquidacion, setLiquidacion] = useState<number>(12000);
  const [dias, setDias] = useState<number>(12);

  // Acordeón de Costos Totales por Mes
  const [isCostosTotalesOpen, setIsCostosTotalesOpen] = useState(true);

  // Confirm delete dialog states
  const [bitacoraToDelete, setBitacoraToDelete] = useState<BitacoraRecord | null>(null);
  const [filaToDelete, setFilaToDelete] = useState<FilaBitacora | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Batch delete states for rows inside active bitácora
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedFilaIds, setSelectedFilaIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Bitácora activa seleccionada
  const activeBitacora = useMemo(() => {
    return bitacoras.find((b) => b.id === selectedBitacoraId) || bitacoras[0] || null;
  }, [bitacoras, selectedBitacoraId]);

  // Agrupación mensual
  const monthlyData = useMemo(() => {
    return groupBitacorasByMonth(bitacoras);
  }, [bitacoras]);

  const subtotalManoDeObra = monthlyData.subtotalManoDeObra;

  // Abrir modal nueva bitácora
  const openNewBitacora = () => {
    setEditingBitacora(null);
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    setTitulo(`Bitácora 01/${m}/${y} – 15/${m}/${y}`);
    setFechaInicio(`${y}-${m}-01`);
    setFechaFin(`${y}-${m}-15`);
    setFormError(null);
    setSaveSuccess(false);
    setIsBitacoraModalOpen(true);
  };

  const openEditBitacora = (b: BitacoraRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingBitacora(b);
    setTitulo(b.titulo);
    setFechaInicio(b.fechaInicio);
    setFechaFin(b.fechaFin);
    setFormError(null);
    setSaveSuccess(false);
    setIsBitacoraModalOpen(true);
  };

  const handleSaveBitacoraMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) {
      setFormError('El título de la bitácora es obligatorio');
      return;
    }

    try {
      if (editingBitacora) {
        const updated: BitacoraRecord = {
          ...editingBitacora,
          titulo: titulo.trim(),
          fechaInicio,
          fechaFin,
          actualizadoEn: Date.now(),
        };
        await onSaveBitacora(updated);
      } else {
        const newBit: BitacoraRecord = {
          id: generateUUID(),
          obraId: project?.id,
          origen: 'manual',
          creadoEn: Date.now(),
          actualizadoEn: Date.now(),
          titulo: titulo.trim(),
          fechaInicio,
          fechaFin,
          filas: [],
          total: 0,
        };
        await onSaveBitacora(newBit);
        setSelectedBitacoraId(newBit.id);
      }
      setSaveSuccess(true);
      setTimeout(() => {
        setIsBitacoraModalOpen(false);
        setSaveSuccess(false);
      }, 600);
    } catch (err: any) {
      setFormError(err?.message || 'Error al guardar la bitácora');
    }
  };

  // Agregar o Editar trabajador en la bitácora activa
  const openAddWorkerToBitacora = () => {
    if (!activeBitacora) return;
    setEditingFila(null);
    setSelectedWorkerId('');
    setConcepto('');
    setDia(80000);
    setSalud(15000);
    setLiquidacion(12000);
    setDias(12);
    setFormError(null);
    setSaveSuccess(false);
    setIsFilaModalOpen(true);
  };

  const openEditFila = (f: FilaBitacora) => {
    setEditingFila(f);
    setSelectedWorkerId(f.workerId || '');
    setConcepto(f.concepto);
    setDia(f.dia);
    setSalud(f.salud);
    setLiquidacion(f.liquidacion);
    setDias(f.dias);
    setFormError(null);
    setSaveSuccess(false);
    setIsFilaModalOpen(true);
  };

  const handleWorkerSelectChange = (wId: string) => {
    setSelectedWorkerId(wId);
    const worker = workers.find((w) => w.id === wId);
    if (worker) {
      setConcepto(`${worker.nombre} - ${worker.rol.toUpperCase()}`);
      const baseDia = Math.round(worker.salarioMensual / 30);
      setDia(baseDia);
      if (worker.tipo === 'con prestaciones') {
        setSalud(Math.round(worker.descuentoSaludPension / 30) || 5000);
        setLiquidacion(Math.round(worker.salarioMensual * 0.12 / 30) || 8000);
      } else {
        setSalud(0);
        setLiquidacion(0);
      }
    }
  };

  const handleSaveFila = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBitacora) return;
    if (!concepto.trim()) {
      setFormError('El concepto del operario es obligatorio');
      return;
    }

    const subtotal = calculateSubtotalFilaBitacora(dia, salud, liquidacion);
    const total = calculateTotalFilaBitacora(subtotal, dias);

    let nextFilas: FilaBitacora[];
    if (editingFila) {
      nextFilas = activeBitacora.filas.map((f) =>
        f.id === editingFila.id
          ? {
              ...f,
              workerId: selectedWorkerId || f.workerId,
              concepto: concepto.trim().toUpperCase(),
              dia: Number(dia) || 0,
              salud: Number(salud) || 0,
              liquidacion: Number(liquidacion) || 0,
              subtotal,
              dias: Number(dias) || 0,
              total,
              actualizadoEn: Date.now(),
            }
          : f
      );
    } else {
      const newFila: FilaBitacora = {
        id: generateUUID(),
        obraId: project?.id,
        origen: 'manual',
        creadoEn: Date.now(),
        actualizadoEn: Date.now(),
        workerId: selectedWorkerId || undefined,
        concepto: concepto.trim().toUpperCase(),
        dia: Number(dia) || 0,
        salud: Number(salud) || 0,
        liquidacion: Number(liquidacion) || 0,
        subtotal,
        dias: Number(dias) || 0,
        total,
      };
      nextFilas = [...activeBitacora.filas, newFila];
    }

    const updatedBitacora: BitacoraRecord = {
      ...activeBitacora,
      filas: nextFilas,
      total: calculateTotalBitacora(nextFilas),
      actualizadoEn: Date.now(),
    };

    await onSaveBitacora(updatedBitacora);
    setSaveSuccess(true);
    setTimeout(() => {
      setIsFilaModalOpen(false);
      setEditingFila(null);
      setSaveSuccess(false);
    }, 600);
  };

  const handleAdjustDias = async (filaId: string, delta: number) => {
    if (!activeBitacora) return;
    const nextFilas = activeBitacora.filas.map((f) => {
      if (f.id === filaId) {
        const newDias = Math.max(0, Number((f.dias + delta).toFixed(1)));
        return recalculateFilaBitacora({
          ...f,
          dias: newDias,
          actualizadoEn: Date.now(),
        });
      }
      return f;
    });

    const updatedBitacora: BitacoraRecord = {
      ...activeBitacora,
      filas: nextFilas,
      total: calculateTotalBitacora(nextFilas),
      actualizadoEn: Date.now(),
    };
    await onSaveBitacora(updatedBitacora);
  };

  const handleConfirmDeleteBitacora = async () => {
    if (!bitacoraToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteBitacora(bitacoraToDelete.id);
      setBitacoraToDelete(null);
      setSelectedBitacoraId(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar la bitácora. No se pudo completar la operación.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteFila = async () => {
    if (!activeBitacora || !filaToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const nextFilas = activeBitacora.filas.filter((f) => f.id !== filaToDelete.id);
      const updatedBitacora: BitacoraRecord = {
        ...activeBitacora,
        filas: nextFilas,
        total: calculateTotalBitacora(nextFilas),
        actualizadoEn: Date.now(),
      };
      await onSaveBitacora(updatedBitacora);
      setFilaToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar el operario de la bitácora.');
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelectFila = (id: string) => {
    setSelectedFilaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFilas = () => {
    if (!activeBitacora) return;
    if (selectedFilaIds.size === activeBitacora.filas.length) {
      setSelectedFilaIds(new Set());
    } else {
      setSelectedFilaIds(new Set(activeBitacora.filas.map((f) => f.id)));
    }
  };

  const handleConfirmBatchDeleteFilas = async () => {
    if (!activeBitacora || selectedFilaIds.size === 0) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const nextFilas = activeBitacora.filas.filter((f) => !selectedFilaIds.has(f.id));
      const updatedBitacora: BitacoraRecord = {
        ...activeBitacora,
        filas: nextFilas,
        total: calculateTotalBitacora(nextFilas),
        actualizadoEn: Date.now(),
      };
      await onSaveBitacora(updatedBitacora);
      setSelectedFilaIds(new Set());
      setIsSelectionMode(false);
      setIsBatchDeleteDialogOpen(false);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar los operarios seleccionados.');
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
      {/* 1. Header con Resumen y Catálogo */}
      <div className="bg-white p-4 sm:p-5 rounded-[14px] border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold">
            <HardHat className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Mano de Obra (Bitácoras)</h2>
            <p className="text-xs text-[#64748B]">
              Bitácoras periódicas y acumulación mensual de costos en <strong className="text-slate-800">{project?.name || 'la obra'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            id="btn-catalogo-trabajadores"
            onClick={onOpenCatalog}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all min-h-[44px]"
          >
            <Users className="w-4 h-4 text-[#0F766E]" />
            <span>Catálogo ({workers.length})</span>
          </button>

          <button
            type="button"
            id="btn-nueva-bitacora"
            onClick={openNewBitacora}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all shadow-2xs min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>+ Nueva Bitácora</span>
          </button>
        </div>
      </div>

      {/* 2. Acordeón "Costos Totales" Agrupados por Mes */}
      <div className="bg-white rounded-[14px] border border-slate-200/90 shadow-2xs overflow-hidden">
        <button
          type="button"
          onClick={() => setIsCostosTotalesOpen(!isCostosTotalesOpen)}
          className="w-full p-4 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0F766E] text-white flex items-center justify-center font-bold">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Costos Totales (Agrupado por Mes)
              </h3>
              <p className="text-base sm:text-lg font-black text-[#0F766E] tabular-nums">
                SUBTOTAL MANO DE OBRA: {formatCOP(subtotalManoDeObra)}
              </p>
            </div>
          </div>
          {isCostosTotalesOpen ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </button>

        {isCostosTotalesOpen && (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 border-t border-slate-200">
            {monthlyData.meses.length === 0 ? (
              <p className="text-xs text-slate-500 col-span-full italic py-2 text-center">
                Sin bitácoras registradas en la obra. Total: $0.
              </p>
            ) : (
              monthlyData.meses.map((m) => (
                <div
                  key={m.monthKey}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between"
                >
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">{m.monthName}</h4>
                    <span className="text-[11px] text-slate-500">{m.bitacoras.length} bitácora(s)</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {formatCOP(m.totalMes)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 3. Selector de Bitácoras Disponibles */}
      {bitacoras.length === 0 ? (
        <div className="bg-white p-8 sm:p-12 rounded-[14px] border border-slate-200/90 shadow-2xs text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
            <HardHat className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No hay bitácoras de mano de obra</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Esta sección inicia completamente limpia en $0. Crea una bitácora para registrar las jornadas y liquidaciones de tus cuadrillas.
          </p>
          <button
            type="button"
            onClick={openNewBitacora}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F766E] text-white text-xs font-bold shadow-sm hover:bg-[#0d655f] transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>+ Crear Primera Bitácora</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Bitácoras de la Obra ({bitacoras.length})
            </h3>
            <span className="text-xs text-slate-400">Toca para abrir y editar detalle</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {bitacoras.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBitacoraId(b.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer border ${
                  activeBitacora?.id === b.id
                    ? 'bg-[#0F766E] text-white border-[#0F766E] shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>{b.titulo}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                    activeBitacora?.id === b.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {formatCOP(b.total)}
                </span>
              </button>
            ))}
          </div>

          {/* 4. Detalle de la Bitácora Activa */}
          {activeBitacora && (
            <div className="bg-white rounded-[14px] border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 bg-[#F6F7F9] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900">{activeBitacora.titulo}</h3>
                    <button
                      type="button"
                      onClick={(e) => openEditBitacora(activeBitacora, e)}
                      aria-label="Editar título y fechas de la bitácora"
                      className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                      title="Editar fechas o título"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Período: {formatDateCO(activeBitacora.fechaInicio)} al {formatDateCO(activeBitacora.fechaFin)}
                  </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="text-right mr-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">TOTAL BITÁCORA</span>
                    <span className="text-lg sm:text-xl font-black text-[#0F766E] tabular-nums">
                      {formatCOP(activeBitacora.total)}
                    </span>
                  </div>

                  {activeBitacora.filas.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelectionMode(!isSelectionMode);
                        setSelectedFilaIds(new Set());
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold min-h-[44px]"
                    >
                      {isSelectionMode ? 'Cancelar' : 'Seleccionar'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={openAddWorkerToBitacora}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold rounded-xl shadow-2xs transition-all cursor-pointer min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Agregar Trabajador</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBitacoraToDelete(activeBitacora)}
                    aria-label={`Eliminar bitácora ${activeBitacora.titulo}`}
                    className="w-11 h-11 flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 cursor-pointer min-h-[44px] min-w-[44px]"
                    title="Eliminar bitácora completa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Barra de selección por lote de filas */}
              {isSelectionMode && (
                <div className="bg-slate-900 text-white p-3 sm:p-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={toggleSelectAllFilas}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white"
                  >
                    {selectedFilaIds.size === activeBitacora.filas.length ? (
                      <CheckSquare className="w-4 h-4 text-teal-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                    <span>Todos ({selectedFilaIds.size}/{activeBitacora.filas.length})</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedFilaIds.size === 0}
                    onClick={() => setIsBatchDeleteDialogOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-40 min-h-[40px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar ({selectedFilaIds.size})</span>
                  </button>
                </div>
              )}

              {/* Tabla / Tarjetas de trabajadores en la bitácora */}
              {activeBitacora.filas.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <p className="text-sm font-bold text-slate-800">No hay trabajadores en esta bitácora</p>
                  <p className="text-xs text-slate-500">
                    Toca "+ Agregar Trabajador" para precargar los datos desde el catálogo de la obra.
                  </p>
                  <button
                    type="button"
                    onClick={openAddWorkerToBitacora}
                    className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-[#0F766E] text-white text-xs font-bold rounded-xl min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Agregar Primer Operario</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Desktop Table (≥ 768px) */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F6F7F9] text-[#64748B] font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <tr>
                          {isSelectionMode && <th className="py-3 px-3 w-10"></th>}
                          <th className="py-3.5 px-4">Concepto (Nombre + Rol)</th>
                          <th className="py-3.5 px-4 text-right">DÍA</th>
                          <th className="py-3.5 px-4 text-right">SALUD</th>
                          <th className="py-3.5 px-4 text-right">LIQUIDACIÓN</th>
                          <th className="py-3.5 px-4 text-right font-bold text-slate-900">SUBTOTAL</th>
                          <th className="py-3.5 px-4 text-center">DÍAS (± 0.5)</th>
                          <th className="py-3.5 px-4 text-right font-extrabold text-[#0F766E]">TOTAL</th>
                          <th className="py-3.5 px-4 text-center w-28">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeBitacora.filas.map((f) => (
                          <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                            {isSelectionMode && (
                              <td className="py-3.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleSelectFila(f.id)}
                                  className="text-[#0F766E] p-1"
                                >
                                  {selectedFilaIds.has(f.id) ? (
                                    <CheckSquare className="w-4 h-4" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-300" />
                                  )}
                                </button>
                              </td>
                            )}
                            <td className="py-3.5 px-4 font-bold text-slate-900">
                              {f.concepto}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                              {formatCOP(f.dia)}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                              {formatCOP(f.salud)}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                              {formatCOP(f.liquidacion)}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums font-bold text-slate-900 bg-slate-50/50">
                              {formatCOP(f.subtotal)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="inline-flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-xl">
                                <button
                                  type="button"
                                  onClick={() => handleAdjustDias(f.id, -0.5)}
                                  className="w-6 h-6 rounded-lg bg-white hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center transition-colors cursor-pointer"
                                  title="Restar medio día (-0.5)"
                                >
                                  -
                                </button>
                                <span className="font-extrabold text-slate-900 px-2 tabular-nums text-xs min-w-[28px] text-center">
                                  {f.dias}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustDias(f.id, +0.5)}
                                  className="w-6 h-6 rounded-lg bg-white hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center transition-colors cursor-pointer"
                                  title="Sumar medio día (+0.5)"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right font-black text-[#0F766E] tabular-nums text-sm">
                              {formatCOP(f.total)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditFila(f)}
                                  aria-label={`Editar operario ${f.concepto}`}
                                  className="w-10 h-10 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 cursor-pointer"
                                  title="Editar valores"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setFilaToDelete(f)}
                                  aria-label={`Eliminar operario ${f.concepto}`}
                                  className="w-10 h-10 flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 cursor-pointer"
                                  title="Eliminar operario"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-[#F6F7F9] border-t border-slate-200 font-bold text-xs">
                        <tr>
                          <td colSpan={isSelectionMode ? 6 : 5} className="py-3.5 px-4 text-right uppercase tracking-wider text-slate-600">
                            TOTAL DE LA BITÁCORA:
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-[#0F766E] tabular-nums text-base">
                            {formatCOP(activeBitacora.total)}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile Cards (< 768px) */}
                  <div className="md:hidden divide-y divide-slate-100">
                    {activeBitacora.filas.map((f) => (
                      <div key={f.id} className="p-4 space-y-3 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            {isSelectionMode && (
                              <button
                                type="button"
                                onClick={() => toggleSelectFila(f.id)}
                                className="mt-1 text-[#0F766E] p-1 shrink-0"
                              >
                                {selectedFilaIds.has(f.id) ? (
                                  <CheckSquare className="w-5 h-5" />
                                ) : (
                                  <Square className="w-5 h-5 text-slate-300" />
                                )}
                              </button>
                            )}
                            <div>
                              <h4 className="text-xs font-bold text-slate-900">{f.concepto}</h4>
                              <p className="text-[11px] text-slate-500">
                                Subtotal día: {formatCOP(f.subtotal)}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-black text-[#0F766E] tabular-nums shrink-0">
                            {formatCOP(f.total)}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-center text-xs border border-slate-100">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-semibold">Valor Día</span>
                            <span className="font-bold text-slate-800">{formatCOP(f.dia)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-semibold">Salud / Liq</span>
                            <span className="font-bold text-slate-800">{formatCOP(f.salud + f.liquidacion)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-semibold">Días</span>
                            <div className="flex items-center justify-center gap-1.5 mt-0.5">
                              <button
                                type="button"
                                onClick={() => handleAdjustDias(f.id, -0.5)}
                                className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-xs font-black shadow-xs"
                              >
                                -
                              </button>
                              <span className="font-bold px-1">{f.dias}</span>
                              <button
                                type="button"
                                onClick={() => handleAdjustDias(f.id, +0.5)}
                                className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-xs font-black shadow-xs"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Accessible action buttons with 44px min target */}
                        <div className="flex items-center justify-end gap-3 pt-1 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => openEditFila(f)}
                            aria-label={`Editar operario ${f.concepto}`}
                            className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4 text-slate-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setFilaToDelete(f)}
                            aria-label={`Eliminar operario ${f.concepto}`}
                            className="w-11 h-11 flex items-center justify-center rounded-xl border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-100/50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4 text-rose-600" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal: Crear / Editar Bitácora */}
      {isBitacoraModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsBitacoraModalOpen(false)} />
          <div className="relative z-10 bg-white rounded-t-[28px] sm:rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {editingBitacora ? 'Editar Período de Bitácora' : 'Crear Nueva Bitácora'}
              </h3>
              <button
                type="button"
                onClick={() => setIsBitacoraModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveBitacoraMeta} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Título de la Bitácora *</label>
                <input
                  type="text"
                  required
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej: Bitácora 16/09/2026 – 30/09/2026"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Fecha Inicio *</label>
                  <input
                    type="date"
                    required
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Fecha Fin *</label>
                  <input
                    type="date"
                    required
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsBitacoraModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all shadow-sm min-h-[44px]"
                >
                  {saveSuccess ? 'Guardado ✓' : editingBitacora ? 'Guardar Cambios' : 'Crear Bitácora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal / Bottom Sheet: Agregar / Editar Fila de Trabajador */}
      {isFilaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsFilaModalOpen(false)} />
          <div className="relative z-10 bg-white rounded-t-[28px] sm:rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {editingFila ? 'Editar Operario en Bitácora' : 'Agregar Operario a Bitácora'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFilaModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveFila} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Precargar desde Catálogo de Trabajadores:
                </label>
                <select
                  value={selectedWorkerId}
                  onChange={(e) => handleWorkerSelectChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                >
                  <option value="">-- Seleccionar o escribir concepto libre --</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.nombre} ({w.rol.toUpperCase()} - {w.tipo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Concepto (Nombre + Rol) *</label>
                <input
                  type="text"
                  required
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  placeholder="Ej: JOSÉ ALFREDO RODRÍGUEZ - OFICIAL"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">DÍA (Valor)</label>
                  <input
                    type="number"
                    step="1000"
                    required
                    value={dia || ''}
                    onChange={(e) => setDia(Number(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">SALUD</label>
                  <input
                    type="number"
                    step="500"
                    value={salud || ''}
                    onChange={(e) => setSalud(Number(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">LIQUIDACIÓN</label>
                  <input
                    type="number"
                    step="500"
                    value={liquidacion || ''}
                    onChange={(e) => setLiquidacion(Number(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs font-bold">
                <span className="text-slate-600">SUBTOTAL (Día + Salud + Liq):</span>
                <span className="text-slate-900 text-sm font-extrabold">
                  {formatCOP(calculateSubtotalFilaBitacora(dia, salud, liquidacion))}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">DÍAS (Acepta 0.5):</label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setDias(Math.max(0, Number((dias - 0.5).toFixed(1))))}
                      className="w-9 h-9 rounded-lg bg-white border border-slate-200 text-slate-800 font-bold flex items-center justify-center text-sm shadow-xs"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={dias}
                      onChange={(e) => setDias(Number(e.target.value) || 0)}
                      className="w-20 text-center bg-transparent font-black text-sm text-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setDias(Number((dias + 0.5).toFixed(1)))}
                      className="w-9 h-9 rounded-lg bg-white border border-slate-200 text-slate-800 font-bold flex items-center justify-center text-sm shadow-xs"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex-1 text-right">
                    <span className="text-[10px] text-slate-400 block font-bold uppercase">TOTAL FILA</span>
                    <span className="text-base font-black text-[#0F766E]">
                      {formatCOP(
                        calculateTotalFilaBitacora(
                          calculateSubtotalFilaBitacora(dia, salud, liquidacion),
                          dias
                        )
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsFilaModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all shadow-sm min-h-[44px]"
                >
                  {saveSuccess ? 'Guardado ✓' : editingFila ? 'Guardar Cambios' : 'Agregar Operario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Bitácora Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!bitacoraToDelete}
        itemName={bitacoraToDelete?.titulo || 'esta bitácora'}
        description="Podrás deshacerlo durante 8 segundos. Los totales de mano de obra se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmDeleteBitacora}
        onCancel={() => setBitacoraToDelete(null)}
      />

      {/* Confirm Delete Fila Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!filaToDelete}
        itemName={filaToDelete?.concepto || 'este operario'}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmDeleteFila}
        onCancel={() => setFilaToDelete(null)}
      />

      {/* Confirm Batch Delete Filas Dialog */}
      <ConfirmDeleteDialog
        isOpen={isBatchDeleteDialogOpen}
        itemName={`${selectedFilaIds.size} operarios seleccionados`}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmBatchDeleteFilas}
        onCancel={() => setIsBatchDeleteDialogOpen(false)}
      />
    </div>
  );
};
