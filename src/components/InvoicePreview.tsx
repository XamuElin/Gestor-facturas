import React, { useState } from 'react';
import {
  FileSpreadsheet,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  DollarSign,
  ArrowRight,
  ShieldCheck,
  Receipt,
  Sparkles,
} from 'lucide-react';
import { InvoiceData } from '../types';

export interface ProcessedInvoiceItem {
  id?: string;
  cliente: string;
  fecha: string;
  concepto: string;
  total: number;
  subtotal?: number;
  iva?: number;
  numeroFactura?: string;
  nitRut?: string;
  moneda?: string;
  categoria?: string;
  fileName?: string;
  driveUrl?: string;
}

export interface InvoicePreviewProps {
  invoices: ProcessedInvoiceItem[] | InvoiceData[];
  onExportToSheets?: () => Promise<{ spreadsheetUrl?: string } | void>;
  isExporting?: boolean;
  spreadsheetUrl?: string | null;
  projectName?: string;
  evidenceFolderName?: string;
  title?: string;
}

export const InvoicePreview: React.FC<InvoicePreviewProps> = ({
  invoices = [],
  onExportToSheets,
  isExporting = false,
  spreadsheetUrl = null,
  projectName = 'Proyecto SVH Arquitectos',
  title = 'Facturas Procesadas con IA',
}) => {
  const [internalExporting, setInternalExporting] = useState(false);
  const [exportSuccessUrl, setExportSuccessUrl] = useState<string | null>(spreadsheetUrl);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Normalizar los campos para soportar tanto ProcessedInvoiceItem como InvoiceData
  const normalizedInvoices: ProcessedInvoiceItem[] = invoices.map((inv: any, idx: number) => {
    return {
      id: inv.id || inv.invoiceNumber || `inv-${idx + 1}`,
      cliente: inv.cliente || inv.vendorName || 'Sin especificar',
      fecha: inv.fecha || inv.date || new Date().toISOString().split('T')[0],
      concepto: inv.concepto || inv.concept || 'Factura de obra',
      total: Number(inv.total ?? inv.totalAmount ?? 0),
      subtotal: Number(inv.subtotal ?? 0),
      iva: Number(inv.iva ?? inv.taxAmount ?? 0),
      numeroFactura: inv.numeroFactura || inv.invoiceNumber || 'S/N',
      nitRut: inv.nitRut || inv.vendorTaxId || '',
      moneda: inv.moneda || inv.currency || 'COP',
      categoria: inv.categoria || inv.category || 'Materiales',
      fileName: inv.fileName || inv.name || `Factura_${idx + 1}.pdf`,
      driveUrl: inv.driveUrl || inv.webViewLink,
    };
  });

  const totalSum = normalizedInvoices.reduce((acc, curr) => acc + (curr.total || 0), 0);
  const subtotalSum = normalizedInvoices.reduce((acc, curr) => acc + (curr.subtotal || 0), 0);
  const ivaSum = normalizedInvoices.reduce((acc, curr) => acc + (curr.iva || 0), 0);

  const formatCurrency = (val: number, currency: string = 'COP') => {
    try {
      const hasDecimals = val % 1 !== 0;
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: currency === 'USD' ? 'USD' : 'COP',
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: 2,
      }).format(val);
    } catch {
      return `$ ${val.toLocaleString('es-CO')}`;
    }
  };

  const handleExportClick = async () => {
    if (!onExportToSheets) return;
    setInternalExporting(true);
    setErrorMessage(null);
    try {
      const res = await onExportToSheets();
      if (res && res.spreadsheetUrl) {
        setExportSuccessUrl(res.spreadsheetUrl);
      }
    } catch (err: any) {
      console.error('Error al exportar a Google Sheets:', err);
      setErrorMessage(err?.message || 'Error al exportar facturas a Google Sheets.');
    } finally {
      setInternalExporting(false);
    }
  };

  const activeLoading = isExporting || internalExporting;

  return (
    <div className="w-full relative overflow-hidden rounded-3xl p-6 sm:p-7 backdrop-blur-xl bg-white/80 border border-slate-200/80 shadow-[0_12px_40px_rgba(51,115,55,0.07)] transition-all duration-300">
      {/* Decorative background glows */}
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-gradient-to-br from-[#94C23D]/20 to-[#337337]/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-gradient-to-tr from-[#337337]/15 to-[#94C23D]/10 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Main Content Layout: Header + Gran Total Acumulado + CTA */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        {/* Project Branding & Title Info */}
        <div className="flex items-center gap-3.5 sm:gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-[#337337] to-[#255725] text-white flex items-center justify-center shadow-lg shadow-[#337337]/25 shrink-0 ring-4 ring-[#94C23D]/20">
            <FileSpreadsheet className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-[#94C23D]/20 text-[#255725] border border-[#94C23D]/40">
                SVH Arquitectos
              </span>
              <span className="text-xs text-slate-500 font-medium">
                {normalizedInvoices.length} {normalizedInvoices.length === 1 ? 'comprobante' : 'comprobantes'}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight mt-1">
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 font-medium">
              Obra: <span className="font-semibold text-[#337337]">{projectName}</span>
            </p>
          </div>
        </div>

        {/* Highlighted Gran Total Acumulado Hero Badge & Export Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 w-full lg:w-auto">
          {/* Card: Gran Total Acumulado */}
          <div className="flex items-center gap-3.5 bg-gradient-to-br from-emerald-50/90 to-emerald-100/40 p-3.5 sm:p-4 rounded-2xl border-2 border-emerald-300/80 shadow-xs flex-1 lg:flex-initial">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#337337] text-white flex items-center justify-center shadow-sm shrink-0">
              <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 font-bold" />
            </div>
            <div className="pr-2 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold text-emerald-900 uppercase tracking-wider block">
                  Gran Total Acumulado
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-200 text-emerald-900 border border-emerald-400">
                  Total
                </span>
              </div>
              <span className="text-xl sm:text-2xl font-black text-emerald-950 tracking-tight block font-mono truncate">
                {formatCurrency(totalSum)}
              </span>
              {(subtotalSum > 0 || ivaSum > 0) && (
                <div className="flex items-center gap-2 mt-1 text-[10px] text-emerald-800 font-medium flex-wrap">
                  {subtotalSum > 0 && (
                    <span>Subtotal: <strong>{formatCurrency(subtotalSum)}</strong></span>
                  )}
                  {subtotalSum > 0 && ivaSum > 0 && <span>•</span>}
                  {ivaSum > 0 && (
                    <span>IVA: <strong>{formatCurrency(ivaSum)}</strong></span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Export CTA Button */}
          {onExportToSheets && (
            <button
              type="button"
              id="btn-export-facturas-sheets"
              onClick={handleExportClick}
              disabled={activeLoading || normalizedInvoices.length === 0}
              className="relative group overflow-hidden inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl font-bold text-xs sm:text-sm tracking-wide text-white transition-all duration-300 shadow-md shadow-[#337337]/25 hover:shadow-lg hover:shadow-[#337337]/35 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none bg-gradient-to-r from-[#337337] via-[#2d662d] to-[#94C23D] w-full sm:w-auto shrink-0"
            >
              <div className="absolute inset-0 w-1/2 h-full bg-white/20 skew-x-12 -translate-x-full group-hover:translate-x-[300%] transition-transform duration-1000 ease-out pointer-events-none" />

              {activeLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Sincronizando Sheets...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Exportar a Sheets</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error alert if any */}
      {errorMessage && (
        <div className="mt-4 p-3.5 rounded-2xl bg-rose-50/90 border border-rose-200 text-rose-800 flex items-start gap-3 backdrop-blur-md">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs flex-1">
            <p className="font-bold">No se pudo completar la exportación</p>
            <p className="mt-0.5 text-rose-700">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Success alert with Direct Sheet link */}
      {exportSuccessUrl && (
        <div className="mt-4 p-3.5 rounded-2xl bg-[#94C23D]/15 border border-[#94C23D]/40 text-[#255725] flex items-center justify-between gap-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#337337] text-white flex items-center justify-center shrink-0 shadow-xs">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-bold text-[#1c451c]">¡Documento Corporativo Generado en Google Sheets!</p>
              <p className="text-[11px] text-slate-600">
                Se incluyó el logotipo de SVH Arquitectos (A1:E3), encabezados corporativos (#337337) y formato de moneda.
              </p>
            </div>
          </div>
          <a
            href={exportSuccessUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#337337] hover:bg-[#255725] text-white text-xs font-bold rounded-xl shadow-xs transition-all shrink-0 hover:scale-[1.02] active:scale-95"
          >
            <span>Abrir Sheet</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </div>
  );
};

