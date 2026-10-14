import React, { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, switchGoogleAccount, addGoogleAccount } from './services/firebaseAuth';
import {
  createDriveFolder,
  createCustomSpreadsheet,
  uploadInvoiceImageToDrive,
  appendInvoiceToSheet,
  fetchSheetInvoiceRecords,
  applySpreadsheetStyling,
  deleteInvoiceRecord,
  updateInvoiceInSheet,
  analyzeAndFetchDynamicSheet,
  deleteDynamicSheetRow,
} from './services/googleDriveSheets';
import {
  loadUserProjectsFromFirestore,
  saveProjectToFirestore,
  deleteProjectFromFirestore,
  updateProjectInFirestore,
} from './services/projectStorage';
import {
  InvoiceData,
  ProjectFolder,
  ProjectWorkspaceConfig,
  SheetInvoiceRecord,
  DynamicSheetAnalysis,
} from './types';
import { Navbar } from './components/Navbar';
import { ProjectSelector } from './components/ProjectSelector';
import { ProjectConfigModal } from './components/ProjectConfigModal';
import { NewProjectModal } from './components/NewProjectModal';
import { InvoiceUploader, QueuedInvoiceItem } from './components/InvoiceUploader';
import { InvoiceReviewModal } from './components/InvoiceReviewModal';
import { InvoiceHistoryTable } from './components/InvoiceHistoryTable';
import { InvoicePreview } from './components/InvoicePreview';
import { UploadSuccessBanner } from './components/UploadSuccessBanner';
import { PayrollDashboard } from './components/PayrollDashboard';
import { DriveInvoicesSyncModal } from './components/DriveInvoicesSyncModal';
import { ObraSelectorSheet } from './components/ObraSelectorSheet';
import { UploadInvoicesModal } from './components/UploadInvoicesModal';
import { GuideModal } from './components/GuideModal';
import { OverviewDashboard } from './components/OverviewDashboard';
import { FacturasSismoSection } from './components/FacturasSismoSection';
import { ManoDeObraSection } from './components/ManoDeObraSection';
import { NominasSection } from './components/NominasSection';
import { InventorySection } from './components/InventorySection';
import { AbonosSection } from './components/AbonosSection';
import { WorkersCatalogModal } from './components/WorkersCatalogModal';
import { exportConstructionWorkbook } from './services/excelExportService';
import { AuditoriaScreen } from './components/AuditoriaScreen';
import {
  fetchWorkersFromDb,
  saveWorkerToDb,
  deleteWorkerFromDb,
  deleteMultipleWorkersFromDb,
  fetchFacturasSismoFromDb,
  saveFacturaSismoToDb,
  deleteFacturaSismoFromDb,
  deleteMultipleFacturasSismoFromDb,
  fetchBitacorasFromDb,
  saveBitacoraToDb,
  deleteBitacoraFromDb,
  deleteMultipleBitacorasFromDb,
  fetchPayrollSettingsFromDb,
  savePayrollSettingsToDb,
  fetchNominasFromDb,
  saveNominaToDb,
  deleteNominaFromDb,
  deleteMultipleNominasFromDb,
  fetchInventarioFromDb,
  saveInventarioItemToDb,
  deleteInventarioItemFromDb,
  deleteMultipleInventarioFromDb,
  fetchAbonosFromDb,
  saveAbonoToDb,
  deleteAbonoFromDb,
  deleteMultipleAbonosFromDb,
  vaciarObraDb,
  scanRecordsWithoutOrigin,
  deleteUnassignedRecords,
  markRecordsAsManual,
  UnassignedRecordItem,
} from './services/constructionDbService';
import { UndoToast, UndoActionItem } from './components/UndoToast';
import { UnassignedOriginNotice } from './components/UnassignedOriginNotice';
import { deleteDriveFile } from './services/googleDriveSheets';
import {
  FacturaSismoItem,
  BitacoraRecord,
  WorkerCatalogItem,
  NominaRecord,
  NominaParametros,
  DEFAULT_NOMINA_PARAMETROS,
  InventarioRecord,
  AbonoRecordItem,
  countFacturasPorRevisar,
} from './utils/constructionCalculations';
import { fetchBadgeReviewCount } from './services/invoiceQueueService';
import { SvhLogo } from './components/SvhLogo';
import {
  AlertCircle,
  Loader2,
  CheckCircle2,
  Sparkles,
  Receipt,
  Users,
  HardHat,
  RefreshCw,
  Plus,
  LayoutDashboard,
  Package,
  PiggyBank,
  FolderOpen,
  Camera,
  ChevronDown,
  BookOpen,
  FileSpreadsheet,
  Download,
  X,
} from 'lucide-react';
import { optimizeImageForAnalysis } from './utils/imageOptimizer';
import { checkInvoiceDuplicate, buildProjectSpreadsheetTitle } from './utils/duplicateChecker';

export type AppModule =
  | 'resumen'
  | 'facturas'
  | 'mano_de_obra'
  | 'nominas'
  | 'inventario'
  | 'abonos'
  | 'invoices' // alias backwards compatibility
  | 'payroll'; // alias backwards compatibility

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isGoogleAuthExpired, setIsGoogleAuthExpired] = useState(false);

  // Active module navigation
  const [activeModule, setActiveModule] = useState<AppModule>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('svh_last_active_module');
      if (
        saved === 'resumen' ||
        saved === 'facturas' ||
        saved === 'mano_de_obra' ||
        saved === 'nominas' ||
        saved === 'inventario' ||
        saved === 'abonos' ||
        saved === 'invoices' ||
        saved === 'payroll'
      ) {
        return saved as AppModule;
      }
    }
    return 'resumen';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('svh_last_active_module', activeModule);
    }
  }, [activeModule]);

  // Project state
  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectFolder | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);

  // Estados de datos de construcción persistentes por OBRA (Firestore + Local)
  const [facturasSismo, setFacturasSismo] = useState<FacturaSismoItem[]>([]);
  const [bitacoras, setBitacoras] = useState<BitacoraRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerCatalogItem[]>([]);
  const [nominas, setNominas] = useState<NominaRecord[]>([]);
  const [payrollSettings, setPayrollSettings] = useState<NominaParametros>(DEFAULT_NOMINA_PARAMETROS);
  const [inventarioItems, setInventarioItems] = useState<InventarioRecord[]>([]);
  const [abonosItems, setAbonosItems] = useState<AbonoRecordItem[]>([]);
  const [isWorkersCatalogOpen, setIsWorkersCatalogOpen] = useState(false);
  const [isLoadingConstructionModules, setIsLoadingConstructionModules] = useState(false);

  // Modal states for Redesign
  const [isObraSelectorOpen, setIsObraSelectorOpen] = useState(false);
  const [isUploadInvoicesModalOpen, setIsUploadInvoicesModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);

  // Polling del conteo de facturas "por revisar" para el badge
  const refreshReviewCount = useCallback(async () => {
    try {
      const count = await fetchBadgeReviewCount(selectedProject?.id);
      setReviewCount(count);
    } catch {
      // Ignorar
    }
  }, [selectedProject?.id]);

  useEffect(() => {
    refreshReviewCount();
    const interval = setInterval(refreshReviewCount, 4000);
    return () => clearInterval(interval);
  }, [refreshReviewCount]);

  // Invoices & Dynamic sheet structure from the active project's connected file
  const [projectInvoices, setProjectInvoices] = useState<SheetInvoiceRecord[]>([]);
  const [dynamicAnalysis, setDynamicAnalysis] = useState<DynamicSheetAnalysis | null>(null);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);

  // Upload & AI Analysis state
  const [currentImageBase64, setCurrentImageBase64] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>('factura.jpg');
  const [currentMimeType, setCurrentMimeType] = useState<string>('image/jpeg');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedInvoice, setExtractedInvoice] = useState<InvoiceData | null>(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);

  // Success Notification
  const [successData, setSuccessData] = useState<{
    driveUrl?: string;
    sheetUrl?: string;
    fileName?: string;
    projectName?: string;
  } | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [lastSavedFileName, setLastSavedFileName] = useState<string | null>(null);
  const [isStylingSheet, setIsStylingSheet] = useState(false);
  const [styleSuccessMessage, setStyleSuccessMessage] = useState<string | null>(null);
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<string | null>(null);
  const [isDriveInvoiceSyncModalOpen, setIsDriveInvoiceSyncModalOpen] = useState<boolean>(false);
  const [undoAction, setUndoAction] = useState<UndoActionItem | null>(null);
  const [unassignedRecords, setUnassignedRecords] = useState<UnassignedRecordItem[]>([]);
  const [isAuditoriaOpen, setIsAuditoriaOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname === '/auditoria' || window.location.hash === '#/auditoria';
  });

  useEffect(() => {
    const handleLocationChange = () => {
      if (typeof window !== 'undefined') {
        setIsAuditoriaOpen(window.location.pathname === '/auditoria' || window.location.hash === '#/auditoria');
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  // Initialize Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, currentToken) => {
        setUser(currentUser);
        setToken(currentToken);
        setAuthChecked(true);
      },
      () => {
        setUser(null);
        setToken(null);
        setAuthChecked(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listeners para expiración y renovación transparente de credenciales de Google
  useEffect(() => {
    const handleAuthExpired = () => {
      setIsGoogleAuthExpired(true);
      setGlobalError(
        'Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para renovar tus credenciales.'
      );
    };

    const handleTokenRefreshed = (e: Event) => {
      const customEvent = e as CustomEvent<{ token: string; user?: User }>;
      if (customEvent.detail?.token) {
        setToken(customEvent.detail.token);
        setIsGoogleAuthExpired(false);
        setGlobalError(null);
        if (customEvent.detail.user) {
          setUser(customEvent.detail.user);
        }
      }
    };

    window.addEventListener('svh_google_auth_expired', handleAuthExpired);
    window.addEventListener('svh_google_token_refreshed', handleTokenRefreshed);
    return () => {
      window.removeEventListener('svh_google_auth_expired', handleAuthExpired);
      window.removeEventListener('svh_google_token_refreshed', handleTokenRefreshed);
    };
  }, []);

  // Load spreadsheet data using dynamic file structure as the source of truth
  const loadProjectInvoices = useCallback(
    async (authToken: string, spreadsheetId: string, sheetTitle?: string) => {
      if (!authToken || !authToken.trim()) {
        console.warn('loadProjectInvoices llamado sin token de autenticación.');
        return;
      }
      setIsLoadingInvoices(true);
      try {
        const dynamicResult = await analyzeAndFetchDynamicSheet(authToken, spreadsheetId, sheetTitle);
        setDynamicAnalysis(dynamicResult);

        // Extract invoice records if present for compatible workflows
        const records = (dynamicResult?.rows || [])
          .map((r) => r?.invoiceRecord)
          .filter(Boolean) as SheetInvoiceRecord[];

        setProjectInvoices(records);
        setIsGoogleAuthExpired(false);
      } catch (err: any) {
        const isAuth =
          err?.status === 401 ||
          err?.isAuthError ||
          String(err?.message || '').includes('401') ||
          String(err?.message || '').includes('invalid authentication credentials') ||
          String(err?.message || '').includes('Expected OAuth 2 access token') ||
          String(err?.message || '').includes('UNAUTHENTICATED');

        if (isAuth) {
          console.warn('[Google Auth] Sesión con Google expirada, se requiere renovación de credenciales.');
          setIsGoogleAuthExpired(true);
          setGlobalError('Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para renovar tus credenciales.');
          return;
        }
        console.error('Error al analizar dinámicamente la hoja de cálculo:', err);

        // Fallback to legacy parser if needed (solo si no es error de autenticación)
        try {
          const records = await fetchSheetInvoiceRecords(authToken, spreadsheetId, sheetTitle);
          setProjectInvoices(records.reverse());
        } catch (fallbackErr) {
          console.error('Error en fallback:', fallbackErr);
        }
      } finally {
        setIsLoadingInvoices(false);
      }
    },
    []
  );

  // Load user projects from Firestore (no hardcoded starter project)
  const loadWorkspaceData = useCallback(
    async (authToken: string, currentUser: User) => {
      setIsLoadingProjects(true);
      setGlobalError(null);
      try {
        const storedProjects = await loadUserProjectsFromFirestore(currentUser.uid);

        if (storedProjects.length > 0) {
          setProjects(storedProjects);
          const savedLastProjectId = typeof window !== 'undefined' ? localStorage.getItem('svh_last_selected_project_id') : null;
          const matched = savedLastProjectId ? storedProjects.find((p) => p.id === savedLastProjectId) : null;
          const initialProject = matched || storedProjects[0];
          setSelectedProject(initialProject);
          if (initialProject.spreadsheetId) {
            if (authToken && authToken.trim()) {
              loadProjectInvoices(authToken, initialProject.spreadsheetId, initialProject.activeSheetTab);
            } else {
              setIsGoogleAuthExpired(true);
              setGlobalError('Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para renovar tus credenciales.');
            }
          }
        } else {
          // No projects found in Firebase. Do NOT auto-create "Residencial Los Olivos"
          setProjects([]);
          setSelectedProject(null);
          setProjectInvoices([]);
        }
      } catch (err: any) {
        console.error('Error cargando proyectos desde Firebase:', err);
        setGlobalError(
          'Error al conectar con Firebase: ' + (err.message || 'Verifica la conexión')
        );
      } finally {
        setIsLoadingProjects(false);
      }
    },
    [loadProjectInvoices]
  );

  // When token or user changes, load Workspace data from Firebase
  useEffect(() => {
    if (token && user) {
      loadWorkspaceData(token, user);
    } else {
      setProjects([]);
      setSelectedProject(null);
      setProjectInvoices([]);
    }
  }, [token, user, loadWorkspaceData]);

  // Cargar módulos de construcción por obra activa (Firestore + localStorage)
  const loadConstructionModules = useCallback(async (projectId: string) => {
    setIsLoadingConstructionModules(true);
    try {
      const [
        workersList,
        facturasList,
        bitacorasList,
        settingsData,
        nominasList,
        inventarioList,
        abonosList,
        unassignedList,
      ] = await Promise.all([
        fetchWorkersFromDb(projectId),
        fetchFacturasSismoFromDb(projectId),
        fetchBitacorasFromDb(projectId),
        fetchPayrollSettingsFromDb(projectId),
        fetchNominasFromDb(projectId),
        fetchInventarioFromDb(projectId),
        fetchAbonosFromDb(projectId),
        scanRecordsWithoutOrigin(projectId),
      ]);
      setWorkers(workersList);
      setFacturasSismo(facturasList);
      setBitacoras(bitacorasList);
      setPayrollSettings(settingsData);
      setNominas(nominasList);
      setInventarioItems(inventarioList);
      setAbonosItems(abonosList);
      setUnassignedRecords(unassignedList);
    } catch (err) {
      console.error('Error cargando módulos de construcción:', err);
    } finally {
      setIsLoadingConstructionModules(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProject?.id) {
      loadConstructionModules(selectedProject.id);
    } else {
      setWorkers([]);
      setFacturasSismo([]);
      setBitacoras([]);
      setNominas([]);
      setInventarioItems([]);
      setAbonosItems([]);
    }
  }, [selectedProject?.id, loadConstructionModules]);

  // Callbacks CRUD para Facturas ("ADECUACIONES SISMO")
  const handleSaveFacturaSismo = async (factura: FacturaSismoItem) => {
    if (!selectedProject) return;
    await saveFacturaSismoToDb(selectedProject.id, factura);
    setFacturasSismo((prev) => {
      const exists = prev.some((f) => f.id === factura.id);
      const updated = exists
        ? prev.map((f) => (f.id === factura.id ? factura : f))
        : [...prev, factura];
      return updated.sort((a, b) => a.consecutivo - b.consecutivo);
    });
  };

  const handleDeleteFacturaSismo = async (facturaId: string) => {
    if (!selectedProject) return;
    const item = facturasSismo.find((f) => f.id === facturaId);
    try {
      await deleteFacturaSismoFromDb(selectedProject.id, facturaId);
      setFacturasSismo((prev) => prev.filter((f) => f.id !== facturaId));
      if (item) {
        setUndoAction({
          id: facturaId,
          message: `Factura #${item.consecutivo} eliminada`,
          onUndo: async () => {
            await saveFacturaSismoToDb(selectedProject.id, item);
            setFacturasSismo((prev) => [item, ...prev].sort((a, b) => a.consecutivo - b.consecutivo));
          },
          durationSeconds: 8,
        });
      }
    } catch (err: any) {
      console.error('Error al eliminar factura sismo:', err);
      setGlobalError(`Error al eliminar factura: ${err?.message || 'No se pudo completar la operación'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleDeleteMultipleFacturasSismo = async (ids: string[]) => {
    if (!selectedProject || ids.length === 0) return;
    const items = facturasSismo.filter((f) => ids.includes(f.id));
    const idSet = new Set(ids);
    try {
      await deleteMultipleFacturasSismoFromDb(selectedProject.id, ids);
      setFacturasSismo((prev) => prev.filter((f) => !idSet.has(f.id)));
      setUndoAction({
        id: `batch-facturas-${Date.now()}`,
        message: `${items.length} facturas eliminadas`,
        onUndo: async () => {
          for (const it of items) {
            await saveFacturaSismoToDb(selectedProject.id, it);
          }
          setFacturasSismo((prev) => [...items, ...prev].sort((a, b) => a.consecutivo - b.consecutivo));
        },
        durationSeconds: 8,
      });
    } catch (err: any) {
      console.error('Error al eliminar facturas:', err);
      setGlobalError(`Error al eliminar facturas: ${err?.message || 'Error en la base de datos'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  // Callbacks CRUD para Mano de Obra (Bitácoras)
  const handleSaveBitacora = async (bitacora: BitacoraRecord) => {
    if (!selectedProject) return;
    await saveBitacoraToDb(selectedProject.id, bitacora);
    setBitacoras((prev) => {
      const exists = prev.some((b) => b.id === bitacora.id);
      const updated = exists
        ? prev.map((b) => (b.id === bitacora.id ? bitacora : b))
        : [...prev, bitacora];
      return updated.sort((a, b) => b.fechaFin.localeCompare(a.fechaFin));
    });
  };

  const handleDeleteBitacora = async (bitacoraId: string) => {
    if (!selectedProject) return;
    const item = bitacoras.find((b) => b.id === bitacoraId);
    try {
      await deleteBitacoraFromDb(selectedProject.id, bitacoraId);
      setBitacoras((prev) => prev.filter((b) => b.id !== bitacoraId));
      if (item) {
        setUndoAction({
          id: bitacoraId,
          message: `Bitácora "${item.titulo}" eliminada`,
          onUndo: async () => {
            await saveBitacoraToDb(selectedProject.id, item);
            setBitacoras((prev) => [item, ...prev].sort((a, b) => b.fechaFin.localeCompare(a.fechaFin)));
          },
          durationSeconds: 8,
        });
      }
    } catch (err: any) {
      console.error('Error al eliminar bitácora:', err);
      setGlobalError(`Error al eliminar bitácora: ${err?.message || 'No se pudo completar la operación'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleDeleteMultipleBitacoras = async (ids: string[]) => {
    if (!selectedProject || ids.length === 0) return;
    const items = bitacoras.filter((b) => ids.includes(b.id));
    const idSet = new Set(ids);
    try {
      await deleteMultipleBitacorasFromDb(selectedProject.id, ids);
      setBitacoras((prev) => prev.filter((b) => !idSet.has(b.id)));
      setUndoAction({
        id: `batch-bitacoras-${Date.now()}`,
        message: `${items.length} bitácoras eliminadas`,
        onUndo: async () => {
          for (const it of items) {
            await saveBitacoraToDb(selectedProject.id, it);
          }
          setBitacoras((prev) => [...items, ...prev].sort((a, b) => b.fechaFin.localeCompare(a.fechaFin)));
        },
        durationSeconds: 8,
      });
    } catch (err: any) {
      console.error('Error al eliminar bitácoras:', err);
      setGlobalError(`Error al eliminar bitácoras: ${err?.message || 'Error en la base de datos'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  // Callbacks CRUD para Catálogo de Trabajadores
  const handleSaveWorker = async (worker: WorkerCatalogItem) => {
    if (!selectedProject) return;
    await saveWorkerToDb(selectedProject.id, worker);
    setWorkers((prev) => {
      const exists = prev.some((w) => w.id === worker.id);
      return exists
        ? prev.map((w) => (w.id === worker.id ? worker : w))
        : [worker, ...prev];
    });
  };

  const handleDeleteWorker = async (workerId: string) => {
    if (!selectedProject) return;
    const item = workers.find((w) => w.id === workerId);
    try {
      await deleteWorkerFromDb(selectedProject.id, workerId);
      setWorkers((prev) => prev.filter((w) => w.id !== workerId));
      if (item) {
        setUndoAction({
          id: workerId,
          message: `Trabajador "${item.nombre}" eliminado`,
          onUndo: async () => {
            await saveWorkerToDb(selectedProject.id, item);
            setWorkers((prev) => [item, ...prev]);
          },
          durationSeconds: 8,
        });
      }
    } catch (err: any) {
      console.error('Error al eliminar trabajador:', err);
      setGlobalError(`Error al eliminar trabajador: ${err?.message || 'No se pudo completar la operación'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleDeleteMultipleWorkers = async (ids: string[]) => {
    if (!selectedProject || ids.length === 0) return;
    const items = workers.filter((w) => ids.includes(w.id));
    const idSet = new Set(ids);
    try {
      await deleteMultipleWorkersFromDb(selectedProject.id, ids);
      setWorkers((prev) => prev.filter((w) => !idSet.has(w.id)));
      setUndoAction({
        id: `batch-workers-${Date.now()}`,
        message: `${items.length} trabajadores eliminados`,
        onUndo: async () => {
          for (const it of items) {
            await saveWorkerToDb(selectedProject.id, it);
          }
          setWorkers((prev) => [...items, ...prev]);
        },
        durationSeconds: 8,
      });
    } catch (err: any) {
      console.error('Error al eliminar trabajadores:', err);
      setGlobalError(`Error al eliminar trabajadores: ${err?.message || 'Error en la base de datos'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  // Callbacks CRUD para Nóminas Quincenales
  const handleSaveNomina = async (nomina: NominaRecord) => {
    if (!selectedProject) return;
    await saveNominaToDb(selectedProject.id, nomina);
    setNominas((prev) => {
      const exists = prev.some((n) => n.id === nomina.id);
      const updated = exists
        ? prev.map((n) => (n.id === nomina.id ? nomina : n))
        : [...prev, nomina];
      return updated.sort((a, b) => b.titulo.localeCompare(a.titulo));
    });
  };

  const handleDeleteNomina = async (nominaId: string) => {
    if (!selectedProject) return;
    const item = nominas.find((n) => n.id === nominaId);
    try {
      await deleteNominaFromDb(selectedProject.id, nominaId);
      setNominas((prev) => prev.filter((n) => n.id !== nominaId));
      if (item) {
        setUndoAction({
          id: nominaId,
          message: `Nómina "${item.titulo}" eliminada`,
          onUndo: async () => {
            await saveNominaToDb(selectedProject.id, item);
            setNominas((prev) => [item, ...prev].sort((a, b) => b.titulo.localeCompare(a.titulo)));
          },
          durationSeconds: 8,
        });
      }
    } catch (err: any) {
      console.error('Error al eliminar nómina:', err);
      setGlobalError(`Error al eliminar nómina: ${err?.message || 'No se pudo completar la operación'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleDeleteMultipleNominas = async (ids: string[]) => {
    if (!selectedProject || ids.length === 0) return;
    const items = nominas.filter((n) => ids.includes(n.id));
    const idSet = new Set(ids);
    try {
      await deleteMultipleNominasFromDb(selectedProject.id, ids);
      setNominas((prev) => prev.filter((n) => !idSet.has(n.id)));
      setUndoAction({
        id: `batch-nominas-${Date.now()}`,
        message: `${items.length} nóminas eliminadas`,
        onUndo: async () => {
          for (const it of items) {
            await saveNominaToDb(selectedProject.id, it);
          }
          setNominas((prev) => [...items, ...prev].sort((a, b) => b.titulo.localeCompare(a.titulo)));
        },
        durationSeconds: 8,
      });
    } catch (err: any) {
      console.error('Error al eliminar nóminas:', err);
      setGlobalError(`Error al eliminar nóminas: ${err?.message || 'Error en la base de datos'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleSavePayrollSettings = async (settings: NominaParametros) => {
    if (!selectedProject) return;
    await savePayrollSettingsToDb(selectedProject.id, settings);
    setPayrollSettings(settings);
  };

  // Callbacks CRUD para Inventario
  const handleSaveInventarioItem = async (item: InventarioRecord) => {
    if (!selectedProject) return;
    await saveInventarioItemToDb(selectedProject.id, item);
    setInventarioItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      const updated = exists
        ? prev.map((i) => (i.id === item.id ? item : i))
        : [...prev, item];
      return updated.sort((a, b) => a.nombre.localeCompare(b.nombre));
    });
  };

  const handleDeleteInventarioItem = async (itemId: string) => {
    if (!selectedProject) return;
    const item = inventarioItems.find((i) => i.id === itemId);
    try {
      await deleteInventarioItemFromDb(selectedProject.id, itemId);
      setInventarioItems((prev) => prev.filter((i) => i.id !== itemId));
      if (item) {
        setUndoAction({
          id: itemId,
          message: `Material "${item.nombre}" eliminado`,
          onUndo: async () => {
            await saveInventarioItemToDb(selectedProject.id, item);
            setInventarioItems((prev) => [item, ...prev].sort((a, b) => a.nombre.localeCompare(b.nombre)));
          },
          durationSeconds: 8,
        });
      }
    } catch (err: any) {
      console.error('Error al eliminar inventario:', err);
      setGlobalError(`Error al eliminar material: ${err?.message || 'No se pudo completar la operación'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleDeleteMultipleInventario = async (ids: string[]) => {
    if (!selectedProject || ids.length === 0) return;
    const items = inventarioItems.filter((i) => ids.includes(i.id));
    const idSet = new Set(ids);
    try {
      await deleteMultipleInventarioFromDb(selectedProject.id, ids);
      setInventarioItems((prev) => prev.filter((i) => !idSet.has(i.id)));
      setUndoAction({
        id: `batch-inventario-${Date.now()}`,
        message: `${items.length} materiales eliminados`,
        onUndo: async () => {
          for (const it of items) {
            await saveInventarioItemToDb(selectedProject.id, it);
          }
          setInventarioItems((prev) => [...items, ...prev].sort((a, b) => a.nombre.localeCompare(b.nombre)));
        },
        durationSeconds: 8,
      });
    } catch (err: any) {
      console.error('Error al eliminar inventario:', err);
      setGlobalError(`Error al eliminar materiales: ${err?.message || 'Error en la base de datos'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  // Agregar a inventario desde el detalle de una factura
  const handleAddToInventory = async (itemData: {
    nombre: string;
    cantidad: number;
    unidad: string;
    facturaVinculada: string;
  }) => {
    if (!selectedProject) return;
    const newItem: InventarioRecord = {
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      obraId: selectedProject.id,
      origen: 'manual',
      creadoEn: Date.now(),
      actualizadoEn: Date.now(),
      nombre: (itemData.nombre || 'MATERIAL DE OBRA').toUpperCase(),
      unidad: (itemData.unidad || 'UN').toUpperCase(),
      cantidad: Math.max(1, Number(itemData.cantidad) || 1),
      fechaIngreso: new Date().toISOString().split('T')[0],
      observacion: `Ingresado desde ${itemData.facturaVinculada}`,
      facturaVinculada: itemData.facturaVinculada,
      createdAt: Date.now(),
    };
    await handleSaveInventarioItem(newItem);
    setActiveModule('inventario');
  };

  // Callbacks CRUD para Abonos
  const handleSaveAbono = async (abono: AbonoRecordItem) => {
    if (!selectedProject) return;
    await saveAbonoToDb(selectedProject.id, abono);
    setAbonosItems((prev) => {
      const exists = prev.some((a) => a.id === abono.id);
      const updated = exists
        ? prev.map((a) => (a.id === abono.id ? abono : a))
        : [...prev, abono];
      return updated.sort((a, b) => a.consecutivo - b.consecutivo);
    });
  };

  const handleDeleteAbono = async (abonoId: string) => {
    if (!selectedProject) return;
    const item = abonosItems.find((a) => a.id === abonoId);
    try {
      await deleteAbonoFromDb(selectedProject.id, abonoId);
      setAbonosItems((prev) => prev.filter((a) => a.id !== abonoId));
      if (item) {
        setUndoAction({
          id: abonoId,
          message: `Abono "${item.item}" eliminado`,
          onUndo: async () => {
            await saveAbonoToDb(selectedProject.id, item);
            setAbonosItems((prev) => [item, ...prev].sort((a, b) => a.consecutivo - b.consecutivo));
          },
          durationSeconds: 8,
        });
      }
    } catch (err: any) {
      console.error('Error al eliminar abono:', err);
      setGlobalError(`Error al eliminar abono: ${err?.message || 'No se pudo completar la operación'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleDeleteMultipleAbonos = async (ids: string[]) => {
    if (!selectedProject || ids.length === 0) return;
    const items = abonosItems.filter((a) => ids.includes(a.id));
    const idSet = new Set(ids);
    try {
      await deleteMultipleAbonosFromDb(selectedProject.id, ids);
      setAbonosItems((prev) => prev.filter((a) => !idSet.has(a.id)));
      setUndoAction({
        id: `batch-abonos-${Date.now()}`,
        message: `${items.length} abonos eliminados`,
        onUndo: async () => {
          for (const it of items) {
            await saveAbonoToDb(selectedProject.id, it);
          }
          setAbonosItems((prev) => [...items, ...prev].sort((a, b) => a.consecutivo - b.consecutivo));
        },
        durationSeconds: 8,
      });
    } catch (err: any) {
      console.error('Error al eliminar abonos:', err);
      setGlobalError(`Error al eliminar abonos: ${err?.message || 'Error en la base de datos'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  // Zona de Peligro: Vaciar obra y Eliminar obra definitivamente
  const handleVaciarObra = async (deleteDriveFiles: boolean) => {
    if (!selectedProject) return;
    const projId = selectedProject.id;
    const projName = selectedProject.name;
    const folderId = selectedProject.evidenceFolderId;

    await vaciarObraDb(projId);

    if (deleteDriveFiles && token && folderId) {
      try {
        await deleteDriveFile(token, folderId);
      } catch (e) {
        console.warn('No se pudo borrar carpeta de Drive al vaciar:', e);
      }
    }

    await loadConstructionModules(projId);
    setDeleteSuccessMessage(`Se han vaciado todos los registros de "${projName}". La obra está completamente en cero.`);
    setTimeout(() => setDeleteSuccessMessage(null), 6000);
  };

  const handleEliminarObraDefinitiva = async (deleteDriveFiles: boolean) => {
    if (!selectedProject) return;
    const projId = selectedProject.id;
    const projName = selectedProject.name;
    const folderId = selectedProject.evidenceFolderId;

    await vaciarObraDb(projId);

    if (deleteDriveFiles && token && folderId) {
      try {
        await deleteDriveFile(token, folderId);
      } catch (e) {
        console.warn('No se pudo borrar carpeta de Drive al eliminar:', e);
      }
    }

    await handleDeleteProject(projId);
    setDeleteSuccessMessage(`La obra "${projName}" y todos sus registros han sido eliminados.`);
    setTimeout(() => setDeleteSuccessMessage(null), 6000);
  };

  // Gestión de registros legacy sin origen
  const handleDeleteUnassignedRecords = async (records: UnassignedRecordItem[]) => {
    if (!selectedProject) return;
    try {
      await deleteUnassignedRecords(selectedProject.id, records);
      await loadConstructionModules(selectedProject.id);
      setDeleteSuccessMessage(`Se eliminaron ${records.length} registros sin origen.`);
      setTimeout(() => setDeleteSuccessMessage(null), 6000);
    } catch (err: any) {
      setGlobalError(`Error al eliminar registros: ${err?.message || 'Error desconocido'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  const handleKeepUnassignedRecords = async (records: UnassignedRecordItem[]) => {
    if (!selectedProject) return;
    try {
      await markRecordsAsManual(selectedProject.id, records);
      await loadConstructionModules(selectedProject.id);
      setDeleteSuccessMessage(`Se conservaron ${records.length} registros como manuales.`);
      setTimeout(() => setDeleteSuccessMessage(null), 5000);
    } catch (err: any) {
      setGlobalError(`Error al actualizar registros: ${err?.message || 'Error desconocido'}`);
      setTimeout(() => setGlobalError(null), 7000);
    }
  };

  // Exportar todas las 6 pestañas a Excel con fórmulas reales de Excel SUM
  const handleExportExcel = () => {
    if (!selectedProject) return;
    exportConstructionWorkbook({
      projectName: selectedProject.name,
      facturas: facturasSismo,
      bitacoras,
      nominas,
      inventario: inventarioItems,
      abonos: abonosItems,
    });
  };

  // Switch active project
  const handleSelectProject = async (project: ProjectFolder) => {
    if (!token) return;
    setIsLoadingInvoices(true);
    try {
      setSelectedProject(project);
      if (typeof window !== 'undefined') {
        localStorage.setItem('svh_last_selected_project_id', project.id);
      }
      if (project.spreadsheetId) {
        await loadProjectInvoices(token, project.spreadsheetId, project.activeSheetTab);
      } else {
        setProjectInvoices([]);
      }
    } catch (err: any) {
      setGlobalError('Error al cambiar de proyecto: ' + err.message);
    } finally {
      setIsLoadingInvoices(false);
    }
  };

  // Add newly created project and persist to Firebase
  const handleProjectCreated = async (newProject: ProjectFolder) => {
    if (user) {
      try {
        await saveProjectToFirestore(user.uid, newProject);
      } catch (err: any) {
        console.error('Error guardando obra en Firebase:', err);
        setGlobalError('Error guardando la obra en Firebase: ' + (err.message || ''));
      }
    }
    const updatedList = [newProject, ...projects.filter((p) => p.id !== newProject.id)];
    setProjects(updatedList);
    setSelectedProject(newProject);
    if (token && newProject.spreadsheetId) {
      loadProjectInvoices(token, newProject.spreadsheetId, newProject.activeSheetTab);
    }
  };

  // Save updated destinations for the active project to Firebase
  const handleSaveProjectConfig = async (newConfig: ProjectWorkspaceConfig) => {
    if (!selectedProject) return;

    const updatedProject: ProjectFolder = {
      ...selectedProject,
      name: newConfig.projectName || selectedProject.name,
      evidenceFolderId: newConfig.evidenceFolderId,
      evidenceFolderName: newConfig.evidenceFolderName,
      evidenceFolderUrl: newConfig.evidenceFolderUrl,
      evidenceParentId: newConfig.evidenceParentId,
      evidenceParentName: newConfig.evidenceParentName,
      spreadsheetId: newConfig.spreadsheetId,
      spreadsheetName: newConfig.spreadsheetName,
      spreadsheetUrl: newConfig.spreadsheetUrl,
      spreadsheetParentId: newConfig.spreadsheetParentId,
      spreadsheetParentName: newConfig.spreadsheetParentName,
      activeSheetTab: newConfig.activeSheetTab,
      detectedTabs: newConfig.detectedTabs,
    };

    setSelectedProject(updatedProject);

    const updatedList = projects.map((p) => (p.id === updatedProject.id ? updatedProject : p));
    setProjects(updatedList);

    if (user) {
      try {
        await updateProjectInFirestore(user.uid, updatedProject.id, updatedProject);
      } catch (err: any) {
        console.error('Error actualizando obra en Firebase:', err);
      }
    }

    if (token && newConfig.spreadsheetId) {
      await loadProjectInvoices(token, newConfig.spreadsheetId, newConfig.activeSheetTab);
    }
  };

  // Delete project from Firebase (ONLY from the list, never deleting from Drive)
  const handleDeleteProject = async (projectId: string) => {
    if (!user) return;
    try {
      await deleteProjectFromFirestore(user.uid, projectId);
      const updatedList = projects.filter((p) => p.id !== projectId);
      setProjects(updatedList);
      if (selectedProject?.id === projectId) {
        if (updatedList.length > 0) {
          const nextProj = updatedList[0];
          setSelectedProject(nextProj);
          if (token && nextProj.spreadsheetId) {
            await loadProjectInvoices(token, nextProj.spreadsheetId);
          } else {
            setProjectInvoices([]);
          }
        } else {
          setSelectedProject(null);
          setProjectInvoices([]);
        }
      }
    } catch (err: any) {
      console.error('Error al quitar obra de la lista:', err);
      setGlobalError('Error al quitar la obra de la lista: ' + (err.message || 'Error desconocido'));
    }
  };

  // Renombrar o editar el nombre del proyecto de obra en cualquier momento
  const handleRenameProject = async (projectId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, name: trimmed } : p))
    );
    if (selectedProject?.id === projectId) {
      setSelectedProject((prev) => (prev ? { ...prev, name: trimmed } : null));
    }
    if (user) {
      try {
        await updateProjectInFirestore(user.uid, projectId, { name: trimmed });
      } catch (err) {
        console.error('Error actualizando nombre de la obra en Firestore:', err);
      }
    }
    setDeleteSuccessMessage(`Nombre de la obra actualizado a "${trimmed}".`);
    setTimeout(() => setDeleteSuccessMessage(null), 4000);
  };

  // Listener de evento global para ejecutar de inmediato la hoja creada o seleccionada
  useEffect(() => {
    const handleExecuteSheetEvent = async (e: Event) => {
      const customEvent = e as CustomEvent<{
        id: string;
        name: string;
        url: string;
        folderId?: string;
        folderName?: string;
      }>;
      const detail = customEvent.detail;
      if (!detail?.id) return;

      const fullUrl = detail.url || `https://docs.google.com/spreadsheets/d/${detail.id}/edit`;
      const folderName = detail.folderName;
      // Guardar el nombre del proyecto con el nombre de la obra de la carpeta actual
      const resolvedObraName =
        folderName &&
        folderName !== 'root' &&
        folderName !== 'Facturas' &&
        folderName !== 'FACTURAS'
          ? folderName
          : selectedProject?.name || 'Obra';

      const updatedProj: ProjectFolder = {
        ...(selectedProject || {
          id: detail.folderId || 'proj-' + Date.now(),
          name: resolvedObraName,
          createdAt: new Date().toISOString(),
          userId: user?.uid || '',
          activeSheetTab: 'Control Facturas',
        }),
        name: resolvedObraName,
        evidenceFolderId: detail.folderId || selectedProject?.evidenceFolderId,
        evidenceFolderName: detail.folderName || selectedProject?.evidenceFolderName,
        spreadsheetId: detail.id,
        spreadsheetName: detail.name,
        spreadsheetUrl: fullUrl,
        activeSheetTab: 'Control Facturas',
      };

      setSelectedProject(updatedProj);
      setProjects((prev) => {
        const exists = prev.some((p) => p.id === updatedProj.id);
        if (exists) {
          return prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
        }
        return [updatedProj, ...prev];
      });

      if (user) {
        try {
          await updateProjectInFirestore(user.uid, updatedProj.id, updatedProj);
        } catch (err: any) {
          console.error('Error actualizando obra en Firebase desde evento:', err);
        }
      }

      setIsConfigModalOpen(false);
      setActiveModule('invoices');
      setDeleteSuccessMessage(
        `¡Hoja de cálculo "${detail.name}" ejecutada exitosamente en la página con los datos de las facturas de la obra!`
      );
      setTimeout(() => setDeleteSuccessMessage(null), 6000);

      if (token) {
        await loadProjectInvoices(token, detail.id, 'Control Facturas');
      }
    };

    window.addEventListener('svh:execute-sheet', handleExecuteSheetEvent);
    return () => {
      window.removeEventListener('svh:execute-sheet', handleExecuteSheetEvent);
    };
  }, [selectedProject, user, token, loadProjectInvoices]);

  // Handle Google Login
  const handleLogin = async () => {
    setIsLoggingIn(true);
    setGlobalError(null);
    try {
      const authResult = await googleSignIn();
      if (authResult) {
        setUser(authResult.user);
        setToken(authResult.accessToken);
      }
    } catch (err: any) {
      console.error('Error during Google sign-in:', err);
      setGlobalError('No se pudo iniciar sesión con Google. Por favor intenta de nuevo.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Logout (manual user action, session is never auto-closed)
  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setSelectedProject(null);
    setProjects([]);
    setProjectInvoices([]);
    setSuccessData(null);
  };

  // Handle Switch Account (forces Google account picker)
  const handleSwitchAccount = async () => {
    setIsLoggingIn(true);
    setGlobalError(null);
    try {
      const authResult = await switchGoogleAccount();
      if (authResult) {
        setUser(authResult.user);
        setToken(authResult.accessToken);
        await loadWorkspaceData(authResult.accessToken, authResult.user);
      }
    } catch (err: any) {
      console.error('Error al cambiar de cuenta:', err);
      if (err?.code !== 'auth/popup-closed-by-user') {
        setGlobalError('No se pudo cambiar de cuenta. ' + (err.message || ''));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Add Account
  const handleAddAccount = async () => {
    setIsLoggingIn(true);
    setGlobalError(null);
    try {
      const authResult = await addGoogleAccount();
      if (authResult) {
        setUser(authResult.user);
        setToken(authResult.accessToken);
        await loadWorkspaceData(authResult.accessToken, authResult.user);
      }
    } catch (err: any) {
      console.error('Error al agregar cuenta:', err);
      if (err?.code !== 'auth/popup-closed-by-user') {
        setGlobalError('No se pudo agregar cuenta. ' + (err.message || ''));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Renovar credenciales de Google OAuth cuando caduca el token de acceso
  const handleRefreshToken = async (): Promise<string | null> => {
    setIsLoggingIn(true);
    setGlobalError(null);
    try {
      const authResult = await googleSignIn();
      if (authResult?.accessToken) {
        setUser(authResult.user);
        setToken(authResult.accessToken);
        setIsGoogleAuthExpired(false);
        setGlobalError(null);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('svh_google_token_refreshed', {
              detail: { token: authResult.accessToken, user: authResult.user },
            })
          );
        }
        if (selectedProject?.spreadsheetId) {
          loadProjectInvoices(authResult.accessToken, selectedProject.spreadsheetId, selectedProject.activeSheetTab);
        }
        return authResult.accessToken;
      }
      return null;
    } catch (err: any) {
      console.warn('Error renovando sesión de Google:', err);
      if (err?.code !== 'auth/popup-closed-by-user') {
        setGlobalError('No se pudo renovar la sesión con Google: ' + (err.message || ''));
      }
      return null;
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle image selected in Uploader
  const handleImageSelected = (base64: string, fileName: string, mimeType: string) => {
    setCurrentImageBase64(base64);
    setCurrentFileName(fileName);
    setCurrentMimeType(mimeType);
  };

  // Call Server-Side Gemini API to analyze invoice
  const handleAnalyzeInvoice = async (base64: string, mimeType: string) => {
    setIsAnalyzing(true);
    setGlobalError(null);
    try {
      // Optimize image before sending to avoid large payloads, timeouts, or buffer limits
      let imageToSend = base64;
      let mimeToSend = mimeType || 'image/jpeg';
      try {
        const optimized = await optimizeImageForAnalysis(base64, 2560, 0.92);
        imageToSend = optimized.base64;
        mimeToSend = optimized.mimeType;
      } catch (optErr) {
        console.warn('Could not optimize image, using original', optErr);
      }

      const response = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageToSend,
          mimeType: mimeToSend,
          fileName: currentFileName,
        }),
      });

      // Safely read response as text first to avoid uncaught "Unexpected token '<'" on HTML/warmup responses
      const rawResponseText = await response.text();
      const isHtmlResponse =
        rawResponseText.trim().startsWith('<') ||
        rawResponseText.toLowerCase().includes('<!doctype') ||
        rawResponseText.toLowerCase().includes('<html');

      if (isHtmlResponse) {
        throw new Error(
          'El servidor de análisis está iniciando o experimentando una pausa momentánea. Por favor, pulsa en "Reintentar análisis con IA" en unos instantes.'
        );
      }

      let result: any = null;
      try {
        result = JSON.parse(rawResponseText);
      } catch {
        throw new Error(
          'Respuesta no válida del servidor. Por favor, intenta de nuevo en unos segundos.'
        );
      }

      if (!response.ok || !result || result.success === false) {
        let message = result?.error || 'Error en el servidor al analizar la factura.';
        if (
          message.includes('503') ||
          message.includes('high demand') ||
          message.includes('UNAVAILABLE') ||
          message.includes('temporarily') ||
          message.includes('RESOURCE_EXHAUSTED') ||
          message.includes('quota')
        ) {
          message =
            'La IA está experimentando un pico de alta demanda o límite temporal de solicitudes. Por favor, pulsa en "Reintentar análisis con IA" en unos instantes.';
        }
        throw new Error(message);
      }

      if (result.success && result.data) {
        // Verificación estricta anti-duplicados previa a la revisión
        const dupCheck = checkInvoiceDuplicate(result.data, projectInvoices, currentFileName);
        if (dupCheck.isDuplicate) {
          setGlobalError(`Factura repetida (${dupCheck.reason || 'Ya registrada en la hoja de cálculo'}). No se puede facturar nuevamente.`);
          setIsAnalyzing(false);
          return;
        }

        setExtractedInvoice(result.data);
        setIsReviewOpen(true);
      } else {
        throw new Error('Respuesta incompleta del analizador de facturas.');
      }
    } catch (err: any) {
      console.error('Error al analizar la factura:', err);
      setGlobalError(err.message || 'Error analizando la factura con IA.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Confirm and upload to Google Drive + append to Google Sheets using project-configured destinations
  const handleConfirmAndSave = async (confirmedData: InvoiceData & { fileName?: string }) => {
    if (!token || !selectedProject || !currentImageBase64) {
      setGlobalError('Faltan credenciales o el proyecto de obra no está seleccionado.');
      return;
    }

    setIsSavingToWorkspace(true);
    setGlobalError(null);

    const finalFileName = (confirmedData.fileName || currentFileName).trim();

    try {
      // 0. Verificación estricta anti-duplicados para impedir doble facturación
      const dupCheck = checkInvoiceDuplicate(confirmedData, projectInvoices, finalFileName);
      if (dupCheck.isDuplicate) {
        setIsSavingToWorkspace(false);
        setGlobalError(`Factura no procesada (Doble facturación no permitida): ${dupCheck.reason}`);
        return;
      }

      // 1. Target folder for evidence (custom configured or project root)
      const targetFolderId = selectedProject.evidenceFolderId || selectedProject.id;

      const uploadResult = await uploadInvoiceImageToDrive(
        token,
        targetFolderId,
        finalFileName,
        currentMimeType,
        currentImageBase64
      );

      // 2. Target spreadsheet for records (custom configured or project default)
      let targetSheetId = selectedProject.spreadsheetId;
      let targetSheetUrl = selectedProject.spreadsheetUrl;

      if (!targetSheetId) {
        const sheetParent = selectedProject.spreadsheetParentId || selectedProject.evidenceFolderId || selectedProject.id;
        const sheetTitle = buildProjectSpreadsheetTitle(selectedProject.name);
        const sheet = await createCustomSpreadsheet(
          token,
          sheetTitle,
          sheetParent
        );
        targetSheetId = sheet.id;
        targetSheetUrl = sheet.webViewLink;

        const updatedProject: ProjectFolder = {
          ...selectedProject,
          spreadsheetId: sheet.id,
          spreadsheetName: sheet.name,
          spreadsheetUrl: sheet.webViewLink,
        };
        setSelectedProject(updatedProject);
        setProjects((prev) =>
          prev.map((p) => (p.id === selectedProject.id ? updatedProject : p))
        );
        if (user) {
          try {
            await updateProjectInFirestore(user.uid, updatedProject.id, updatedProject);
          } catch (e) {
            console.warn('Error guardando nuevo spreadsheetId en Firestore:', e);
          }
        }
      }

      // 3. Append row to the configured Google Sheet
      await appendInvoiceToSheet(
        token,
        targetSheetId,
        confirmedData,
        uploadResult.webViewLink,
        finalFileName,
        selectedProject.activeSheetTab
      );

      // Guardar también en la base de datos de facturas de la obra ("ADECUACIONES SISMO")
      if (selectedProject) {
        const nextConsecutivo =
          facturasSismo.reduce((max, f) => Math.max(max, f.consecutivo || 0), 0) + 1;
        const sismoItem: FacturaSismoItem = {
          id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          consecutivo: nextConsecutivo,
          concepto: (
            confirmedData.concept ||
            confirmedData.vendorName ||
            finalFileName
          ).toUpperCase(),
          costo: Number(confirmedData.totalAmount) || 0,
          fecha: confirmedData.date || (confirmedData as any).invoiceDate || new Date().toISOString().split('T')[0],
          observacion: 'PAGADO',
          estado: 'confirmada',
          facturaVinculada: {
            fileName: finalFileName,
            url: uploadResult.webViewLink,
            webViewLink: uploadResult.webViewLink,
          },
        };
        await handleSaveFacturaSismo(sismoItem);
      }

      // 4. Update UI
      setIsReviewOpen(false);
      setExtractedInvoice(null);
      setCurrentImageBase64(null);
      setCurrentFileName(finalFileName);
      setLastSavedFileName(finalFileName);

      // Show success banner with direct links
      setSuccessData({
        driveUrl: uploadResult.webViewLink,
        sheetUrl: targetSheetUrl,
        fileName: finalFileName,
        projectName: selectedProject.name,
      });

      // 5. Reload invoice list from the active Google Sheet
      await loadProjectInvoices(token, targetSheetId, selectedProject.activeSheetTab);
    } catch (err: any) {
      console.error('Error guardando en Workspace:', err);
      setGlobalError('Error al guardar en Google Drive / Sheets: ' + err.message);
    } finally {
      setIsSavingToWorkspace(false);
    }
  };

  // Direct processing of invoice item without mandatory confirmation modal
  const handleProcessInvoiceItem = async (
    item: QueuedInvoiceItem,
    targetFolderIdOverride?: string,
    preferredModel?: string
  ): Promise<{
    success: boolean;
    data?: InvoiceData;
    driveUrl?: string;
    error?: string;
  }> => {
    if (!token || !selectedProject) {
      return {
        success: false,
        error: 'Faltan credenciales o el proyecto de obra no está seleccionado.',
      };
    }

    try {
      // 0. Pre-verificación anti-duplicados por nombre de archivo contra facturas existentes
      const preCheck = checkInvoiceDuplicate(
        { fileName: item.fileName },
        projectInvoices,
        item.fileName
      );
      if (preCheck.isDuplicate) {
        return {
          success: false,
          error: `Factura repetida (${preCheck.reason || 'Ya registrada en la hoja de cálculo'}). No se puede facturar nuevamente.`,
        };
      }

      // 1. Optimize image before sending to IA
      let imageToSend = item.base64;
      let mimeToSend = item.mimeType || 'image/jpeg';
      try {
        const optimized = await optimizeImageForAnalysis(item.base64, 2560, 0.92);
        imageToSend = optimized.base64;
        mimeToSend = optimized.mimeType;
      } catch (optErr) {
        console.warn('Could not optimize image, using original', optErr);
      }

      // 2. Call server-side Gemini API
      const response = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageToSend,
          mimeType: mimeToSend,
          fileName: item.fileName,
          model: preferredModel,
        }),
      });

      const rawResponseText = await response.text();
      let result: any = null;
      try {
        result = JSON.parse(rawResponseText);
      } catch {
        return {
          success: false,
          error: 'Error al interpretar respuesta de la IA. Por favor reintenta.',
        };
      }

      if (!response.ok || !result || result.success === false) {
        let msg = result?.error || 'Error al analizar la factura con IA.';
        if (
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('quota') ||
          msg.includes('RESOURCE_EXHAUSTED')
        ) {
          msg = 'Servicio de IA saturado temporalmente. Puedes reintentar en unos instantes.';
        }
        return { success: false, error: msg };
      }

      const extractedData: InvoiceData = result.data;

      // Verificación estricta anti-duplicados por datos contables extraídos
      const postCheck = checkInvoiceDuplicate(
        {
          fileName: item.fileName,
          invoiceNumber: extractedData.invoiceNumber || (extractedData as any).numeroFactura,
          vendorName: extractedData.vendorName || (extractedData as any).cliente,
          vendorTaxId: extractedData.vendorTaxId || (extractedData as any).nitRut,
          totalAmount: extractedData.totalAmount || (extractedData as any).total,
          date: (extractedData as any).date || (extractedData as any).fecha,
        },
        projectInvoices,
        item.fileName
      );
      if (postCheck.isDuplicate) {
        return {
          success: false,
          error: `Factura repetida (${postCheck.reason || 'Ya registrada'}). No se puede facturar nuevamente.`,
        };
      }

      // 3. Upload invoice evidence image to Drive (respecting chosen destination folder)
      const targetFolderId =
        targetFolderIdOverride || selectedProject.evidenceFolderId || selectedProject.id;
      const uploadResult = await uploadInvoiceImageToDrive(
        token,
        targetFolderId,
        item.fileName,
        item.mimeType,
        item.base64
      );

      // 4. Resolve Spreadsheet ID con el nombre del proyecto más "Facturación"
      let targetSheetId = selectedProject.spreadsheetId;
      if (!targetSheetId) {
        const sheetParent = selectedProject.spreadsheetParentId || selectedProject.evidenceFolderId || selectedProject.id;
        const sheet = await createCustomSpreadsheet(
          token,
          buildProjectSpreadsheetTitle(selectedProject.name),
          sheetParent
        );
        targetSheetId = sheet.id;

        const updatedProject: ProjectFolder = {
          ...selectedProject,
          spreadsheetId: sheet.id,
          spreadsheetName: sheet.name,
          spreadsheetUrl: sheet.webViewLink,
        };
        setSelectedProject(updatedProject);
        setProjects((prev) =>
          prev.map((p) => (p.id === selectedProject.id ? updatedProject : p))
        );
        if (user) {
          try {
            await updateProjectInFirestore(user.uid, updatedProject.id, updatedProject);
          } catch (e) {
            console.warn('Error guardando nuevo spreadsheetId en Firestore:', e);
          }
        }
      }

      // 5. Append row to Google Sheets directly
      await appendInvoiceToSheet(
        token,
        targetSheetId,
        extractedData,
        uploadResult.webViewLink,
        uploadResult.name,
        selectedProject.activeSheetTab
      );

      // 6. Refresh invoice list
      await loadProjectInvoices(token, targetSheetId, selectedProject.activeSheetTab);

      // Las facturas leídas por la IA llegan automáticamente con estado "Por revisar"
      if (selectedProject && uploadResult?.webViewLink) {
        const nextConsecutivo =
          facturasSismo.reduce((max, f) => Math.max(max, f.consecutivo || 0), 0) + 1;
        const sismoItem: FacturaSismoItem = {
          id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          consecutivo: nextConsecutivo,
          concepto: (
            extractedData.concept ||
            (extractedData as any).concepto ||
            extractedData.vendorName ||
            item.fileName
          ).toUpperCase(),
          costo: Number(extractedData.totalAmount) || 0,
          fecha: extractedData.date || (extractedData as any).invoiceDate || new Date().toISOString().split('T')[0],
          observacion: 'POR REVISAR',
          estado: 'por_revisar',
          facturaVinculada: {
            fileName: item.fileName,
            url: uploadResult.webViewLink,
            webViewLink: uploadResult.webViewLink,
          },
        };
        await handleSaveFacturaSismo(sismoItem);
      }

      return {
        success: true,
        data: extractedData,
        driveUrl: uploadResult.webViewLink,
      };
    } catch (err: any) {
      console.error('Error al procesar y guardar la factura:', err);
      return {
        success: false,
        error: err.message || 'Error desconocido al guardar en Drive y Sheets',
      };
    }
  };

  // Open review modal for manual inspection when explicitly requested
  const handleReviewInvoiceItem = async (item: QueuedInvoiceItem) => {
    setCurrentImageBase64(item.base64);
    setCurrentFileName(item.fileName);
    setCurrentMimeType(item.mimeType);
    await handleAnalyzeInvoice(item.base64, item.mimeType);
  };

  // Update selected project's evidence folder when navigated or changed
  const handleUpdateEvidenceFolder = async (folder: {
    id: string;
    name: string;
    path?: string;
    webViewLink?: string;
  }) => {
    if (!selectedProject) return;
    const updatedProject: ProjectFolder = {
      ...selectedProject,
      evidenceFolderId: folder.id,
      evidenceFolderName: folder.name,
      evidenceFolderUrl: folder.webViewLink,
    };
    setSelectedProject(updatedProject);
    setProjects((prev) =>
      prev.map((p) => (p.id === selectedProject.id ? updatedProject : p))
    );
    if (user) {
      try {
        await updateProjectInFirestore(user.uid, updatedProject.id, updatedProject);
      } catch (e) {
        console.warn('Error guardando carpeta de evidencias actualizada en Firestore:', e);
      }
    }
  };

  // Edit invoice record directly in Google Sheets
  const handleEditInvoice = async (updatedInvoice: SheetInvoiceRecord) => {
    if (!token || !selectedProject?.spreadsheetId || !updatedInvoice.rowIndex) {
      throw new Error('Faltan datos del proyecto o el número de fila a editar.');
    }

    // Actualización inmediata en el estado del MVP
    setProjectInvoices((prev) =>
      prev.map((inv) => (inv.rowIndex === updatedInvoice.rowIndex ? { ...inv, ...updatedInvoice } : inv))
    );

    setDynamicAnalysis((prev) => {
      if (!prev) return prev;
      const updatedRows = (prev.rows || []).map((row) => {
        if (row.rowIndex === updatedInvoice.rowIndex) {
          return {
            ...row,
            invoiceRecord: {
              ...(row.invoiceRecord || {}),
              ...updatedInvoice,
            } as SheetInvoiceRecord,
          };
        }
        return row;
      });
      return { ...prev, rows: updatedRows };
    });

    const tabTitle = updatedInvoice.sheetTitle || selectedProject.activeSheetTab;
    await updateInvoiceInSheet(
      token,
      selectedProject.spreadsheetId,
      tabTitle,
      updatedInvoice.rowIndex,
      updatedInvoice,
      updatedInvoice.rawRowData
    );

    // Refresh invoices list to ensure 100% parity with Google Sheets
    await loadProjectInvoices(token, selectedProject.spreadsheetId, tabTitle);
  };

  const handleApplySpreadsheetStyling = async () => {
    if (!token || !selectedProject?.spreadsheetId) return;
    setIsStylingSheet(true);
    try {
      await applySpreadsheetStyling(token, selectedProject.spreadsheetId);
      setStyleSuccessMessage('¡Encabezado decorado y formato de pesos ($) aplicados con éxito en Google Sheets!');
      setTimeout(() => setStyleSuccessMessage(null), 5000);
      await loadProjectInvoices(token, selectedProject.spreadsheetId);
    } catch (err: any) {
      console.error('Error aplicando formato a Google Sheets:', err);
      setGlobalError('Error aplicando formato a Google Sheets: ' + err.message);
    } finally {
      setIsStylingSheet(false);
    }
  };

  // Delete invoice record from Google Sheets and corresponding file from Google Drive
  const handleDeleteInvoice = async (invoice: SheetInvoiceRecord) => {
    if (!token || !selectedProject?.spreadsheetId) {
      throw new Error('Faltan credenciales de acceso o la obra no tiene hoja de cálculo vinculada.');
    }

    const evidenceFolderId = selectedProject.evidenceFolderId || selectedProject.id;
    const result = await deleteInvoiceRecord(
      token,
      selectedProject.spreadsheetId,
      invoice,
      evidenceFolderId
    );

    if (!result.sheetSuccess) {
      throw new Error(result.details || 'No se pudo eliminar la fila de la factura en Google Sheets.');
    }

    // Optimistically update local table state
    setProjectInvoices((prev) =>
      prev.filter((item) => {
        const matchesDriveUrl =
          Boolean(invoice.driveFileUrl) && item.driveFileUrl === invoice.driveFileUrl;
        const matchesDoc =
          Boolean(invoice.invoiceNumber) &&
          item.invoiceNumber === invoice.invoiceNumber &&
          item.vendorName === invoice.vendorName;
        const matchesRow = Boolean(invoice.rowIndex) && item.rowIndex === invoice.rowIndex;

        return !(matchesDriveUrl || matchesDoc || matchesRow);
      })
    );

    // Refresh from Google Sheets to guarantee 100% row index and data synchronization
    loadProjectInvoices(token, selectedProject.spreadsheetId);

    setDeleteSuccessMessage(
      `Factura ${invoice.invoiceNumber ? `"${invoice.invoiceNumber}"` : ''} eliminada con éxito de Google Sheets y Google Drive.`
    );
    setTimeout(() => setDeleteSuccessMessage(null), 6000);
  };

  // Delete dynamic row directly from Google Sheets
  const handleDeleteDynamicRow = async (sheetTitle: string, rowIndex: number) => {
    if (!token || !selectedProject?.spreadsheetId) {
      throw new Error('Faltan credenciales de acceso o la obra no tiene hoja de cálculo vinculada.');
    }
    await deleteDynamicSheetRow(token, selectedProject.spreadsheetId, sheetTitle, rowIndex);
    setDeleteSuccessMessage(`Fila ${rowIndex} eliminada con éxito de la pestaña "${sheetTitle}".`);
    setTimeout(() => setDeleteSuccessMessage(null), 5000);
    await loadProjectInvoices(token, selectedProject.spreadsheetId, sheetTitle);
  };

  // Handle switching active tab in the spreadsheet
  const handleSelectTab = async (tabTitle: string) => {
    if (!token || !selectedProject?.spreadsheetId) return;
    const updatedProject: ProjectFolder = {
      ...selectedProject,
      activeSheetTab: tabTitle,
    };
    setSelectedProject(updatedProject);
    setProjects((prev) =>
      prev.map((p) => (p.id === selectedProject.id ? updatedProject : p))
    );
    await loadProjectInvoices(token, selectedProject.spreadsheetId, tabTitle);
  };

  // Exportar facturas procesadas a Google Sheets con logo infalible en A1:E3 y paleta corporativa SVH
  const [isExportingStyled, setIsExportingStyled] = useState(false);
  const handleExportToSheetsWithStyling = async (): Promise<{ spreadsheetUrl?: string } | void> => {
    if (!token || !selectedProject) {
      throw new Error('Faltan credenciales de Google o el proyecto no está seleccionado.');
    }
    setIsExportingStyled(true);
    setGlobalError(null);
    try {
      const response = await fetch('/api/export-invoices-styled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invoices: projectInvoices,
          folderId: selectedProject.evidenceFolderId || selectedProject.id,
          spreadsheetId: selectedProject.spreadsheetId,
          sheetTitle: selectedProject.activeSheetTab || 'Control Facturas',
          projectName: selectedProject.name,
        }),
      });

      const resData = await response.json();
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Error en el servidor al exportar facturas.');
      }

      if (resData.spreadsheetId && resData.spreadsheetId !== selectedProject.spreadsheetId) {
        const updated: ProjectFolder = {
          ...selectedProject,
          spreadsheetId: resData.spreadsheetId,
          spreadsheetUrl: resData.spreadsheetUrl,
        };
        setSelectedProject(updated);
        setProjects((prev) => prev.map((p) => (p.id === selectedProject.id ? updated : p)));
        if (user) {
          updateProjectInFirestore(user.uid, updated.id, updated).catch(console.warn);
        }
      }

      // Recargar datos actualizados
      if (resData.spreadsheetId) {
        await loadProjectInvoices(token, resData.spreadsheetId, selectedProject.activeSheetTab);
      }

      return { spreadsheetUrl: resData.spreadsheetUrl };
    } finally {
      setIsExportingStyled(false);
    }
  };

  const facturasPorRevisarCountSidebar = countFacturasPorRevisar(facturasSismo);

  if (isAuditoriaOpen) {
    return (
      <AuditoriaScreen
        onBackToApp={() => {
          setIsAuditoriaOpen(false);
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/');
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      {/* Top Navigation en Móvil y Tablet (< 1024px) o cuando no hay usuario autenticado */}
      <div className={user ? 'lg:hidden' : 'block'}>
        <Navbar
          user={user}
          onLogin={handleLogin}
          onLogout={handleLogout}
          onSwitchAccount={handleSwitchAccount}
          onAddAccount={handleAddAccount}
          isLoggingIn={isLoggingIn}
          activeProjectName={selectedProject?.name}
          driveConnected={!!token}
          onOpenObraSelector={() => setIsObraSelectorOpen(true)}
          onOpenGuide={() => setIsGuideModalOpen(true)}
        />
      </div>

      <div className="flex-1 flex w-full">
        {/* MENÚ LATERAL IZQUIERDO COMPUTADOR (≥ 1024px) */}
        {user && (
          <aside className="hidden lg:flex w-64 shrink-0 bg-white border-r border-slate-200/90 flex-col justify-between sticky top-0 h-screen overflow-y-auto shadow-2xs z-30">
            {/* Top Brand & Obra Selector */}
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <SvhLogo size="md" showSubtitle={true} />
              </div>

              {/* Selector de Obra Arriba */}
              <div className="pt-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Obra Activa en Drive
                </label>
                <button
                  type="button"
                  id="btn-sidebar-obra-selector"
                  onClick={() => setIsObraSelectorOpen(true)}
                  className="w-full flex items-center justify-between p-3 rounded-[14px] bg-[#0F766E]/5 hover:bg-[#0F766E]/10 border border-[#0F766E]/20 text-[#0F766E] transition-all cursor-pointer group text-left shadow-2xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold truncate">
                      {selectedProject?.name || 'Seleccionar Obra'}
                    </p>
                    <span className="text-[10px] text-slate-500 truncate block">
                      {selectedProject?.spreadsheetName ? 'Hoja conectada' : 'Toca para cambiar'}
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 shrink-0 text-[#0F766E] group-hover:translate-y-0.5 transition-transform" />
                </button>
              </div>

              {/* Menú Lateral de Módulos */}
              <nav className="space-y-1 pt-2">
                {/* 1. Resumen */}
                <button
                  type="button"
                  id="sidebar-nav-resumen"
                  onClick={() => setActiveModule('resumen')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold transition-all cursor-pointer ${
                    activeModule === 'resumen'
                      ? 'bg-[#0F766E] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 shrink-0" />
                  <span>Resumen</span>
                </button>

                {/* 2. Facturas */}
                <button
                  type="button"
                  id="sidebar-nav-facturas"
                  onClick={() => setActiveModule('facturas')}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-[12px] text-xs font-bold transition-all cursor-pointer ${
                    activeModule === 'facturas' || activeModule === 'invoices'
                      ? 'bg-[#0F766E] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Receipt className="w-4 h-4 shrink-0" />
                    <span>Facturas</span>
                  </div>
                  {facturasPorRevisarCountSidebar > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      activeModule === 'facturas' || activeModule === 'invoices'
                        ? 'bg-amber-400 text-slate-900'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {facturasPorRevisarCountSidebar}
                    </span>
                  )}
                </button>

                {/* 3. Mano de Obra */}
                <button
                  type="button"
                  id="sidebar-nav-mano-obra"
                  onClick={() => setActiveModule('mano_de_obra')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold transition-all cursor-pointer ${
                    activeModule === 'mano_de_obra' || activeModule === 'payroll'
                      ? 'bg-[#0F766E] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <HardHat className="w-4 h-4 shrink-0" />
                  <span>Mano de Obra</span>
                </button>

                {/* 4. Nóminas */}
                <button
                  type="button"
                  id="sidebar-nav-nominas"
                  onClick={() => setActiveModule('nominas')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold transition-all cursor-pointer ${
                    activeModule === 'nominas'
                      ? 'bg-[#0F766E] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  <span>Nóminas</span>
                </button>

                {/* 5. Inventario */}
                <button
                  type="button"
                  id="sidebar-nav-inventario"
                  onClick={() => setActiveModule('inventario')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold transition-all cursor-pointer ${
                    activeModule === 'inventario'
                      ? 'bg-[#0F766E] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Package className="w-4 h-4 shrink-0" />
                  <span>Inventario</span>
                </button>

                {/* 6. Abonos */}
                <button
                  type="button"
                  id="sidebar-nav-abonos"
                  onClick={() => setActiveModule('abonos')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold transition-all cursor-pointer ${
                    activeModule === 'abonos'
                      ? 'bg-[#0F766E] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <PiggyBank className="w-4 h-4 shrink-0" />
                  <span>Abonos</span>
                </button>

                <div className="pt-2 pb-1 border-t border-slate-100 my-1" />

                {/* 7. Catálogo de Personal */}
                <button
                  type="button"
                  id="sidebar-nav-workers"
                  onClick={() => setIsWorkersCatalogOpen(true)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                >
                  <Users className="w-4 h-4 shrink-0 text-indigo-600" />
                  <span>Catálogo Personal</span>
                </button>

                {/* 8. Exportar a Excel */}
                <button
                  type="button"
                  id="sidebar-nav-excel"
                  onClick={handleExportExcel}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold text-emerald-800 hover:bg-emerald-50 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>Exportar a Excel</span>
                </button>

                {/* 9. Guía */}
                <button
                  type="button"
                  id="sidebar-nav-guia"
                  onClick={() => setIsGuideModalOpen(true)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                >
                  <BookOpen className="w-4 h-4 shrink-0 text-[#0F766E]" />
                  <span>Guía del Sistema</span>
                </button>
              </nav>
            </div>

            {/* Bottom Profile / Account */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 space-y-3">
              <div className="flex items-center gap-2.5">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Usuario'}
                    className="w-8 h-8 rounded-full border border-slate-200 object-cover shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#0F766E] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {user.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900 truncate">
                    {user.displayName || user.email?.split('@')[0]}
                  </p>
                  <span className="text-[10px] text-emerald-700 flex items-center gap-1 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Drive &amp; Sheets
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-[11px] font-semibold text-slate-500">
                <button
                  type="button"
                  onClick={handleSwitchAccount}
                  className="hover:text-slate-800 transition-colors cursor-pointer"
                >
                  Cambiar cuenta
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-rose-600 hover:text-rose-700 transition-colors cursor-pointer"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* Main Content Area (Spacious max 1200px on desktop) */}
        <main className="flex-1 min-w-0 w-full max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-28 lg:pb-10 overflow-x-hidden">
        {/* Global Error Banner */}
        {globalError && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-sm text-rose-800 animate-in fade-in">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold">Atención: </span>
              <span>{globalError}</span>

              {/* Botón para renovar sesión de Google directamente desde cualquier pantalla */}
              {(isGoogleAuthExpired || globalError?.includes('Renovar Conexión Google') || globalError?.includes('ha expirado')) && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleRefreshToken}
                    disabled={isLoggingIn}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[#1ca330] hover:bg-[#158025] text-white rounded-lg text-xs font-bold shadow-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isLoggingIn ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Renovando credenciales de Google...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Renovar Conexión Google</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {currentImageBase64 && !isAnalyzing && !isGoogleAuthExpired && (
                <div className="mt-2">
                  <button
                    id="btn-retry-invoice-analysis"
                    onClick={() => handleAnalyzeInvoice(currentImageBase64, currentMimeType)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Reintentar análisis con IA</span>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setGlobalError(null)}
              className="text-rose-500 hover:text-rose-700 text-xs font-semibold"
            >
              Cerrar
            </button>
          </div>
        )}

        {!user ? (
          /* Unauthenticated Landing / Connect Screen */
          <div className="max-w-3xl mx-auto py-8 sm:py-12">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden text-center p-8 sm:p-12">
              <div className="flex justify-center mb-6">
                <SvhLogo size="xl" showSubtitle={true} />
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-serif">
                SVH Arquitectos Facturas
              </h1>

              <p className="mt-3 text-sm sm:text-base text-slate-600 max-w-xl mx-auto leading-relaxed">
                Control y archivo automatizado de facturas por proyecto de obra. Sube la foto de la factura y el sistema la archivará en tu <strong>Google Drive</strong> y registrará la partida contable en <strong>Google Sheets</strong>.
              </p>

              {/* 3 Step Flow */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8 text-left">
                <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200">
                  <div className="w-8 h-8 rounded-lg bg-[#1ca330]/15 text-[#157a24] flex items-center justify-center font-bold text-sm mb-2.5">
                    1
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase">Organización Drive</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Carpetas de evidencias configurables o automáticas por obra.
                  </p>
                </div>

                <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200">
                  <div className="w-8 h-8 rounded-lg bg-[#98d52c]/25 text-[#305e0c] flex items-center justify-center font-bold text-sm mb-2.5">
                    2
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase">Extracción con IA</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Lectura óptica inteligente de proveedor, NIF, importes e IVA.
                  </p>
                </div>

                <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200">
                  <div className="w-8 h-8 rounded-lg bg-[#1ca330]/15 text-[#157a24] flex items-center justify-center font-bold text-sm mb-2.5">
                    3
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase">Google Sheets</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Inserta fila con importes, fecha y enlace directo a la factura.
                  </p>
                </div>
              </div>

              {/* Login CTA Button */}
              <div className="pt-2">
                <button
                  id="btn-login-main-hero"
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  className="inline-flex items-center gap-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-6 py-3.5 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-60 text-sm"
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-[#98d52c]" />
                      <span>Conectando con Google...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 48 48">
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        ></path>
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        ></path>
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        ></path>
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        ></path>
                      </svg>
                      <span>Iniciar sesión con Google para comenzar</span>
                    </>
                  )}
                </button>
                <p className="text-xs text-slate-400 mt-3">
                  Permite gestionar las carpetas de obra en tu Drive y sincronizar con tus hojas de cálculo.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Authenticated Dashboard View */
          <div className="space-y-6">
            {/* Success notification if an invoice was saved */}
            {successData && (
              <UploadSuccessBanner
                driveUrl={successData.driveUrl}
                sheetUrl={successData.sheetUrl}
                fileName={successData.fileName}
                projectName={successData.projectName}
                onDismiss={() => setSuccessData(null)}
                onAddMore={() => {
                  const btn = document.getElementById('btn-add-more-invoices') || document.getElementById('dropzone-invoice');
                  btn?.scrollIntoView({ behavior: 'smooth' });
                  const fileInput = document.querySelector<HTMLInputElement>('#invoice-uploader-container input[type="file"]');
                  fileInput?.click();
                }}
              />
            )}

            {/* Step 1: Active Project of Work with Destination Configuration */}
            <ProjectSelector
              projects={projects}
              selectedProject={selectedProject}
              onSelectProject={handleSelectProject}
              onOpenNewProject={() => setIsNewProjectModalOpen(true)}
              isLoadingProjects={isLoadingProjects}
              onOpenConfig={() => setIsConfigModalOpen(true)}
              onDeleteProject={handleDeleteProject}
              onRenameProject={handleRenameProject}
            />

            {/* Módulo Navigation Switcher (6 módulos completos del Arquitecto) */}
            {selectedProject && (
              <div className="flex items-center justify-between p-1.5 bg-slate-100/90 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-2xs w-full max-w-4xl overflow-x-auto scrollbar-none gap-1">
                <button
                  type="button"
                  id="tab-module-resumen"
                  onClick={() => setActiveModule('resumen')}
                  className={`flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === 'resumen'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <LayoutDashboard className={`w-4 h-4 shrink-0 ${activeModule === 'resumen' ? 'text-[#0F766E]' : 'text-slate-400'}`} />
                  <span>Resumen</span>
                </button>

                <button
                  type="button"
                  id="tab-module-facturas"
                  onClick={() => setActiveModule('facturas')}
                  className={`flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all relative ${
                    activeModule === 'facturas' || activeModule === 'invoices'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Receipt className={`w-4 h-4 shrink-0 ${activeModule === 'facturas' || activeModule === 'invoices' ? 'text-[#0F766E]' : 'text-slate-400'}`} />
                  <span>Facturas</span>
                  {countFacturasPorRevisar(facturasSismo) > 0 && (
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  )}
                </button>

                <button
                  type="button"
                  id="tab-module-mano-obra"
                  onClick={() => setActiveModule('mano_de_obra')}
                  className={`flex-1 min-w-[95px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === 'mano_de_obra' || activeModule === 'payroll'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <HardHat className={`w-4 h-4 shrink-0 ${activeModule === 'mano_de_obra' || activeModule === 'payroll' ? 'text-[#0F766E]' : 'text-slate-400'}`} />
                  <span>Mano de Obra</span>
                </button>

                <button
                  type="button"
                  id="tab-module-nominas"
                  onClick={() => setActiveModule('nominas')}
                  className={`flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === 'nominas'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FileSpreadsheet className={`w-4 h-4 shrink-0 ${activeModule === 'nominas' ? 'text-[#0F766E]' : 'text-slate-400'}`} />
                  <span>Nóminas</span>
                </button>

                <button
                  type="button"
                  id="tab-module-inventario"
                  onClick={() => setActiveModule('inventario')}
                  className={`flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === 'inventario' || activeModule === 'inventory'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Package className={`w-4 h-4 shrink-0 ${activeModule === 'inventario' || activeModule === 'inventory' ? 'text-[#0F766E]' : 'text-slate-400'}`} />
                  <span>Inventario</span>
                </button>

                <button
                  type="button"
                  id="tab-module-abonos"
                  onClick={() => setActiveModule('abonos')}
                  className={`flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === 'abonos'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <PiggyBank className={`w-4 h-4 shrink-0 ${activeModule === 'abonos' ? 'text-[#0F766E]' : 'text-slate-400'}`} />
                  <span>Abonos</span>
                </button>
              </div>
            )}

            {/* VISTA 0: Resumen General / Cuadro de Costos */}
            {activeModule === 'resumen' && (
              <OverviewDashboard
                project={selectedProject}
                facturas={facturasSismo}
                bitacoras={bitacoras}
                nominas={nominas}
                inventario={inventarioItems}
                abonos={abonosItems}
                onNavigateToSection={(section) => setActiveModule(section as AppModule)}
                onOpenUploadModal={() => setIsUploadInvoicesModalOpen(true)}
                onOpenObraSelector={() => setIsObraSelectorOpen(true)}
                onOpenCatalog={() => setIsWorkersCatalogOpen(true)}
                onExportExcel={handleExportExcel}
              />
            )}

            {/* VISTA 1: Facturas ("ADECUACIONES SISMO") */}
            {(activeModule === 'facturas' || activeModule === 'invoices') && (
              <FacturasSismoSection
                project={selectedProject}
                facturas={facturasSismo}
                onSaveFactura={handleSaveFacturaSismo}
                onDeleteFactura={handleDeleteFacturaSismo}
                onOpenUploadScanModal={() => setIsUploadInvoicesModalOpen(true)}
                onAddToInventory={handleAddToInventory}
              />
            )}

            {/* VISTA 2: Mano de Obra (Bitácoras) */}
            {(activeModule === 'mano_de_obra' || activeModule === 'payroll') && (
              <ManoDeObraSection
                project={selectedProject}
                bitacoras={bitacoras}
                workers={workers}
                onSaveBitacora={handleSaveBitacora}
                onDeleteBitacora={handleDeleteBitacora}
                onOpenCatalog={() => setIsWorkersCatalogOpen(true)}
              />
            )}

            {/* VISTA 3: Nóminas Quincenales */}
            {activeModule === 'nominas' && (
              <NominasSection
                project={selectedProject}
                nominas={nominas}
                workers={workers}
                settings={payrollSettings}
                onSaveNomina={handleSaveNomina}
                onDeleteNomina={handleDeleteNomina}
                onSaveSettings={handleSavePayrollSettings}
                onOpenCatalog={() => setIsWorkersCatalogOpen(true)}
              />
            )}

            {/* VISTA 4: Inventario de Obra */}
            {(activeModule === 'inventario' || activeModule === 'inventory') && (
              <InventorySection
                project={selectedProject}
                items={inventarioItems}
                onSaveItem={handleSaveInventarioItem}
                onDeleteItem={handleDeleteInventarioItem}
              />
            )}

            {/* VISTA 5: Abonos de Cliente */}
            {activeModule === 'abonos' && (
              <AbonosSection
                project={selectedProject}
                abonos={abonosItems}
                onSaveAbono={handleSaveAbono}
                onDeleteAbono={handleDeleteAbono}
              />
            )}
          </div>
        )}
      </main>
      </div>

      {/* New Project Modal with Custom Drive Location and Sheet */}
      {isNewProjectModalOpen && token && (
        <NewProjectModal
          isOpen={isNewProjectModalOpen}
          onClose={() => setIsNewProjectModalOpen(false)}
          accessToken={token}
          onProjectCreated={handleProjectCreated}
        />
      )}

      {/* Project Custom Storage Configuration Modal */}
      {isConfigModalOpen && selectedProject && token && (
        <ProjectConfigModal
          isOpen={isConfigModalOpen}
          onClose={() => setIsConfigModalOpen(false)}
          project={selectedProject}
          accessToken={token}
          onSaveConfig={handleSaveProjectConfig}
        />
      )}

      {/* Mandatory User Confirmation & Review Modal */}
      {isReviewOpen && extractedInvoice && selectedProject && (
        <InvoiceReviewModal
          isOpen={isReviewOpen}
          onClose={() => setIsReviewOpen(false)}
          onConfirm={handleConfirmAndSave}
          initialData={extractedInvoice}
          project={selectedProject}
          fileName={currentFileName}
          isSaving={isSavingToWorkspace}
          onAddToInventory={handleAddToInventory}
        />
      )}

      {/* Modal de Análisis de Facturas de Drive (Detección de Nuevas vs Ya Leídas y Prevención de Duplicados) */}
      {isDriveInvoiceSyncModalOpen && selectedProject && token && (
        <DriveInvoicesSyncModal
          isOpen={isDriveInvoiceSyncModalOpen}
          onClose={() => setIsDriveInvoiceSyncModalOpen(false)}
          project={selectedProject}
          accessToken={token}
          existingInvoices={projectInvoices}
          activeTab={dynamicAnalysis?.activeTab || selectedProject.activeSheetTab}
          onSyncComplete={async (addedCount) => {
            if (token && selectedProject.spreadsheetId) {
              await loadProjectInvoices(
                token,
                selectedProject.spreadsheetId,
                dynamicAnalysis?.activeTab || selectedProject.activeSheetTab
              );
            }
            setDeleteSuccessMessage(
              `¡Análisis completado! Se agregaron ${addedCount} facturas nuevas a Google Sheets sin duplicados.`
            );
            setTimeout(() => setDeleteSuccessMessage(null), 6000);
          }}
        />
      )}

      {/* Selector de Obras (Hoja inferior al 85% de alto en celular, diálogo en computador) */}
      <ObraSelectorSheet
        isOpen={isObraSelectorOpen}
        onClose={() => setIsObraSelectorOpen(false)}
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={handleSelectProject}
        onOpenNewProjectModal={() => setIsNewProjectModalOpen(true)}
      />

      {/* Modal de Subida de Facturas en Segundo Plano */}
      {isUploadInvoicesModalOpen && selectedProject && (
        <UploadInvoicesModal
          isOpen={isUploadInvoicesModalOpen}
          onClose={() => setIsUploadInvoicesModalOpen(false)}
          project={selectedProject}
          accessToken={token || undefined}
          onInvoiceCompleted={() => {
            if (token && selectedProject.spreadsheetId) {
              loadProjectInvoices(
                token,
                selectedProject.spreadsheetId,
                dynamicAnalysis?.activeTab || selectedProject.activeSheetTab
              );
            }
          }}
        />
      )}

      {/* Guía Integrada del Sistema */}
      <GuideModal
        isOpen={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
      />

      {/* Catálogo de Trabajadores Modal (Compartido por Mano de Obra y Nóminas) */}
      <WorkersCatalogModal
        isOpen={isWorkersCatalogOpen}
        onClose={() => setIsWorkersCatalogOpen(false)}
        workers={workers}
        onSaveWorker={handleSaveWorker}
        onDeleteWorker={handleDeleteWorker}
      />

      {/* Mobile Fixed Bottom Navigation Bar (< 1024px) */}
      {user && (
        <nav
          id="mobile-bottom-navbar"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-lg px-2 py-1"
        >
          <div className="flex items-center justify-around">
            <button
              type="button"
              id="mobile-nav-resumen"
              onClick={() => setActiveModule('resumen')}
              className={`flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all min-h-[48px] touch-target-48 cursor-pointer ${
                activeModule === 'resumen' ? 'text-[#0F766E] font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <LayoutDashboard className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">Resumen</span>
            </button>

            <button
              type="button"
              id="mobile-nav-facturas"
              onClick={() => setActiveModule('facturas')}
              className={`relative flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all min-h-[48px] touch-target-48 cursor-pointer ${
                activeModule === 'facturas' || activeModule === 'invoices' ? 'text-[#0F766E] font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <Receipt className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">Facturas</span>
              {countFacturasPorRevisar(facturasSismo) > 0 && (
                <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-amber-500" />
              )}
            </button>

            <button
              type="button"
              id="mobile-nav-mano-obra"
              onClick={() => setActiveModule('mano_de_obra')}
              className={`flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all min-h-[48px] touch-target-48 cursor-pointer ${
                activeModule === 'mano_de_obra' || activeModule === 'payroll' ? 'text-[#0F766E] font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <HardHat className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">M. Obra</span>
            </button>

            <button
              type="button"
              id="mobile-nav-nominas"
              onClick={() => setActiveModule('nominas')}
              className={`flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all min-h-[48px] touch-target-48 cursor-pointer ${
                activeModule === 'nominas' ? 'text-[#0F766E] font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <FileSpreadsheet className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">Nóminas</span>
            </button>

            <button
              type="button"
              id="mobile-nav-inventario"
              onClick={() => setActiveModule('inventario')}
              className={`flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all min-h-[48px] touch-target-48 cursor-pointer ${
                activeModule === 'inventario' || activeModule === 'inventory' ? 'text-[#0F766E] font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <Package className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">Inventario</span>
            </button>

            <button
              type="button"
              id="mobile-nav-abonos"
              onClick={() => setActiveModule('abonos')}
              className={`flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all min-h-[48px] touch-target-48 cursor-pointer ${
                activeModule === 'abonos' ? 'text-[#0F766E] font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <PiggyBank className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">Abonos</span>
            </button>
          </div>
        </nav>
      )}

      {/* Botón Flotante Contextual (+) en Móvil */}
      {user && (
        <button
          type="button"
          id="btn-contextual-fab"
          onClick={() => {
            if (activeModule === 'facturas' || activeModule === 'invoices' || activeModule === 'resumen') {
              setIsUploadInvoicesModalOpen(true);
            } else if (activeModule === 'abonos') {
              const btn = document.getElementById('btn-nuevo-abono');
              if (btn) btn.click();
              else setActiveModule('abonos');
            } else if (activeModule === 'mano_de_obra' || activeModule === 'payroll') {
              const btn = document.getElementById('btn-nueva-bitacora');
              if (btn) btn.click();
              else setActiveModule('mano_de_obra');
            } else if (activeModule === 'nominas') {
              const btn = document.getElementById('btn-nueva-nomina');
              if (btn) btn.click();
              else setActiveModule('nominas');
            } else if (activeModule === 'inventario' || activeModule === 'inventory') {
              const btn = document.getElementById('btn-nuevo-material-inventario');
              if (btn) btn.click();
              else setActiveModule('inventario');
            } else {
              setIsUploadInvoicesModalOpen(true);
            }
          }}
          className="lg:hidden fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-[#0F766E] hover:bg-[#0d655f] text-white shadow-xl flex items-center justify-center transition-all active:scale-95 cursor-pointer border-2 border-white"
          title="Acción rápida"
        >
          <Plus className="w-7 h-7" />
        </button>
      )}

      {/* Toast de Deshacer eliminación (8 segundos) */}
      <UndoToast action={undoAction} onDismiss={() => setUndoAction(null)} />

      {/* Toast de confirmación de acción / eliminación */}
      {deleteSuccessMessage && (
        <div className="fixed bottom-24 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-md animate-in slide-in-from-bottom duration-200">
          <div className="bg-emerald-950 text-white rounded-2xl p-4 shadow-2xl border border-emerald-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-xs font-medium text-emerald-100 truncate">
                {deleteSuccessMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteSuccessMessage(null)}
              className="text-emerald-300 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-500 text-xs py-5 border-t border-slate-800 text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>Automatización de Facturas para Obras y Construcción</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setIsAuditoriaOpen(true);
                if (typeof window !== 'undefined') {
                  window.history.pushState({}, '', '/auditoria');
                }
              }}
              className="text-slate-400 hover:text-white transition-colors underline cursor-pointer text-[11px]"
            >
              Auditoría Técnica (/auditoria)
            </button>
            <span>Integrado con Google Drive, Google Sheets &amp; Gemini 3.8 Flash</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
