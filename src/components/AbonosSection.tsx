import React, { useState, useMemo } from 'react';
import {
  PiggyBank,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  DollarSign,
  X,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  CheckSquare,
  Square,
  AlertCircle,
} from 'lucide-react';
import {
  AbonoRecordItem,
  calculateTotalAbonos,
  getNombreConsecutivoAbono,
  generateUUID,
} from '../utils/constructionCalculations';
import { formatCOP, formatDateCO } from '../utils/formatters';
import { ProjectFolder } from '../types';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

interface AbonosSectionProps {
  project: ProjectFolder | null;
  abonos: AbonoRecordItem[];
  onSaveAbono: (abono: AbonoRecordItem) => Promise<void>;
  onDeleteAbono: (abonoId: string) => Promise<void>;
  onDeleteMultipleAbonos?: (ids: string[]) => Promise<void>;
}

export const AbonosSection: React.FC<AbonosSectionProps> = ({
  project,
  abonos,
  onSaveAbono,
  onDeleteAbono,
  onDeleteMultipleAbonos,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAbono, setEditingAbono] = useState<AbonoRecordItem | null>(null);

  // Form states
  const [itemNombre, setItemNombre] = useState('');
  const [costo, setCosto] = useState<number>(0);
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0]);
  const [observacion, setObservacion] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Confirm Delete Dialog state
  const [itemToDelete, setItemToDelete] = useState<AbonoRecordItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Batch Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false);

  // Total abonos = suma de costos
  const totalAbonos = useMemo(() => calculateTotalAbonos(abonos), [abonos]);

  const openNewAbono = () => {
    setEditingAbono(null);
    const nextConsecutivo =
      abonos.reduce((max, a) => Math.max(max, a.consecutivo || 0), 0) + 1;
    setItemNombre(getNombreConsecutivoAbono(nextConsecutivo));
    setCosto(0);
    setFecha(new Date().toISOString().split('T')[0]);
    setObservacion('');
    setFormError(null);
    setSaveSuccess(false);
    setIsModalOpen(true);
  };

  const openEditAbono = (ab: AbonoRecordItem) => {
    setEditingAbono(ab);
    setItemNombre(ab.item);
    setCosto(ab.costo);
    setFecha(ab.fecha);
    setObservacion(ab.observacion || '');
    setFormError(null);
    setSaveSuccess(false);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawVal = Number(costo) || 0;
    if (rawVal <= 0) {
      setFormError('Por favor ingresa un costo de abono mayor a 0');
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      const nextConsecutivo = editingAbono
        ? editingAbono.consecutivo
        : abonos.reduce((max, a) => Math.max(max, a.consecutivo || 0), 0) + 1;

      const record: AbonoRecordItem = {
        id: editingAbono ? editingAbono.id : generateUUID(),
        obraId: project?.id,
        origen: editingAbono?.origen || 'manual',
        creadoEn: editingAbono?.creadoEn || Date.now(),
        actualizadoEn: Date.now(),
        consecutivo: nextConsecutivo,
        item: itemNombre.trim() || getNombreConsecutivoAbono(nextConsecutivo),
        costo: rawVal,
        fecha: fecha || new Date().toISOString().split('T')[0],
        observacion: observacion.trim(),
      };

      await onSaveAbono(record);
      setSaveSuccess(true);
      setTimeout(() => {
        setIsModalOpen(false);
        setEditingAbono(null);
        setSaveSuccess(false);
      }, 700);
    } catch (err: any) {
      setFormError(err?.message || 'Error al guardar el abono');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmSingleDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteAbono(itemToDelete.id);
      setItemToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar el abono. No se pudo completar la operación.');
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
    if (selectedIds.size === abonos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(abonos.map((a) => a.id)));
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const ids = Array.from(selectedIds);
      if (onDeleteMultipleAbonos) {
        await onDeleteMultipleAbonos(ids);
      } else {
        for (const id of ids) {
          await onDeleteAbono(id);
        }
      }
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setIsBatchDeleteDialogOpen(false);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar los abonos seleccionados.');
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
      {/* 1. Header con Resumen */}
      <div className="bg-white p-4 sm:p-5 rounded-[14px] border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <PiggyBank className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Abonos del Cliente</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Pestaña ABONOS
              </span>
            </div>
            <p className="text-xs text-[#64748B]">
              Ingresos recibidos en <strong className="text-slate-800">{project?.name || 'la obra'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {abonos.length > 0 && (
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

          <button
            type="button"
            id="btn-nuevo-abono"
            onClick={openNewAbono}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[14px] bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all shadow-2xs cursor-pointer min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>+ Registrar Abono</span>
          </button>
        </div>
      </div>

      {/* 2. Tarjetas de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Total Abonos Recibidos
          </span>
          <p className="text-2xl sm:text-3xl font-extrabold text-[#16A34A] tabular-nums">
            {formatCOP(totalAbonos)}
          </p>
          <span className="text-[10px] text-slate-500">{abonos.length} abonos registrados</span>
        </div>

        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Último Abono Registrado
          </span>
          <p className="text-lg sm:text-xl font-bold text-slate-900 truncate">
            {abonos[abonos.length - 1]?.item || 'Sin abonos aún'}
          </p>
          <span className="text-[10px] text-slate-500">
            {abonos[abonos.length - 1]
              ? `${formatCOP(abonos[abonos.length - 1].costo)} · ${formatDateCO(abonos[abonos.length - 1].fecha)}`
              : '$0 recibidos'}
          </span>
        </div>
      </div>

      {/* Barra de Selección Múltiple */}
      {isSelectionMode && (
        <div className="bg-slate-900 text-white p-3 sm:p-4 rounded-xl flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white"
            >
              {selectedIds.size === abonos.length ? (
                <CheckSquare className="w-4 h-4 text-teal-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>Todos ({selectedIds.size}/{abonos.length})</span>
            </button>
          </div>

          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setIsBatchDeleteDialogOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all disabled:opacity-40 min-h-[40px]"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Eliminar ({selectedIds.size})</span>
          </button>
        </div>
      )}

      {/* 3. Listado de Abonos */}
      <div className="bg-white rounded-[14px] border border-slate-200/90 shadow-2xs overflow-hidden">
        {abonos.length === 0 ? (
          <div className="p-8 sm:p-12 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <PiggyBank className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Sin abonos registrados</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Esta obra inicia completamente limpia. Registra los pagos o anticipos entregados por el cliente para calcular el saldo en tiempo real.
            </p>
            <button
              type="button"
              onClick={openNewAbono}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F766E] text-white text-xs font-bold shadow-sm hover:bg-[#0d655f] transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>+ Registrar Primer Abono</span>
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table (≥ 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                  <tr>
                    {isSelectionMode && <th className="py-3 px-4 w-10"></th>}
                    <th className="py-3.5 px-4 w-16">N.º</th>
                    <th className="py-3.5 px-4">Ítem / Concepto</th>
                    <th className="py-3.5 px-4 text-right">Costo ($ COP)</th>
                    <th className="py-3.5 px-4">Fecha</th>
                    <th className="py-3.5 px-4">Observación</th>
                    <th className="py-3.5 px-4 text-center w-28">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {abonos.map((ab) => (
                    <tr key={ab.id} className="hover:bg-slate-50/80 transition-colors">
                      {isSelectionMode && (
                        <td className="py-3.5 px-4">
                          <button
                            type="button"
                            onClick={() => toggleSelect(ab.id)}
                            className="text-[#0F766E] p-1"
                          >
                            {selectedIds.has(ab.id) ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-300" />
                            )}
                          </button>
                        </td>
                      )}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-400">
                        #{ab.consecutivo}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {ab.item}
                      </td>
                      <td className="py-3.5 px-4 text-right font-black text-[#16A34A] tabular-nums text-sm">
                        {formatCOP(ab.costo)}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-600 whitespace-nowrap">
                        {formatDateCO(ab.fecha)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 truncate max-w-xs">
                        {ab.observacion || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditAbono(ab)}
                            aria-label={`Editar abono ${ab.item}`}
                            className="w-11 h-11 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer"
                            title="Editar abono"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemToDelete(ab)}
                            aria-label={`Eliminar abono ${ab.item}`}
                            className="w-11 h-11 flex items-center justify-center text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200 cursor-pointer"
                            title="Eliminar abono"
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
                    <td colSpan={isSelectionMode ? 3 : 2} className="py-3.5 px-4 text-right uppercase tracking-wider text-slate-600">
                      TOTAL ABONOS:
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-[#16A34A] tabular-nums text-base">
                      {formatCOP(totalAbonos)}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile Cards (< 768px) */}
            <div className="md:hidden divide-y divide-slate-100">
              {abonos.map((ab) => (
                <div key={ab.id} className="p-4 space-y-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      {isSelectionMode && (
                        <button
                          type="button"
                          onClick={() => toggleSelect(ab.id)}
                          className="mt-1 text-[#0F766E] p-1 shrink-0"
                        >
                          {selectedIds.has(ab.id) ? (
                            <CheckSquare className="w-5 h-5" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-300" />
                          )}
                        </button>
                      )}
                      <div>
                        <span className="text-[10px] font-bold text-slate-400">#{ab.consecutivo}</span>
                        <h4 className="text-xs font-bold text-slate-900 leading-snug">{ab.item}</h4>
                        <p className="text-[11px] text-slate-500">{formatDateCO(ab.fecha)}</p>
                      </div>
                    </div>
                    <span className="text-sm font-black text-[#16A34A] tabular-nums shrink-0">
                      {formatCOP(ab.costo)}
                    </span>
                  </div>

                  {ab.observacion && (
                    <p className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      {ab.observacion}
                    </p>
                  )}

                  {/* Accessible Icon Buttons with 44px min target */}
                  <div className="flex items-center justify-end gap-3 pt-1 border-t border-slate-100/80">
                    <button
                      type="button"
                      onClick={() => openEditAbono(ab)}
                      aria-label={`Editar abono ${ab.item}`}
                      className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                      title="Editar abono"
                    >
                      <Pencil className="w-4 h-4 text-slate-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemToDelete(ab)}
                      aria-label={`Eliminar abono ${ab.item}`}
                      className="w-11 h-11 flex items-center justify-center rounded-xl border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-100/50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                      title="Eliminar abono"
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

      {/* Modal / Bottom Sheet para Registrar o Editar Abono */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => !isSaving && setIsModalOpen(false)} />

          <div className="relative z-10 w-full sm:max-w-md bg-white rounded-t-[28px] sm:rounded-2xl p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <PiggyBank className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {editingAbono ? 'Editar Abono de Cliente' : 'Registrar Nuevo Abono'}
                  </h3>
                  <span className="text-[10px] text-slate-400">Guarda directo en la base de datos</span>
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Ítem / Título del Abono:
                </label>
                <input
                  type="text"
                  required
                  value={itemNombre}
                  onChange={(e) => setItemNombre(e.target.value)}
                  placeholder="Ej: Primer abono"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Valor / Costo ($ COP):
                </label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={costo || ''}
                    onChange={(e) => setCosto(Number(e.target.value) || 0)}
                    placeholder="Ej: 15000000"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3.5 py-2.5 text-xs font-extrabold text-[#16A34A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
                {costo > 0 && (
                  <p className="text-[11px] font-bold text-emerald-700 mt-1">
                    {formatCOP(costo)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Fecha del Abono:
                </label>
                <input
                  type="date"
                  required
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Observación (Opcional):
                </label>
                <textarea
                  rows={2}
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="Ej: Giro anticipo avance de obra"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
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
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50 min-h-[44px]"
                >
                  {saveSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                      <span>Guardado ✓</span>
                    </>
                  ) : (
                    <span>{isSaving ? 'Guardando...' : editingAbono ? 'Guardar Cambios' : 'Crear Abono'}</span>
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
        itemName={itemToDelete?.item || 'este abono'}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmSingleDelete}
        onCancel={() => setItemToDelete(null)}
      />

      {/* Confirm Delete Dialog (Por Lote) */}
      <ConfirmDeleteDialog
        isOpen={isBatchDeleteDialogOpen}
        itemName={`${selectedIds.size} abonos seleccionados`}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmBatchDelete}
        onCancel={() => setIsBatchDeleteDialogOpen(false)}
      />
    </div>
  );
};
