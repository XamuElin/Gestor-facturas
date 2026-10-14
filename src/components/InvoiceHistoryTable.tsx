import React, { useState, useMemo, useRef } from 'react';
import {
  SheetInvoiceRecord,
  ProjectFolder,
  SheetTabInfo,
  DynamicSheetAnalysis,
  DynamicColumnMeta,
  DynamicSheetRow,
  IntermediateSubtotal,
} from '../types';
import {
  parseLocaleAmount,
  syncProjectDriveLinksAndFixInvoices,
  reprocessAllInvoicesWithAi,
  SyncDriveLinksResult,
} from '../services/googleDriveSheets';
import { safeJsonFetch } from '../utils/safeApiFetch';
import { payrollService } from '../services/payrollService';
import {
  FileSpreadsheet,
  ExternalLink,
  Search,
  RefreshCw,
  Download,
  Eye,
  TrendingUp,
  Receipt,
  FileCheck,
  FolderOpen,
  Sparkles,
  CheckCircle2,
  Trash2,
  PlusCircle,
  Pencil,
  FileEdit,
  Save,
  Layers,
  ArrowUpDown,
  Filter,
  Link as LinkIcon,
  Calendar,
  Hash,
  Tag,
  Info,
  Bookmark,
  Calculator,
  FileText,
  Paperclip,
  X,
  Loader2,
  AlertCircle,
  ShieldAlert,
  Wrench,
  Check,
  StopCircle,
  Minus,
  Maximize2,
  Minimize2,
  FolderSearch,
} from 'lucide-react';
import { DeleteInvoiceModal } from './DeleteInvoiceModal';
import { EditInvoiceModal } from './EditInvoiceModal';
import { formatCOP, formatDateCO } from '../utils/formatters';

export interface InvoiceHistoryTableProps {
  dynamicAnalysis?: DynamicSheetAnalysis | null;
  invoices?: SheetInvoiceRecord[];
  project: ProjectFolder;
  onRefresh: () => void;
  isLoading: boolean;
  onApplyStyling?: () => void;
  isStylingSheet?: boolean;
  styleSuccessMessage?: string | null;
  onDeleteInvoice?: (invoice: SheetInvoiceRecord) => Promise<void>;
  onDeleteDynamicRow?: (sheetTitle: string, rowIndex: number) => Promise<void>;
  onEditInvoice?: (invoice: SheetInvoiceRecord) => Promise<void>;
  onAddMoreInvoices?: () => void;
  tabs?: SheetTabInfo[];
  activeTab?: string;
  onSelectTab?: (tabTitle: string) => void;
  accessToken?: string;
  onOpenDriveInvoiceAnalysis?: () => void;
  onReauthenticate?: () => Promise<string | null>;
}

export const InvoiceHistoryTable: React.FC<InvoiceHistoryTableProps> = ({
  dynamicAnalysis,
  invoices = [],
  project,
  onRefresh,
  isLoading,
  onApplyStyling,
  isStylingSheet = false,
  styleSuccessMessage = null,
  onDeleteInvoice,
  onDeleteDynamicRow,
  onEditInvoice,
  onAddMoreInvoices,
  tabs = [],
  activeTab,
  onSelectTab,
  accessToken,
  onOpenDriveInvoiceAnalysis,
  onReauthenticate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumnIndex, setSortColumnIndex] = useState<number | null>(null);
  const [sortAscending, setSortAscending] = useState<boolean>(true);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SheetInvoiceRecord | null>(null);
  const [rowToDelete, setRowToDelete] = useState<{ sheetTitle: string; rowIndex: number } | null>(null);
  const [invoiceToEdit, setInvoiceToEdit] = useState<SheetInvoiceRecord | null>(null);
  const [autoStartAiModal, setAutoStartAiModal] = useState<boolean>(false);
  const [quickRenameInvoice, setQuickRenameInvoice] = useState<SheetInvoiceRecord | null>(null);
  const [quickRenameInput, setQuickRenameInput] = useState<string>('');
  const [isSavingQuickRename, setIsSavingQuickRename] = useState<boolean>(false);
  const [quickRenameError, setQuickRenameError] = useState<string | null>(null);
  const [mobileViewMode, setMobileViewMode] = useState<'cards' | 'table'>('cards');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const handleStartQuickRename = (inv: SheetInvoiceRecord) => {
    setQuickRenameInvoice(inv);
    setQuickRenameInput(inv.fileName || '');
    setQuickRenameError(null);
  };

  const handleSaveQuickRename = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!quickRenameInvoice || !onEditInvoice) return;
    const trimmed = quickRenameInput.trim();
    if (!trimmed) {
      setQuickRenameError('El nombre del documento no puede estar vacío.');
      return;
    }
    setIsSavingQuickRename(true);
    setQuickRenameError(null);
    try {
      await onEditInvoice({
        ...quickRenameInvoice,
        fileName: trimmed,
      });
      setQuickRenameInvoice(null);
      setRenameSuccessMessage(`¡Nombre del documento actualizado a "${trimmed}" en Google Sheets y Google Drive!`);
      setTimeout(() => setRenameSuccessMessage(null), 6000);
    } catch (err: any) {
      setQuickRenameError(err?.message || 'Error al actualizar el nombre del documento.');
    } finally {
      setIsSavingQuickRename(false);
    }
  };
  const [renameSuccessMessage, setRenameSuccessMessage] = useState<string | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false);
  const [excelSuccessMessage, setExcelSuccessMessage] = useState<string | null>(null);
  const [excelErrorMessage, setExcelErrorMessage] = useState<string | null>(null);

  // Manejador: Exportar hoja de cálculo completa a Excel (.xlsx) respetando todo el formato
  const handleExportExcel = async () => {
    if (!project.spreadsheetId) return;
    setIsExportingExcel(true);
    setExcelSuccessMessage(null);
    setExcelErrorMessage(null);
    try {
      await payrollService.downloadExcelReport(accessToken || '', project.spreadsheetId, project.name);
      setExcelSuccessMessage('¡Hoja de cálculo exportada a Excel (.xlsx) exitosamente respetando todo su formato corporativo!');
      setTimeout(() => setExcelSuccessMessage(null), 6000);
    } catch (err: any) {
      console.warn('Aviso al exportar Excel desde facturas:', err);
      const isAuth =
        err?.status === 401 ||
        err?.isAuthError ||
        String(err?.message || '').includes('401') ||
        String(err?.message || '').includes('invalid authentication credentials') ||
        String(err?.message || '').includes('expirado') ||
        String(err?.message || '').includes('Expected OAuth 2');

      if (isAuth && onReauthenticate) {
        try {
          const newToken = await onReauthenticate();
          if (newToken) {
            await payrollService.downloadExcelReport(newToken, project.spreadsheetId, project.name);
            setExcelSuccessMessage('¡Hoja de cálculo exportada a Excel (.xlsx) exitosamente tras renovar credenciales!');
            setTimeout(() => setExcelSuccessMessage(null), 6000);
            return;
          }
        } catch (renewErr) {
          console.warn('No se pudo autorenovar token:', renewErr);
        }
      }

      setExcelErrorMessage(
        isAuth
          ? 'Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para renovar tus credenciales.'
          : (err.message || 'Error al exportar la hoja de cálculo a Excel.')
      );
      setTimeout(() => setExcelErrorMessage(null), 7000);
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Modal and state for "Actualizar Información"
  const [isUpdateInfoOpen, setIsUpdateInfoOpen] = useState<boolean>(false);
  const [isSyncingDriveLinks, setIsSyncingDriveLinks] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<SyncDriveLinksResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Use dynamic tabs if available, otherwise props tabs
  const effectiveTabs = useMemo(() => {
    if (dynamicAnalysis?.tabs && Array.isArray(dynamicAnalysis.tabs) && dynamicAnalysis.tabs.length > 0) {
      return dynamicAnalysis.tabs;
    }
    return tabs || [];
  }, [dynamicAnalysis?.tabs, tabs]);

  const effectiveActiveTab = dynamicAnalysis?.activeTab || activeTab || (effectiveTabs[0]?.title || '');

  // Determine headers & columns from dynamicAnalysis or fallback to default
  const effectiveHeaders: string[] = useMemo(() => {
    if (dynamicAnalysis?.headers && Array.isArray(dynamicAnalysis.headers) && dynamicAnalysis.headers.length > 0) {
      return dynamicAnalysis.headers;
    }
    return [
      'Fecha',
      'Nº Factura',
      'Proveedor / Emisor',
      'Concepto',
      'Categoría',
      'Total ($)',
    ];
  }, [dynamicAnalysis?.headers]);

  const effectiveColumns: DynamicColumnMeta[] = useMemo(() => {
    if (dynamicAnalysis?.columns && Array.isArray(dynamicAnalysis.columns) && dynamicAnalysis.columns.length > 0) {
      return dynamicAnalysis.columns;
    }
    const safeCount = (invoices || []).length;
    return [
      { key: 'col_0', header: 'Fecha', index: 0, type: 'date', sampleValues: [], count: safeCount },
      { key: 'col_1', header: 'Nº Factura', index: 1, type: 'text', sampleValues: [], count: safeCount },
      { key: 'col_2', header: 'Proveedor / Emisor', index: 2, type: 'text', sampleValues: [], count: safeCount },
      { key: 'col_3', header: 'Concepto', index: 3, type: 'text', sampleValues: [], count: safeCount },
      { key: 'col_4', header: 'Categoría', index: 4, type: 'tag', sampleValues: [], count: safeCount },
      { key: 'col_5', header: 'Total ($)', index: 5, type: 'currency', sampleValues: [], count: safeCount, isNumeric: true },
    ];
  }, [dynamicAnalysis?.columns, invoices?.length]);

  // Transform rows: dynamicRows or fallback from SheetInvoiceRecord
  const rawRows: DynamicSheetRow[] = useMemo(() => {
    if (dynamicAnalysis?.rows && Array.isArray(dynamicAnalysis.rows) && dynamicAnalysis.rows.length > 0) {
      return dynamicAnalysis.rows.map((r) => {
        let driveUrl = r.driveFileUrl || r.invoiceRecord?.driveFileUrl || '';
        let fileName = r.fileName || r.invoiceRecord?.fileName || '';

        const allCells = [...(r.values || []), ...(r.rawRowData || []), ...Object.values(r.cellsByHeader || {})];
        for (const cell of allCells) {
          const str = String(cell || '').trim();
          if (!str) continue;

          const isNotSpreadsheet =
            !str.includes('docs.google.com/spreadsheets') &&
            !str.includes('/spreadsheets/') &&
            !(project?.spreadsheetId && str.includes(project.spreadsheetId));

          if (!driveUrl) {
            if (
              (str.includes('drive.google.com') || (str.startsWith('http') && !str.includes('sheets.google.com'))) &&
              isNotSpreadsheet
            ) {
              driveUrl = str;
            } else if (str.startsWith('=')) {
              const m = str.match(/=HYPERLINK\("([^"]+)"(?:,\s*"([^"]*)")?/i) || str.match(/=HIPERVINCULO\("([^"]+)"(?:,\s*"([^"]*)")?/i);
              if (
                m &&
                m[1] &&
                !m[1].includes('docs.google.com/spreadsheets') &&
                !m[1].includes('/spreadsheets/') &&
                !(project?.spreadsheetId && m[1].includes(project.spreadsheetId))
              ) {
                driveUrl = m[1];
                if (m[2] && !fileName) {
                  fileName = m[2];
                }
              }
            }
          }

          if (!fileName) {
            if (/\.(pdf|png|jpe?g|webp)$/i.test(str)) {
              fileName = str;
            } else if (/^factura\s*\d+/i.test(str) && !str.includes('$')) {
              fileName = str;
            }
          }
        }

        return {
          ...r,
          driveFileUrl: driveUrl || undefined,
          fileName: fileName || undefined,
          invoiceRecord: r.invoiceRecord
            ? {
                ...r.invoiceRecord,
                driveFileUrl: driveUrl || r.invoiceRecord.driveFileUrl,
                fileName: fileName || r.invoiceRecord.fileName,
              }
            : undefined,
        };
      });
    }
    // Fallback mapping from invoices
    return (invoices || []).map((inv, idx) => {
      const rowIndex = inv?.rowIndex || idx + 2;
      return {
        id: inv?.id || `row_${rowIndex}`,
        rowIndex,
        values: [
          inv?.issueDate || inv?.registrationDate || '',
          inv?.invoiceNumber || '',
          inv?.vendorName || '',
          inv?.concept || '',
          inv?.category || 'Varios',
          inv?.totalAmount ? `$ ${inv.totalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2 })}` : '',
        ],
        cellsByHeader: {
          Fecha: inv?.issueDate || inv?.registrationDate || '',
          'Nº Factura': inv?.invoiceNumber || '',
          'Proveedor / Emisor': inv?.vendorName || '',
          Concepto: inv?.concept || '',
          Categoría: inv?.category || 'Varios',
          'Total ($)': inv?.totalAmount || 0,
        },
        driveFileUrl: inv?.driveFileUrl,
        fileName: inv?.fileName,
        invoiceRecord: inv,
      };
    });
  }, [dynamicAnalysis?.rows, invoices]);

  // Filtering and sorting
  const filteredAndSortedRows = useMemo(() => {
    let result = rawRows || [];

    // Filter by search query
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter((row) => {
        return (row.values || []).some((cell) =>
          cell !== undefined && cell !== null && String(cell).toLowerCase().includes(q)
        );
      });
    }

    // Sort by column
    if (sortColumnIndex !== null) {
      result = [...result].sort((a, b) => {
        const valA = (a.values || [])[sortColumnIndex];
        const valB = (b.values || [])[sortColumnIndex];

        if (valA === undefined || valA === '') return 1;
        if (valB === undefined || valB === '') return -1;

        // Number comparison respecting locale: commas as thousands, dots as decimal
        const numA = typeof valA === 'number' ? valA : parseLocaleAmount(valA);
        const numB = typeof valB === 'number' ? valB : parseLocaleAmount(valB);

        if (!isNaN(numA) && !isNaN(numB) && (numA !== 0 || numB !== 0)) {
          return sortAscending ? numA - numB : numB - numA;
        }

        // String comparison
        const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        return sortAscending ? cmp : -cmp;
      });
    }

    return result;
  }, [rawRows, searchTerm, sortColumnIndex, sortAscending]);

  // Filas intermedias etiquetadas como 'SUBTOTAL' extraídas del análisis o inspección
  const intermediateSubtotals: IntermediateSubtotal[] = useMemo(() => {
    if (dynamicAnalysis?.intermediateSubtotals && Array.isArray(dynamicAnalysis.intermediateSubtotals) && dynamicAnalysis.intermediateSubtotals.length > 0) {
      return dynamicAnalysis.intermediateSubtotals;
    }
    // Inspección en filas cargadas
    const fromRows: IntermediateSubtotal[] = [];
    rawRows.forEach((r) => {
      if (r.isSubtotalRow && r.subtotalInfo) {
        fromRows.push(r.subtotalInfo);
      }
    });
    return fromRows;
  }, [dynamicAnalysis?.intermediateSubtotals, rawRows]);

  // Suma exclusiva de los subtotales por concepto
  const subtotalsSum = useMemo(() => {
    return intermediateSubtotals.reduce((acc, s) => acc + (s.amount || 0), 0);
  }, [intermediateSubtotals]);

  // Filas de gastos unitarios puros (excluyen filas de SUBTOTAL y filas de TOTAL para no inflar el gran total)
  const pureUnitRows = useMemo(() => {
    return rawRows.filter((r) => !r.isSubtotalRow && !r.isTotalRow);
  }, [rawRows]);

  // Suma de gastos unitarios puros
  const unitExpensesSum = useMemo(() => {
    const costColIdx = effectiveColumns.findIndex((c) => c.type === 'currency');
    if (costColIdx >= 0) {
      return pureUnitRows.reduce((acc, r) => {
        const val = r.values ? r.values[costColIdx] : undefined;
        return acc + parseLocaleAmount(val);
      }, 0);
    }
    return 0;
  }, [pureUnitRows, effectiveColumns]);

  // Dynamic Summaries (restricted strictly to expense cost columns)
  const summaries = useMemo(() => {
    if (dynamicAnalysis?.numericSummaries && Array.isArray(dynamicAnalysis.numericSummaries) && dynamicAnalysis.numericSummaries.length > 0) {
      return dynamicAnalysis.numericSummaries;
    }
    // Fallback calculation from invoices
    const safeInvoices = invoices || [];
    const totalAmount = safeInvoices.reduce((acc, inv) => acc + (inv?.totalAmount || 0), 0);
    const subtotal = safeInvoices.reduce((acc, inv) => acc + (inv?.subtotal || 0), 0);
    const tax = safeInvoices.reduce((acc, inv) => acc + (inv?.taxAmount || 0), 0);

    const list = [{ header: 'Total Facturado', sum: totalAmount }];
    if (subtotal > 0) list.push({ header: 'Base Imponible', sum: subtotal });
    if (tax > 0) list.push({ header: 'IVA / Impuestos', sum: tax });
    return list;
  }, [dynamicAnalysis?.numericSummaries, invoices]);

  // Total propio del MVP: calculado directamente sobre las facturas registradas en la aplicación
  // Directiva de usuario: no combinarlo con el total de Google Sheets
  const mvpTotal = useMemo(() => {
    const safeInvoices = invoices || [];
    if (safeInvoices.length > 0) {
      const sum = safeInvoices.reduce((acc, inv) => acc + (inv?.totalAmount || 0), 0);
      if (sum > 0) return sum;
    }
    return unitExpensesSum;
  }, [invoices, unitExpensesSum]);

  // Métrica de 'TOTAL GENERAL' para Google Sheets:
  // Reservada para el cierre definitivo de la hoja o la suma de dichos subtotales
  const grandTotal = useMemo(() => {
    // 1. Cierre definitivo de la hoja declarado en el análisis
    if (dynamicAnalysis?.grandTotal !== undefined && dynamicAnalysis.grandTotal > 0) {
      return dynamicAnalysis.grandTotal;
    }
    if (dynamicAnalysis?.declaredTotal !== undefined && dynamicAnalysis.declaredTotal > 0) {
      return dynamicAnalysis.declaredTotal;
    }
    // 2. Suma de dichos subtotales por concepto
    if (intermediateSubtotals.length > 0 && subtotalsSum > 0) {
      return subtotalsSum;
    }
    // 3. Si existe una columna de costo en summaries
    if (summaries.length > 0 && summaries[0].sum > 0) {
      return summaries[0].sum;
    }
    return unitExpensesSum;
  }, [
    dynamicAnalysis?.grandTotal,
    dynamicAnalysis?.declaredTotal,
    intermediateSubtotals.length,
    subtotalsSum,
    summaries,
    unitExpensesSum,
  ]);

  const grandTotalSource = useMemo(() => {
    if (dynamicAnalysis?.declaredTotal !== undefined) {
      return 'Cierre definitivo de la hoja';
    }
    if (intermediateSubtotals.length > 0) {
      return `Suma de ${intermediateSubtotals.length} subtotales`;
    }
    return 'Cierre general';
  }, [dynamicAnalysis?.declaredTotal, intermediateSubtotals.length]);

  const grandTotalBadge = useMemo(() => {
    if (dynamicAnalysis?.declaredTotal !== undefined) {
      return 'Cierre Definitivo';
    }
    if (intermediateSubtotals.length > 0) {
      return 'Suma de Subtotales';
    }
    return 'Total Consolidado';
  }, [dynamicAnalysis?.declaredTotal, intermediateSubtotals.length]);

  const totalRowsCount = dynamicAnalysis ? dynamicAnalysis.totalRows : (invoices || []).length;

  const handleToggleSort = (colIdx: number) => {
    if (sortColumnIndex === colIdx) {
      if (sortAscending) {
        setSortAscending(false);
      } else {
        setSortColumnIndex(null);
        setSortAscending(true);
      }
    } else {
      setSortColumnIndex(colIdx);
      setSortAscending(true);
    }
  };

  // List of rows that do not have a photo link in Google Drive / Sheets
  const unlinkedRows = useMemo(() => {
    return (filteredAndSortedRows || []).filter((r) => {
      if (r.isSubtotalRow) return false;
      const url = r.driveFileUrl || r.invoiceRecord?.driveFileUrl;
      return !url || String(url).trim() === '';
    });
  }, [filteredAndSortedRows]);

  // List of invoices that may have been poorly processed (missing vendor, $0 amount, missing date/concept)
  const poorlyProcessedRows = useMemo(() => {
    return (filteredAndSortedRows || []).filter((r) => {
      if (r.isSubtotalRow) return false;
      const inv = r.invoiceRecord;
      if (!inv) return false;
      return (
        inv.totalAmount === 0 ||
        !inv.vendorName ||
        inv.vendorName.toLowerCase() === 'sin proveedor' ||
        !inv.concept ||
        !inv.issueDate
      );
    });
  }, [filteredAndSortedRows]);

  const [isUpdateInfoMinimized, setIsUpdateInfoMinimized] = useState(false);
  const [isUpdateInfoFullscreen, setIsUpdateInfoFullscreen] = useState(true);
  const [isRereadingWithAi, setIsRereadingWithAi] = useState(false);
  const [rereadSuccessMessage, setRereadSuccessMessage] = useState<string | null>(null);
  const [rereadErrorMessage, setRereadErrorMessage] = useState<string | null>(null);

  const [isRereadingAllRegistered, setIsRereadingAllRegistered] = useState(false);
  const [rereadAllSuccessMessage, setRereadAllSuccessMessage] = useState<string | null>(null);
  const [rereadAllErrorMessage, setRereadAllErrorMessage] = useState<string | null>(null);

  // Barra de progreso interactiva para releer facturas
  const [rereadProgress, setRereadProgress] = useState<{
    current: number;
    total: number;
    currentFileName: string;
    percentage: number;
    successCount: number;
    errorCount: number;
    isRereading: boolean;
  } | null>(null);

  const abortRereadRef = useRef<boolean>(false);

  const handleCancelReread = () => {
    abortRereadRef.current = true;
  };

  const handleRunSyncDriveLinks = async () => {
    if (!accessToken || !project) return;
    setIsSyncingDriveLinks(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await syncProjectDriveLinksAndFixInvoices(
        accessToken,
        project,
        effectiveActiveTab || project.activeSheetTab
      );
      setSyncResult(res);
      onRefresh();
    } catch (err: any) {
      setSyncError(err.message || 'Error al sincronizar enlaces de Drive con Google Sheets.');
    } finally {
      setIsSyncingDriveLinks(false);
    }
  };

  const handleRereadAllRegisteredInvoices = async () => {
    if (!accessToken || !project?.spreadsheetId) return;
    if (isRereadingAllRegistered) return;

    // Obtener las filas reales de facturas a releer (omitiendo subtotales y totales)
    const targetRows = pureUnitRows.length > 0 ? pureUnitRows : rawRows.filter((r) => !r.isTotalRow && !r.isSubtotalRow);
    if (targetRows.length === 0) {
      setRereadAllErrorMessage('No se encontraron filas de facturas para releer en esta pestaña.');
      return;
    }

    abortRereadRef.current = false;
    setIsRereadingAllRegistered(true);
    setRereadAllErrorMessage(null);
    setRereadAllSuccessMessage(null);

    const total = targetRows.length;
    let successCount = 0;
    let errorCount = 0;

    setRereadProgress({
      current: 0,
      total,
      currentFileName: 'Iniciando lectura inteligente con IA...',
      percentage: 0,
      successCount: 0,
      errorCount: 0,
      isRereading: true,
    });

    try {
      for (let i = 0; i < total; i++) {
        if (abortRereadRef.current) {
          console.log('[Relectura IA] Operación cancelada por el usuario.');
          break;
        }

        const row = targetRows[i];
        const invNum = row.invoiceRecord?.invoiceNumber || (row.values && String(row.values[1] || '')) || '';
        const vendor = row.invoiceRecord?.vendorName || (row.values && String(row.values[2] || '')) || '';
        const name = row.fileName || row.invoiceRecord?.fileName || (invNum ? `Factura ${invNum}` : `Comprobante Fila ${row.rowIndex}`);

        const isControlSpreadsheet = (url?: string, n?: string) => {
          const u = (url || '').toLowerCase();
          const nameStr = (n || '').toLowerCase();
          if (u.includes('docs.google.com/spreadsheets') || u.includes('/spreadsheets/')) return true;
          if (project?.spreadsheetId && u.includes(project.spreadsheetId.toLowerCase())) return true;
          if (/control[-_ ]*facturas/i.test(nameStr) || nameStr.includes('control_facturas')) return true;
          return false;
        };

        let fileId = '';
        const driveUrl = row.driveFileUrl || row.invoiceRecord?.driveFileUrl || '';
        if (!isControlSpreadsheet(driveUrl)) {
          const idMatch = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (idMatch && idMatch[1] && idMatch[1] !== project.spreadsheetId) {
            fileId = idMatch[1];
          }
        }

        const rawFileName = row.fileName || row.invoiceRecord?.fileName;
        let safeFileName = rawFileName && !isControlSpreadsheet(undefined, rawFileName) ? rawFileName : undefined;

        if (!safeFileName) {
          const cells = [...(row.values || []), ...(row.rawRowData || [])];
          for (const cell of cells) {
            const str = String(cell || '').trim();
            const m = str.match(/=HYPERLINK\("[^"]+",\s*"([^"]+)"\)/i) || str.match(/=HIPERVINCULO\("[^"]+",\s*"([^"]+)"\)/i);
            if (m && m[1]) {
              safeFileName = m[1];
              break;
            }
            if (/\.(pdf|png|jpe?g|webp)$/i.test(str)) {
              safeFileName = str;
              break;
            }
          }
        }

        const batchNum = Math.floor(i / 5) + 1;
        const totalBatches = Math.ceil(total / 5);

        setRereadProgress({
          current: i + 1,
          total,
          currentFileName: `Lote ${batchNum} de ${totalBatches} · ${name}`,
          percentage: Math.round(((i + 1) / total) * 100),
          successCount,
          errorCount,
          isRereading: true,
        });

        // Reintentos automáticos de hasta 4 veces con backoff creciente (3s, 6s, 12s, 24s + jitter)
        let attempts = 0;
        const MAX_RETRIES = 4;
        const RETRY_DELAYS = [3000, 6000, 12000, 24000];
        let res: any = null;

        while (attempts <= MAX_RETRIES && !abortRereadRef.current) {
          if (attempts > 0) {
            const baseWait = RETRY_DELAYS[attempts - 1] || 24000;
            const jitter = Math.floor(Math.random() * 1000);
            setRereadProgress((prev) =>
              prev ? { ...prev, currentFileName: `Reintentando (${attempts}/${MAX_RETRIES}): ${name}` } : null
            );
            await new Promise((r) => setTimeout(r, baseWait + jitter));
          }

          res = await safeJsonFetch('/api/reprocess-invoice', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileId,
              fileName: safeFileName,
              spreadsheetId: project.spreadsheetId,
              sheetTitle: effectiveActiveTab || project.activeSheetTab || 'Facturas',
              rowIndex: row.rowIndex,
              folderId: project.id,
              evidenceFolderId: project.evidenceFolderId,
              invoiceNumber: invNum,
              vendorName: vendor,
            }),
          });

          if (res.ok && res.data?.success) {
            break;
          }

          const errMsg = (res.error || res.data?.error || '').toLowerCase();
          const is503 = errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('high demand');
          const is429 = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('resource_exhausted');
          const isTimeout = errMsg.includes('timeout') || errMsg.includes('504');

          if ((is503 || is429 || isTimeout) && attempts < MAX_RETRIES && !abortRereadRef.current) {
            attempts++;
            continue;
          } else {
            break;
          }
        }

        if (res?.ok && res?.data?.success) {
          successCount++;
        } else {
          errorCount++;
          if (res?.data?.skipped) {
            console.log(`[Relectura] Fila ${row.rowIndex} (${name}) omitida:`, res?.data?.error);
          } else {
            console.warn(`[Relectura] Fila ${row.rowIndex} (${name}) no se pudo releer:`, res?.error || res?.data?.error);
          }
        }

        setRereadProgress((prev) =>
          prev ? { ...prev, successCount, errorCount } : null
        );

        // Pausa entre archivos de 1.5s y entre lotes de 5 de 10s
        if (i < total - 1 && !abortRereadRef.current) {
          if ((i + 1) % 5 === 0) {
            for (let s = 10; s > 0 && !abortRereadRef.current; s--) {
              setRereadProgress((prev) =>
                prev ? { ...prev, currentFileName: `Pausa entre lotes: ${s}s...` } : null
              );
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } else {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }

      const wasAborted = abortRereadRef.current;
      if (wasAborted) {
        setRereadAllSuccessMessage(`Relectura detenida. Se actualizaron con éxito ${successCount} facturas en Google Sheets.`);
      } else if (successCount > 0) {
        setRereadAllSuccessMessage(
          `¡Relectura con IA completada! Se releeron y actualizaron ${successCount} de ${total} facturas con éxito en Google Sheets.${errorCount > 0 ? ` (${errorCount} omitida(s) por no disponer de archivo comprobante en Drive)` : ''}`
        );
      } else {
        setRereadAllErrorMessage(
          'No se pudo releer ninguna factura. Asegúrate de que los archivos de las fotos estén guardados en la carpeta del proyecto en Google Drive.'
        );
      }
      onRefresh();
    } catch (err: any) {
      setRereadAllErrorMessage(err.message || 'Error durante la relectura secuencial de facturas con IA.');
    } finally {
      setIsRereadingAllRegistered(false);
      setRereadProgress(null);
    }
  };

  const handleRereadAllWithAi = async () => {
    if (!accessToken || !project?.spreadsheetId) return;
    if (isRereadingWithAi) return;

    if (poorlyProcessedRows.length === 0) {
      setRereadSuccessMessage('No hay facturas con errores pendientes de corregir.');
      return;
    }

    abortRereadRef.current = false;
    setIsRereadingWithAi(true);
    setRereadErrorMessage(null);
    setRereadSuccessMessage(null);

    const total = poorlyProcessedRows.length;
    let successCount = 0;
    let errorCount = 0;

    setRereadProgress({
      current: 0,
      total,
      currentFileName: 'Iniciando corrección de facturas con error...',
      percentage: 0,
      successCount: 0,
      errorCount: 0,
      isRereading: true,
    });

    try {
      for (let i = 0; i < total; i++) {
        if (abortRereadRef.current) break;
        const r = poorlyProcessedRows[i];
        const inv = r.invoiceRecord;
        const name = r.fileName || inv?.fileName || (inv?.invoiceNumber ? `Factura ${inv.invoiceNumber}` : `Fila ${r.rowIndex}`);

        const isControlSpreadsheet = (url?: string, n?: string) => {
          const u = (url || '').toLowerCase();
          const nameStr = (n || '').toLowerCase();
          if (u.includes('docs.google.com/spreadsheets') || u.includes('/spreadsheets/')) return true;
          if (project?.spreadsheetId && u.includes(project.spreadsheetId.toLowerCase())) return true;
          if (/control[-_ ]*facturas/i.test(nameStr) || nameStr.includes('control_facturas')) return true;
          return false;
        };

        let fileId = '';
        const driveUrl = r.driveFileUrl || inv?.driveFileUrl || '';
        if (!isControlSpreadsheet(driveUrl)) {
          const idMatch = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (idMatch && idMatch[1] && idMatch[1] !== project.spreadsheetId) {
            fileId = idMatch[1];
          }
        }

        const rawFileName = r.fileName || inv?.fileName;
        let safeFileName = rawFileName && !isControlSpreadsheet(undefined, rawFileName) ? rawFileName : undefined;

        if (!safeFileName) {
          const cells = [...(r.values || []), ...(r.rawRowData || [])];
          for (const cell of cells) {
            const str = String(cell || '').trim();
            const m = str.match(/=HYPERLINK\("[^"]+",\s*"([^"]+)"\)/i) || str.match(/=HIPERVINCULO\("[^"]+",\s*"([^"]+)"\)/i);
            if (m && m[1]) {
              safeFileName = m[1];
              break;
            }
            if (/\.(pdf|png|jpe?g|webp)$/i.test(str)) {
              safeFileName = str;
              break;
            }
          }
        }

        const batchNum = Math.floor(i / 5) + 1;
        const totalBatches = Math.ceil(total / 5);

        setRereadProgress({
          current: i + 1,
          total,
          currentFileName: `Lote ${batchNum} de ${totalBatches} · ${name}`,
          percentage: Math.round(((i + 1) / total) * 100),
          successCount,
          errorCount,
          isRereading: true,
        });

        // Reintentos automáticos de hasta 4 veces con backoff creciente (3s, 6s, 12s, 24s + jitter)
        let attempts = 0;
        const MAX_RETRIES = 4;
        const RETRY_DELAYS = [3000, 6000, 12000, 24000];
        let res: any = null;

        while (attempts <= MAX_RETRIES && !abortRereadRef.current) {
          if (attempts > 0) {
            const baseWait = RETRY_DELAYS[attempts - 1] || 24000;
            const jitter = Math.floor(Math.random() * 1000);
            setRereadProgress((prev) =>
              prev ? { ...prev, currentFileName: `Reintentando (${attempts}/${MAX_RETRIES}): ${name}` } : null
            );
            await new Promise((r) => setTimeout(r, baseWait + jitter));
          }

          res = await safeJsonFetch('/api/reprocess-invoice', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileId,
              fileName: safeFileName,
              spreadsheetId: project.spreadsheetId,
              sheetTitle: effectiveActiveTab || project.activeSheetTab || 'Facturas',
              rowIndex: r.rowIndex,
              folderId: project.id,
              evidenceFolderId: project.evidenceFolderId,
              invoiceNumber: inv?.invoiceNumber,
              vendorName: inv?.vendorName,
            }),
          });

          if (res.ok && res.data?.success) {
            break;
          }

          const errMsg = (res.error || res.data?.error || '').toLowerCase();
          const is503 = errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('high demand');
          const is429 = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('resource_exhausted');
          const isTimeout = errMsg.includes('timeout') || errMsg.includes('504');

          if ((is503 || is429 || isTimeout) && attempts < MAX_RETRIES && !abortRereadRef.current) {
            attempts++;
            continue;
          } else {
            break;
          }
        }

        if (res?.ok && res?.data?.success) {
          successCount++;
        } else {
          errorCount++;
          if (res?.data?.skipped) {
            console.log(`[Relectura Erróneas] Fila ${r.rowIndex} (${name}) omitida:`, res?.data?.error);
          } else {
            console.warn(`[Relectura Erróneas] Fila ${r.rowIndex} (${name}) error:`, res?.error || res?.data?.error);
          }
        }

        setRereadProgress((prev) =>
          prev ? { ...prev, successCount, errorCount } : null
        );

        // Pausa preventiva de 1.5s entre archivos y 10s entre lotes de 5
        if (i < total - 1 && !abortRereadRef.current) {
          if ((i + 1) % 5 === 0) {
            for (let s = 10; s > 0 && !abortRereadRef.current; s--) {
              setRereadProgress((prev) =>
                prev ? { ...prev, currentFileName: `Pausa entre lotes: ${s}s...` } : null
              );
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } else {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }

      if (successCount > 0) {
        setRereadSuccessMessage(`¡Se corrigieron ${successCount} facturas con IA exitosamente!`);
      } else {
        setRereadErrorMessage('No se pudieron corregir las facturas con error.');
      }
      onRefresh();
    } catch (err: any) {
      setRereadErrorMessage(err.message || 'Error al releer facturas con IA.');
    } finally {
      setIsRereadingWithAi(false);
      setRereadProgress(null);
    }
  };

  return (
    <div
      id="invoice-history-table-container"
      className="w-full bg-white/95 backdrop-blur-md rounded-2xl sm:rounded-3xl border border-slate-200 shadow-md sm:shadow-lg overflow-hidden transition-all"
    >
      {/* Table Header with Stats & Actions */}
      <div className="p-4 sm:p-6 border-b border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white/70">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-[#1ca330]" />
                <span>
                  {dynamicAnalysis?.spreadsheetName || 'Hoja de Cálculo Conectada'}
                </span>
              </h3>
              {effectiveActiveTab && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#1ca330]/10 text-[#157a24] border border-[#1ca330]/25">
                  Pestaña: {effectiveActiveTab}
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Estructura real leída directamente del archivo en Google Drive (Fuente de verdad)
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto mt-3 lg:mt-0">
            {/* Botón: Analizar Facturas de Drive (NUEVO) */}
            {onOpenDriveInvoiceAnalysis && (
              <button
                id="btn-analyze-drive-invoices"
                type="button"
                onClick={onOpenDriveInvoiceAnalysis}
                className="col-span-2 sm:col-span-1 h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-emerald-600 via-teal-600 to-[#1ca330] hover:from-emerald-700 hover:to-[#157a24] rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer ring-1 ring-emerald-400/40 whitespace-nowrap w-full sm:w-auto"
                title="Analizar facturas en Google Drive, detectar cuáles ya se leyeron y cuáles no, y añadirlas a Sheets sin duplicados"
              >
                <FolderSearch className="w-3.5 h-3.5 text-emerald-200 shrink-0" />
                <span className="hidden sm:inline">Analizar Facturas de Drive</span>
                <span className="sm:hidden">Analizar Facturas de Drive</span>
              </button>
            )}

            {/* Botón Principal: Actualizar Información */}
            <button
              id="btn-update-info"
              type="button"
              onClick={() => {
                setSyncResult(null);
                setSyncError(null);
                setIsUpdateInfoOpen(true);
              }}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-slate-800 to-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer whitespace-nowrap w-full sm:w-auto"
              title="Actualizar información, sincronizar enlaces de fotos desde Drive y corregir facturas"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="hidden sm:inline">Actualizar Información</span>
              <span className="sm:hidden">Actualizar Info</span>
              {(unlinkedRows.length > 0 || poorlyProcessedRows.length > 0) && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black shadow-xs shrink-0">
                  {unlinkedRows.length + poorlyProcessedRows.length}
                </span>
              )}
            </button>

            {/* Botón: Releer Todas las Facturas con IA */}
            <button
              id="btn-toolbar-reread-all-invoices"
              type="button"
              onClick={handleRereadAllRegisteredInvoices}
              disabled={isRereadingAllRegistered || isLoading || !accessToken || rawRows.length === 0}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer ring-1 ring-purple-400/40 disabled:opacity-50 whitespace-nowrap w-full sm:w-auto"
              title="Releer todas las facturas registradas en esta hoja con IA para asegurar extracción y totales 100% exactos"
            >
              {isRereadingAllRegistered ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-200 shrink-0" />
                  <span className="truncate">
                    {rereadProgress
                      ? `${rereadProgress.current}/${rereadProgress.total} (${rereadProgress.percentage}%)`
                      : 'Releyendo...'}
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-purple-200 shrink-0" />
                  <span>Releer con IA</span>
                </>
              )}
            </button>

            {onAddMoreInvoices && (
              <button
                id="btn-table-add-more-invoices"
                onClick={onAddMoreInvoices}
                className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-[#1ca330] hover:bg-[#168826] rounded-xl transition-all shadow-xs active:scale-95 whitespace-nowrap cursor-pointer w-full sm:w-auto"
                title="Cargar y registrar facturas en esta hoja"
              >
                <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                <span>+ Cargar</span>
              </button>
            )}

            <button
              id="btn-refresh-history"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors shadow-xs disabled:opacity-50 whitespace-nowrap cursor-pointer w-full sm:w-auto"
              title="Recargar datos desde el archivo en Google Drive"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isLoading ? 'animate-spin text-[#1ca330]' : ''}`} />
              <span>Recargar</span>
            </button>

            {project.spreadsheetUrl && (
              <a
                id="btn-open-google-sheets"
                href={project.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-[#157a24] bg-[#1ca330]/15 hover:bg-[#1ca330]/25 border border-[#1ca330]/30 rounded-xl transition-colors shadow-xs whitespace-nowrap w-full sm:w-auto"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#1ca330] shrink-0" />
                <span>Ver en Sheets</span>
                <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
              </a>
            )}

            {project.spreadsheetId && (
              <button
                id="btn-export-excel-invoices"
                type="button"
                onClick={handleExportExcel}
                disabled={isExportingExcel}
                className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50 whitespace-nowrap w-full sm:w-auto"
                title="Descargar la hoja de cálculo completa en formato Excel (.xlsx) respetando todo su formato"
              >
                {isExportingExcel ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 shrink-0" />
                    <span>Exportando...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Excel (.xlsx)</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Real Google Sheets / Excel Tabs */}
        {effectiveTabs && effectiveTabs.length > 0 && (
          <div className="mb-3.5 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[11px] font-semibold text-slate-500 shrink-0 flex items-center gap-1 mr-1">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span>Pestañas reales:</span>
            </span>
            {effectiveTabs.map((tab) => {
              const isActive = effectiveActiveTab ? tab.title === effectiveActiveTab : tab.index === 0;
              return (
                <button
                  key={tab.sheetId ?? tab.title}
                  id={`btn-tab-${tab.sheetId ?? tab.title}`}
                  type="button"
                  onClick={() => onSelectTab && onSelectTab(tab.title)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                    isActive
                      ? 'bg-[#1ca330] text-white shadow-xs font-semibold'
                      : 'bg-white/80 hover:bg-white text-slate-600 hover:text-slate-900 border border-slate-200/90'
                  }`}
                  title={`Ver registros de la pestaña "${tab.title}"`}
                >
                  <FileSpreadsheet className={`w-3 h-3 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{tab.title}</span>
                  {tab.rowCount !== undefined && (
                    <span
                      className={`text-[10px] px-1 rounded ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tab.rowCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Barra de Progreso en Tiempo Real para Releer Facturas con IA */}
        {rereadProgress && rereadProgress.isRereading && (
          <div
            id="reread-invoices-progress-bar-container"
            className="mb-4 p-4 rounded-2xl bg-gradient-to-r from-purple-900/95 via-indigo-900/90 to-purple-950/95 text-white shadow-xl border border-purple-500/40 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-300"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-purple-800/80 border border-purple-400/40 shadow-inner">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-200" />
                  <Sparkles className="w-2.5 h-2.5 text-amber-300 absolute" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-sm font-bold text-white tracking-wide">
                      Releyendo Facturas con IA (Gemini)
                    </span>
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-500/30 text-purple-200 border border-purple-400/40">
                      {rereadProgress.current} de {rereadProgress.total} comprobantes
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-200/90 truncate max-w-md sm:max-w-lg mt-0.5">
                    📄 Procesando: <span className="font-semibold text-white">{rereadProgress.currentFileName}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-center">
                <div className="text-right">
                  <span className="text-base sm:text-xl font-black text-white font-mono">
                    {rereadProgress.percentage}%
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px] text-purple-200/80 mt-0.5">
                    <span className="text-emerald-300 font-bold">✓ {rereadProgress.successCount} actualizadas</span>
                    {rereadProgress.errorCount > 0 && (
                      <span className="text-amber-300 font-bold">· {rereadProgress.errorCount} omitidas</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCancelReread}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-rose-600/80 hover:bg-rose-600 rounded-xl border border-rose-400/40 transition-colors shadow-sm cursor-pointer active:scale-95"
                  title="Detener el proceso de relectura en el comprobante actual"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Detener</span>
                </button>
              </div>
            </div>

            {/* Track de Progreso Suave y Brillante */}
            <div className="w-full bg-purple-950/80 rounded-full h-3 overflow-hidden border border-purple-500/40 p-0.5 shadow-inner">
              <div
                className="bg-gradient-to-r from-purple-400 via-indigo-300 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
                style={{ width: `${Math.max(3, rereadProgress.percentage)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-purple-300/80 mt-1.5 px-1">
              <span>Extracción estructurada con Structured Outputs & sincronización en Google Sheets</span>
              <span>{Math.max(0, rereadProgress.total - rereadProgress.current)} restantes</span>
            </div>
          </div>
        )}

        {/* Success message after renaming document */}
        {renameSuccessMessage && (
          <div className="mb-3 p-3 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-between text-xs text-emerald-950 font-semibold animate-in fade-in shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#1ca330] shrink-0" />
              <span>{renameSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setRenameSuccessMessage(null)}
              className="text-emerald-700 hover:text-emerald-900 font-bold px-2 py-0.5 rounded hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Success message after exporting to Excel */}
        {excelSuccessMessage && (
          <div className="mb-3 p-3 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-between text-xs text-emerald-950 font-semibold animate-in fade-in shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#1ca330] shrink-0" />
              <span>{excelSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setExcelSuccessMessage(null)}
              className="text-emerald-700 hover:text-emerald-900 font-bold px-2 py-0.5 rounded hover:bg-emerald-100 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error message after exporting to Excel */}
        {excelErrorMessage && (
          <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-300 flex items-center justify-between text-xs text-rose-950 font-semibold animate-in fade-in shadow-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{excelErrorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setExcelErrorMessage(null)}
              className="text-rose-700 hover:text-rose-900 font-bold px-2 py-0.5 rounded hover:bg-rose-100 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* Success message after applying styling */}
        {styleSuccessMessage && (
          <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-800 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{styleSuccessMessage}</span>
          </div>
        )}

        {/* Success message after re-reading all invoices */}
        {rereadAllSuccessMessage && (
          <div className="mb-3 p-3 rounded-xl bg-purple-50 border border-purple-300 flex items-center justify-between text-xs text-purple-900 font-semibold animate-in fade-in">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
              <span>{rereadAllSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setRereadAllSuccessMessage(null)}
              className="text-purple-700 hover:text-purple-900 font-bold px-2 py-0.5 rounded hover:bg-purple-100 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error message after re-reading all invoices */}
        {rereadAllErrorMessage && (
          <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-300 flex items-center justify-between text-xs text-rose-900 font-semibold animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{rereadAllErrorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setRereadAllErrorMessage(null)}
              className="text-rose-700 hover:text-rose-900 font-bold px-2 py-0.5 rounded hover:bg-rose-100 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* Dynamic Metric Cards (Strictly aligned with Source-of-Truth and No-Inflation directives) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: TOTAL FACTURAS MVP (Direct calculation of MVP invoices, never combined with Google Sheets closing) */}
          <div className="bg-emerald-50/80 backdrop-blur-sm p-3.5 rounded-xl border-2 border-emerald-300/90 shadow-2xs">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[11px] font-bold text-emerald-900 block truncate uppercase tracking-wider">
                TOTAL FACTURAS MVP
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-200/90 text-emerald-900 border border-emerald-400/80">
                MVP
              </span>
            </div>
            <span className="text-base sm:text-xl font-extrabold text-emerald-950 block truncate font-mono">
              $ {mvpTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-emerald-700 font-medium block truncate mt-0.5">
              {invoices.length} {invoices.length === 1 ? 'comprobante contabilizado' : 'comprobantes contabilizados'}
            </span>
          </div>

          {/* Card 2: Subtotales por concepto (si existen en la hoja) */}
          {intermediateSubtotals.length > 0 ? (
            <div className="bg-amber-50/80 backdrop-blur-sm p-3.5 rounded-xl border border-amber-300 shadow-2xs">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[11px] font-bold text-amber-950 block truncate uppercase tracking-wider">
                  Subtotales por Concepto
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 border border-amber-300">
                  {intermediateSubtotals.length} {intermediateSubtotals.length === 1 ? 'grupo' : 'grupos'}
                </span>
              </div>
              <span className="text-base sm:text-xl font-extrabold text-amber-950 block truncate font-mono">
                $ {subtotalsSum.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-amber-800 font-medium block truncate mt-0.5">
                Excluidos del gasto unitario
              </span>
            </div>
          ) : summaries.length > 1 ? (
            <div className="bg-white/90 backdrop-blur-sm p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[11px] font-medium text-slate-500 block truncate" title={summaries[1].header}>
                  {summaries[1].header}
                </span>
              </div>
              <span className="text-base sm:text-xl font-bold text-slate-900 block truncate font-mono">
                $ {summaries[1].sum.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-400 font-medium block truncate mt-0.5">
                Cómputo directo
              </span>
            </div>
          ) : null}

          {/* Card 3: Gastos Unitarios (Suma de registros individuales sin inflar por subtotales) */}
          <div className="bg-white/90 backdrop-blur-sm p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[11px] font-bold text-slate-600 block truncate uppercase tracking-wider">
                Gastos Unitarios
              </span>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                Sin inflar
              </span>
            </div>
            <span className="text-base sm:text-xl font-bold text-slate-900 block truncate font-mono">
              $ {unitExpensesSum.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-500 font-medium block truncate mt-0.5">
              {pureUnitRows.length} partidas individuales
            </span>
          </div>

          {/* Card 4: Total Registros */}
          <div className="bg-white/90 backdrop-blur-sm p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[11px] font-medium text-slate-500 block">Total Registros</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base sm:text-xl font-bold text-sky-700">
                {filteredAndSortedRows.length}
              </span>
              {filteredAndSortedRows.length !== totalRowsCount && (
                <span className="text-[10px] text-slate-400">de {totalRowsCount}</span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-medium block truncate mt-0.5">
              {intermediateSubtotals.length > 0
                ? `${intermediateSubtotals.length} subtotales identificados`
                : 'Partidas registradas'}
            </span>
          </div>
        </div>

        {/* Sección Propia: Subtotales por concepto */}
        {intermediateSubtotals.length > 0 && (
          <div
            id="section-subtotales-por-concepto"
            className="mt-3.5 bg-gradient-to-br from-amber-50/90 via-amber-50/50 to-orange-50/30 border border-amber-300/80 rounded-xl p-3.5 shadow-2xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 mb-3 border-b border-amber-200/80">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 bg-amber-200/90 text-amber-900 rounded-lg mt-0.5 shrink-0 shadow-2xs">
                  <Bookmark className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs sm:text-sm font-bold text-amber-950 uppercase tracking-wide">
                      Subtotales por concepto
                    </h4>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 border border-amber-300">
                      {intermediateSubtotals.length} {intermediateSubtotals.length === 1 ? 'grupo' : 'grupos'}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800/90 mt-0.5">
                    Filas intermedias de SUBTOTAL extraídas de la tabla. Sus importes no se suman a los gastos unitarios para no duplicar el cómputo.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-white/95 border border-amber-300/90 rounded-lg px-3 py-1.5 self-start sm:self-auto shadow-2xs">
                <span className="text-[10px] font-bold text-amber-900 uppercase">Suma de subtotales:</span>
                <span className="text-xs sm:text-sm font-black font-mono text-amber-950">
                  $ {subtotalsSum.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Grid de Subtotales por Concepto */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {intermediateSubtotals.map((sub, idx) => (
                <div
                  key={sub.id || idx}
                  className="bg-white/95 backdrop-blur-xs p-3 rounded-lg border border-amber-200 hover:border-amber-400 transition-all shadow-2xs flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200/90">
                          SUBTOTAL
                        </span>
                        <span className="text-xs font-bold text-slate-900 truncate block" title={sub.concept || sub.label}>
                          {sub.concept || sub.label}
                        </span>
                      </div>
                      <span className="text-[11px] text-amber-900/90 font-medium block">
                        Corresponde a: <strong className="font-semibold text-slate-800">{sub.rangeDescription}</strong>
                      </span>
                    </div>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 whitespace-nowrap border border-slate-200">
                      Fila {sub.actualSheetRowIndex}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 mt-1">
                    <span className="text-[10px] text-slate-500 font-medium">Subtotal declarado:</span>
                    <span className="text-xs sm:text-sm font-mono font-black text-amber-950">
                      {sub.formattedAmount || `$ ${sub.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Universal Search Bar */}
        <div className="mt-3 flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              id="input-search-invoices"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={`Buscar en todas las columnas de "${effectiveActiveTab}"...`}
              className="w-full bg-white/90 border border-slate-300/90 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Switcher (Tarjetas vs Tabla completa) y aviso */}
      <div className="lg:hidden px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 p-1 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <button
            type="button"
            onClick={() => setMobileViewMode('cards')}
            className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors ${
              mobileViewMode === 'cards'
                ? 'bg-[#0F766E] text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tarjetas
          </button>
          <button
            type="button"
            onClick={() => setMobileViewMode('table')}
            className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors ${
              mobileViewMode === 'table'
                ? 'bg-[#0F766E] text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tabla
          </button>
        </div>

        <span className="font-bold bg-white px-2.5 py-1 rounded-full border border-slate-200 text-[11px] text-[#0F766E]">
          {filteredAndSortedRows.length} {filteredAndSortedRows.length === 1 ? 'partida' : 'partidas'}
        </span>
      </div>

      {/* VISTA EN TARJETAS PARA CELULAR (< 1024px si mobileViewMode === 'cards') */}
      {mobileViewMode === 'cards' && (
        <div className="lg:hidden p-3.5 space-y-2.5 max-h-[75vh] overflow-y-auto pb-20">
          {filteredAndSortedRows.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-white rounded-[14px] border border-dashed border-slate-200">
              <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-xs font-semibold text-slate-600">No hay partidas que coincidan con la búsqueda</p>
            </div>
          ) : (
            filteredAndSortedRows.map((row, rIdx) => {
              const invoice = row?.invoiceRecord;
              const rowKey = `m-card-${row?.id ?? 'r'}-${row?.rowIndex ?? rIdx}-${rIdx}`;
              const isExpanded = expandedRowId === rowKey;

              // Obtener 3 datos clave: Concepto / Proveedor, Fecha y Total
              const vendor = invoice?.vendorName || String(row?.values?.[1] || row?.values?.[0] || 'Proveedor / Partida');
              const dateVal = invoice?.date || String(row?.values?.[0] || '');
              const totalVal = invoice?.totalAmount !== undefined
                ? Number(invoice.totalAmount)
                : parseLocaleAmount(row?.values?.[7] || row?.values?.[5] || 0);

              const driveUrl = row.driveFileUrl || invoice?.driveFileUrl;

              return (
                <div
                  key={rowKey}
                  onClick={() => setExpandedRowId(isExpanded ? null : rowKey)}
                  className="p-3.5 bg-white rounded-[14px] border border-slate-200/90 shadow-2xs transition-all active:scale-[0.99] cursor-pointer space-y-2"
                >
                  {/* Los 3 datos clave visibles */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-[#64748B]">
                        <span>#{row.rowIndex}</span>
                        <span>•</span>
                        <span>{dateVal ? formatDateCO(dateVal) : 'Sin fecha'}</span>
                        {invoice?.category && (
                          <>
                            <span>•</span>
                            <span className="text-[#0F766E] font-semibold">{invoice.category}</span>
                          </>
                        )}
                      </div>
                      <h4 className="text-xs font-bold text-[#0F172A] truncate mt-0.5">
                        {vendor}
                      </h4>
                      {invoice?.concept && (
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {invoice.concept}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-sm font-black font-mono text-[#0F172A] block tabular-nums">
                        {formatCOP(totalVal)}
                      </span>
                      <span className="text-[10px] text-[#0F766E] font-semibold">
                        {isExpanded ? 'Toca para ocultar' : 'Toca para ver más'}
                      </span>
                    </div>
                  </div>

                  {/* Resto de datos al tocar (Acordeón expandible) */}
                  {isExpanded && (
                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 space-y-1.5 animate-in fade-in" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-[#64748B] block">Número Factura:</span>
                          <span className="font-semibold text-slate-800">{invoice?.invoiceNumber || 'S/N'}</span>
                        </div>
                        <div>
                          <span className="text-[#64748B] block">NIT / RUT:</span>
                          <span className="font-semibold text-slate-800">{invoice?.vendorTaxId || '—'}</span>
                        </div>
                        {invoice?.subtotal !== undefined && invoice?.subtotal > 0 && (
                          <div>
                            <span className="text-[#64748B] block">Subtotal:</span>
                            <span className="font-mono font-medium text-slate-800 tabular-nums">{formatCOP(invoice.subtotal)}</span>
                          </div>
                        )}
                        {invoice?.taxAmount !== undefined && invoice?.taxAmount > 0 && (
                          <div>
                            <span className="text-[#64748B] block">IVA:</span>
                            <span className="font-mono font-medium text-slate-800 tabular-nums">{formatCOP(invoice.taxAmount)}</span>
                          </div>
                        )}
                      </div>

                      {/* Botones de acción móvil */}
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                        {driveUrl && (
                          <a
                            href={driveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 h-9 px-3 bg-teal-50 hover:bg-teal-100 text-[#0F766E] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Ver Comprobante</span>
                          </a>
                        )}
                        {invoice && onEditInvoice && (
                          <button
                            type="button"
                            onClick={() => setInvoiceToEdit(invoice)}
                            className="h-9 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>
                        )}
                        {invoice && onDeleteInvoice && (
                          <button
                            type="button"
                            onClick={() => setInvoiceToDelete(invoice)}
                            className="h-9 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold flex items-center justify-center transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Barra de totales fija abajo en móvil cuando aplique */}
      {mobileViewMode === 'cards' && (
        <div className="lg:hidden fixed bottom-16 left-0 right-0 z-20 bg-emerald-50/95 backdrop-blur-md border-t-2 border-emerald-300 p-3 px-4 shadow-lg flex items-center justify-between">
          <div className="text-xs">
            <span className="text-[10px] uppercase font-bold text-emerald-900 block">Total de la Obra</span>
            <span className="text-emerald-700 font-semibold">{filteredAndSortedRows.length} partidas</span>
          </div>
          <div className="text-right">
            <span className="text-base font-black font-mono text-emerald-950 tabular-nums">
              {formatCOP(mvpTotal)}
            </span>
          </div>
        </div>
      )}

      {/* Dynamic Data Table (Visible en Computador >= 1024px o en móvil si el usuario prefiere vista tabla) */}
      <div className={`overflow-x-auto max-h-[82vh] min-h-[500px] sm:min-h-[620px] lg:min-h-[720px] scrollbar-thin ${
        mobileViewMode === 'cards' ? 'hidden lg:block' : 'block'
      }`}>
        <table className="w-full text-left text-xs sm:text-sm border-collapse min-w-[1000px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100/95 backdrop-blur-sm border-b border-slate-200 text-slate-800 font-bold uppercase tracking-wider text-xs sm:text-[13px]">
              <th className="py-3.5 sm:py-4 px-3 text-slate-400 font-normal w-12 border-r border-slate-200/80 text-center">
                #
              </th>
              {(effectiveHeaders || []).map((header, colIdx) => {
                const colMeta = effectiveColumns ? effectiveColumns[colIdx] : undefined;
                const isSorted = sortColumnIndex === colIdx;
                return (
                  <th
                    key={colIdx}
                    onClick={() => handleToggleSort(colIdx)}
                    className="py-3.5 sm:py-4 px-3.5 sm:px-4 border-r border-slate-200/80 whitespace-nowrap cursor-pointer hover:bg-slate-200/60 transition-colors select-none"
                    title="Haz clic para ordenar por esta columna"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{header}</span>
                      <div className="flex items-center gap-1 text-slate-400 shrink-0">
                        {colMeta?.type === 'currency' && (
                          <span className="text-xs font-mono font-bold text-emerald-600">$</span>
                        )}
                        {colMeta?.type === 'date' && <Calendar className="w-3.5 h-3.5 text-sky-500" />}
                        {colMeta?.type === 'url' && <LinkIcon className="w-3.5 h-3.5 text-blue-500" />}
                        <ArrowUpDown
                          className={`w-3.5 h-3.5 ${
                            isSorted ? 'text-[#1ca330] font-bold' : 'opacity-40'
                          }`}
                        />
                      </div>
                    </div>
                  </th>
                );
              })}
              <th className="py-3.5 sm:py-4 px-3.5 text-center whitespace-nowrap w-28">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(filteredAndSortedRows || []).length === 0 ? (
              <tr>
                <td colSpan={(effectiveHeaders || []).length + 2} className="p-8 text-center text-slate-400 text-xs">
                  {isLoading ? (
                    <div className="py-6 flex flex-col items-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-[#1ca330]" />
                      <span>Cargando datos desde la hoja de Google Drive...</span>
                    </div>
                  ) : totalRowsCount === 0 ? (
                    <div>
                      <FileCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-medium text-slate-600">
                        Esta pestaña de la hoja de cálculo está vacía o aún no contiene filas de datos.
                      </p>
                      <p className="text-slate-400 mt-0.5">
                        Puedes registrar facturas o comprobantes desde la sección superior.
                      </p>
                    </div>
                  ) : (
                    'No se encontraron filas que coincidan con la búsqueda.'
                  )}
                </td>
              </tr>
            ) : (
              (filteredAndSortedRows || []).map((row, rIdx) => {
                const invoice = row?.invoiceRecord;

                // Renderizado especial de fila intermedia de SUBTOTAL
                if (row.isSubtotalRow) {
                  const subInfo = row.subtotalInfo;
                  return (
                    <tr
                      key={`subtotal-${row?.id ?? 'sub'}-${rIdx}`}
                      className="bg-amber-50/90 hover:bg-amber-100/80 border-y-2 border-amber-300/90 transition-colors font-medium text-amber-950"
                    >
                      <td className="py-2.5 px-3 text-center font-mono text-[11px] border-r border-amber-200/90 text-amber-800">
                        <span className="inline-block px-1.5 py-0.5 bg-amber-200 text-amber-950 rounded text-[9px] font-extrabold tracking-wide">
                          SUB
                        </span>
                      </td>

                      {(effectiveHeaders || []).map((header, colIdx) => {
                        const cellVal = row?.values ? row.values[colIdx] : undefined;
                        const colMeta = effectiveColumns ? effectiveColumns[colIdx] : undefined;
                        const strVal = String(cellVal !== undefined && cellVal !== null ? cellVal : '');
                        const isCurrency = colMeta?.type === 'currency' || colIdx === subInfo?.costColIndex;
                        const isConceptCol = colIdx === 0 || /concepto|detalle|descrip|partida|nombre/i.test(header);

                        return (
                          <td
                            key={colIdx}
                            className={`py-2 px-3.5 border-r border-amber-200/80 text-xs ${
                              isCurrency
                                ? 'text-right font-mono font-black text-amber-950'
                                : 'text-amber-900'
                            }`}
                          >
                            {isCurrency ? (
                              <div className="flex flex-col items-end">
                                <span className="text-xs sm:text-sm">
                                  $ {parseLocaleAmount(strVal).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                                </span>
                                <span className="text-[9px] font-semibold text-amber-800 bg-amber-200/70 px-1 rounded mt-0.5">
                                  Subtotal grupo
                                </span>
                              </div>
                            ) : isConceptCol ? (
                              <div className="flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 bg-amber-200 text-amber-950 rounded text-[9px] font-black uppercase tracking-wider">
                                  SUBTOTAL
                                </span>
                                <span className="font-bold text-slate-900 truncate max-w-[240px]" title={subInfo?.concept || strVal}>
                                  {subInfo?.concept || strVal || 'Subtotal'}
                                </span>
                                {subInfo?.rangeDescription && (
                                  <span className="text-[10px] font-medium text-amber-800/90 hidden sm:inline">
                                    ({subInfo.rangeDescription})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="max-w-[200px] truncate block opacity-75" title={strVal}>
                                {strVal || '—'}
                              </span>
                            )}
                          </td>
                        );
                      })}

                      {/* Columna de Estado / Acciones para fila de Subtotal */}
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                          Excluido de unitarios
                        </span>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={`row-${row?.id ?? 'r'}-${row?.rowIndex ?? rIdx}-${rIdx}`} className="hover:bg-slate-50/90 transition-colors group">
                    <td className="py-2.5 px-3 text-slate-400 text-center font-mono text-[11px] border-r border-slate-100">
                      {row?.rowIndex}
                    </td>

                    {(effectiveHeaders || []).map((_, colIdx) => {
                      const cellVal = row?.values ? row.values[colIdx] : undefined;
                      const colMeta = effectiveColumns ? effectiveColumns[colIdx] : undefined;
                      const strVal = String(cellVal !== undefined && cellVal !== null ? cellVal : '');

                      const headerLower = (colMeta?.header || '').toLowerCase();
                      const isComprobanteCol =
                        headerLower.includes('comprobante') ||
                        headerLower.includes('archivo') ||
                        headerLower.includes('soporte') ||
                        headerLower.includes('enlace') ||
                        headerLower.includes('drive') ||
                        headerLower.includes('foto') ||
                        headerLower.includes('imagen') ||
                        headerLower.includes('link');

                      const isUrl =
                        colMeta?.type === 'url' ||
                        strVal.startsWith('http://') ||
                        strVal.startsWith('https://') ||
                        strVal.includes('drive.google.com');

                      const effectiveFileUrl =
                        (isUrl ? strVal : '') ||
                        row.driveFileUrl ||
                        row.invoiceRecord?.driveFileUrl ||
                        (strVal.startsWith('http') || strVal.includes('drive.google.com') ? strVal : '') ||
                        (isComprobanteCol && strVal.length > 20 && !strVal.includes(' ') && !strVal.includes('.')
                          ? `https://drive.google.com/file/d/${strVal}/view`
                          : '');

                      const isCurrency = colMeta?.type === 'currency';

                      return (
                        <td
                          key={colIdx}
                          className={`py-3 sm:py-3.5 px-3.5 sm:px-4 border-r border-slate-100 text-xs sm:text-sm ${
                            isCurrency ? 'text-right font-mono font-bold text-slate-900' : 'text-slate-700'
                          }`}
                        >
                          {isComprobanteCol || isUrl ? (
                            effectiveFileUrl ? (
                              <div className="flex items-center gap-1.5 max-w-[260px]">
                                <a
                                  href={effectiveFileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 hover:text-sky-950 border border-sky-300 rounded-xl transition-all shadow-2xs group truncate flex-1"
                                  title="Abrir y corroborar foto original de la factura en Google Drive"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-sky-600 group-hover:text-sky-800 shrink-0" />
                                  <span className="truncate">
                                    {row.fileName || row.invoiceRecord?.fileName || 'Ver Foto en Drive ↗'}
                                  </span>
                                </a>
                                {invoice && onEditInvoice && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartQuickRename(invoice);
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer shrink-0"
                                    title="Editar nombre del documento de esta factura"
                                  >
                                    <FileEdit className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (invoice && onEditInvoice) {
                                      setAutoStartAiModal(false);
                                      setInvoiceToEdit(invoice);
                                    } else {
                                      setIsUpdateInfoOpen(true);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-xl transition-all shadow-2xs cursor-pointer"
                                  title="Esta factura no tiene enlace a la foto en Drive. Haz clic para vincular o actualizar"
                                >
                                  <Paperclip className="w-3 h-3 text-amber-600 shrink-0" />
                                  <span>+ Vincular Foto</span>
                                </button>
                                {invoice && onEditInvoice && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartQuickRename(invoice);
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer shrink-0"
                                    title="Editar nombre del documento de esta factura"
                                  >
                                    <FileEdit className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )
                          ) : colMeta?.type === 'tag' ? (
                            <span className="inline-block px-2.5 py-1 text-xs font-medium rounded-lg bg-sky-50 text-sky-700 border border-sky-200">
                              {strVal}
                            </span>
                          ) : isCurrency ? (
                            <span className="block truncate font-mono font-bold text-slate-900 text-xs sm:text-sm">
                              $ {parseLocaleAmount(strVal).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="max-w-[320px] truncate block" title={strVal}>
                              {strVal || <span className="text-slate-300">—</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    {/* Actions Column */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Edit Button (if mapped as invoice record) */}
                        {invoice && onEditInvoice && (
                          <button
                            id={`btn-edit-row-${row.rowIndex}`}
                            type="button"
                            onClick={() => {
                              setAutoStartAiModal(false);
                              setInvoiceToEdit(invoice);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-2.5 py-1.5 rounded-lg transition-colors shadow-2xs active:scale-95 cursor-pointer"
                            title="Editar fila y actualizar campos en Google Sheets"
                          >
                            <Pencil className="w-3.5 h-3.5 text-emerald-700" />
                            <span className="hidden sm:inline">Editar</span>
                          </button>
                        )}

                        {/* Quick Rename Document Button */}
                        {invoice && onEditInvoice && (
                          <button
                            id={`btn-rename-doc-row-${row.rowIndex}`}
                            type="button"
                            onClick={() => handleStartQuickRename(invoice)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-800 hover:text-sky-950 bg-sky-50 hover:bg-sky-100 border border-sky-300 px-2.5 py-1.5 rounded-lg transition-colors shadow-2xs active:scale-95 cursor-pointer"
                            title="Editar nombre del documento o archivo de esta factura"
                          >
                            <FileEdit className="w-3.5 h-3.5 text-sky-700" />
                            <span className="hidden sm:inline">Renombrar</span>
                          </button>
                        )}

                        {/* Quick AI Re-read / Re-extract Button */}
                        {invoice && onEditInvoice && (
                          <button
                            id={`btn-ai-reextract-row-${row.rowIndex}`}
                            type="button"
                            onClick={() => {
                              setAutoStartAiModal(true);
                              setInvoiceToEdit(invoice);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-purple-800 hover:text-purple-950 bg-purple-50 hover:bg-purple-100 border border-purple-300 px-2.5 py-1.5 rounded-lg transition-colors shadow-2xs active:scale-95 cursor-pointer"
                            title="Re-analizar con IA si la factura estuvo mal procesada"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                            <span className="hidden sm:inline">Releer IA</span>
                          </button>
                        )}

                        {/* View Drive File Button */}
                        {(row.driveFileUrl || row.invoiceRecord?.driveFileUrl) && (
                          <a
                            href={row.driveFileUrl || row.invoiceRecord?.driveFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
                            title="Abrir foto en Google Drive"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Ver</span>
                          </a>
                        )}

                        {/* Delete Button */}
                        {invoice && onDeleteInvoice ? (
                          <button
                            id={`btn-delete-row-${row.rowIndex}`}
                            type="button"
                            onClick={() => setInvoiceToDelete(invoice)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-1.5 rounded-lg transition-colors shadow-2xs active:scale-95"
                            title="Eliminar fila de Google Sheets"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : onDeleteDynamicRow ? (
                          <button
                            id={`btn-delete-dynamic-row-${row.rowIndex}`}
                            type="button"
                            onClick={() =>
                              setRowToDelete({
                                sheetTitle: effectiveActiveTab,
                                rowIndex: row.rowIndex,
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-1.5 rounded-lg transition-colors shadow-2xs active:scale-95"
                            title="Eliminar esta fila en Google Sheets"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {/* Table Footer with exact Declared Totals & Reserved TOTAL GENERAL */}
          <tfoot className="sticky bottom-0 z-10 bg-emerald-50/95 backdrop-blur-sm border-t-2 border-emerald-300 font-bold text-slate-800 shadow-xs">
            <tr>
              <td className="py-2.5 px-3 text-center text-[11px] font-mono text-emerald-800 border-r border-emerald-200">
                Σ
              </td>
              {(effectiveHeaders || []).map((header, colIdx) => {
                const summaryItem = (summaries || []).find((s) => (s?.header || '').toLowerCase() === (header || '').toLowerCase());
                const colMeta = effectiveColumns ? effectiveColumns[colIdx] : undefined;
                const isExpense = colMeta?.type === 'currency' || summaryItem !== undefined;

                // Suma exclusiva de esta columna (evita inflar o repetir el gran total en columnas como Subtotal o IVA)
                const thisColSum = (() => {
                  if (summaryItem?.sum !== undefined && summaryItem.sum > 0) {
                    return summaryItem.sum;
                  }
                  if (colMeta?.sum !== undefined && colMeta.sum > 0) {
                    return colMeta.sum;
                  }
                  // Cálculo directo a partir de las filas puras
                  const sum = pureUnitRows.reduce((acc, r) => {
                    const val = r.values ? r.values[colIdx] : undefined;
                    return acc + parseLocaleAmount(val);
                  }, 0);
                  if (sum > 0) return sum;
                  if (header.toLowerCase().includes('total')) return mvpTotal;
                  return 0;
                })();

                const isTotalColumn =
                  header.toLowerCase().includes('total') ||
                  header.toLowerCase().includes('pagar') ||
                  header.toLowerCase().includes('monto');

                return (
                  <td
                    key={colIdx}
                    className={`py-2 px-3.5 border-r border-emerald-200 text-xs ${
                      isExpense ? 'text-right font-mono font-bold text-emerald-950' : 'text-slate-600'
                    }`}
                  >
                    {isExpense ? (
                      <div className="flex flex-col items-end">
                        <span className="text-xs sm:text-sm font-black">
                          $ {thisColSum.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100/90 px-1.5 py-0.5 rounded border border-emerald-300">
                          {isTotalColumn ? 'Total MVP' : header}
                        </span>
                      </div>
                    ) : colIdx === 0 ? (
                      <div className="flex flex-col">
                        <span className="font-extrabold text-emerald-950 uppercase text-[10px] tracking-wider">
                          TOTAL GENERAL
                        </span>
                        <span className="text-[9px] text-emerald-700 font-medium">
                          {invoices.length} {invoices.length === 1 ? 'factura' : 'facturas'}
                        </span>
                      </div>
                    ) : null}
                  </td>
                );
              })}
              <td className="py-2 px-3 text-center text-[10px] text-emerald-800 font-bold">
                MVP
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Edit Invoice Modal */}
      {invoiceToEdit && onEditInvoice && (
        <EditInvoiceModal
          isOpen={!!invoiceToEdit}
          onClose={() => {
            setInvoiceToEdit(null);
            setAutoStartAiModal(false);
          }}
          invoice={invoiceToEdit}
          project={project}
          onSave={onEditInvoice}
          sheetTitle={effectiveActiveTab || project.activeSheetTab}
          accessToken={accessToken}
          initialAutoRunAi={autoStartAiModal}
        />
      )}

      {/* Modal de Renombrado Rápido del Documento */}
      {quickRenameInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-[#1ca330]" />
                <h4 className="text-sm font-bold text-slate-900">Editar Nombre del Documento</h4>
              </div>
              <button
                type="button"
                onClick={() => setQuickRenameInvoice(null)}
                disabled={isSavingQuickRename}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuickRename} className="p-4 sm:p-5 space-y-4">
              {/* Resumen del Comprobante */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs space-y-1">
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span className="truncate">{quickRenameInvoice.vendorName || 'Sin proveedor'}</span>
                  <span className="font-mono text-emerald-700">
                    $ {(quickRenameInvoice.totalAmount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Factura: <strong className="text-slate-700">{quickRenameInvoice.invoiceNumber || 'S/N'}</strong></span>
                  <span>Fila #{quickRenameInvoice.rowIndex}</span>
                </div>
              </div>

              {quickRenameError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{quickRenameError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nombre del archivo de la factura:
                </label>
                <input
                  type="text"
                  value={quickRenameInput}
                  onChange={(e) => setQuickRenameInput(e.target.value)}
                  placeholder="Ej. FACTURA 13 ARENA.pdf"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  autoFocus
                />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Corrige el nombre si se guardó incorrectamente. Se actualizará en la fila #{quickRenameInvoice.rowIndex} de Google Sheets y se renombrará el archivo correspondiente en Google Drive.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQuickRenameInvoice(null)}
                  disabled={isSavingQuickRename}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingQuickRename || !quickRenameInput.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#1ca330] hover:bg-[#157a24] transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSavingQuickRename ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Guardar Nombre</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Invoice Modal */}
      {invoiceToDelete && onDeleteInvoice && (
        <DeleteInvoiceModal
          isOpen={!!invoiceToDelete}
          onClose={() => setInvoiceToDelete(null)}
          invoice={invoiceToDelete}
          project={project}
          onConfirmDelete={onDeleteInvoice}
        />
      )}

      {/* Delete Generic Dynamic Row Confirmation Modal */}
      {rowToDelete && onDeleteDynamicRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-base">¿Eliminar fila {rowToDelete.rowIndex}?</h4>
              <p className="text-xs text-slate-500 mt-1">
                Esta acción eliminará la fila directamente de la pestaña "{rowToDelete.sheetTitle}" en Google Sheets.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRowToDelete(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeleteDynamicRow(rowToDelete.sheetTitle, rowToDelete.rowIndex);
                  setRowToDelete(null);
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Minimized Floating Dock */}
      {isUpdateInfoOpen && isUpdateInfoMinimized && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#1ca330]/20 text-[#98d52c]">
              <Wrench className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold truncate max-w-[200px]">
                Actualizar Información y Auditoría
              </span>
              <span className="text-[10px] text-slate-400">Pestaña minimizada</span>
            </div>
          </div>
          <div className="flex items-center gap-1 border-l border-slate-700/80 pl-2">
            <button
              type="button"
              onClick={() => setIsUpdateInfoMinimized(false)}
              className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Restaurar a página completa"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsUpdateInfoOpen(false)}
              className="p-1.5 hover:bg-rose-900/60 rounded-xl text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
              title="Cerrar pestaña (x)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modal: Actualizar Información y Enlaces de Facturas */}
      {isUpdateInfoOpen && !isUpdateInfoMinimized && (
        <div className={isUpdateInfoFullscreen ? 'fixed inset-0 z-50 flex flex-col w-full h-full bg-white overflow-hidden animate-in fade-in duration-150' : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150'}>
          <div className={isUpdateInfoFullscreen ? 'w-full h-full flex flex-col bg-white overflow-hidden' : 'bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95'}>
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-[#1ca330]/15 text-[#157a24]">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900">
                      Actualizar Información y Auditoría de Facturas
                    </h3>
                    {isUpdateInfoFullscreen && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hidden sm:inline-block">
                        Página Completa
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Sincroniza enlaces a fotos en Google Drive y relee facturas registradas con IA para corregir importes y garantizar facturación exacta.
                  </p>
                </div>
              </div>

              {/* Window Controls */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  id="btn-minimize-update-info-tab"
                  onClick={() => setIsUpdateInfoMinimized(true)}
                  className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
                  title="Minimizar pestaña (-)"
                >
                  <Minus className="w-5 h-5 stroke-[2.5]" />
                </button>
                <button
                  type="button"
                  id="btn-toggle-fullscreen-update-info-tab"
                  onClick={() => setIsUpdateInfoFullscreen((prev) => !prev)}
                  className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors hidden sm:inline-flex cursor-pointer"
                  title={isUpdateInfoFullscreen ? 'Restaurar tamaño ventana' : 'Abrir en página completa'}
                >
                  {isUpdateInfoFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  id="btn-close-update-info-modal"
                  onClick={() => setIsUpdateInfoOpen(false)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                  title="Cerrar pestaña (x)"
                >
                  <X className="w-5 h-5 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-6 lg:p-8 overflow-y-auto space-y-6 flex-1 max-w-5xl w-full mx-auto text-xs sm:text-sm">
              {/* Sync Results Banner */}
              {syncResult && (
                <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl space-y-2 animate-in fade-in">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>¡Sincronización completada con éxito!</span>
                  </div>
                  <ul className="text-xs text-emerald-800 list-disc list-inside space-y-1">
                    <li>Enlaces de fotos actualizados en Google Sheets: <strong>{syncResult.updatedLinksCount}</strong></li>
                    <li>Facturas que ya contaban con enlace válido: <strong>{syncResult.alreadyLinkedCount}</strong></li>
                    <li>Archivos de fotos escaneados en Google Drive: <strong>{syncResult.scannedFilesCount}</strong></li>
                    {syncResult.unlinkedCount > 0 && (
                      <li className="text-amber-800">Facturas aún sin foto encontrada en Drive: <strong>{syncResult.unlinkedCount}</strong></li>
                    )}
                  </ul>
                  {syncResult.details.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-emerald-200/80 max-h-28 overflow-y-auto text-[11px] text-emerald-700 space-y-0.5 font-mono">
                      {syncResult.details.map((d, i) => (
                        <div key={i}>{d}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {syncError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{syncError}</span>
                </div>
              )}

              {rereadAllSuccessMessage && (
                <div className="p-3.5 bg-purple-50 border border-purple-300 rounded-xl flex items-center gap-2.5 text-xs text-purple-900 font-semibold animate-in fade-in">
                  <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
                  <span>{rereadAllSuccessMessage}</span>
                </div>
              )}

              {rereadAllErrorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{rereadAllErrorMessage}</span>
                </div>
              )}

              {/* Botón Destacado: Releer TODAS las Facturas Registradas */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-purple-50 via-indigo-50/60 to-purple-50 border-2 border-purple-300/80 space-y-3 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-purple-950 flex items-center gap-1.5 text-sm">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      <span>Releer TODAS las Facturas Registradas con IA ({totalRowsCount} facturas)</span>
                    </h4>
                    <p className="text-xs text-purple-900/90 mt-1 max-w-xl">
                      Ejecuta la re-lectura inteligente con IA de Gemini sobre todas las fotos archivadas en Google Drive, actualizando importes, IVA, NIF, proveedor y conceptos exactos en Google Sheets para garantizar facturación perfecta al cliente.
                    </p>
                  </div>

                  <button
                    type="button"
                    id="btn-modal-reread-all-registered-invoices"
                    onClick={handleRereadAllRegisteredInvoices}
                    disabled={isRereadingAllRegistered || !accessToken || totalRowsCount === 0}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 disabled:opacity-50 rounded-xl transition-all shadow-md active:scale-95 cursor-pointer shrink-0 ring-1 ring-purple-400/40"
                    title="Releer todas las facturas registradas en esta hoja con IA"
                  >
                    {isRereadingAllRegistered ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-purple-200" />
                        <span>
                          {rereadProgress
                            ? `Releyendo (${rereadProgress.current}/${rereadProgress.total})... ${rereadProgress.percentage}%`
                            : `Releyendo Facturas (${totalRowsCount})...`}
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-purple-200" />
                        <span>Releer TODAS las Facturas ({totalRowsCount})</span>
                      </>
                    )}
                  </button>
                </div>

                {rereadProgress && rereadProgress.isRereading && (
                  <div className="pt-2 border-t border-purple-200/80 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-xs mb-1.5 font-semibold text-purple-900">
                      <span className="truncate max-w-xs sm:max-w-md">📄 {rereadProgress.currentFileName}</span>
                      <span className="font-mono font-bold text-purple-950">{rereadProgress.percentage}% ({rereadProgress.current}/{rereadProgress.total})</span>
                    </div>
                    <div className="w-full bg-purple-200/80 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-purple-600 via-indigo-600 to-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(4, rereadProgress.percentage)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-purple-800 mt-1.5">
                      <span>✓ {rereadProgress.successCount} actualizadas {rereadProgress.errorCount > 0 ? `· ⚠ ${rereadProgress.errorCount} omitidas` : ''}</span>
                      <button
                        type="button"
                        onClick={handleCancelReread}
                        className="text-rose-600 hover:text-rose-800 font-bold underline cursor-pointer text-xs"
                      >
                        Detener relectura
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Action 1: Enlaces a Fotos de Drive a Sheets */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-sky-50/70 to-indigo-50/40 border border-sky-200/90 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sky-950 flex items-center gap-1.5">
                      <FileSpreadsheet className="w-4 h-4 text-sky-600" />
                      <span>1. Enlaces a Fotos de Facturas en Google Sheets</span>
                    </h4>
                    <p className="text-xs text-sky-800/90 mt-1">
                      Genera fórmulas <code>=HYPERLINK</code> en Google Sheets para que tú y tu equipo puedan hacer clic directamente desde la hoja de cálculo y abrir la foto en Google Drive para corroborarla y contrastar los datos.
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                    {unlinkedRows.length === 0 ? '100% Enlazadas' : `${unlinkedRows.length} pendientes`}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-600 space-y-0.5">
                    <div>Fotos vinculadas: <strong>{totalRowsCount - unlinkedRows.length} de {totalRowsCount}</strong></div>
                    {unlinkedRows.length > 0 && (
                      <div className="text-amber-700 font-medium">⚠️ {unlinkedRows.length} facturas no tienen enlace a la foto en Drive</div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleRunSyncDriveLinks}
                    disabled={isSyncingDriveLinks || !accessToken}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer shrink-0"
                  >
                    {isSyncingDriveLinks ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sincronizando Drive...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        <span>Sincronizar y Vincular Fotos de Drive</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Action 2: Facturas Mal Procesadas o Incompletas */}
              <div className="p-4 sm:p-5 rounded-2xl bg-amber-50/70 border border-amber-200/90 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-amber-950 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span>2. Facturas Detectadas con Datos Incompletos o $0</span>
                    </h4>
                    <p className="text-xs text-amber-900/90 mt-1">
                      Comprobantes con importe 0, sin proveedor o concepto vacío para corregirlos puntualmente o re-analizarlos con IA.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                      {poorlyProcessedRows.length === 0 ? 'Sin errores' : `${poorlyProcessedRows.length} a revisar`}
                    </span>
                    {poorlyProcessedRows.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRereadAllWithAi}
                        disabled={isRereadingWithAi || !accessToken}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
                        title="Releer solo las facturas erróneas automáticamente con IA de Gemini"
                      >
                        {isRereadingWithAi ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Releyendo con IA...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Releer Erróneas con IA</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Barra de progreso para corrección de erróneas */}
                {isRereadingWithAi && rereadProgress && rereadProgress.isRereading && (
                  <div className="pt-2 border-t border-amber-200/80 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-xs mb-1.5 font-semibold text-amber-950">
                      <span className="truncate max-w-xs sm:max-w-md">📄 {rereadProgress.currentFileName}</span>
                      <span className="font-mono font-bold text-amber-900">{rereadProgress.percentage}% ({rereadProgress.current}/{rereadProgress.total})</span>
                    </div>
                    <div className="w-full bg-amber-200/80 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-amber-500 via-purple-600 to-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(4, rereadProgress.percentage)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-amber-900 mt-1.5">
                      <span>✓ {rereadProgress.successCount} corregidas {rereadProgress.errorCount > 0 ? `· ⚠ ${rereadProgress.errorCount} omitidas` : ''}</span>
                      <button
                        type="button"
                        onClick={handleCancelReread}
                        className="text-rose-600 hover:text-rose-800 font-bold underline cursor-pointer text-xs"
                      >
                        Detener relectura
                      </button>
                    </div>
                  </div>
                )}

                {poorlyProcessedRows.length === 0 ? (
                  <div className="p-3 bg-white/80 rounded-xl border border-amber-200 flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Todas las facturas tienen importes, proveedor y concepto registrados.</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {poorlyProcessedRows.map((r, i) => {
                      const inv = r.invoiceRecord;
                      return (
                        <div
                          key={`poor-${r.id || 'p'}-${r.rowIndex || i}-${i}`}
                          className="p-2.5 bg-white rounded-xl border border-amber-200 flex items-center justify-between gap-2 shadow-2xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 truncate">
                                {inv?.vendorName || 'Sin proveedor'}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                                {inv?.invoiceNumber || 'S/N'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>Fila {r.rowIndex}</span>
                              <span>•</span>
                              <span className="font-mono font-bold text-slate-700">
                                $ {(inv?.totalAmount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                              </span>
                              {(!inv?.totalAmount || inv.totalAmount === 0) && (
                                <span className="text-[10px] text-rose-600 font-bold bg-rose-50 px-1 rounded">Importe $0</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {inv && onEditInvoice && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsUpdateInfoOpen(false);
                                  setAutoStartAiModal(true);
                                  setInvoiceToEdit(inv);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors cursor-pointer"
                                title="Releer factura con IA para extraer datos correctos"
                              >
                                <Sparkles className="w-3 h-3" />
                                <span>Releer IA</span>
                              </button>
                            )}
                            {inv && onEditInvoice && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsUpdateInfoOpen(false);
                                  handleStartQuickRename(inv);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors cursor-pointer"
                                title="Editar nombre del documento"
                              >
                                <FileEdit className="w-3 h-3 text-sky-700" />
                                <span>Renombrar</span>
                              </button>
                            )}
                            {inv && onEditInvoice && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsUpdateInfoOpen(false);
                                  setAutoStartAiModal(false);
                                  setInvoiceToEdit(inv);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Editar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/80">
              <span className="text-xs text-slate-500">
                Pestaña activa: <strong>{effectiveActiveTab}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onRefresh();
                    setIsUpdateInfoOpen(false);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
                >
                  Recargar y Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
