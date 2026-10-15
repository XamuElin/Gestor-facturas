import React, { useEffect, useState } from 'react';
import { RotateCcw, X, CheckCircle2 } from 'lucide-react';

export interface UndoActionItem {
  id: string;
  message: string;
  onUndo: () => void;
  durationSeconds?: number;
}

interface UndoToastProps {
  action: UndoActionItem | null;
  onDismiss: () => void;
}

export const UndoToast: React.FC<UndoToastProps> = ({ action, onDismiss }) => {
  const [secondsLeft, setSecondsLeft] = useState(8);

  useEffect(() => {
    if (!action) return;
    const duration = action.durationSeconds || 8;
    setSecondsLeft(duration);

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [action, onDismiss]);

  if (!action) return null;

  return (
    <div className="fixed bottom-24 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-md animate-in slide-in-from-bottom duration-200">
      <div className="bg-slate-950 text-white rounded-2xl p-4 shadow-2xl border border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0 animate-pulse" />
          <p className="text-xs font-semibold truncate text-slate-200">
            {action.message}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              action.onUndo();
              onDismiss();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all active:scale-95 shadow-sm min-h-[38px] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Deshacer ({secondsLeft}s)</span>
          </button>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Cerrar notificación"
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
