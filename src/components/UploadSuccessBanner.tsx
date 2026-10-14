import React from 'react';
import { CheckCircle2, ExternalLink, FileSpreadsheet, FolderOpen, PlusCircle, X } from 'lucide-react';

interface UploadSuccessBannerProps {
  driveUrl?: string;
  sheetUrl?: string;
  fileName?: string;
  projectName?: string;
  onDismiss: () => void;
  onAddMore?: () => void;
}

export const UploadSuccessBanner: React.FC<UploadSuccessBannerProps> = ({
  driveUrl,
  sheetUrl,
  fileName,
  projectName,
  onDismiss,
  onAddMore,
}) => {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg shrink-0 mt-0.5">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-emerald-900">
              ¡Factura subida a Drive y registrada en Google Sheets!
            </h4>
            <p className="text-xs text-emerald-700 mt-0.5">
              Se anexó el archivo <strong>{fileName}</strong> a la carpeta de la obra{' '}
              <strong>"{projectName}"</strong> y se añadió la nueva fila en su hoja de cálculo.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 mt-3">
              {onAddMore && (
                <button
                  id="btn-success-add-more-invoices"
                  type="button"
                  onClick={onAddMore}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-[#1ca330] hover:bg-[#168826] px-3.5 py-1.5 rounded-lg shadow-xs transition-all active:scale-95"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Agregar más facturas (máx. 15)</span>
                </button>
              )}

              {driveUrl && (
                <a
                  id="btn-success-view-drive"
                  href={driveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-800 bg-white hover:bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg shadow-xs transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-sky-600" />
                  <span>Ver archivo en Google Drive</span>
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              )}

              {sheetUrl && (
                <a
                  id="btn-success-view-sheet"
                  href={sheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg shadow-xs transition-colors"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Abrir Google Sheet de la Obra</span>
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="text-emerald-500 hover:text-emerald-700 p-1 rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
