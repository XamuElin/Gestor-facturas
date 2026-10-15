import React, { useState } from 'react';
import {
  Users,
  Plus,
  X,
  Pencil,
  Trash2,
  CheckCircle2,
  Briefcase,
  Calendar,
  DollarSign,
  AlertCircle,
} from 'lucide-react';
import { WorkerCatalogItem, generateUUID } from '../utils/constructionCalculations';
import { formatCOP, formatDateCO } from '../utils/formatters';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

interface WorkersCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  workers: WorkerCatalogItem[];
  onSaveWorker: (worker: WorkerCatalogItem) => Promise<void>;
  onDeleteWorker: (workerId: string) => Promise<void>;
}

export const WorkersCatalogModal: React.FC<WorkersCatalogModalProps> = ({
  isOpen,
  onClose,
  workers,
  onSaveWorker,
  onDeleteWorker,
}) => {
  const [editingWorker, setEditingWorker] = useState<WorkerCatalogItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<WorkerCatalogItem['rol']>('oficial');
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().split('T')[0]);
  const [tipo, setTipo] = useState<WorkerCatalogItem['tipo']>('con prestaciones');
  const [salarioMensual, setSalarioMensual] = useState<number>(1800000);
  const [auxilioTransporte, setAuxilioTransporte] = useState<number>(250000);
  const [descuentoSaludPension, setDescuentoSaludPension] = useState<number>(140000);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Delete dialog state
  const [workerToDelete, setWorkerToDelete] = useState<WorkerCatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen) return null;

  const startCreate = () => {
    setEditingWorker(null);
    setNombre('');
    setRol('oficial');
    setFechaInicio(new Date().toISOString().split('T')[0]);
    setTipo('con prestaciones');
    setSalarioMensual(1800000);
    setAuxilioTransporte(250000);
    setDescuentoSaludPension(140000);
    setFormError(null);
    setSaveSuccess(false);
    setIsCreating(true);
  };

  const startEdit = (w: WorkerCatalogItem) => {
    setEditingWorker(w);
    setNombre(w.nombre);
    setRol(w.rol);
    setFechaInicio(w.fechaInicio);
    setTipo(w.tipo);
    setSalarioMensual(w.salarioMensual);
    setAuxilioTransporte(w.auxilioTransporte);
    setDescuentoSaludPension(w.descuentoSaludPension);
    setFormError(null);
    setSaveSuccess(false);
    setIsCreating(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      setFormError('El nombre del trabajador es obligatorio');
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      const item: WorkerCatalogItem = {
        id: editingWorker ? editingWorker.id : generateUUID(),
        origen: editingWorker?.origen || 'manual',
        creadoEn: editingWorker?.creadoEn || Date.now(),
        actualizadoEn: Date.now(),
        nombre: nombre.trim().toUpperCase(),
        rol,
        fechaInicio: fechaInicio || new Date().toISOString().split('T')[0],
        tipo,
        salarioMensual: Number(salarioMensual) || 0,
        auxilioTransporte: tipo === 'independiente' ? 0 : Number(auxilioTransporte) || 0,
        descuentoSaludPension: tipo === 'independiente' ? 0 : Number(descuentoSaludPension) || 0,
      };

      await onSaveWorker(item);
      setSaveSuccess(true);
      setTimeout(() => {
        setIsCreating(false);
        setEditingWorker(null);
        setSaveSuccess(false);
      }, 600);
    } catch (err: any) {
      setFormError(err?.message || 'Error al guardar el trabajador');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!workerToDelete) return;
    setIsDeleting(true);
    try {
      await onDeleteWorker(workerToDelete.id);
      setWorkerToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-[#F6F7F9]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Catálogo de Trabajadores de la Obra</h3>
              <p className="text-xs text-slate-500">
                Compartido por Mano de Obra (Bitácoras) y Nóminas ({workers.length} registrados)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {/* Action Bar */}
          {!isCreating && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Personal Registrado
              </span>
              <button
                type="button"
                id="btn-agregar-trabajador-catalogo"
                onClick={startCreate}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold rounded-xl shadow-2xs transition-all min-h-[44px]"
              >
                <Plus className="w-4 h-4" />
                <span>+ Agregar Trabajador</span>
              </button>
            </div>
          )}

          {/* Form */}
          {isCreating ? (
            <div className="bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  {editingWorker ? 'Editar Datos del Trabajador' : 'Nuevo Trabajador para la Obra'}
                </h4>
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                >
                  Cancelar
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Nombre Completo *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: JOSÉ ALFREDO RODRÍGUEZ"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Rol / Especialidad *</label>
                    <select
                      value={rol}
                      onChange={(e) => setRol(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    >
                      <option value="oficial">Oficial</option>
                      <option value="ayudante">Ayudante</option>
                      <option value="cielo raso">Cielo Raso</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Fecha de Inicio *</label>
                    <input
                      type="date"
                      required
                      value={fechaInicio}
                      onChange={(e) => setFechaInicio(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Tipo de Contrato *</label>
                    <select
                      value={tipo}
                      onChange={(e) => {
                        const newTipo = e.target.value as any;
                        setTipo(newTipo);
                        if (newTipo === 'independiente') {
                          setAuxilioTransporte(0);
                          setDescuentoSaludPension(0);
                        } else {
                          setAuxilioTransporte(250000);
                          setDescuentoSaludPension(140000);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    >
                      <option value="con prestaciones">Con prestaciones</option>
                      <option value="independiente">Independiente (sin auxilio ni descuentos)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Salario Mensual ($) *</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      required
                      value={salarioMensual || ''}
                      onChange={(e) => setSalarioMensual(Number(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold tabular-nums text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Auxilio Transporte ($)</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      disabled={tipo === 'independiente'}
                      value={auxilioTransporte || ''}
                      onChange={(e) => setAuxilioTransporte(Number(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold tabular-nums text-slate-900 bg-white disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Desc. Salud/Pensión ($)</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      disabled={tipo === 'independiente'}
                      value={descuentoSaludPension || ''}
                      onChange={(e) => setDescuentoSaludPension(Number(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold tabular-nums text-slate-900 bg-white disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold shadow-sm min-h-[44px]"
                  >
                    {saveSuccess ? 'Guardado ✓' : editingWorker ? 'Guardar Cambios' : 'Registrar Trabajador'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div>
              {workers.length === 0 ? (
                <div className="p-8 sm:p-12 text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                    <Users className="w-7 h-7" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">Catálogo vacío</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    No hay trabajadores registrados en esta obra. Agrega los operarios de tu cuadrilla para precargar sus valores en Mano de Obra y Nóminas.
                  </p>
                  <button
                    type="button"
                    onClick={startCreate}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F766E] text-white text-xs font-bold shadow-sm hover:bg-[#0d655f] min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ Registrar Primer Trabajador</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {workers.map((w) => (
                    <div
                      key={w.id}
                      className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow space-y-2 relative"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 leading-snug">{w.nombre}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-[#0F766E] uppercase">
                              {w.rol}
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium">
                              {w.tipo === 'independiente' ? 'Independiente' : 'Prestaciones'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEdit(w)}
                            aria-label={`Editar ${w.nombre}`}
                            className="w-10 h-10 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 cursor-pointer"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setWorkerToDelete(w)}
                            aria-label={`Eliminar ${w.nombre}`}
                            className="w-10 h-10 flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-[11px] tabular-nums">
                        <div>
                          <span className="text-[10px] text-slate-400 block font-semibold">Salario Mes</span>
                          <span className="font-bold text-slate-800">{formatCOP(w.salarioMensual)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block font-semibold">Auxilio T.</span>
                          <span className="font-bold text-slate-800">{formatCOP(w.auxilioTransporte)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block font-semibold">Desc. Salud</span>
                          <span className="font-bold text-slate-800">{formatCOP(w.descuentoSaludPension)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirm Delete Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!workerToDelete}
        itemName={workerToDelete?.nombre || 'este trabajador'}
        description="Podrás deshacerlo durante 8 segundos. No afectará las bitácoras o nóminas ya calculadas."
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setWorkerToDelete(null)}
      />
    </div>
  );
};
