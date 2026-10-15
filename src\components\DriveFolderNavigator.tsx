import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchFolderDirectContents,
  DriveHierarchicalItem,
  DriveItemType,
  getFolderMetadata,
  createCustomSpreadsheet,
} from '../services/googleDriveSheets';
import { DriveFileAnalyzerModal } from './DriveFileAnalyzerModal';
import { safeJsonFetch } from '../utils/safeApiFetch';
import { buildProjectSpreadsheetTitle } from '../utils/duplicateChecker';
import {
  Folder,
  FolderOpen,
  FolderCheck,
  HardDrive,
  Users,
  Building2,
  ChevronRight,
  ArrowUp,
  RotateCw,
  Search,
  Receipt,
  FileSpreadsheet,
  Image as ImageIcon,
  FileText,
  File,
  Check,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Loader2,
  X,
  Sparkles,
  Link2,
  ArrowRight,
  Sliders,
  RefreshCw,
} from 'lucide-react';
import { googleSignIn } from '../services/firebaseAuth';

export interface SelectedFolderInfo {
  id: string;
  name: string;
  webViewLink?: string;
  path: string;
}

export interface DriveFolderNavigatorProps {
  accessToken: string;
  initialFolderId?: string;
  initialFolderName?: string;
  selectedFolderId?: string;
  onSelectFolder: (folder: SelectedFolderInfo) => void;
  onSelectSpreadsheet?: (item: DriveHierarchicalItem) => void;
  onEditFacturacion?: (item: DriveHierarchicalItem) => void;
  onSpreadsheetCreated?: (spreadsheet: { id: string; name: string; url: string; folderId?: string; folderName?: string }) => void;
  onAnalyzeFile?: (item: DriveHierarchicalItem) => void;
  onClose?: () => void;
  isModal?: boolean;
  title?: string;
  subtitle?: string;
  selectButtonLabel?: string;
  allowSelectCurrentFolder?: boolean;
  compact?: boolean;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

type RootScope = 'root' | 'shared-with-me' | 'shared-drives';

export const DriveFolderNavigator: React.FC<DriveFolderNavigatorProps> = ({
  accessToken,
  initialFolderId = 'root',
  initialFolderName,
  selectedFolderId,
  onSelectFolder,
  onSelectSpreadsheet,
  onEditFacturacion,
  onSpreadsheetCreated,
  onAnalyzeFile,
  onClose,
  isModal = false,
  title = 'Explorador de Google Drive',
  subtitle = 'Navega por la jerarquía real de carpetas y subcarpetas para seleccionar el destino',
  selectButtonLabel = 'Seleccionar esta carpeta como destino',
  allowSelectCurrentFolder = true,
  compact = false,
}) => {
  // Navigation State
  const [rootScope, setRootScope] = useState<RootScope>(
    initialFolderId === 'shared-with-me'
      ? 'shared-with-me'
      : initialFolderId === 'shared-drives'
      ? 'shared-drives'
      : 'root'
  );
  const [currentFolderId, setCurrentFolderId] = useState<string>(initialFolderId || 'root');
  const [currentFolderName, setCurrentFolderName] = useState<string>(
    initialFolderName || (initialFolderId === 'root' || !initialFolderId ? 'Mi Unidad' : 'Carpeta de Drive')
  );
  const [currentFolderUrl, setCurrentFolderUrl] = useState<string | undefined>(undefined);

  // Modal for analyzing files directly in Drive
  const [fileToAnalyze, setFileToAnalyze] = useState<DriveHierarchicalItem | null>(null);

  // Breadcrumbs path
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    {
      id: initialFolderId || 'root',
      name:
        initialFolderId === 'shared-with-me'
          ? 'Compartido conmigo'
          : initialFolderId === 'shared-drives'
          ? 'Unidades compartidas'
          : 'Mi Unidad',
    },
  ]);

  // Content items
  const [items, setItems] = useState<DriveHierarchicalItem[]>([]);
  const [foldersCount, setFoldersCount] = useState(0);
  const [filesCount, setFilesCount] = useState(0);

  // Highlighted / Selected folder (defaults to current folder or initial selection)
  const [activeFolderId, setActiveFolderId] = useState<string>(selectedFolderId || initialFolderId || 'root');
  const [activeFolderName, setActiveFolderName] = useState<string>(initialFolderName || 'Mi Unidad');
  const [activeFolderUrl, setActiveFolderUrl] = useState<string | undefined>(undefined);

  // UI state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Active Google OAuth Token handling and seamless renewal
  const [currentAccessToken, setCurrentAccessToken] = useState<string>(() => {
    return accessToken || (typeof window !== 'undefined' ? sessionStorage.getItem('svh_google_oauth_token') || '' : '');
  });
  const [isRenewingSession, setIsRenewingSession] = useState(false);

  useEffect(() => {
    if (accessToken) {
      setCurrentAccessToken(accessToken);
    }
  }, [accessToken]);

  useEffect(() => {
    const handleTokenRefreshed = (e: Event) => {
      const customEvent = e as CustomEvent<{ token: string }>;
      if (customEvent.detail?.token) {
        setCurrentAccessToken(customEvent.detail.token);
        setBatchError(null);
        setError(null);
      }
    };
    window.addEventListener('svh_google_token_refreshed', handleTokenRefreshed);
    return () => {
      window.removeEventListener('svh_google_token_refreshed', handleTokenRefreshed);
    };
  }, []);

  const handleRenewSession = async () => {
    setIsRenewingSession(true);
    setBatchError(null);
    setError(null);
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setCurrentAccessToken(res.accessToken);
        setBatchError(null);
        setError(null);
        window.dispatchEvent(
          new CustomEvent('svh_google_token_refreshed', {
            detail: { token: res.accessToken, user: res.user },
          })
        );
        await loadFolderContents(currentFolderId, false, res.accessToken);
      }
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setBatchError('No se pudo renovar la sesión de Google: ' + (err?.message || 'Error desconocido'));
      }
    } finally {
      setIsRenewingSession(false);
    }
  };

  // Batch folder processing state
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchResult, setBatchResult] = useState<any>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [isExportingCorporate, setIsExportingCorporate] = useState<boolean>(false);
  const [corporateExportSuccess, setCorporateExportSuccess] = useState<{
    spreadsheetId?: string;
    spreadsheetName?: string;
    spreadsheetUrl: string;
    folderId?: string;
    folderName?: string;
    message: string;
  } | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentFileName: string;
    percentage: number;
  } | null>(null);

  // Creating a new Spreadsheet directly in the current folder location
  const [showCreateSheetInline, setShowCreateSheetInline] = useState<boolean>(false);
  const [newSheetTitleInput, setNewSheetTitleInput] = useState<string>('');
  const [isCreatingSheetLoading, setIsCreatingSheetLoading] = useState<boolean>(false);
  const [createSheetSuccess, setCreateSheetSuccess] = useState<{
    id: string;
    name: string;
    url: string;
  } | null>(null);
  const [createSheetError, setCreateSheetError] = useState<string | null>(null);

  const handleProcessFolderBatch = async () => {
    if (
      !currentFolderId ||
      currentFolderId === 'root' ||
      currentFolderId === 'shared-with-me' ||
      currentFolderId === 'shared-drives'
    ) {
      setBatchError('Por favor entra en una carpeta específica de la obra antes de iniciar el procesamiento en lote.');
      setShowBatchModal(true);
      return;
    }

    if (!currentAccessToken) {
      setBatchError('No hay sesión de Google activa. Por favor pulsa en "Renovar Conexión Google".');
      setShowBatchModal(true);
      return;
    }

    setIsBatchProcessing(true);
    setBatchResult(null);
    setBatchError(null);
    setShowBatchModal(true);

    // 1. Identificar comprobantes candidatos actualmente listados en la carpeta
    // Las hojas de Google (registro de la obra, exportaciones) no son comprobantes
    const invoiceFiles = items.filter(
      (f) =>
        f.itemType !== 'folder' &&
        f.mimeType !== 'application/vnd.google-apps.spreadsheet' &&
        f.mimeType !== 'application/vnd.google-apps.folder' &&
        (f.itemType === 'invoice' ||
          f.itemType === 'sheet' ||
          f.mimeType === 'application/pdf' ||
          (f.mimeType && f.mimeType.startsWith('image/')) ||
          f.name.match(/\.(pdf|png|jpe?g|webp|xlsx?|csv)$/i))
    );

    // Procesar los comprobantes listados con /api/process-drive-file, varios a la vez.
    // El servidor ya reintenta ante saturación de Gemini; aquí solo se reintenta una vez más si sigue saturado.
    if (invoiceFiles.length > 0) {
      const total = invoiceFiles.length;
      const results: any[] = new Array(total);
      let completed = 0;
      let resolvedSpreadsheetUrl: string | undefined;
      let authExpired = false;
      let dailyQuotaMessage: string | null = null;
      const CONCURRENCY = 2;

      setBatchProgress({ current: 0, total, currentFileName: invoiceFiles[0].name, percentage: 0 });

      const processOne = async (file: any) => {
        let singleRes: any = null;
        for (let attempt = 0; attempt < 4 && !authExpired; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 15000 * attempt));
          singleRes = await safeJsonFetch('/api/process-drive-file', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentAccessToken}`,
            },
            body: JSON.stringify({
              fileId: file.id,
              fileName: file.name,
              mimeType: file.mimeType,
              folderId: currentFolderId,
            }),
          });
          if (singleRes.ok && singleRes.data?.success) break;
          if (singleRes.status === 401 || singleRes.data?.isAuthError) {
            authExpired = true;
            break;
          }
          // Cupo diario de Gemini agotado: no reintentar y detener el resto del lote
          if (singleRes.data?.isDailyQuota) {
            dailyQuotaMessage = singleRes.data.error || 'Se agotó el cupo diario gratuito de Gemini.';
            break;
          }
          const transient =
            singleRes.status === 429 ||
            singleRes.status === 502 ||
            singleRes.status === 503 ||
            singleRes.status === 504 ||
            singleRes.status === 0 ||
            singleRes.data?.isQuota;
          if (!transient) break;
        }

        if (singleRes?.ok && singleRes.data?.success) {
          if (singleRes.data.spreadsheetUrl) resolvedSpreadsheetUrl = singleRes.data.spreadsheetUrl;
          const driveFileUrl =
            file.webViewLink || singleRes.data?.driveUrl || `https://drive.google.com/file/d/${file.id}/view`;
          if (singleRes.data.isDuplicate) {
            return {
              fileId: file.id,
              fileName: file.name,
              status: 'skipped_duplicate',
              message: singleRes.data.message,
              driveUrl: driveFileUrl,
            };
          }
          return {
            fileId: file.id,
            fileName: file.name,
            status: 'success',
            reviewStatus: singleRes.data.reviewStatus,
            reasons: singleRes.data.reasons,
            extracted: {
              ...(singleRes.data.extracted || {}),
              driveUrl: driveFileUrl,
              webViewLink: driveFileUrl,
              fileName: file.name,
            },
            driveUrl: driveFileUrl,
          };
        }
        return {
          fileId: file.id,
          fileName: file.name,
          status: 'error',
          error: singleRes?.data?.error || singleRes?.error || 'Error al procesar archivo',
        };
      };

      try {
        let nextIndex = 0;
        const runWorker = async () => {
          while (nextIndex < total && !authExpired && !dailyQuotaMessage) {
            const i = nextIndex++;
            results[i] = await processOne(invoiceFiles[i]);
            completed++;
            setBatchProgress({
              current: completed,
              total,
              currentFileName: invoiceFiles[Math.min(nextIndex, total - 1)].name,
              percentage: Math.round((completed / total) * 100),
            });
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, runWorker));

        if (authExpired) {
          window.dispatchEvent(new CustomEvent('svh_google_auth_expired'));
          setBatchError(
            'Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para continuar.'
          );
          return;
        }

        const finalResults = results.filter(Boolean);
        const successCount = finalResults.filter((r) => r.status === 'success').length;
        const failureCount = finalResults.filter((r) => r.status === 'error').length;
        const duplicateCount = finalResults.filter((r) => r.status === 'skipped_duplicate').length;
        const pendingCount = total - successCount - duplicateCount;
        const finalBatchResult = {
          success: true,
          message:
            `Procesamiento completado: ${successCount} facturas registradas en Sheets.` +
            (duplicateCount ? ` ${duplicateCount} omitidas por estar ya registradas.` : '') +
            (dailyQuotaMessage
              ? ` ${dailyQuotaMessage} Quedan ${pendingCount} comprobante(s) por leer: vuelve a procesar la carpeta cuando se renueve el cupo.`
              : ''),
          successCount,
          failureCount,
          spreadsheetUrl: resolvedSpreadsheetUrl,
          folderId: currentFolderId,
          folderName: currentFolderName,
          results: finalResults,
        };
        setBatchResult(finalBatchResult);

        // Crear la hoja corporativa solo con las facturas nuevas leídas con éxito
        if (successCount > 0) {
          setTimeout(() => {
            handleExportBatchToCorporateSheets(finalResults.filter((r) => r.status === 'success'));
          }, 400);
        }
      } catch (err: any) {
        console.error('Error durante procesamiento de comprobantes:', err);
        setBatchError(err.message || 'Error inesperado al procesar los archivos');
      } finally {
        setIsBatchProcessing(false);
        setBatchProgress(null);
      }
      return;
    }

    // 2. Si no había archivos cacheados en el estado de items, recurrir a /api/process-folder
    try {
      const fetchRes = await safeJsonFetch('/api/process-folder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentAccessToken}`,
        },
        body: JSON.stringify({
          folderId: currentFolderId,
        }),
      });

      if (!fetchRes.ok || !fetchRes.data?.success) {
        const errText = fetchRes.error || fetchRes.data?.error || '';
        const isAuth =
          fetchRes.status === 401 ||
          fetchRes.data?.isAuthError ||
          errText.toLowerCase().includes('invalid authentication credentials') ||
          errText.toLowerCase().includes('expected oauth 2') ||
          errText.toLowerCase().includes('unauthenticated') ||
          errText.toLowerCase().includes('expirado');

        if (isAuth) {
          window.dispatchEvent(new CustomEvent('svh_google_auth_expired'));
          setBatchError('Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para continuar.');
          return;
        }
        throw new Error(errText || 'Error al procesar la carpeta');
      }

      setBatchResult(fetchRes.data);
      if (fetchRes.data?.results && fetchRes.data.results.length > 0) {
        setTimeout(() => {
          handleExportBatchToCorporateSheets(fetchRes.data.results);
        }, 400);
      }
    } catch (err: any) {
      console.error('Error al procesar lote:', err);
      setBatchError(err.message || 'Fallo durante el procesamiento en lote');
    } finally {
      setIsBatchProcessing(false);
      setBatchProgress(null);
    }
  };

  // Exportación infalible a Google Sheets con logo =IMAGE(), A1:E3 merge y paleta SVH Arquitectos (#337337)
  const handleExportBatchToCorporateSheets = async (customResults?: any) => {
    // Si customResults es un evento de React (o no es un arreglo válido), utilizar batchResult?.results
    const targetResults: any[] = Array.isArray(customResults)
      ? customResults
      : Array.isArray(batchResult?.results)
      ? batchResult.results
      : [];

    if (!targetResults || targetResults.length === 0) {
      console.warn('No hay resultados de facturas disponibles para exportar.');
      return null;
    }
    if (!currentAccessToken) {
      setBatchError('No hay sesión de Google activa para realizar la exportación. Por favor pulsa en "Renovar Conexión Google".');
      return null;
    }

    setBatchError(null);
    setIsExportingCorporate(true);
    setCorporateExportSuccess(null);
    try {
      // Filtrar facturas exitosas extraídas
      const successfulInvoices = targetResults
        .filter((r: any) => r && (r.status === 'success' || r.extracted))
        .map((r: any) => {
          const ext = r.extracted || r;
          return {
            cliente: ext.cliente || ext.vendorName || 'Sin especificar',
            fecha: ext.fecha || ext.date || new Date().toISOString().split('T')[0],
            concepto: ext.concepto || ext.concept || r.fileName || 'Factura de obra',
            total: Number(ext.total ?? ext.totalAmount ?? 0),
            subtotal: Number(ext.subtotal ?? 0),
            iva: Number(ext.iva ?? ext.taxAmount ?? 0),
            numeroFactura: ext.numeroFactura || ext.invoiceNumber || 'S/N',
            nitRut: ext.nitRut || ext.vendorTaxId || '',
            categoria: ext.categoria || ext.category || 'Materiales',
            moneda: ext.moneda || ext.currency || 'COP',
            fileName: r.fileName || ext.fileName,
            driveUrl: ext.driveUrl || r.driveUrl,
          };
        });

      const res = await safeJsonFetch<{
        success: boolean;
        spreadsheetId?: string;
        spreadsheetUrl?: string;
        spreadsheetName?: string;
        error?: string;
        isAuthError?: boolean;
      }>('/api/export-invoices-styled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentAccessToken}`,
        },
        body: JSON.stringify({
          invoices: successfulInvoices,
          folderId: currentFolderId,
          projectName: currentFolderName || 'Facturas',
          sheetTitle: 'Control Facturas',
        }),
      });

      if (!res.ok || !res.data?.success) {
        const errText = res.error || res.data?.error || '';
        const isAuth =
          res.status === 401 ||
          res.data?.isAuthError ||
          errText.toLowerCase().includes('invalid authentication credentials') ||
          errText.toLowerCase().includes('expected oauth 2') ||
          errText.toLowerCase().includes('unauthenticated') ||
          errText.toLowerCase().includes('expirado');

        if (isAuth) {
          window.dispatchEvent(new CustomEvent('svh_google_auth_expired'));
          throw new Error('Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para completar la exportación.');
        }
        throw new Error(errText || 'Error al exportar a Google Sheets.');
      }

      const newSheetId = res.data.spreadsheetId;
      const newSheetUrl = res.data.spreadsheetUrl;
      const newSheetName = res.data.spreadsheetName || `Control Facturas SVH - ${currentFolderName || 'Facturas'}`;

      const exportSuccessObj = {
        spreadsheetId: newSheetId,
        spreadsheetName: newSheetName,
        spreadsheetUrl: newSheetUrl || '',
        folderId: currentFolderId,
        folderName: currentFolderName || 'Facturas',
        message: `¡Se exportaron ${successfulInvoices.length} facturas con enlaces a la carpeta "${currentFolderName || 'Facturas'}" y se ejecutó la hoja en la página!`,
      };

      setCorporateExportSuccess(exportSuccessObj);

      setBatchResult((prev: any) => ({
        ...(prev || {}),
        spreadsheetId: newSheetId,
        spreadsheetUrl: newSheetUrl,
        spreadsheetName: newSheetName,
        folderId: currentFolderId,
        folderName: currentFolderName,
      }));

      return exportSuccessObj;
    } catch (err: any) {
      console.error('Error exportando lote con estilo corporativo:', err);
      setBatchError(err.message || 'No se pudo exportar a Google Sheets con formato corporativo.');
      return null;
    } finally {
      setIsExportingCorporate(false);
    }
  };

  // Acción del botón: Ver Hoja Ejecutada en la Página
  const handleGoToExecutedSheet = async () => {
    let sheetId = corporateExportSuccess?.spreadsheetId || batchResult?.spreadsheetId;
    let sheetUrl = corporateExportSuccess?.spreadsheetUrl || batchResult?.spreadsheetUrl;
    let sheetName = corporateExportSuccess?.spreadsheetName || batchResult?.spreadsheetName || `Control Facturas SVH - ${currentFolderName || 'Facturas'}`;

    // Si aún no se tiene sheetId pero hay resultados en el lote, ejecutar la exportación a Google Sheets de inmediato
    if (!sheetId && batchResult?.results && batchResult.results.length > 0) {
      try {
        const exported = await handleExportBatchToCorporateSheets(batchResult.results);
        if (exported?.spreadsheetId) {
          sheetId = exported.spreadsheetId;
          sheetUrl = exported.spreadsheetUrl;
          sheetName = exported.spreadsheetName;
        }
      } catch (err) {
        console.error('Error generando hoja en handleGoToExecutedSheet:', err);
      }
    }

    if (sheetId && sheetUrl) {
      if (onSelectSpreadsheet) {
        onSelectSpreadsheet({
          id: sheetId,
          name: sheetName,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          itemType: 'spreadsheet',
          webViewLink: sheetUrl,
          parentId: currentFolderId,
        });
      }
      if (onSpreadsheetCreated) {
        onSpreadsheetCreated({
          id: sheetId,
          name: sheetName,
          url: sheetUrl,
          folderId: currentFolderId,
          folderName: currentFolderName,
        });
      }

      // Disparar evento global para garantizar ejecución en la página sin importar anidamiento
      window.dispatchEvent(
        new CustomEvent('svh:execute-sheet', {
          detail: {
            id: sheetId,
            name: sheetName,
            url: sheetUrl,
            folderId: currentFolderId,
            folderName: currentFolderName,
          },
        })
      );
    }

    setShowBatchModal(false);
    onClose?.();
  };

  // Confirmar y registrar factura individual analizada directamente en Sheets
  const handleUseSingleInvoice = async (analysis: any, driveUrl?: string) => {
    if (!fileToAnalyze || !accessToken) return;
    try {
      const extractedInv = analysis.extractedInvoice || analysis;
      const invoiceData = {
        cliente: extractedInv.vendorName || extractedInv.cliente || 'Sin especificar',
        fecha: extractedInv.date || extractedInv.fecha || new Date().toISOString().split('T')[0],
        concepto: extractedInv.concept || extractedInv.concepto || analysis.summary || fileToAnalyze.name,
        total: Number(extractedInv.totalAmount ?? extractedInv.total ?? 0),
        subtotal: Number(extractedInv.subtotal ?? 0),
        iva: Number(extractedInv.taxAmount ?? extractedInv.iva ?? 0),
        numeroFactura: extractedInv.invoiceNumber || extractedInv.numeroFactura || 'S/N',
        nitRut: extractedInv.vendorTaxId || extractedInv.nitRut || '',
        categoria: 'Materiales',
        fileName: fileToAnalyze.name,
        driveUrl: driveUrl || fileToAnalyze.webViewLink,
      };

      const res = await safeJsonFetch('/api/export-invoices-styled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          invoices: [invoiceData],
          folderId: currentFolderId,
          projectName: currentFolderName || 'Facturas',
          sheetTitle: 'Control Facturas',
        }),
      });

      if (!res.ok || !res.data?.success) {
        throw new Error(res.error || res.data?.error || 'Error registrando factura en Sheets');
      }

      const newSheetId = res.data.spreadsheetId;
      const newSheetUrl = res.data.spreadsheetUrl;
      setFileToAnalyze(null);

      if (onSelectSpreadsheet && newSheetId) {
        onSelectSpreadsheet({
          id: newSheetId,
          name: `Control Facturas SVH - ${currentFolderName || 'Facturas'}`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          itemType: 'spreadsheet',
          webViewLink: newSheetUrl,
          parentId: currentFolderId,
        });
      }

      if (onSpreadsheetCreated && newSheetId) {
        onSpreadsheetCreated({
          id: newSheetId,
          name: `Control Facturas SVH - ${currentFolderName || 'Facturas'}`,
          url: newSheetUrl,
        });
      }
    } catch (err: any) {
      console.error('Error al registrar factura individual:', err);
    }
  };

  // Crear una nueva Hoja de Cálculo directamente en la carpeta donde se ubica el usuario
  const handleCreateSheetInCurrentFolder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sheetName = newSheetTitleInput.trim();
    if (!accessToken || !sheetName) return;

    setIsCreatingSheetLoading(true);
    setCreateSheetError(null);
    try {
      const cleanParentId =
        !currentFolderId || currentFolderId === 'shared-with-me' || currentFolderId === 'shared-drives'
          ? undefined
          : currentFolderId;

      const created = await createCustomSpreadsheet(
        accessToken,
        sheetName,
        cleanParentId
      );

      setCreateSheetSuccess({
        id: created.id,
        name: created.name,
        url: created.webViewLink,
      });

      setShowCreateSheetInline(false);

      // Recargar contenidos de la carpeta para que la nueva hoja aparezca de inmediato
      await loadFolderContents(currentFolderId, true);

      // Notificar al componente padre que se creó y seleccionó la nueva hoja
      if (onSpreadsheetCreated) {
        onSpreadsheetCreated({
          id: created.id,
          name: created.name,
          url: created.webViewLink,
        });
      }

      if (onSelectSpreadsheet) {
        onSelectSpreadsheet({
          id: created.id,
          name: created.name,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          itemType: 'spreadsheet',
          webViewLink: created.webViewLink,
          parentId: currentFolderId,
        });
      }
    } catch (err: any) {
      console.error('Error al crear hoja de cálculo en la carpeta actual:', err);
      setCreateSheetError(err.message || 'Error al crear la hoja de cálculo en Google Drive.');
    } finally {
      setIsCreatingSheetLoading(false);
    }
  };

  // Synchronize initial folder path if custom ID is passed
  useEffect(() => {
    let isMounted = true;
    const initPath = async () => {
      if (!initialFolderId || initialFolderId === 'root') {
        if (isMounted) {
          setBreadcrumbs([{ id: 'root', name: 'Mi Unidad' }]);
          setCurrentFolderId('root');
          setCurrentFolderName('Mi Unidad');
          if (onSelectFolder && !selectedFolderId) {
            onSelectFolder({ id: 'root', name: 'Mi Unidad', path: 'Mi Unidad' });
          }
        }
        return;
      }

      // Fetch metadata of initial folder to display correct name
      try {
        const meta = await getFolderMetadata(accessToken, initialFolderId);
        if (isMounted) {
          setCurrentFolderId(meta.id);
          setCurrentFolderName(meta.name);
          setCurrentFolderUrl(meta.webViewLink);
          setActiveFolderId(meta.id);
          setActiveFolderName(meta.name);
          setActiveFolderUrl(meta.webViewLink);

          setBreadcrumbs([
            { id: 'root', name: 'Mi Unidad' },
            { id: meta.id, name: meta.name },
          ]);

          if (onSelectFolder && !selectedFolderId) {
            onSelectFolder({
              id: meta.id,
              name: meta.name,
              webViewLink: meta.webViewLink,
              path: `Mi Unidad > ${meta.name}`,
            });
          }
        }
      } catch (err) {
        console.warn('Error inicializando ruta de carpeta:', err);
      }
    };

    if (accessToken) {
      initPath();
    }
    return () => {
      isMounted = false;
    };
  }, [initialFolderId, accessToken]);

  // Load direct children of currentFolderId
  const loadFolderContents = useCallback(
    async (folderId: string, showRefreshSpinner = false, overrideToken?: string) => {
      const tokenToUse = overrideToken || currentAccessToken;
      if (!tokenToUse) return;
      if (showRefreshSpinner) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const result = await fetchFolderDirectContents(tokenToUse, folderId);
        setItems(result.items);
        setFoldersCount(result.foldersCount);
        setFilesCount(result.filesCount);
        setCurrentFolderName(result.currentFolder.name);
        setCurrentFolderUrl(result.currentFolder.webViewLink);

        // If the current folder is entered, it can be the active target
        if (folderId === activeFolderId) {
          setActiveFolderName(result.currentFolder.name);
          setActiveFolderUrl(result.currentFolder.webViewLink);
        }
      } catch (err: any) {
        console.error('Error cargando contenidos de carpeta en Google Drive:', err);
        const errMsg = String(err?.message || '');
        const isAuth =
          err?.status === 401 ||
          err?.isAuthError ||
          errMsg.includes('401') ||
          errMsg.includes('invalid authentication credentials') ||
          errMsg.includes('Expected OAuth 2') ||
          errMsg.includes('UNAUTHENTICATED');

        if (isAuth) {
          window.dispatchEvent(new CustomEvent('svh_google_auth_expired'));
          setError('Tu sesión con Google Drive ha expirado. Por favor, pulsa en "Renovar Conexión Google" para continuar navegando.');
        } else {
          setError(errMsg || 'No se pudo leer el contenido de la carpeta en Google Drive.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [currentAccessToken, activeFolderId]
  );

  // Trigger loading when currentFolderId changes
  useEffect(() => {
    loadFolderContents(currentFolderId);
  }, [currentFolderId, loadFolderContents]);

  // Action: Switch root scope (Mi Unidad, Compartido conmigo, Unidades compartidas)
  const handleSwitchRootScope = (scope: RootScope) => {
    if (scope === rootScope && currentFolderId === scope) return;
    setRootScope(scope);
    setSearchFilter('');
    const scopeName =
      scope === 'shared-with-me'
        ? 'Compartido conmigo'
        : scope === 'shared-drives'
        ? 'Unidades compartidas'
        : 'Mi Unidad';

    setCurrentFolderId(scope);
    setCurrentFolderName(scopeName);
    setCurrentFolderUrl(undefined);
    setActiveFolderId(scope);
    setActiveFolderName(scopeName);
    setActiveFolderUrl(undefined);
    setBreadcrumbs([{ id: scope, name: scopeName }]);
  };

  // Action: Enter a subfolder
  const handleEnterFolder = (folder: { id: string; name: string; webViewLink?: string }) => {
    setSearchFilter('');
    setCurrentFolderId(folder.id);
    setCurrentFolderName(folder.name);
    setCurrentFolderUrl(folder.webViewLink);
    setActiveFolderId(folder.id);
    setActiveFolderName(folder.name);
    setActiveFolderUrl(folder.webViewLink);

    // Push to breadcrumbs & immediately synchronize active location with parent
    const existingIdx = breadcrumbs.findIndex((b) => b.id === folder.id);
    const nextBreadcrumbs =
      existingIdx !== -1
        ? breadcrumbs.slice(0, existingIdx + 1)
        : [...breadcrumbs, { id: folder.id, name: folder.name }];

    setBreadcrumbs(nextBreadcrumbs);

    const fullPath = nextBreadcrumbs.map((b) => b.name).join(' > ');
    if (onSelectFolder) {
      onSelectFolder({
        id: folder.id,
        name: folder.name,
        webViewLink: folder.webViewLink,
        path: fullPath,
      });
    }
  };

  // Action: Click a breadcrumb item
  const handleBreadcrumbClick = (item: BreadcrumbItem, index: number) => {
    if (item.id === currentFolderId) return;
    setSearchFilter('');
    const nextBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(nextBreadcrumbs);
    setCurrentFolderId(item.id);
    setCurrentFolderName(item.name);
    setActiveFolderId(item.id);
    setActiveFolderName(item.name);

    const fullPath = nextBreadcrumbs.map((b) => b.name).join(' > ');
    if (onSelectFolder) {
      onSelectFolder({
        id: item.id,
        name: item.name,
        path: fullPath,
      });
    }
  };

  // Action: Go to parent folder (Up one level)
  const handleGoUp = () => {
    if (breadcrumbs.length <= 1) return;
    const parentIndex = breadcrumbs.length - 2;
    const parentItem = breadcrumbs[parentIndex];
    handleBreadcrumbClick(parentItem, parentIndex);
  };

  // Action: Refresh current folder contents directly from Google Drive
  const handleRefresh = () => {
    loadFolderContents(currentFolderId, true);
  };

  // Action: Choose specific item without navigating
  const handleSelectSpecificFolder = (folder: { id: string; name: string; webViewLink?: string }) => {
    setActiveFolderId(folder.id);
    setActiveFolderName(folder.name);
    setActiveFolderUrl(folder.webViewLink);

    const pathItems = breadcrumbs.map((b) => b.name);
    if (folder.id !== currentFolderId) {
      pathItems.push(folder.name);
    }
    const fullPath = pathItems.join(' > ');

    if (onSelectFolder) {
      onSelectFolder({
        id: folder.id,
        name: folder.name,
        webViewLink: folder.webViewLink,
        path: fullPath,
      });
    }
  };

  // Action: Confirm selection
  const handleConfirmSelection = () => {
    // Construct readable path from breadcrumbs
    const pathItems = breadcrumbs.map((b) => b.name);
    if (activeFolderId !== currentFolderId) {
      pathItems.push(activeFolderName);
    }
    const fullPath = pathItems.join(' > ');

    onSelectFolder({
      id: activeFolderId,
      name: activeFolderName,
      webViewLink: activeFolderUrl,
      path: fullPath,
    });

    if (onClose) {
      onClose();
    }
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!searchFilter.trim()) return items;
    const query = searchFilter.toLowerCase().trim();
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [items, searchFilter]);

  const filteredFolders = useMemo(
    () => filteredItems.filter((i) => i.itemType === 'folder'),
    [filteredItems]
  );
  const filteredFiles = useMemo(
    () => filteredItems.filter((i) => i.itemType !== 'folder'),
    [filteredItems]
  );

  // Helper to render file type badge & icon
  const renderItemVisuals = (item: DriveHierarchicalItem) => {
    switch (item.itemType) {
      case 'folder':
        return {
          icon: <Folder className="w-5 h-5 text-amber-500 shrink-0 group-hover:text-amber-600 transition-colors" />,
          badge: (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
              Carpeta
            </span>
          ),
        };
      case 'invoice':
        return {
          icon: <Receipt className="w-5 h-5 text-emerald-600 shrink-0" />,
          badge: (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              🧾 Factura / Comprobante
            </span>
          ),
        };
      case 'spreadsheet':
        return {
          icon: <FileSpreadsheet className="w-5 h-5 text-emerald-700 shrink-0" />,
          badge: (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-300">
              📊 Hoja de Cálculo
            </span>
          ),
        };
      case 'image':
        return {
          icon: <ImageIcon className="w-5 h-5 text-sky-600 shrink-0" />,
          badge: (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200">
              📷 Imagen
            </span>
          ),
        };
      case 'file':
      default:
        return {
          icon: <FileText className="w-5 h-5 text-slate-500 shrink-0" />,
          badge: (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
              📄 Archivo
            </span>
          ),
        };
    }
  };

  const contentUI = (
    <div className="flex flex-col h-full overflow-hidden text-slate-800">
      {/* Header bar */}
      <div className="p-4 sm:p-5 border-b border-slate-200/80 bg-white/70 backdrop-blur-md flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#1ca330] to-[#98d52c] text-white flex items-center justify-center shadow-xs">
              <FolderOpen className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
              <p className="text-[11px] text-slate-500">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              title="Sincronizar y actualizar contenido de Google Drive"
              className="p-2 text-slate-500 hover:text-[#1ca330] hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#1ca330]' : ''}`} />
            </button>
            {onClose && isModal && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Real Drive Root Scope Selector */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl w-full sm:w-fit overflow-x-auto">
          <button
            type="button"
            onClick={() => handleSwitchRootScope('root')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              rootScope === 'root'
                ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-sky-600" />
            <span>Mi Unidad</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchRootScope('shared-with-me')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              rootScope === 'shared-with-me'
                ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-emerald-600" />
            <span>Compartido conmigo</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchRootScope('shared-drives')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              rootScope === 'shared-drives'
                ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-amber-600" />
            <span>Unidades compartidas</span>
          </button>
        </div>
      </div>

      {/* Breadcrumbs Navigation Bar */}
      <div className="px-4 sm:px-5 py-2.5 bg-slate-50/90 border-b border-slate-200/70 flex items-center justify-between gap-2 overflow-x-auto shrink-0 scrollbar-none">
        <div className="flex items-center gap-1.5 text-xs text-slate-600 shrink-0">
          <button
            type="button"
            disabled={breadcrumbs.length <= 1 || isLoading}
            onClick={handleGoUp}
            title="Subir un nivel (Carpeta anterior)"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Subir nivel</span>
          </button>

          <span className="text-slate-300">|</span>

          {/* Breadcrumbs Path */}
          <div className="flex items-center gap-1 flex-wrap">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.id + idx}>
                  <button
                    type="button"
                    onClick={() => handleBreadcrumbClick(crumb, idx)}
                    disabled={isLast || isLoading}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
                      isLast
                        ? 'font-bold text-slate-900 bg-white shadow-2xs border border-slate-200 cursor-default'
                        : 'text-slate-600 hover:text-[#1ca330] hover:bg-slate-200/60 font-medium'
                    }`}
                  >
                    {crumb.id === 'root' ? (
                      <HardDrive className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <span className="truncate max-w-[130px] sm:max-w-[180px]">{crumb.name}</span>
                  </button>
                  {!isLast && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Current Folder Direct Link */}
        {currentFolderUrl && (
          <a
            href={currentFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir esta carpeta en Google Drive"
            className="inline-flex items-center gap-1 text-[11px] text-[#1ca330] hover:text-[#158023] font-medium hover:underline shrink-0"
          >
            <span className="hidden md:inline">Ver en Drive</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Filter and stats toolbar */}
      <div className="px-4 sm:px-5 py-2.5 bg-white/60 border-b border-slate-200/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder={`Filtrar en "${currentFolderName}"...`}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330] transition-colors"
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => setSearchFilter('')}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2.5 text-[11px] text-slate-500 shrink-0 flex-wrap">
          <span>
            {foldersCount} {foldersCount === 1 ? 'carpeta' : 'carpetas'}
          </span>
          <span className="text-slate-300">•</span>
          <span>
            {filesCount} {filesCount === 1 ? 'archivo' : 'archivos'}
          </span>

          {/* Botón para crear Google Sheets en la carpeta actual donde se ubica el usuario */}
          <button
            type="button"
            id="btn-create-sheet-here"
            onClick={() => {
              setNewSheetTitleInput(
                buildProjectSpreadsheetTitle(
                  currentFolderName &&
                  currentFolderName !== 'Mi Unidad' &&
                  currentFolderName !== 'Compartido conmigo' &&
                  currentFolderName !== 'Unidades compartidas'
                    ? currentFolderName
                    : 'Obra'
                )
              );
              setShowCreateSheetInline((prev) => !prev);
              setCreateSheetError(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1ca330] hover:bg-[#168826] text-white rounded-lg text-[11px] font-bold shadow-2xs transition-all active:scale-95 cursor-pointer shrink-0"
            title={`Crear una nueva Hoja de Cálculo directamente dentro de "${currentFolderName || 'esta carpeta'}"`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Crear Sheets aquí</span>
          </button>

          {filesCount > 0 && currentFolderId !== 'root' && (
            <button
              type="button"
              onClick={handleProcessFolderBatch}
              disabled={isBatchProcessing}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-[11px] font-bold shadow-2xs transition-all active:scale-95 disabled:opacity-50"
              title="Procesar todas las facturas de esta carpeta con Gemini e inyectarlas en Google Sheets"
            >
              {isBatchProcessing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Procesando lote...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  <span>Procesar a Sheets</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Panel inline para crear hoja de cálculo directamente en la carpeta actual donde se ubica el usuario */}
      {showCreateSheetInline && (
        <div className="px-4 sm:px-5 py-3.5 bg-emerald-50/90 border-b border-emerald-200 animate-in fade-in slide-in-from-top-1">
          <div className="max-w-2xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-950">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>
                  Crear Hoja de Cálculo en:{' '}
                  <span className="underline decoration-emerald-500 font-extrabold text-emerald-900">
                    "{currentFolderName}"
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateSheetInline(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-emerald-800">
              Se creará la hoja contable oficial con encabezados completos (Fecha, Proveedor, Concepto, Subtotal, IVA, Total y Enlace a foto) directamente en la carpeta actual donde estás ubicado.
            </p>
            <form onSubmit={handleCreateSheetInCurrentFolder} className="flex flex-col sm:flex-row gap-2 pt-1">
              <input
                type="text"
                value={newSheetTitleInput}
                onChange={(e) => setNewSheetTitleInput(e.target.value)}
                placeholder="Nombre de la hoja de cálculo..."
                className="flex-1 bg-white border border-emerald-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!newSheetTitleInput.trim() || isCreatingSheetLoading}
                  className="px-3 py-1.5 bg-[#1ca330] hover:bg-[#168826] text-white rounded-lg text-xs font-bold shadow-xs transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isCreatingSheetLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creando en Drive...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Crear en esta carpeta</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateSheetInline(false)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>
            {createSheetError && (
              <p className="text-xs text-rose-600 mt-1 font-medium">{createSheetError}</p>
            )}
          </div>
        </div>
      )}

      {/* Banner de éxito al crear la hoja */}
      {createSheetSuccess && (
        <div className="px-4 sm:px-5 py-3 bg-emerald-100/90 border-b border-emerald-300 flex items-center justify-between text-xs text-emerald-950 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              ¡Hoja de cálculo <strong>"{createSheetSuccess.name}"</strong> creada con éxito en esta carpeta!
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={createSheetSuccess.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-bold text-emerald-800 hover:text-emerald-950 underline"
            >
              <span>Abrir en Google Sheets</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={() => setCreateSheetSuccess(null)}
              className="text-emerald-700 hover:text-emerald-900 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main folder content view */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 bg-gradient-to-b from-white/80 to-slate-50/80">
        {/* Error message */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 flex-1">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">{error}</p>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="text-[11px] text-rose-800 underline font-medium hover:text-rose-950 cursor-pointer"
                >
                  Reintentar conexión con Google Drive
                </button>
              </div>
            </div>
            {(error.includes('expirado') ||
              error.includes('sesión') ||
              error.includes('credenciales') ||
              error.includes('autenticación') ||
              error.includes('OAuth 2') ||
              error.includes('401')) && (
              <button
                type="button"
                onClick={handleRenewSession}
                disabled={isRenewingSession}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1ca330] hover:bg-[#158025] text-white text-xs font-bold rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer disabled:opacity-50"
              >
                {isRenewingSession ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Renovando...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Renovar Conexión Google</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Loading spinner */}
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin text-[#1ca330]" />
            <p className="text-xs font-medium">Leyendo estructura de Google Drive...</p>
            <p className="text-[11px] text-slate-400">Consultando carpetas y archivos en tiempo real</p>
          </div>
        ) : filteredItems.length === 0 ? (
          /* Empty folder or no filter matches */
          <div className="py-16 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
              <FolderOpen className="w-6 h-6 stroke-[1.5]" />
            </div>
            <h4 className="text-xs font-bold text-slate-700">
              {searchFilter
                ? 'No se encontraron elementos con ese filtro'
                : 'Esta carpeta está vacía'}
            </h4>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
              {searchFilter
                ? 'Intenta con otro término o borra la búsqueda para ver todos los elementos.'
                : 'No contiene subcarpetas ni archivos directamente en este nivel de Google Drive.'}
            </p>
            {!searchFilter && (
              <div className="pt-2">
                <button
                  type="button"
                  id="btn-create-sheet-empty-folder"
                  onClick={() => {
                    setNewSheetTitleInput(
                      buildProjectSpreadsheetTitle(
                        currentFolderName &&
                        currentFolderName !== 'Mi Unidad' &&
                        currentFolderName !== 'Compartido conmigo' &&
                        currentFolderName !== 'Unidades compartidas'
                          ? currentFolderName
                          : 'Obra'
                      )
                    );
                    setShowCreateSheetInline(true);
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#1ca330] hover:bg-[#168826] text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Crear Hoja de Cálculo en esta carpeta</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {/* 1. SECCIÓN DE CARPETAS */}
            {filteredFolders.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-amber-500" />
                  <span>Subcarpetas ({filteredFolders.length})</span>
                  <span className="text-[10px] font-normal normal-case text-slate-400">
                    — Haz clic para entrar o seleccionala como destino
                  </span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredFolders.map((folder) => {
                    const isSelected = activeFolderId === folder.id;
                    return (
                      <div
                        key={folder.id}
                        className={`group relative p-3.5 rounded-xl border transition-all duration-150 flex items-center justify-between gap-3 cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50/90 border-[#1ca330] shadow-sm ring-2 ring-[#1ca330]/30'
                            : 'bg-white hover:bg-slate-50 border-slate-200/90 hover:border-slate-300 shadow-2xs'
                        }`}
                        onClick={() => handleEnterFolder(folder)}
                        title={`Haz clic para entrar a "${folder.name}"`}
                      >
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform mt-0.5">
                            <Folder className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start gap-1.5 flex-wrap">
                              <p className="text-xs font-bold text-slate-800 line-clamp-2 break-words leading-tight group-hover:text-[#1ca330] transition-colors">
                                {folder.name}
                              </p>
                              {folder.sharedWithMe && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                                  Compartida
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 truncate">
                              {folder.ownerName ? `De: ${folder.ownerName} • ` : ''}
                              {folder.modifiedTimeFormatted ? `Modificado: ${folder.modifiedTimeFormatted}` : 'Carpeta de Drive'}
                            </p>
                          </div>
                        </div>

                        {/* Folder action buttons */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleSelectSpecificFolder(folder)}
                            title={`Elegir "${folder.name}" como destino`}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 ${
                              isSelected
                                ? 'bg-[#1ca330] text-white shadow-2xs'
                                : 'bg-slate-100 hover:bg-[#1ca330]/15 text-slate-700 hover:text-[#1ca330]'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                                <span>Elegida</span>
                              </>
                            ) : (
                              <span>Elegir</span>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleEnterFolder(folder)}
                            title="Entrar a esta subcarpeta"
                            className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-200/70 rounded-lg transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. SECCIÓN DE ARCHIVOS EXISTENTES */}
            {filteredFiles.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200/60">
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <File className="w-3.5 h-3.5 text-slate-400" />
                  <span>Archivos en esta carpeta ({filteredFiles.length})</span>
                  <span className="text-[10px] font-normal normal-case text-slate-400">
                    — Solo lectura para referencia visual
                  </span>
                </h4>

                <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl bg-white overflow-hidden shadow-2xs">
                  {filteredFiles.map((file) => {
                    const { icon, badge } = renderItemVisuals(file);
                    return (
                      <div
                        key={file.id}
                        className="p-2.5 sm:px-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 truncate min-w-0 flex-1">
                          <div className="shrink-0">{icon}</div>
                          <div className="truncate min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-800 truncate block">
                                {file.name}
                              </span>
                              {file.sharedWithMe && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                                  Compartido
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                              {file.sizeFormatted && <span>{file.sizeFormatted}</span>}
                              {file.ownerName && <span>• De: {file.ownerName}</span>}
                              {file.modifiedTimeFormatted && (
                                <>
                                  <span>•</span>
                                  <span>{file.modifiedTimeFormatted}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {badge}

                          {/* Quick File Action: Analizar / Leer */}
                          <button
                            type="button"
                            onClick={() => {
                              if (onAnalyzeFile) {
                                onAnalyzeFile(file);
                              } else {
                                setFileToAnalyze(file);
                              }
                            }}
                            title={`Analizar contenido de ${file.name}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors shadow-2xs"
                          >
                            <Sparkles className="w-3 h-3 text-[#1ca330]" />
                            <span className="hidden sm:inline">Leer / Analizar</span>
                          </button>

                          {/* Quick File Action: Conectar si es Spreadsheet */}
                          {file.itemType === 'spreadsheet' && onSelectSpreadsheet && (
                            <button
                              type="button"
                              onClick={() => onSelectSpreadsheet(file)}
                              title={`Conectar ${file.name} como hoja de datos`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-[#1ca330] bg-[#1ca330]/10 hover:bg-[#1ca330]/20 transition-colors"
                            >
                              <Link2 className="w-3 h-3" />
                              <span className="hidden sm:inline">Vincular Hoja</span>
                            </button>
                          )}

                          {file.itemType === 'spreadsheet' && onEditFacturacion && (
                            <button
                              type="button"
                              onClick={() => onEditFacturacion(file)}
                              title={`Editar facturación (nombre y columnas) de ${file.name}`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition-colors shadow-2xs"
                            >
                              <Sliders className="w-3 h-3 text-emerald-700" />
                              <span className="hidden sm:inline">Edición de Facturación</span>
                            </button>
                          )}

                          {file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir archivo original en Google Drive"
                              className="p-1 text-slate-400 hover:text-[#1ca330] rounded transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer bar with selection indicator and confirmation */}
      <div className="p-4 sm:p-5 border-t border-slate-200/90 bg-white/90 backdrop-blur-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#1ca330] flex items-center justify-center shrink-0">
            <FolderCheck className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div className="truncate min-w-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Carpeta de destino seleccionada:
            </span>
            <span className="text-xs font-bold text-slate-900 truncate block">
              {activeFolderName}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 shrink-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancelar
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirmSelection}
            disabled={!activeFolderId || isLoading}
            className="w-full sm:w-auto px-5 py-2 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168a28] text-white shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>{selectButtonLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );

  const batchModalUI = showBatchModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Procesamiento en Lote e Inyección a Sheets
              </h3>
              <p className="text-[11px] text-slate-500">
                Carpeta: <span className="font-semibold text-slate-800">{currentFolderName}</span>
              </p>
            </div>
          </div>
          {!isBatchProcessing && (
            <button
              type="button"
              onClick={() => setShowBatchModal(false)}
              className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-700">
          {isBatchProcessing && (
            <div className="py-8 flex flex-col items-center justify-center gap-4 text-center">
              <div className="relative">
                <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
                {batchProgress && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-emerald-800">
                    {batchProgress.percentage}%
                  </span>
                )}
              </div>
              <div className="space-y-2 max-w-sm w-full">
                <p className="font-bold text-slate-900 text-sm">
                  {batchProgress
                    ? `Procesando comprobante ${batchProgress.current} de ${batchProgress.total}...`
                    : 'Procesando comprobantes en Google Drive...'}
                </p>
                {batchProgress && (
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-600 h-2 transition-all duration-300 rounded-full"
                      style={{ width: `${batchProgress.percentage}%` }}
                    />
                  </div>
                )}
                <p className="text-slate-500 text-[11px] truncate px-2">
                  {batchProgress
                    ? `Analizando: ${batchProgress.currentFileName}`
                    : 'Leyendo archivos secuencialmente, aplicando Structured Outputs con Gemini e inyectando cada fila en Sheets.'}
                </p>
              </div>
            </div>
          )}

          {batchError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Atención en el procesamiento</p>
                  <p className="mt-0.5 text-[11px]">{batchError}</p>
                </div>
              </div>
              {(batchError.includes('expirado') ||
                batchError.includes('sesión') ||
                batchError.includes('credenciales') ||
                batchError.includes('autenticación') ||
                batchError.includes('OAuth 2')) && (
                <button
                  type="button"
                  onClick={handleRenewSession}
                  disabled={isRenewingSession}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1ca330] hover:bg-[#158025] text-white text-xs font-bold rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isRenewingSession ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Renovando...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Renovar Conexión Google</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {batchResult && (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <span className="font-bold text-emerald-900 block text-xs">¡Lote completado con éxito!</span>
                  <span className="text-[11px] text-emerald-700">
                    {batchResult.successCount} facturas procesadas correctamente en la carpeta "{currentFolderName || 'actual'}".
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    id="btn-go-to-executed-sheet-batch"
                    onClick={() => handleGoToExecutedSheet()}
                    disabled={isExportingCorporate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#337337] hover:bg-[#255725] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isExportingCorporate ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Generando hoja en la carpeta...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Ver Hoja Ejecutada en la Página</span>
                      </>
                    )}
                  </button>
                  {batchResult.spreadsheetUrl && (
                    <a
                      href={batchResult.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors shrink-0"
                    >
                      <span>Abrir Google Sheet</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {corporateExportSuccess && (
                <div className="p-3 bg-[#94C23D]/20 border border-[#94C23D]/50 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#255725]">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#337337] shrink-0" />
                    <span className="font-semibold">{corporateExportSuccess.message}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      id="btn-go-to-executed-sheet"
                      onClick={() => handleGoToExecutedSheet()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#337337] hover:bg-[#255725] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Ver Hoja Ejecutada en la Página</span>
                    </button>
                    <a
                      href={corporateExportSuccess.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-[11px] font-semibold rounded-lg shadow-xs transition-colors shrink-0"
                    >
                      <span>Abrir en Drive ↗</span>
                    </a>
                  </div>
                </div>
              )}

              {batchResult.results && batchResult.results.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <div className="bg-slate-50 px-3.5 py-2.5 border-b border-slate-200 font-bold text-[11px] text-slate-700 flex items-center justify-between">
                    <span>Detalle de facturas procesadas ({batchResult.results.length})</span>
                    <span className="text-[10px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Enlaces de fotos vinculados automáticamente
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {batchResult.results.map((r: any, idx: number) => {
                      const effectiveDriveUrl = r.driveUrl || r.extracted?.driveUrl || r.extracted?.webViewLink;
                      return (
                        <div key={idx} className="p-3 flex items-start justify-between gap-3 text-[11px] hover:bg-slate-50/70 transition-colors">
                          <div className="truncate max-w-[320px] sm:max-w-md">
                            <span className="font-bold text-slate-900 block truncate text-xs">{r.fileName}</span>
                            {r.extracted && (
                              <div className="text-slate-500 text-[11px] mt-0.5">
                                {r.extracted.cliente || r.extracted.vendorName || 'Proveedor'} • {r.extracted.fecha || r.extracted.date || 'S/F'}
                              </div>
                            )}
                            {/* ENLACE DIRECTO DE LA FOTO EN DRIVE INSERTADO EN LA INFORMACIÓN */}
                            {effectiveDriveUrl && (
                              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                <a
                                  href={effectiveDriveUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[11px] font-semibold transition-colors shadow-2xs"
                                  title="Abrir foto de la factura en Google Drive"
                                >
                                  <ExternalLink className="w-3 h-3 text-emerald-600" />
                                  <span>Ver foto en Drive ↗</span>
                                </a>
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-white/90 px-1.5 py-0.5 rounded border border-emerald-100 font-medium">
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  Enlace insertado en información
                                </span>
                              </div>
                            )}
                            {r.error && (
                              <span className="text-rose-600 text-[10px] block truncate mt-1">{r.error}</span>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            {r.status === 'success' ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-emerald-100/80 text-emerald-900 border border-emerald-200 font-mono">
                                $ {(r.extracted?.total || r.extracted?.totalAmount || 0).toLocaleString()}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                Error
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3">
          {batchResult && batchResult.results && batchResult.results.length > 0 ? (
            <button
              type="button"
              id="btn-confirm-add-to-sheets"
              onClick={() => handleExportBatchToCorporateSheets()}
              disabled={isExportingCorporate || isBatchProcessing}
              className="w-full sm:w-auto relative group overflow-hidden inline-flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-xl font-bold text-xs text-white shadow-md shadow-[#337337]/25 hover:shadow-lg transition-all duration-200 bg-gradient-to-r from-[#337337] via-[#2d662d] to-[#94C23D] hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              {isExportingCorporate ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Añadiendo y Ejecutando Hoja en la Página...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 text-white stroke-[3]" />
                  <span>Confirmar y Añadir al Sheets</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            disabled={isBatchProcessing || isExportingCorporate}
            onClick={() => setShowBatchModal(false)}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (isModal) {
    return (
      <>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl sm:rounded-3xl border border-white/60 shadow-2xl w-full max-w-5xl xl:max-w-6xl h-[95vh] sm:h-[92vh] max-h-[880px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {contentUI}
          </div>
        </div>
        {fileToAnalyze && (
          <DriveFileAnalyzerModal
            fileItem={fileToAnalyze}
            accessToken={accessToken}
            onClose={() => setFileToAnalyze(null)}
            onConnectAsSpreadsheet={onSelectSpreadsheet}
            onUseAsInvoice={handleUseSingleInvoice}
          />
        )}
        {batchModalUI}
      </>
    );
  }

  return (
    <>
      <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col overflow-hidden ${compact ? 'h-[460px] sm:h-[520px]' : 'h-[520px] sm:h-[620px] lg:h-[700px]'}`}>
        {contentUI}
      </div>
      {fileToAnalyze && (
        <DriveFileAnalyzerModal
          fileItem={fileToAnalyze}
          accessToken={accessToken}
          onClose={() => setFileToAnalyze(null)}
          onConnectAsSpreadsheet={onSelectSpreadsheet}
          onUseAsInvoice={handleUseSingleInvoice}
        />
      )}
      {batchModalUI}
    </>
  );
};
