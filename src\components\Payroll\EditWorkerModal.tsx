import React, { useState, useEffect } from 'react';
import { Worker, PaymentFrequency } from '../../types';
import {
  X,
  UserCheck,
  Loader2,
  DollarSign,
  AlertCircle,
  Briefcase,
  Hash,
  Phone,
  Calendar,
} from 'lucide-react';
import { WorkerRoleSelect } from './WorkerRoleSelect';
import { saveCustomWorkerRole } from '../../utils/workerRoles';

interface EditWorkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker | null;
  onSave: (updatedWorker: Worker) => Promise<void>;
}

export const EditWorkerModal: React.FC<EditWorkerModalProps> = ({
  isOpen,
  onClose,
  worker,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [dni, setDni] = useState('');
  const [role, setRole] = useState('Ayudante');
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>('Semanal');
  const [rateUnit, setRateUnit] = useState<'Dia' | 'Hora'>('Dia');
  const [baseRate, setBaseRate] = useState<number | ''>(60000);
  const [overtimeRate, setOvertimeRate] = useState<number | ''>(12000);
  const [phone, setPhone] = useState('');
  const [active, setActive] = useState<boolean>(true);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (worker) {
      setName(worker.name || '');
      setDni(worker.dni || '');
      setRole(worker.role || 'Ayudante');
      setPaymentFrequency(worker.paymentFrequency || 'Semanal');
      setRateUnit(worker.rateUnit || 'Dia');
      setBaseRate(worker.baseRate !== undefined && worker.baseRate !== null ? Number(worker.baseRate) : 60000);
      setOvertimeRate(worker.overtimeRate !== undefined && worker.overtimeRate !== null ? Number(worker.overtimeRate) : 12000);
      setPhone(worker.phone || '');
      setActive(worker.active !== false);
      setErrorMsg(null);
    }
  }, [worker]);

  if (!isOpen || !worker) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('El nombre del obrero es obligatorio.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      if (role.trim()) {
        saveCustomWorkerRole(role.trim());
      }

      const updated: Worker = {
        ...worker,
        name: name.trim(),
        dni: dni.trim(),
        role: role.trim(),
        paymentFrequency,
        rateUnit,
        baseRate: Number(baseRate) || 0,
        overtimeRate: Number(overtimeRate) || 0,
        phone: phone.trim(),
        active,
      };

      await onSave(updated);
      onClose();
    } catch (err: any) {
      console.error('Error al guardar cambios del obrero:', err);
      setErrorMsg(err.message || 'Error al guardar los cambios en Google Sheets.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl border border-white/60 shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
        {/* Glow de fondo */}
        <div className="absolute -right-16 -top-16 w-48 h-48 bg-emerald-400/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 w-48 h-48 bg-teal-400/10 rounded-full blur-2xl pointer-events-none" />

        {/* Header con gradiente suave Glassmorphism */}
        <div className="relative p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#1ca330] to-[#98d52c] text-white flex items-center justify-center font-bold shadow-xs">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Editar Ficha de Obrero</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {worker.id}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Modifica tarifas base, cargo y frecuencia en Google Sheets
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mensaje de error si falla la actualización */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Nombre y Cédula */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Nombre Completo *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                <Hash className="w-3 h-3 text-slate-400" />
                <span>Cédula / DNI</span>
              </label>
              <input
                type="text"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                placeholder="Ej: 1024567890"
                className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
              />
            </div>
          </div>

          {/* Rol y Frecuencia de Pago */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                <Briefcase className="w-3 h-3 text-slate-400" />
                <span>Rol / Oficio</span>
              </label>
              <WorkerRoleSelect
                value={role}
                onChange={setRole}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                <span>Frecuencia de Pago</span>
              </label>
              <select
                value={paymentFrequency}
                onChange={(e) => setPaymentFrequency(e.target.value as PaymentFrequency)}
                className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
              >
                <option value="Semanal">Semanal (Sábado)</option>
                <option value="Quincenal">Quincenal</option>
                <option value="Mensual">Mensual</option>
                <option value="Diario">Diario (Jornal)</option>
              </select>
            </div>
          </div>

          {/* Modalidad, Valor Base y Hora Extra */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-600 uppercase">
                Modalidad
              </label>
              <select
                value={rateUnit}
                onChange={(e) => setRateUnit(e.target.value as 'Dia' | 'Hora')}
                className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30"
              >
                <option value="Dia">Por Día</option>
                <option value="Hora">Por Hora</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-600 uppercase">
                Valor Base ($)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={baseRate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setBaseRate('');
                  } else {
                    const n = parseFloat(v);
                    setBaseRate(isNaN(n) ? '' : Math.max(0, n));
                  }
                }}
                placeholder="0"
                className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-600 uppercase">
                Hora Extra ($)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={overtimeRate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setOvertimeRate('');
                  } else {
                    const n = parseFloat(v);
                    setOvertimeRate(isNaN(n) ? '' : Math.max(0, n));
                  }
                }}
                placeholder="0"
                className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30"
              />
            </div>
          </div>

          {/* Teléfono y Estado Activo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-1">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                <Phone className="w-3 h-3 text-slate-400" />
                <span>Teléfono / WhatsApp</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ej: 310 123 4567"
                className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
              />
            </div>

            <div className="flex items-center gap-3 pt-4 sm:pt-5">
              <input
                type="checkbox"
                id="edit-worker-active"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="w-4 h-4 text-[#1ca330] rounded-sm focus:ring-[#1ca330] border-slate-300"
              />
              <label htmlFor="edit-worker-active" className="text-xs font-semibold text-slate-700 cursor-pointer">
                Obrero Activo en Cuadrilla
              </label>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="p-4 border-t border-slate-100 flex items-center justify-end gap-2 pt-4 bg-slate-50/50 -mx-6 -mb-6 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/80 rounded-xl transition-colors"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando en Sheets...</span>
                </>
              ) : (
                <span>Guardar Cambios</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
