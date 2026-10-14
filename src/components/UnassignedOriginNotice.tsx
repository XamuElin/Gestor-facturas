import React, { useState } from 'react';
import { AlertTriangle, Trash2, CheckSquare, Square, X, CheckCircle2, ShieldAlert } from 'lucide-react';
import { UnassignedRecordItem } from '../services/constructionDbService';

import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

interface UnassignedOriginNoticeProps {
  unassignedRecords: UnassignedRecordItem[];
  onDeleteSelected: (records: UnassignedRecordItem[]) => Promise<void>;
  onKeepSelected: (records: UnassignedRecordItem[]) => Promise<void>;
  onDismiss: () => void;
}

export const UnassignedOriginNotice: React.FC<UnassignedOriginNoticeProps> = ({
  unassignedRecords,
  onDeleteSelected,
  onKeepSelected,
  onDismiss,
}) => {
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(unassignedRecords.map((r) => r.id))
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmingDeleteAll, setIsConfirmingDeleteAll] = useState(false);
  const [isConfirmingDeleteSelected, setIsConfirmingDeleteSelected] = useState(false);

  if (!unassignedRecords || unassignedRecords.length === 0) return null;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === unassignedRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unassignedRecords.map((r) => r.id)));
    }
  };

  const executeDeleteAll = async () => {
    setIsProcessing(true);
    try {
      await onDeleteSelected(unassignedRecords);
      setIsConfirmingDeleteAll(false);
      setIsReviewModalOpen(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const executeDeleteSelected = async () => {
    const toDelete = unassignedRecords.filter((r) => selectedIds.has(r.id));
    if (toDelete.length === 0) return;
    setIsProcessing(true);
    try {
      await onDeleteSelected(toDelete);
      setIsConfirmingDeleteSelected(false);
      setIsReviewModalOpen(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeepAll = async () => {
    setIsProcessing(true);
    try {
      await onKeepSelected(unassignedRecords);
      setIsReviewModalOpen(false);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      {/* Aviso Superior en la App */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-amber-900 animate-in fade-in duration-200">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-xs font-semibold">
              Encontramos <strong>{unassignedRecords.length}</strong> registros sin origen registrado (pueden ser datos de ejemplo).
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => setIsReviewModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold transition-colors min-h-[38px]"
            >
              Revisar
            </button>
            <button
              type="button"
              onClick={() => setIsConfirmingDeleteAll(true)}
              disabled={isProcessing}
              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-xs min-h-[38px] cursor-pointer"
            >
              Borrar todos
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Cerrar aviso"
              className="p-1.5 text-amber-700 hover:text-amber-900 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal / Hoja de Revisión con Casillas */}
      {isReviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsReviewModalOpen(false)} />

          <div className="relative z-10 w-full sm:max-w-lg bg-white rounded-t-[28px] sm:rounded-2xl p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    Registros sin origen ({unassignedRecords.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Marca los que desees eliminar o consérvalos como manuales.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Select All Bar */}
            <div className="py-2.5 flex items-center justify-between text-xs text-slate-600 border-b border-slate-100">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 font-bold hover:text-slate-900"
              >
                {selectedIds.size === unassignedRecords.length ? (
                  <CheckSquare className="w-4 h-4 text-[#0F766E]" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400" />
                )}
                <span>Seleccionar todos ({selectedIds.size}/{unassignedRecords.length})</span>
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 py-1 max-h-[45vh]">
              {unassignedRecords.map((r) => {
                const isSelected = selectedIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    onClick={() => toggleSelect(r.id)}
                    className="py-2.5 px-1.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded-xl transition-colors"
                  >
                    <div className="shrink-0 text-[#0F766E]">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {r.title}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {r.details}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                      {r.subcollection}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Footer Actions */}
            <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleKeepAll}
                disabled={isProcessing}
                className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors min-h-[44px]"
              >
                Conservar todos
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDeleteSelected(true)}
                  disabled={selectedIds.size === 0 || isProcessing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors disabled:opacity-50 min-h-[44px] cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Eliminar ({selectedIds.size})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de Confirmación para Borrar Todos */}
      <ConfirmDeleteDialog
        isOpen={isConfirmingDeleteAll}
        itemName={`todos los ${unassignedRecords.length} registros sin origen`}
        description="Se eliminarán de la obra. Podrás deshacerlo durante 8 segundos."
        isDeleting={isProcessing}
        onConfirm={executeDeleteAll}
        onCancel={() => setIsConfirmingDeleteAll(false)}
      />

      {/* Diálogo de Confirmación para Borrar Seleccionados */}
      <ConfirmDeleteDialog
        isOpen={isConfirmingDeleteSelected}
        itemName={`${selectedIds.size} registros seleccionados`}
        description="Se eliminarán de la obra. Podrás deshacerlo durante 8 segundos."
        isDeleting={isProcessing}
        onConfirm={executeDeleteSelected}
        onCancel={() => setIsConfirmingDeleteSelected(false)}
      />
    </>
  );
};
