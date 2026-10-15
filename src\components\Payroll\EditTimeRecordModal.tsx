import React, { useState, useEffect, useMemo } from 'react';
import { TimeRecord, Worker } from '../../types';
import { DateRangePicker } from '../Common/DateRangePicker';
import {
  X,
  Clock,
  Calendar,
  AlertCircle,
  Loader2,
  DollarSign,
  Trash2,
  CheckCircle2,
  Briefcase,
  User,
} from 'lucide-react';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';

interface EditTimeRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: TimeRecord | null;
  workers: Worker[];
  onSave: (recordId: string, updated: Partial<TimeRecord>) => Promise<void>;
  onDelete?: (recordId: string, record?: TimeRecord) => Promise<void>;
}

export const EditTimeRecordModal: React.FC<EditTimeRecordModalProps> = ({
  isOpen,
  onClose,
  record,
  workers,
  onSave,
  onDelete,
}) => {
  const [workerId, setWorkerId] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [regularHours, setRegularHours] = useState<number | ''>(8);
  const [overtimeHours, setOvertimeHours] = useState<number | ''>(0);
  const [daysWorked, setDaysWorked] = useState<number | ''>(1);
  const [activityNotes, setActivityNotes] = useState<string>('');

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      setWorkerId(record.workerId || '');
      setDate(record.date || new Date().toISOString().split('T')[0]);
      setRegularHours(record.regularHours !== undefined && record.regularHours !== null ? Number(record.regularHours) : 0);
      setOvertimeHours(record.overtimeHours !== undefined && record.overtimeHours !== null ? Number(record.overtimeHours) : 0);
      setDaysWorked(record.daysWorked !== undefined && record.daysWorked !== null ? Number(record.daysWorked) : (Number(record.regularHours) >= 7 ? 1 : 0.5));
      setActivityNotes(record.activityNotes || record.siteLocation || '');
      setErrorMsg(null);
    }
  }, [record]);

  const selectedWorker = useMemo(() => {
    return workers.find((w) => w.id === workerId);
  }, [workers, workerId]);

  const [rangeStart, rangeEnd, parsedSelectedDates] = useMemo(() => {
    if (!date) return ['', '', []];
    if (date.includes('al')) {
      const parts = date.split('al').map((s) => s.trim());
      return [parts[0] || '', parts[1] || parts[0] || '', []];
    }
    if (date.includes(',')) {
      const parts = date.split(',').map((s) => s.trim()).filter(Boolean);
      return [parts[0] || '', parts[parts.length - 1] || '', parts];
    }
    return [date, date, [date]];
  }, [date]);

  // Cálculo en vivo del subtotal y total estimado
  const calculatedPay = useMemo(() => {
    if (!selectedWorker) return { base: 0, overtime: 0, total: 0 };
    const rH = Number(regularHours) || 0;
    const dW = Number(daysWorked) || 0;
    const oH = Number(overtimeHours) || 0;
    const base =
      selectedWorker.rateUnit === 'Hora'
        ? rH * selectedWorker.baseRate
        : dW * selectedWorker.baseRate;
    const overtime = oH * selectedWorker.overtimeRate;
    return {
      base,
      overtime,
      total: base + overtime,
    };
  }, [selectedWorker, regularHours, overtimeHours, daysWorked]);

  if (!isOpen || !record) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerId) {
      setErrorMsg('Debes seleccionar un obrero.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await onSave(record.id, {
        workerId,
        workerName: selectedWorker?.name || record.workerName,
        date,
        regularHours: Number(regularHours),
        overtimeHours: Number(overtimeHours),
        daysWorked: Number(daysWorked),
        activityNotes: activityNotes.trim() || 'Jornada ajustada',
        siteLocation: activityNotes.trim(),
      });
      onClose();
    } catch (err: any) {
      console.error('Error al actualizar jornada:', err);
      setErrorMsg(err.message || 'Error al guardar modificaciones en Google Sheets.');
    } finally {
      setIsSaving(false);
    }
  };

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleDelete = () => {
    setIsConfirmingDelete(true);
  };

  const executeDelete = async () => {
    if (!onDelete || !record) return;

    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await onDelete(record.id, record);
      setIsConfirmingDelete(false);
      onClose();
    } catch (err: any) {
      console.error('Error al eliminar jornada:', err);
      setErrorMsg(err.message || 'Error al eliminar jornada en Google Sheets.');
    } finally {
      setIsDeleting(false);
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

        {/* Header con gradiente suave */}
        <div className="relative p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#1ca330] to-[#98d52c] text-white flex items-center justify-center font-bold shadow-xs">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Editar Jornada / Salario</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {record.id}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Corrige horas, días, horas extras o fecha registrada en Google Sheets
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

        {/* Mensaje de error si falla */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 1. Selector de Obrero */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Obrero Asignado</span>
            </label>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.role}) - ${w.baseRate.toLocaleString()} / {w.rateUnit}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Fecha y Horas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <DateRangePicker
                label="Fecha o Período"
                startDate={rangeStart}
                endDate={rangeEnd}
                selectedDates={parsedSelectedDates}
                compact
                onChange={(val) => {
                  if (val.selectionMode === 'individual' && val.selectedDates.length > 1) {
                    setDate(val.selectedDates.join(', '));
                  } else if (val.startDate === val.endDate || !val.endDate) {
                    setDate(val.startDate);
                  } else {
                    setDate(`${val.startDate} al ${val.endDate}`);
                  }
                  if (val.workingDays) {
                    setDaysWorked(val.workingDays);
                    setRegularHours(val.workingDays * 8);
                  }
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center justify-between">
                <span>Horas Ordinarias</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  {daysWorked} {daysWorked === 1 ? 'día' : 'días'}
                </span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={regularHours}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setRegularHours('');
                      setDaysWorked('');
                    } else {
                      const h = Math.max(0, parseFloat(v) || 0);
                      setRegularHours(h);
                      setDaysWorked(Math.round((h / 8) * 100) / 100);
                    }
                  }}
                  placeholder="0"
                  className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setRegularHours(8);
                    setDaysWorked(1);
                  }}
                  className="px-2 py-1.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg shrink-0"
                >
                  8h
                </button>
              </div>
            </div>
          </div>

          {/* 3. Horas Extras y Días */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center justify-between">
                <span>Horas Extras</span>
                {(Number(overtimeHours) || 0) > 0 && selectedWorker && (
                  <span className="text-[10px] font-bold text-amber-700">
                    +${((Number(overtimeHours) || 0) * selectedWorker.overtimeRate).toLocaleString()}
                  </span>
                )}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={overtimeHours}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setOvertimeHours('');
                    } else {
                      setOvertimeHours(Math.max(0, parseFloat(v) || 0));
                    }
                  }}
                  placeholder="0"
                  className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                />
                <button
                  type="button"
                  onClick={() => setOvertimeHours((prev) => (Number(prev) || 0) + 1)}
                  className="px-2 py-1.5 text-[10px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg shrink-0"
                >
                  +1h
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Días Fracción Equivalente
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={daysWorked}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setDaysWorked('');
                  } else {
                    setDaysWorked(Math.max(0, parseFloat(v) || 0));
                  }
                }}
                placeholder="0"
                className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
              />
            </div>
          </div>

          {/* 4. Actividad / Frente de Obra */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
              <Briefcase className="w-3.5 h-3.5 text-slate-400" />
              <span>Frente de Obra / Actividad Realizada</span>
            </label>
            <input
              type="text"
              value={activityNotes}
              onChange={(e) => setActivityNotes(e.target.value)}
              placeholder="Ej: Armado de vigas eje 3-B, estuco piso 2..."
              className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
            />
          </div>

          {/* Resumen de Liquidación de la Jornada */}
          <div className="p-3.5 bg-emerald-50/80 rounded-2xl border border-emerald-100 flex items-center justify-between text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
                Total Jornada Calculado
              </span>
              <span className="text-[11px] text-emerald-800 font-medium">
                Base: ${calculatedPay.base.toLocaleString()} + Extras: ${calculatedPay.overtime.toLocaleString()}
              </span>
            </div>
            <div className="text-right">
              <span className="text-base font-extrabold text-emerald-950 font-mono">
                ${calculatedPay.total.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-100">
            {onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving || isDeleting}
                className="px-3.5 py-2.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors flex items-center gap-1.5"
                title="Eliminar este registro de jornada erróneo"
              >
                {isDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Eliminar Registro</span>
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving || isDeleting}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving || isDeleting}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-xs hover:shadow-md transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando en Sheets...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Guardar Jornada</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      <ConfirmDeleteDialog
        isOpen={isConfirmingDelete}
        itemName={`Jornada de ${record.workerName || 'trabajador'} (${date})`}
        description="Se eliminará este registro de jornada de Google Sheets."
        isDeleting={isDeleting}
        onConfirm={executeDelete}
        onCancel={() => setIsConfirmingDelete(false)}
      />
    </div>
  );
};
