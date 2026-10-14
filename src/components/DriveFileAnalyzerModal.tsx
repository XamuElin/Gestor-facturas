import React, { useState, useEffect, useCallback } from 'react';
import {
  DriveHierarchicalItem,
  downloadDriveFileContent,
} from '../services/googleDriveSheets';
import { ExtractedFileAnalysis } from '../types';
import { safeJsonFetch } from '../utils/safeApiFetch';
import { EditFacturacionModal } from './EditFacturacionModal';
import {
  FileText,
  FileSpreadsheet,
  Receipt,
  Image as ImageIcon,
  ExternalLink,
  X,
  Loader2,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Table as TableIcon,
  Download,
  Link2,
  ArrowRight,
  Info,
  RotateCcw,
  AlertTriangle,
  Minus,
  Maximize2,
  Minimize2,
  Sliders,
} from 'lucide-react';

interface DriveFileAnalyzerModalProps {
  fileItem: DriveHierarchicalItem | null;
  accessToken: string;
  onClose: () => void;
  onConnectAsSpreadsheet?: (item: DriveHierarchicalItem, tabTitle?: string) => void;
  onUseAsInvoice?: (analysis: ExtractedFileAnalysis, driveUrl?: string) => void;
}

function sanitizeErrorMessage(msg: string): string {
  if (!msg) return 'Error desconocido al analizar el archivo.';
  if (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('temporarily') ||
    msg.includes('overloaded')
  ) {
    return 'Los servidores de IA de Google están experimentando alta demanda momentánea (código 503). Por favor, pulsa en "Reintentar análisis con IA" en unos segundos.';
  }
  if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return 'Límite temporal de consultas alcanzado en la API de IA. Por favor, pulsa en "Reintentar análisis con IA" en unos instantes.';
  }
  return msg;
}

export const DriveFileAnalyzerModal: React.FC<DriveFileAnalyzerModalProps> = ({
  fileItem,
  accessToken,
  onClose,
  onConnectAsSpreadsheet,
  onUseAsInvoice,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ExtractedFileAnalysis | null>(null);
  const [activeSheetTab, setActiveSheetTab] = useState<string>('');
  const [tableSearch, setTableSearch] = useState<string>('');
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(true);
  const [isEditFacturacionOpen, setIsEditFacturacionOpen] = useState<boolean>(false);

  const runAnalysis = useCallback(async () => {
    if (!fileItem || !accessToken) return;

    setIsLoading(true);
    setError(null);

    try {
      // 1. Download original file bytes from Google Drive
      const download = await downloadDriveFileContent(
        accessToken,
        fileItem.id,
        fileItem.mimeType
      );

      // 2. Call universal analyzer endpoint
      const fetchRes = await safeJsonFetch('/api/analyze-any-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: download.base64,
          fileName: fileItem.name,
          mimeType: download.mimeType || fileItem.mimeType,
          fileText: download.text,
        }),
      });

      if (!fetchRes.ok || !fetchRes.data?.success || !fetchRes.data?.data) {
        throw new Error(
          fetchRes.error || fetchRes.data?.error || `Error (${fetchRes.status}) al analizar archivo`
        );
      }

      const resJson = fetchRes.data;

      const data: ExtractedFileAnalysis = {
        ...resJson.data,
        fileId: fileItem.id,
        fileName: fileItem.name,
        mimeType: fileItem.mimeType,
        fileSizeFormatted: fileItem.sizeFormatted,
        driveViewLink: fileItem.webViewLink,
      };
      setAnalysis(data);

      if (data.sheets && data.sheets.length > 0) {
        setActiveSheetTab(data.sheets[0].name);
      } else if (data.tables && data.tables.length > 0) {
        setActiveSheetTab(data.tables[0].title || 'Tabla 1');
      }
    } catch (err: any) {
      console.error('Error analizando archivo de Drive:', err);
      setError(sanitizeErrorMessage(err.message || ''));
    } finally {
      setIsLoading(false);
    }
  }, [fileItem, accessToken]);

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  if (!fileItem) return null;

  // Render file type icon
  const renderFileIcon = () => {
    switch (fileItem.itemType) {
      case 'spreadsheet':
        return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
      case 'invoice':
        return <Receipt className="w-5 h-5 text-emerald-600" />;
      case 'image':
        return <ImageIcon className="w-5 h-5 text-sky-600" />;
      default:
        return <FileText className="w-5 h-5 text-blue-600" />;
    }
  };

  // Export JSON representation
  const handleExportJson = () => {
    if (!analysis) return;
    const blob = new Blob([JSON.stringify(analysis, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analisis_${fileItem.name.replace(/\.[^/.]+$/, '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!fileItem) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#1ca330]/20 text-[#98d52c]">
            {renderFileIcon()}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold truncate max-w-[200px]">
              {fileItem.name}
            </span>
            <span className="text-[10px] text-slate-400">Análisis minimizado</span>
          </div>
        </div>
        <div className="flex items-center gap-1 border-l border-slate-700/80 pl-2">
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Restaurar a página completa"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-rose-900/60 rounded-xl text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            title="Cerrar pestaña (x)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  const modalContainerClasses = isFullscreen
    ? 'fixed inset-0 z-50 flex flex-col w-full h-full bg-white overflow-hidden animate-in fade-in duration-150'
    : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200';

  const modalBoxClasses = isFullscreen
    ? 'w-full h-full flex flex-col bg-white overflow-hidden text-slate-800'
    : 'bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-slate-800';

  return (
    <div
      id="drive-file-analyzer-modal-backdrop"
      className={modalContainerClasses}
    >
      <div
        id="drive-file-analyzer-modal"
        className={modalBoxClasses}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center shrink-0">
              {renderFileIcon()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 truncate" title={fileItem.name}>
                  {fileItem.name}
                </h3>
                {analysis?.documentType && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                    {analysis.documentType}
                  </span>
                )}
                {isFullscreen && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hidden sm:inline-block shrink-0">
                    Página Completa
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                <span>{fileItem.sizeFormatted || 'Archivo de Google Drive'}</span>
                {fileItem.modifiedTimeFormatted && (
                  <>
                    <span>•</span>
                    <span>Modificado: {fileItem.modifiedTimeFormatted}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {fileItem.webViewLink && (
              <a
                href={fileItem.webViewLink}
                target="_blank"
                rel="noreferrer"
                id="btn-open-original-drive-file"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors shadow-xs"
              >
                <span>Abrir en Drive</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              type="button"
              id="btn-minimize-file-analyzer-tab"
              onClick={() => setIsMinimized(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
              title="Minimizar pestaña (-)"
            >
              <Minus className="w-5 h-5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              id="btn-toggle-fullscreen-file-analyzer-tab"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors hidden sm:inline-flex cursor-pointer"
              title={isFullscreen ? 'Restaurar tamaño ventana' : 'Abrir en página completa'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              id="btn-close-file-analyzer-modal"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              title="Cerrar pestaña (x)"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl w-full mx-auto">
          {isLoading && (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4 shadow-sm animate-pulse">
                <Sparkles className="w-7 h-7 text-[#1ca330]" />
              </div>
              <h4 className="text-base font-bold text-slate-900 mb-1">
                Extrayendo información útil del archivo...
              </h4>
              <p className="text-xs text-slate-500 max-w-md">
                Leyendo el archivo original directamente desde Google Drive e interpretando su estructura real sin modificarlo.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs text-emerald-700 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-[#1ca330]" />
                <span>Analizando con inteligencia artificial y motores de extracción</span>
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
                <div>
                  <h4 className="font-bold text-rose-900">No se pudo completar el análisis</h4>
                  <p className="text-xs text-rose-700 mt-0.5 leading-relaxed">{error}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runAnalysis()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors shadow-xs cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reintentar análisis con IA</span>
                    </button>
                    {fileItem.webViewLink && (
                      <a
                        href={fileItem.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-800 bg-rose-100/70 hover:bg-rose-200/80 rounded-lg transition-colors"
                      >
                        <span>Abrir original en Drive</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {analysis && !isLoading && (
            <>
              {/* High Demand / Structural Fallback Notice */}
              {analysis.isAiTemporarilyUnavailable && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-amber-50/90 border border-amber-200 rounded-xl text-amber-900 text-xs sm:text-sm">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <span className="font-semibold">Modo de contingencia estructural:</span> Los servidores de IA de Google experimentan alta demanda momentánea (503).
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => runAnalysis()}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-200/70 hover:bg-amber-300 border border-amber-300 rounded-lg transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reintentar con IA</span>
                  </button>
                </div>
              )}

              {/* Executive Summary Card */}
              <div className="bg-gradient-to-br from-slate-50 to-emerald-50/30 border border-slate-200/90 rounded-xl p-4 sm:p-5 shadow-xs">
                <div className="flex items-center gap-2 mb-2 text-slate-900 font-bold text-sm">
                  <Sparkles className="w-4 h-4 text-[#1ca330]" />
                  <span>Resumen del Contenido</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                  {analysis.summary}
                </p>

                {/* Key Attributes Pills / Badges */}
                {analysis.keyDetails && analysis.keyDetails.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-3 border-t border-slate-200/60">
                    {analysis.keyDetails.map((detail, idx) => (
                      <div key={idx} className="bg-white/80 border border-slate-200/60 rounded-lg p-2">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                          {detail.label}
                        </div>
                        <div className="text-xs font-bold text-slate-900 truncate mt-0.5" title={detail.value}>
                          {detail.value || 'N/A'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Enlace Directo a la Foto en Google Drive insertado en la información */}
                {fileItem.webViewLink && (
                  <div className="mt-4 p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                        <Link2 className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-emerald-950 flex items-center gap-1.5">
                          <span>Enlace de Foto en Google Drive</span>
                          <span className="text-[10px] bg-emerald-200/70 text-emerald-900 px-1.5 py-0.5 rounded font-bold">
                            ✓ Listo para Sheets
                          </span>
                        </div>
                        <div className="text-[11px] text-emerald-800 font-mono truncate max-w-xs sm:max-w-md mt-0.5" title={fileItem.webViewLink}>
                          {fileItem.webViewLink}
                        </div>
                      </div>
                    </div>
                    <a
                      href={fileItem.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold transition-colors shadow-2xs shrink-0 self-end sm:self-auto"
                    >
                      <span>Ver Foto en Drive</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Action Banner for Spreadsheets & Invoices */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-xl">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    {analysis.sheets ? <FileSpreadsheet className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-emerald-950">
                      {analysis.sheets
                        ? 'Hoja de Cálculo Lista para Integración'
                        : analysis.isInvoiceCompatible
                        ? 'Comprobante / Factura Detectada'
                        : 'Representación Organizada Disponible'}
                    </h5>
                    <p className="text-[11px] text-emerald-800">
                      {analysis.sheets
                        ? 'Puedes conectar este archivo como la hoja activa para el control contable de la obra.'
                        : analysis.isInvoiceCompatible
                        ? 'Registra los datos extraídos con el enlace de Drive directamente en la hoja de cálculo activa.'
                        : 'Puedes consultar los datos estructurados o exportarlos.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {analysis.sheets && onConnectAsSpreadsheet && (
                    <button
                      type="button"
                      id="btn-connect-analyzed-sheet"
                      onClick={() => onConnectAsSpreadsheet(fileItem, activeSheetTab)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1ca330] text-white hover:bg-[#168527] transition-colors shadow-xs"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>Conectar como Hoja Activa</span>
                    </button>
                  )}

                  {analysis.sheets && (
                    <button
                      type="button"
                      id="btn-edit-facturacion-from-analyzer"
                      onClick={() => setIsEditFacturacionOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-900 hover:bg-emerald-200 border border-emerald-300 transition-colors shadow-xs cursor-pointer active:scale-95"
                      title="Editar facturación (nombre y columnas) de esta hoja de cálculo"
                    >
                      <Sliders className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Edición de Facturación</span>
                    </button>
                  )}

                  {analysis.isInvoiceCompatible && onUseAsInvoice && (
                    <button
                      type="button"
                      id="btn-confirm-add-to-sheets"
                      onClick={() => onUseAsInvoice(analysis, fileItem.webViewLink)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-[#337337] to-[#1ca330] text-white hover:opacity-95 shadow-md shadow-[#337337]/20 transition-all cursor-pointer active:scale-95"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirmar y Añadir al Sheets</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    <span>Exportar JSON</span>
                  </button>
                </div>
              </div>

              {/* Spreadsheets Tabs & Data Viewer */}
              {analysis.sheets && analysis.sheets.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  {/* Sheet Tabs */}
                  <div className="bg-slate-100/80 p-2 border-b border-slate-200 flex items-center justify-between gap-2 overflow-x-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-500 px-2 uppercase tracking-wider">
                        Pestañas del archivo:
                      </span>
                      {analysis.sheets.map((sheet) => (
                        <button
                          key={sheet.name}
                          type="button"
                          onClick={() => setActiveSheetTab(sheet.name)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            activeSheetTab === sheet.name
                              ? 'bg-white text-emerald-800 shadow-xs border border-emerald-200'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                          }`}
                        >
                          <span>{sheet.name}</span>
                          <span className="ml-1 text-[10px] font-normal text-slate-400">
                            ({sheet.totalRows} filas)
                          </span>
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      placeholder="Filtrar datos..."
                      className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-[#1ca330] w-36"
                    />
                  </div>

                  {/* Active Sheet Table */}
                  {(() => {
                    const currentSheet =
                      analysis.sheets.find((s) => s.name === activeSheetTab) || analysis.sheets[0];
                    if (!currentSheet) return null;

                    const filteredRows = tableSearch.trim()
                      ? (currentSheet.rows || []).filter((r) =>
                          Array.isArray(r) && r.some((c) =>
                            String(c || '').toLowerCase().includes(tableSearch.toLowerCase().trim())
                          )
                        )
                      : (currentSheet.rows || []);

                    return (
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-slate-50 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
                            <tr>
                              <th className="py-2 px-3 text-slate-400 font-normal w-12 border-r border-slate-200 text-center">
                                #
                              </th>
                              {(currentSheet.headers || []).map((h, i) => (
                                <th key={i} className="py-2 px-3 border-r border-slate-200 whitespace-nowrap">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {(filteredRows || []).slice(0, 50).map((row, rIdx) => (
                              <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-1.5 px-3 text-slate-400 text-center border-r border-slate-100 font-mono text-[11px]">
                                  {rIdx + 1}
                                </td>
                                {(currentSheet.headers || []).map((_, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className="py-1.5 px-3 border-r border-slate-100 whitespace-nowrap max-w-xs truncate"
                                    title={String((row && row[cIdx] !== undefined) ? row[cIdx] : '')}
                                  >
                                    {String((row && row[cIdx] !== undefined) ? row[cIdx] : '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                            {(filteredRows || []).length === 0 && (
                              <tr>
                                <td
                                  colSpan={(currentSheet.headers || []).length + 1}
                                  className="py-8 text-center text-slate-400"
                                >
                                  No hay filas que coincidan con la búsqueda.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Detected Tables in Non-spreadsheet documents (PDF, Word, etc.) */}
              {(!analysis.sheets || analysis.sheets.length === 0) &&
                analysis.tables &&
                analysis.tables.length > 0 && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs space-y-4 p-4 bg-slate-50/50">
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-800">
                      <TableIcon className="w-4 h-4 text-emerald-600" />
                      <span>Tablas de datos detectadas en el documento</span>
                    </div>

                    {(analysis.tables || []).map((table, tIdx) => (
                      <div key={tIdx} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                        {table.title && (
                          <div className="bg-slate-50 px-3 py-1.5 font-bold text-xs text-slate-700 border-b border-slate-200">
                            {table.title}
                          </div>
                        )}
                        <div className="overflow-x-auto max-h-56">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 font-bold border-b border-slate-200">
                              <tr>
                                {(table.headers || []).map((h, i) => (
                                  <th key={i} className="py-2 px-3 whitespace-nowrap">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {(table.rows || []).map((r, rIdx) => (
                                <tr key={rIdx} className="hover:bg-slate-50">
                                  {Array.isArray(r) ? r.map((cell, cIdx) => (
                                    <td key={cIdx} className="py-1.5 px-3 whitespace-nowrap">
                                      {String(cell || '')}
                                    </td>
                                  )) : null}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {/* Line items if Invoice / Quotation */}
              {analysis.items && analysis.items.length > 0 && (
                <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-xs">
                  <h5 className="font-bold text-xs text-slate-800 mb-3 flex items-center gap-1.5">
                    <Receipt className="w-4 h-4 text-emerald-600" />
                    <span>Partidas / Conceptos Desglosados</span>
                  </h5>
                  <div className="divide-y divide-slate-100">
                    {(analysis.items || []).map((item, i) => (
                      <div key={i} className="py-2 flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-4">
                          <span className="font-medium text-slate-800">{item.description}</span>
                          {(item.quantity !== undefined || item.unitPrice !== undefined) && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {item.quantity !== undefined && `Cant: ${item.quantity}`}
                              {item.unitPrice !== undefined && ` • Precio: ${item.unitPrice}`}
                            </div>
                          )}
                        </div>
                        {item.total !== undefined && (
                          <span className="font-bold text-slate-900 shrink-0 font-mono">
                            ${item.total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-slate-400" />
            <span>El archivo original en Google Drive permanece inalterado.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 transition-colors shadow-xs"
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* Modal de Edición de Facturación */}
      {isEditFacturacionOpen && fileItem && (
        <EditFacturacionModal
          isOpen={isEditFacturacionOpen}
          onClose={() => setIsEditFacturacionOpen(false)}
          accessToken={accessToken}
          spreadsheet={{
            id: fileItem.id,
            name: fileItem.name,
            webViewLink: fileItem.webViewLink,
          }}
          activeTab={activeSheetTab}
          detectedTabs={analysis?.sheets?.map((s, idx) => ({ sheetId: idx, title: s.name, index: idx })) || []}
          currentHeaders={analysis?.sheets?.find((s) => s.name === activeSheetTab)?.headers || []}
          onSpreadsheetRenamed={(newTitle) => {
            if (fileItem) fileItem.name = newTitle;
          }}
        />
      )}
    </div>
  );
};
