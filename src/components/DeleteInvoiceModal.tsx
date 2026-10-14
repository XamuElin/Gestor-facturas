import React, { useState } from 'react';
import { SheetInvoiceRecord, ProjectFolder } from '../types';
import {
  Trash2,
  AlertTriangle,
  X,
  Loader2,
  Calendar,
  DollarSign,
  FileSpreadsheet,
  HardDrive,
  FileText,
} from 'lucide-react';

interface DeleteInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: SheetInvoiceRecord | null;
  project: ProjectFolder;
  onConfirmDelete: (invoice: SheetInvoiceRecord) => Promise<void>;
}

export const DeleteInvoiceModal: React.FC<DeleteInvoiceModalProps> = ({
  isOpen,
  onClose,
  invoice,
  project,
  onConfirmDelete,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !invoice) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await onConfirmDelete(invoice);
      onClose();
    } catch (err: any) {
      console.error('Error al eliminar factura:', err);
      setErrorMessage(
        err.message || 'Ocurrió un error al intentar eliminar la factura de Sheets y Drive.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
    >
      <div
        id="delete-invoice-dialog"
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3 bg-rose-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 id="delete-modal-title" className="text-base font-bold text-slate-900">
                ¿Eliminar esta factura?
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Obra: <span className="font-semibold text-slate-700">{project.name}</span>
              </p>
            </div>
          </div>

          <button
            id="btn-close-delete-modal"
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Invoice Summary Card */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <span className="font-medium text-slate-500">Nº Factura:</span>
              <span className="font-bold text-slate-900 text-sm">{invoice.invoiceNumber || 'S/N'}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Proveedor / Emisor:</span>
              <span className="font-semibold text-slate-800 truncate max-w-[240px] text-right">
                {invoice.vendorName || 'Sin proveedor'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Concepto:</span>
              <span className="text-slate-700 truncate max-w-[240px] text-right">
                {invoice.concept || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Fecha:
              </span>
              <span className="font-medium text-slate-700">
                {invoice.issueDate || invoice.registrationDate || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="font-semibold text-slate-700 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-slate-500" />
                Importe Total:
              </span>
              <span className="font-extrabold text-slate-900 text-sm">
                $ {invoice.totalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {invoice.fileName && (
              <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                <span className="flex items-center gap-1 truncate max-w-[120px]">
                  <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                  Archivo:
                </span>
                <span className="font-mono truncate max-w-[220px]">{invoice.fileName}</span>
              </div>
            )}
          </div>

          {/* Action Warnings List */}
          <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Esta acción ejecutará las siguientes operaciones permanentes:</span>
            </div>
            <ul className="text-xs text-amber-800 space-y-1.5 pl-6 list-disc">
              <li>
                <span className="font-semibold">Google Sheets:</span> Eliminará la fila de registro contable en la hoja de cálculo de la obra.
              </li>
              <li>
                <span className="font-semibold">Google Drive:</span> Eliminará de forma definitiva el archivo de imagen de la factura guardado en la carpeta de evidencias.
              </li>
            </ul>
          </div>

          {/* Error notice if deletion failed */}
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            id="btn-cancel-delete-invoice"
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition-colors shadow-xs disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            id="btn-confirm-delete-invoice"
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm active:scale-95 disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Eliminando de Sheets y Drive...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Confirmar y Eliminar</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
