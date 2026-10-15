import React from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';

interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  title?: string;
  itemName: string;
  description?: string;
  confirmLabel?: string;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({
  isOpen,
  title = '¿Eliminar registro?',
  itemName,
  description = 'Podrás deshacerlo durante 8 segundos.',
  confirmLabel = 'Eliminar',
  isDeleting = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop click */}
      <div className="fixed inset-0" onClick={onCancel} aria-hidden="true" />

      {/* Sheet / Dialog Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="relative z-10 w-full sm:max-w-md bg-white rounded-t-[28px] sm:rounded-2xl p-6 shadow-2xl border border-slate-200 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 text-left"
      >
        {/* Mobile drag handle */}
        <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-4 sm:hidden" />

        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 id="confirm-delete-title" className="text-base font-bold text-slate-900 leading-snug">
              ¿Eliminar <span className="text-rose-600 font-extrabold break-words">"{itemName}"</span>?
            </h3>
            <p className="text-xs text-slate-600 mt-1 font-medium">
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info notice */}
        <div className="mt-4 p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-center gap-2 text-xs text-amber-800 font-medium">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>El cálculo y los totales se actualizarán al instante.</span>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors min-h-[44px]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50 min-h-[44px]"
          >
            <Trash2 className="w-4 h-4" />
            <span>{isDeleting ? 'Eliminando...' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
