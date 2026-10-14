import React from 'react';
import {
  AlertTriangle,
  FolderX,
  FileSpreadsheet,
  Settings,
  Sparkles,
  RefreshCw,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { DriveFilesCheckResult } from '../types';

interface DriveFilesWarningAlertProps {
  warning: DriveFilesCheckResult;
  projectName: string;
  onOpenConfig: () => void;
  onRepairFiles: () => Promise<void>;
  onRecheck: () => Promise<void>;
  isRepairing?: boolean;
  isChecking?: boolean;
  onDismiss?: () => void;
  compact?: boolean;
}

export const DriveFilesWarningAlert: React.FC<DriveFilesWarningAlertProps> = ({
  warning,
  projectName,
  onOpenConfig,
  onRepairFiles,
  onRecheck,
  isRepairing = false,
  isChecking = false,
  onDismiss,
  compact = false,
}) => {
  if (warning.isValid && !warning.hasRenamedFiles) {
    return null;
  }

  return (
    <div
      id="alert-drive-files-missing"
      className="bg-amber-50 border-2 border-amber-400/80 rounded-xl p-4 sm:p-5 shadow-sm text-slate-800 transition-all animate-fadeIn"
      role="alert"
    >
      <div className="flex items-start gap-3">
        {/* Warning Icon Badge */}
        <div className="p-2.5 rounded-xl bg-amber-500 text-white shrink-0 shadow-xs">
          <AlertTriangle className="w-5 h-5 animate-pulse" />
        </div>

        {/* Content Section */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-sm sm:text-base font-bold text-amber-950 flex items-center gap-1.5">
              <span>Aviso: Archivos en Google Drive eliminados o modificados</span>
            </h4>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="text-amber-700/70 hover:text-amber-950 p-1 rounded-md transition-colors"
                title="Cerrar aviso"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
          </div>

          <p className="text-xs sm:text-sm font-semibold text-amber-900 mt-1">
            Los archivos creados en Google Drive para la obra{' '}
            <span className="font-bold underline underline-offset-2 text-amber-950">
              "{projectName}"
            </span>{' '}
            ya no existen porque fueron eliminados o cambiaron su nombre al tratar de añadir una factura.
          </p>

          {/* Breakdown of affected items */}
          <div className="mt-3 space-y-2">
            {warning.folderStatus.trashed && (
              <div className="flex items-start gap-2 bg-white/90 border border-amber-300 rounded-lg p-2.5 text-xs text-slate-800 shadow-2xs">
                <FolderX className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-red-800 block">
                    Carpeta de evidencias no encontrada o eliminada:
                  </span>
                  <span className="text-slate-600">
                    La carpeta "
                    <strong className="text-slate-800">
                      {warning.folderStatus.expectedName || 'Carpeta de Evidencias'}
                    </strong>
                    " fue eliminada permanentemente o enviada a la papelera en tu Google Drive.
                  </span>
                </div>
              </div>
            )}

            {warning.folderStatus.renamed && (
              <div className="flex items-start gap-2 bg-white/90 border border-amber-300 rounded-lg p-2.5 text-xs text-slate-800 shadow-2xs">
                <FolderX className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-amber-900 block">
                    La carpeta de evidencias cambió de nombre en Drive:
                  </span>
                  <span className="text-slate-600">
                    Nombre original: "
                    <strong>{warning.folderStatus.expectedName}</strong>" ➔ Nombre actual en Drive: "
                    <strong className="text-amber-900">{warning.folderStatus.currentName}</strong>"
                  </span>
                </div>
              </div>
            )}

            {warning.sheetStatus.trashed && (
              <div className="flex items-start gap-2 bg-white/90 border border-amber-300 rounded-lg p-2.5 text-xs text-slate-800 shadow-2xs">
                <FileSpreadsheet className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-red-800 block">
                    Hoja de cálculo de control no encontrada o eliminada:
                  </span>
                  <span className="text-slate-600">
                    El archivo de Google Sheets "
                    <strong className="text-slate-800">
                      {warning.sheetStatus.expectedName || 'Control de Facturas'}
                    </strong>
                    " fue eliminado permanentemente o enviado a la papelera en Drive.
                  </span>
                </div>
              </div>
            )}

            {warning.sheetStatus.renamed && (
              <div className="flex items-start gap-2 bg-white/90 border border-amber-300 rounded-lg p-2.5 text-xs text-slate-800 shadow-2xs">
                <FileSpreadsheet className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-amber-900 block">
                    La hoja de cálculo de control cambió de nombre en Drive:
                  </span>
                  <span className="text-slate-600">
                    Nombre original: "
                    <strong>{warning.sheetStatus.expectedName}</strong>" ➔ Nombre actual en Drive: "
                    <strong className="text-amber-900">{warning.sheetStatus.currentName}</strong>"
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-4 flex items-center gap-2.5 flex-wrap">
            {warning.hasDeletedFiles && (
              <button
                type="button"
                id="btn-repair-missing-drive-files"
                onClick={onRepairFiles}
                disabled={isRepairing}
                className="inline-flex items-center gap-1.5 bg-[#1ca330] hover:bg-[#168826] text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-all active:scale-95 disabled:opacity-60"
              >
                {isRepairing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Recreando en Google Drive...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-[#98d52c]" />
                    <span>Recrear archivos faltantes en Drive</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              id="btn-reconfigure-missing-destinations"
              onClick={onOpenConfig}
              className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-amber-300 font-semibold text-xs px-3.5 py-2 rounded-lg shadow-2xs transition-colors"
            >
              <Settings className="w-3.5 h-3.5 text-amber-700" />
              <span>Configurar o vincular otros destinos</span>
            </button>

            <button
              type="button"
              id="btn-recheck-drive-status"
              onClick={onRecheck}
              disabled={isChecking}
              className="inline-flex items-center gap-1 text-xs text-amber-900 hover:text-amber-950 font-medium px-2.5 py-2 rounded-lg hover:bg-amber-100/70 transition-colors disabled:opacity-50"
              title="Volver a consultar si los archivos fueron restaurados de la papelera en Google Drive"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'Comprobando...' : 'Volver a comprobar'}</span>
            </button>
          </div>

          <div className="mt-2 text-[11px] text-amber-800/80 flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Si restauras los archivos desde la papelera de Google Drive, pulsa "Volver a comprobar" para continuar registrando facturas normalmente.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
