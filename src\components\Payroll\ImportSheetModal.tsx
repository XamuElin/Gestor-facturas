import React, { useState } from 'react';
import {
  X,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { payrollService } from '../../services/payrollService';

interface ImportSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string;
  destinationSpreadsheetId: string;
  onSuccess: (message: string) => void;
}

export const ImportSheetModal: React.FC<ImportSheetModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  destinationSpreadsheetId,
  onSuccess,
}) => {
  const [sourceUrlOrId, setSourceUrlOrId] = useState('');
  const [newTabTitle, setNewTabTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceUrlOrId.trim()) {
      setErrorMsg('Por favor ingresa el enlace o identificador de la hoja de cálculo de Google Sheets.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      const result = await payrollService.importSheetAsTab(
        accessToken,
        destinationSpreadsheetId,
        sourceUrlOrId.trim(),
        newTabTitle.trim() || undefined
      );

      onSuccess(result.message || `Pestaña "${result.sheetTitle}" añadida correctamente a la hoja de cálculo.`);
      onClose();
      setSourceUrlOrId('');
      setNewTabTitle('');
    } catch (err: any) {
      console.error('Error importando hoja:', err);
      setErrorMsg(err.message || 'No se pudo importar la hoja existente como pestaña.');
    } finally {
      setIsLoading(false);
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

        {/* Header */}
        <div className="relative p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#1ca330] to-[#98d52c] text-white flex items-center justify-center font-bold shadow-xs">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Añadir Hoja de Cálculo Existente como Pestaña
              </h3>
              <p className="text-[11px] text-slate-500">
                Importa una hoja externa de Google Drive directamente a tu planilla activa
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
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              <span>Enlace o ID de la Hoja de Google Sheets *</span>
            </label>
            <input
              type="text"
              required
              value={sourceUrlOrId}
              onChange={(e) => setSourceUrlOrId(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
              className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
            />
            <p className="text-[10px] text-slate-400">
              Pega la URL completa de la hoja de cálculo de Google Sheets o su ID de archivo.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
              Nombre para la Pestaña (Opcional)
            </label>
            <input
              type="text"
              value={newTabTitle}
              onChange={(e) => setNewTabTitle(e.target.value)}
              placeholder="Ej: Nomina_Anterior, Presupuesto_Materiales, etc."
              className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
            />
            <p className="text-[10px] text-slate-400">
              Si se deja en blanco, se conservará el nombre original de la pestaña importada.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 text-[11px] text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#1ca330]" />
              <span>Copia exacta de datos y formato</span>
            </div>
            <p className="text-[10px] text-slate-500">
              La API de Google Sheets clonará automáticamente las celdas, estilos, colores y fórmulas a una nueva pestaña en tu libro principal.
            </p>
          </div>

          {/* Botones de Acción */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || !sourceUrlOrId.trim()}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-xs hover:shadow-md transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Importando pestaña...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Añadir como Pestaña</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
