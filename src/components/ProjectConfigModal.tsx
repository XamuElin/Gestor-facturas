import React, { useState, useEffect } from 'react';
import { ProjectFolder, ProjectWorkspaceConfig, SheetTabInfo } from '../types';
import {
  searchDriveFolders,
  searchDriveSpreadsheets,
  createDriveFolder,
  createCustomSpreadsheet,
  ensureSheetHeaders,
  getSpreadsheetTabs,
  getTabHeaders,
} from '../services/googleDriveSheets';
import { googleSignIn } from '../services/firebaseAuth';
import { ParentFolderPicker } from './ParentFolderPicker';
import { DriveFolderNavigator } from './DriveFolderNavigator';
import { buildProjectSpreadsheetTitle } from '../utils/duplicateChecker';
import { EditFacturacionModal } from './EditFacturacionModal';
import {
  FolderOpen,
  FileSpreadsheet,
  Search,
  Check,
  ExternalLink,
  X,
  Loader2,
  FolderPlus,
  FilePlus,
  AlertCircle,
  Table,
  CheckCircle2,
  FolderKanban,
  CheckCheck,
  Minus,
  Maximize2,
  Minimize2,
  Sliders,
  Pencil,
  RotateCcw,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { getObraRecordCounts } from '../services/constructionDbService';

interface ProjectConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectFolder;
  accessToken: string;
  onSaveConfig: (updatedConfig: ProjectWorkspaceConfig) => Promise<void>;
  onVaciarObra?: (deleteDriveFiles: boolean) => Promise<void>;
  onEliminarObra?: (deleteDriveFiles: boolean) => Promise<void>;
}

export const ProjectConfigModal: React.FC<ProjectConfigModalProps> = ({
  isOpen,
  onClose,
  project,
  accessToken,
  onSaveConfig,
  onVaciarObra,
  onEliminarObra,
}) => {
  const [projectName, setProjectName] = useState(project.name || '');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);

  // Danger Zone states
  const [recordCounts, setRecordCounts] = useState({
    totalRecords: 0,
    facturas: 0,
    bitacoras: 0,
    nominas: 0,
    workers: 0,
    inventario: 0,
    abonos: 0,
  });
  const [isDangerDialogOpen, setIsDangerDialogOpen] = useState(false);
  const [dangerAction, setDangerAction] = useState<'vaciar' | 'eliminar'>('vaciar');
  const [typedProjectName, setTypedProjectName] = useState('');
  const [deleteDriveChecked, setDeleteDriveChecked] = useState(false);
  const [isExecutingDanger, setIsExecutingDanger] = useState(false);
  const [dangerError, setDangerError] = useState<string | null>(null);

  const [activeAccessToken, setActiveAccessToken] = useState<string>(() => {
    if (accessToken) return accessToken;
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('svh_google_access_token') || '';
    }
    return '';
  });
  const [isRenewingAuth, setIsRenewingAuth] = useState(false);

  useEffect(() => {
    if (accessToken) {
      setActiveAccessToken(accessToken);
    }
  }, [accessToken]);

  useEffect(() => {
    const handleTokenRefreshed = (e: Event) => {
      const customEvent = e as CustomEvent<{ token: string }>;
      if (customEvent.detail?.token) {
        setActiveAccessToken(customEvent.detail.token);
        setErrorMsg(null);
      }
    };
    window.addEventListener('svh_google_token_refreshed', handleTokenRefreshed);
    return () => window.removeEventListener('svh_google_token_refreshed', handleTokenRefreshed);
  }, []);

  const handleRenewGoogleConnection = async () => {
    setIsRenewingAuth(true);
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setActiveAccessToken(res.accessToken);
        setErrorMsg(null);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('svh_google_token_refreshed', {
              detail: { token: res.accessToken, user: res.user },
            })
          );
        }
      }
    } catch (e) {
      console.warn('Error renovando sesión desde modal:', e);
    } finally {
      setIsRenewingAuth(false);
    }
  };

  useEffect(() => {
    if (project?.id) {
      getObraRecordCounts(project.id).then(setRecordCounts).catch(() => {});
    }
  }, [project?.id]);

  // Current active targets
  const [evidenceFolderId, setEvidenceFolderId] = useState(
    project.evidenceFolderId || project.id
  );
  const [evidenceFolderName, setEvidenceFolderName] = useState(
    project.evidenceFolderName || project.name
  );
  const [evidenceFolderUrl, setEvidenceFolderUrl] = useState(
    project.evidenceFolderUrl || project.webViewLink
  );
  const [evidenceParentName, setEvidenceParentName] = useState(
    project.evidenceParentName || project.baseLocationName || 'Carpeta del proyecto'
  );

  const [spreadsheetId, setSpreadsheetId] = useState(
    project.spreadsheetId || ''
  );
  const [spreadsheetName, setSpreadsheetName] = useState(
    project.spreadsheetName || ''
  );
  const [spreadsheetUrl, setSpreadsheetUrl] = useState(
    project.spreadsheetUrl || ''
  );
  const [spreadsheetParentName, setSpreadsheetParentName] = useState(
    project.spreadsheetParentName || 'Carpeta del proyecto'
  );

  // Sheet tabs and structure
  const [activeSheetTab, setActiveSheetTab] = useState<string>(
    project.activeSheetTab || ''
  );
  const [detectedTabs, setDetectedTabs] = useState<SheetTabInfo[]>(
    project.detectedTabs || []
  );
  const [tabHeaders, setTabHeaders] = useState<string[]>([]);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);
  const [isEditFacturacionOpen, setIsEditFacturacionOpen] = useState(false);

  // Cerrar modal automáticamente cuando se ejecuta una hoja desde el navegador
  useEffect(() => {
    const handleClose = () => onClose();
    window.addEventListener('svh:execute-sheet', handleClose);
    return () => window.removeEventListener('svh:execute-sheet', handleClose);
  }, [onClose]);

  // Folder mode: 'select' (existing) or 'create' (new)
  const [folderMode, setFolderMode] = useState<'select' | 'create'>('select');
  const [newFolderParentId, setNewFolderParentId] = useState(
    project.baseFolderId || project.id || 'root'
  );
  const [newFolderParentName, setNewFolderParentName] = useState(
    project.baseLocationName || project.name || 'Mi Unidad (Raíz de Drive)'
  );
  const [newFolderName, setNewFolderName] = useState(
    `Evidencias_${project.name.replace(/[:\/\\?*|"]/g, '_')}`
  );
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Sheet mode: 'select' (existing) or 'create' (new)
  const [sheetMode, setSheetMode] = useState<'select' | 'create'>('select');
  const [sheetSearch, setSheetSearch] = useState('');
  const [driveSheets, setDriveSheets] = useState<
    { id: string; name: string; webViewLink?: string }[]
  >([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [newSheetTitle, setNewSheetTitle] = useState(
    buildProjectSpreadsheetTitle(project.name)
  );
  const [newSheetParentId, setNewSheetParentId] = useState(
    project.id || 'root'
  );
  const [newSheetParentName, setNewSheetParentName] = useState(
    project.name || 'Mi Unidad (Raíz de Drive)'
  );
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load spreadsheets when modal is open
  useEffect(() => {
    if (!isOpen || !activeAccessToken) return;
    const fetchSheets = async () => {
      setIsLoadingSheets(true);
      try {
        const results = await searchDriveSpreadsheets(activeAccessToken, sheetSearch);
        setDriveSheets(results);
        setErrorMsg(null);
      } catch (err: any) {
        console.error('Error buscando hojas de cálculo:', err);
        const errMsg = String(err?.message || '');
        if (
          err?.status === 401 ||
          err?.isAuthError ||
          errMsg.includes('401') ||
          errMsg.includes('invalid authentication credentials') ||
          errMsg.includes('Expected OAuth 2') ||
          errMsg.includes('expirada')
        ) {
          setErrorMsg('Tu sesión con Google Drive ha expirado. Por favor, pulsa en "Renovar Conexión Google".');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('svh_google_auth_expired'));
          }
        }
      } finally {
        setIsLoadingSheets(false);
      }
    };

    const timeout = setTimeout(fetchSheets, 300);
    return () => clearTimeout(timeout);
  }, [isOpen, activeAccessToken, sheetSearch]);

  // Load tabs whenever spreadsheetId changes
  useEffect(() => {
    if (!isOpen || !activeAccessToken || !spreadsheetId) return;
    let isCancelled = false;

    const loadTabs = async () => {
      setIsLoadingTabs(true);
      try {
        const tabs = await getSpreadsheetTabs(activeAccessToken, spreadsheetId);
        if (isCancelled) return;
        setDetectedTabs(tabs);
        let tabToUse = activeSheetTab;
        if (!tabToUse || !tabs.some((t) => t.title === tabToUse)) {
          tabToUse = tabs[0]?.title || 'Hoja1';
          setActiveSheetTab(tabToUse);
        }
        if (tabToUse) {
          const headers = await getTabHeaders(activeAccessToken, spreadsheetId, tabToUse);
          if (!isCancelled) setTabHeaders(headers);
        }
      } catch (err) {
        console.warn('Error cargando pestañas de la hoja de cálculo:', err);
      } finally {
        if (!isCancelled) setIsLoadingTabs(false);
      }
    };

    loadTabs();
    return () => {
      isCancelled = true;
    };
  }, [isOpen, activeAccessToken, spreadsheetId]);

  if (!isOpen) return null;

  // Handle Tab Change
  const handleTabChange = async (newTab: string) => {
    setActiveSheetTab(newTab);
    if (!spreadsheetId) return;
    try {
      const headers = await getTabHeaders(activeAccessToken, spreadsheetId, newTab);
      setTabHeaders(headers);
    } catch (e) {
      console.warn('Error leyendo encabezados de pestaña:', e);
    }
  };

  // Handle Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setIsCreatingFolder(true);
    setErrorMsg(null);
    try {
      const cleanParentId = newFolderParentId === 'root' ? undefined : newFolderParentId;
      const created = await createDriveFolder(activeAccessToken, newFolderName.trim(), cleanParentId);
      setEvidenceFolderId(created.id);
      setEvidenceFolderName(created.name);
      setEvidenceFolderUrl(created.webViewLink);
      setEvidenceParentName(newFolderParentName);
      setFolderMode('select');
    } catch (err: any) {
      setErrorMsg('Error creando carpeta: ' + err.message);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Handle Create Spreadsheet
  const handleCreateSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSheetTitle.trim()) return;

    setIsCreatingSheet(true);
    setErrorMsg(null);
    try {
      const cleanParentId = newSheetParentId === 'root' ? undefined : newSheetParentId;
      const created = await createCustomSpreadsheet(activeAccessToken, newSheetTitle.trim(), cleanParentId);
      setSpreadsheetId(created.id);
      setSpreadsheetName(created.name);
      setSpreadsheetUrl(created.webViewLink);
      setSpreadsheetParentName(newSheetParentName);
      setActiveSheetTab('Facturas');
      setSheetMode('select');
    } catch (err: any) {
      setErrorMsg('Error creando hoja de cálculo: ' + err.message);
    } finally {
      setIsCreatingSheet(false);
    }
  };

  // Handle Save
  const handleSave = async () => {
    if (!projectName.trim()) {
      setErrorMsg('El proyecto debe tener un nombre.');
      return;
    }
    if (!evidenceFolderId) {
      setErrorMsg('Debes asignar una carpeta para guardar las evidencias.');
      return;
    }
    if (!spreadsheetId) {
      setErrorMsg('Debes asignar una hoja de cálculo para registrar los datos.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      if (tabHeaders.length === 0) {
        await ensureSheetHeaders(activeAccessToken, spreadsheetId);
      }

      await onSaveConfig({
        projectName: projectName.trim(),
        evidenceFolderId,
        evidenceFolderName,
        evidenceFolderUrl,
        evidenceParentId: newFolderParentId,
        evidenceParentName,
        spreadsheetId,
        spreadsheetName,
        spreadsheetUrl,
        spreadsheetParentId: newSheetParentId,
        spreadsheetParentName,
        activeSheetTab: activeSheetTab || 'Hoja1',
        detectedTabs,
      });

      onClose();
    } catch (err: any) {
      setErrorMsg('Error al guardar ajustes: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#1ca330]/20 text-[#98d52c]">
            <FolderKanban className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold truncate max-w-[200px]">
              {projectName.trim() || project.name}
            </span>
            <span className="text-[10px] text-slate-400">Ajustes de Obra (Minimizada)</span>
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

  const modalContainerClasses =
    'fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150';

  const modalBoxClasses =
    'w-full md:max-w-5xl lg:max-w-6xl h-[90vh] md:h-auto md:max-h-[90vh] bg-white rounded-t-[20px] md:rounded-[18px] border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 md:zoom-in-95 duration-200';

  return (
    <div className={modalContainerClasses}>
      <div className={modalBoxClasses}>
        {/* Header with full-page / minimize (-) and close (x) controls */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#1ca330]/10 text-[#157a24]">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  Ajustes y Configuración de Obra
                </h3>
                {isFullscreen && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hidden sm:inline-block">
                    Página Completa
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Configura el nombre, la carpeta de almacenamiento de fotos y la hoja de cálculo en todos los formatos.
              </p>
            </div>
          </div>

          {/* Window Control Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              id="btn-minimize-project-config-tab"
              onClick={() => setIsMinimized(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
              title="Minimizar pestaña (-)"
            >
              <Minus className="w-5 h-5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              id="btn-toggle-fullscreen-project-config-tab"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors hidden sm:inline-flex cursor-pointer"
              title={isFullscreen ? 'Restaurar tamaño ventana' : 'Abrir en página completa'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              id="btn-close-project-config-tab"
              onClick={onClose}
              disabled={isSaving}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              title="Cerrar pestaña (x)"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Current Selection Status Bar - Cuadro de información del proyecto asignado */}
        <div className="bg-slate-100/80 px-4 sm:px-6 py-3 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <FolderOpen className="w-4 h-4 text-sky-600 shrink-0" />
            <div className="truncate flex-1">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">
                Carpeta de Fotos / Evidencias:
              </span>
              <span className="font-bold text-slate-800 truncate block">
                {evidenceFolderName || 'No seleccionada'}
              </span>
              {evidenceParentName && (
                <span className="text-[10px] text-slate-500 truncate block">
                  📁 Ubicación: {evidenceParentName}
                </span>
              )}
            </div>
            {evidenceFolderUrl && (
              <a
                href={evidenceFolderUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sky-600 hover:text-sky-800 p-1.5 rounded-lg hover:bg-sky-50 transition-colors shrink-0"
                title="Abrir carpeta en Google Drive"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="truncate flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">
                  Hoja de Cálculo:
                </span>
                {activeSheetTab && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                    Pestaña: {activeSheetTab}
                  </span>
                )}
              </div>
              <span className="font-bold text-slate-800 truncate block">
                {spreadsheetName || 'No seleccionada'}
              </span>
              {spreadsheetParentName && (
                <span className="text-[10px] text-slate-500 truncate block">
                  📊 Ubicación: {spreadsheetParentName}
                </span>
              )}
            </div>
            {spreadsheetUrl && (
              <a
                href={spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-600 hover:text-emerald-800 p-1.5 rounded-lg hover:bg-emerald-50 transition-colors shrink-0"
                title="Abrir hoja de cálculo en Google Sheets"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="m-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form Body (Exact same 1, 2, 3 structure as NewProjectModal in all formats) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Section 1: Project Name */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              1. Nombre del Proyecto de Obra:
            </label>
            <input
              id="input-config-project-title"
              type="text"
              required
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Ej: Residencial Los Olivos / Reforma Gran Vía"
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
            />
          </div>

          {/* Section 2: Folder in Google Drive */}
          <div className="p-4 sm:p-5 bg-slate-50/80 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4 text-sky-600" />
                <span>2. Carpeta de Almacenamiento en Google Drive (Evidencias / Fotos):</span>
              </label>

              <div className="flex gap-1 bg-white p-0.5 rounded-xl border border-slate-200 text-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setFolderMode('select')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    folderMode === 'select'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Usar Existente
                </button>
                <button
                  type="button"
                  onClick={() => setFolderMode('create')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    folderMode === 'create'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Crear Nueva
                </button>
              </div>
            </div>

            {folderMode === 'create' ? (
              <form onSubmit={handleCreateFolder} className="p-4 bg-sky-50/60 border border-sky-200 rounded-xl space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-900">
                  <FolderPlus className="w-4 h-4 text-sky-600" />
                  <span>Crear nueva carpeta en Google Drive para evidencias:</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nombre de la nueva carpeta:
                  </label>
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Ej: Evidencias Facturas - Sector 4"
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    autoFocus
                  />
                </div>

                <ParentFolderPicker
                  accessToken={activeAccessToken}
                  selectedFolderId={newFolderParentId}
                  selectedFolderName={newFolderParentName}
                  onSelect={(id, name) => {
                    setNewFolderParentId(id);
                    setNewFolderParentName(name);
                  }}
                  label="Ubicación donde crear esta carpeta en tu Google Drive:"
                  allowProjectFolder={{ id: project.id, name: project.name }}
                />

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setFolderMode('select')}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium px-4 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {isCreatingFolder ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Creando en Drive...</span>
                      </>
                    ) : (
                      <span>Crear y Asignar Carpeta</span>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-2">
                <DriveFolderNavigator
                  accessToken={activeAccessToken}
                  initialFolderId={evidenceFolderId || project.id}
                  initialFolderName={evidenceFolderName || project.name}
                  selectedFolderId={evidenceFolderId}
                  onSelectFolder={(folder) => {
                    setEvidenceFolderId(folder.id);
                    setEvidenceFolderName(folder.name);
                    setEvidenceFolderUrl(folder.webViewLink);
                    setNewSheetParentId(folder.id);
                    setNewSheetParentName(folder.name);
                  }}
                  onSpreadsheetCreated={async (sheet) => {
                    setSpreadsheetId(sheet.id);
                    setSpreadsheetName(sheet.name);
                    setSpreadsheetUrl(sheet.url);
                    setSheetMode('select');
                    try {
                      await onSaveConfig({
                        projectName: projectName.trim() || sheet.folderName || project.name,
                        evidenceFolderId: sheet.folderId || evidenceFolderId,
                        evidenceFolderName: sheet.folderName || evidenceFolderName,
                        evidenceFolderUrl: evidenceFolderUrl,
                        spreadsheetId: sheet.id,
                        spreadsheetName: sheet.name,
                        spreadsheetUrl: sheet.url,
                        activeSheetTab: 'Control Facturas',
                      });
                      onClose();
                    } catch (e) {
                      console.error('Error auto-guardando desde creación de hoja:', e);
                    }
                  }}
                  onSelectSpreadsheet={async (sheet) => {
                    setSpreadsheetId(sheet.id);
                    setSpreadsheetName(sheet.name);
                    setSpreadsheetUrl(sheet.webViewLink);
                    setSheetMode('select');
                    try {
                      await onSaveConfig({
                        projectName: projectName.trim() || project.name,
                        evidenceFolderId: evidenceFolderId,
                        evidenceFolderName: evidenceFolderName,
                        evidenceFolderUrl: evidenceFolderUrl,
                        spreadsheetId: sheet.id,
                        spreadsheetName: sheet.name,
                        spreadsheetUrl: sheet.webViewLink,
                        activeSheetTab: 'Control Facturas',
                      });
                      onClose();
                    } catch (e) {
                      console.error('Error auto-guardando desde selección de hoja:', e);
                    }
                  }}
                  onEditFacturacion={(sheet) => {
                    setSpreadsheetId(sheet.id);
                    setSpreadsheetName(sheet.name);
                    setSpreadsheetUrl(sheet.webViewLink);
                    setIsEditFacturacionOpen(true);
                  }}
                  title="Navegar carpetas en Google Drive"
                  subtitle="Explora la jerarquía real para vincular la carpeta donde te ubicas"
                  selectButtonLabel="Vincular esta carpeta de obra"
                  compact={false}
                />
              </div>
            )}
          </div>

          {/* Section 3: Spreadsheet in Google Sheets */}
          <div className="p-4 sm:p-5 bg-slate-50/80 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>3. Hoja de Cálculo (Google Sheets):</span>
              </label>

              <div className="flex gap-1 bg-white p-0.5 rounded-xl border border-slate-200 text-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setSheetMode('select')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    sheetMode === 'select'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Usar Existente
                </button>
                <button
                  type="button"
                  onClick={() => setSheetMode('create')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    sheetMode === 'create'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Crear Automática
                </button>
              </div>
            </div>

            {sheetMode === 'create' ? (
              <form onSubmit={handleCreateSheet} className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                  <FilePlus className="w-4 h-4 text-emerald-600" />
                  <span>Crear nueva hoja de cálculo en Google Drive:</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nombre de la nueva hoja de cálculo:
                  </label>
                  <input
                    type="text"
                    value={newSheetTitle}
                    onChange={(e) => setNewSheetTitle(e.target.value)}
                    placeholder="Ej: Casa Campestre Facturación"
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                </div>

                <ParentFolderPicker
                  accessToken={activeAccessToken}
                  selectedFolderId={newSheetParentId}
                  selectedFolderName={newSheetParentName}
                  onSelect={(id, name) => {
                    setNewSheetParentId(id);
                    setNewSheetParentName(name);
                  }}
                  label="Ubicación donde guardar esta hoja en tu Google Drive:"
                  allowProjectFolder={{ id: project.id, name: project.name }}
                />

                <p className="text-[11px] text-slate-500">
                  Se inicializarán automáticamente las columnas con formato contable: Fecha Registro, Fecha Factura, Nº Factura, Proveedor,
                  Concepto, Categoría, Subtotal, IVA, Total y Enlace a Foto en Drive.
                </p>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSheetMode('select')}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!newSheetTitle.trim() || isCreatingSheet}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-4 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {isCreatingSheet ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Creando en Drive...</span>
                      </>
                    ) : (
                      <span>Crear y Asignar Hoja</span>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={sheetSearch}
                    onChange={(e) => setSheetSearch(e.target.value)}
                    placeholder="Filtrar hojas de cálculo de tu Drive..."
                    className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto divide-y divide-slate-100 bg-white">
                  {isLoadingSheets ? (
                    <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                      <span>Buscando hojas de cálculo en Google Drive...</span>
                    </div>
                  ) : errorMsg && (errorMsg.includes('expirado') || errorMsg.includes('sesión') || errorMsg.includes('Google')) ? (
                    <div className="p-4 text-center text-xs text-amber-800 bg-amber-50 space-y-2.5">
                      <div className="flex items-center justify-center gap-1.5 text-amber-700 font-medium">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Sesión de Google Drive expirada</span>
                      </div>
                      <p className="text-[11px] text-amber-600">
                        {errorMsg}
                      </p>
                      <button
                        type="button"
                        onClick={handleRenewGoogleConnection}
                        disabled={isRenewingAuth}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-xs font-semibold cursor-pointer shadow-sm transition-colors"
                      >
                        {isRenewingAuth ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                        <span>Renovar Conexión Google</span>
                      </button>
                    </div>
                  ) : driveSheets.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No se encontraron hojas de cálculo coincidentes.
                    </div>
                  ) : (
                    driveSheets.map((s) => {
                      const isSelected = spreadsheetId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => {
                            setSpreadsheetId(s.id);
                            setSpreadsheetName(s.name);
                            setSpreadsheetUrl(s.webViewLink);
                          }}
                          className={`p-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-50 text-emerald-950 font-semibold'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <FileSpreadsheet
                              className={`w-4 h-4 shrink-0 ${
                                isSelected ? 'text-emerald-600' : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate text-xs">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              id={`btn-config-edit-facturacion-${s.id}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSpreadsheetId(s.id);
                                setSpreadsheetName(s.name);
                                setSpreadsheetUrl(s.webViewLink);
                                setIsEditFacturacionOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 bg-white hover:bg-emerald-100 rounded-md border border-emerald-300 transition-colors cursor-pointer shadow-2xs"
                              title="Editar facturación (nombre y columnas) de esta hoja"
                            >
                              <Sliders className="w-3 h-3 text-emerald-700" />
                              <span className="hidden sm:inline">Edición de Facturación</span>
                            </button>
                            {isSelected && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Detected tabs and columns in the selected sheet */}
                {spreadsheetId && (
                  <div className="p-3.5 bg-slate-50/90 border border-slate-200/90 rounded-xl space-y-2.5 text-xs animate-in fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-semibold text-slate-800">
                        <Table className="w-4 h-4 text-emerald-600" />
                        <span>Pestaña de destino en la hoja:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 font-medium">
                          {detectedTabs.length > 0
                            ? `${detectedTabs.length} pestaña${detectedTabs.length === 1 ? '' : 's'} disponible${detectedTabs.length === 1 ? '' : 's'}`
                            : 'Consultando estructura...'}
                        </span>
                        <button
                          id="btn-edit-facturacion-config-selected"
                          type="button"
                          onClick={() => setIsEditFacturacionOpen(true)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 transition-colors shadow-2xs cursor-pointer active:scale-95"
                          title="Abrir edición de facturación para personalizar nombre y columnas contables"
                        >
                          <Sliders className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Edición de Facturación</span>
                        </button>
                      </div>
                    </div>

                    {isLoadingTabs ? (
                      <div className="flex items-center gap-2 text-slate-500 py-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                        <span>Detectando pestañas y encabezados de la hoja...</span>
                      </div>
                    ) : detectedTabs.length > 0 ? (
                      <div className="space-y-2.5">
                        {/* Tabs Pill Selector */}
                        <div className="flex flex-wrap gap-1.5">
                          {detectedTabs.map((tab) => {
                            const isTabActive =
                              (activeSheetTab || detectedTabs[0]?.title) === tab.title;
                            return (
                              <button
                                key={tab.sheetId}
                                type="button"
                                onClick={() => handleTabChange(tab.title)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                                  isTabActive
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs ring-2 ring-emerald-200'
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                }`}
                              >
                                {tab.title}
                              </button>
                            );
                          })}
                        </div>

                        {/* Column Structure Detection */}
                        <div className="pt-2 border-t border-slate-200">
                          <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1.5">
                            <span className="font-semibold text-slate-800 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Columnas identificadas en "{activeSheetTab || detectedTabs[0]?.title}":
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-emerald-700 font-medium text-[10px] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                Formato compatible
                              </span>
                              <button
                                id="btn-edit-facturacion-config-columns-preview"
                                type="button"
                                onClick={() => setIsEditFacturacionOpen(true)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition-colors cursor-pointer"
                                title="Personalizar columnas de facturación"
                              >
                                <Pencil className="w-3 h-3 text-emerald-600" />
                                <span>Editar Columnas</span>
                              </button>
                            </div>
                          </div>

                          {tabHeaders.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 bg-white rounded-lg border border-slate-200">
                              {tabHeaders.map((hdr, hIdx) => (
                                <span
                                  key={hIdx}
                                  className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium"
                                >
                                  {hdr || `Col ${hIdx + 1}`}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-500 italic bg-white p-2 rounded border border-slate-200">
                              Esta pestaña no tiene encabezados aún. Se configurarán encabezados estándar contables automáticamente.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-[11px]">
                        Se usará la primera pestaña activa de la hoja de cálculo seleccionada.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. ZONA DE PELIGRO: VACIAR OBRA / ELIMINAR OBRA */}
          <div className="p-4 sm:p-5 rounded-2xl border-2 border-rose-200 bg-rose-50/40 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-950">Zona de Peligro</h3>
                <p className="text-xs text-rose-700">
                  Acciones destructivas y limpieza de datos en "{project.name}".
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-white/90 rounded-xl border border-rose-200 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-slate-900">
                Registros contables en esta obra: <strong className="text-rose-600 font-extrabold">{recordCounts.totalRecords}</strong>
              </div>
              <div className="text-[11px] text-slate-600 flex flex-wrap gap-2 pt-0.5">
                <span>{recordCounts.facturas} facturas</span> •
                <span>{recordCounts.bitacoras} bitácoras</span> •
                <span>{recordCounts.nominas} nóminas</span> •
                <span>{recordCounts.workers} trabajadores</span> •
                <span>{recordCounts.inventario} materiales</span> •
                <span>{recordCounts.abonos} abonos</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Botón Vaciar Obra */}
              <div className="p-3.5 bg-white rounded-xl border border-rose-200/90 shadow-2xs space-y-2 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Vaciar esta obra</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                    Borra todos sus {recordCounts.totalRecords} registros (facturas, bitácoras, nóminas, personal, inventario y abonos). Conserva la obra y los archivos de Drive.
                  </p>
                </div>
                <button
                  type="button"
                  id="btn-open-vaciar-obra"
                  onClick={() => {
                    setDangerAction('vaciar');
                    setTypedProjectName('');
                    setDeleteDriveChecked(false);
                    setDangerError(null);
                    setIsDangerDialogOpen(true);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold transition-all min-h-[40px] cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Vaciar esta obra</span>
                </button>
              </div>

              {/* Botón Eliminar Obra */}
              <div className="p-3.5 bg-white rounded-xl border border-rose-200/90 shadow-2xs space-y-2 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold text-rose-900">Eliminar obra</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                    Elimina la obra de la lista junto con todos sus {recordCounts.totalRecords} registros contables. No toca Drive salvo que lo selecciones.
                  </p>
                </div>
                <button
                  type="button"
                  id="btn-open-eliminar-obra"
                  onClick={() => {
                    setDangerAction('eliminar');
                    setTypedProjectName('');
                    setDeleteDriveChecked(false);
                    setDangerError(null);
                    setIsDangerDialogOpen(true);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all min-h-[40px] cursor-pointer shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar obra</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500 hidden sm:flex items-center gap-1.5">
            <CheckCheck className="w-4 h-4 text-emerald-600" />
            <span>Los destinos se aplicarán automáticamente a todas las lecturas de facturas.</span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              id="btn-save-project-config"
              onClick={handleSave}
              disabled={isSaving || !evidenceFolderId || !spreadsheetId}
              className="inline-flex items-center gap-2 bg-[#1ca330] hover:bg-[#168826] text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Guardar Configuración de Obra</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Modal de Edición de Facturación */}
        {isEditFacturacionOpen && spreadsheetId && (
          <EditFacturacionModal
            isOpen={isEditFacturacionOpen}
            onClose={() => setIsEditFacturacionOpen(false)}
            accessToken={activeAccessToken}
            spreadsheet={{
              id: spreadsheetId,
              name: spreadsheetName || 'Facturación',
              webViewLink: spreadsheetUrl,
            }}
            activeTab={activeSheetTab}
            detectedTabs={detectedTabs}
            currentHeaders={tabHeaders}
            onSpreadsheetRenamed={(newTitle) => {
              setSpreadsheetName(newTitle);
              setDriveSheets((prev) =>
                prev.map((s) => (s.id === spreadsheetId ? { ...s, name: newTitle } : s))
              );
            }}
            onHeadersUpdated={(newHeaders, tabTitle) => {
              setTabHeaders([...newHeaders]);
              if (tabTitle) setActiveSheetTab(tabTitle);
            }}
          />
        )}
        {/* Modal de Confirmación para Zona de Peligro (Vaciar / Eliminar Obra) */}
        {isDangerDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in">
            <div className="fixed inset-0" onClick={() => !isExecutingDanger && setIsDangerDialogOpen(false)} />
            <div className="relative z-10 bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-rose-200">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-snug">
                    {dangerAction === 'vaciar' ? '¿Vaciar todos los registros de la obra?' : '¿Eliminar obra por completo?'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {dangerAction === 'vaciar'
                      ? `Se borrarán permanentemente ${recordCounts.totalRecords} registros contables (${recordCounts.facturas} facturas, ${recordCounts.bitacoras} bitácoras, ${recordCounts.nominas} nóminas, ${recordCounts.workers} trabajadores, ${recordCounts.inventario} materiales, ${recordCounts.abonos} abonos). La obra se conservará en cero.`
                      : `Se eliminará la obra "${project.name}" y todos sus ${recordCounts.totalRecords} registros contables.`}
                  </p>
                </div>
              </div>

              {dangerError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{dangerError}</span>
                </div>
              )}

              {/* Casilla Google Drive (desactivada por defecto) */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={deleteDriveChecked}
                    onChange={(e) => setDeleteDriveChecked(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                  />
                  <span>
                    <strong>Eliminar también los archivos de Google Drive y hojas de cálculo vinculadas</strong> (desactivada por defecto).
                  </span>
                </label>
              </div>

              {/* Confirmación escribiendo el nombre de la obra */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Para confirmar, escribe el nombre de la obra: <strong className="text-rose-600">{project.name}</strong>
                </label>
                <input
                  type="text"
                  value={typedProjectName}
                  onChange={(e) => setTypedProjectName(e.target.value)}
                  placeholder={`Escribe "${project.name}"`}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsDangerDialogOpen(false)}
                  disabled={isExecutingDanger}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  id="btn-confirm-danger-action"
                  disabled={isExecutingDanger || typedProjectName.trim() !== project.name.trim()}
                  onClick={async () => {
                    if (typedProjectName.trim() !== project.name.trim()) return;
                    setIsExecutingDanger(true);
                    setDangerError(null);
                    try {
                      if (dangerAction === 'vaciar') {
                        if (onVaciarObra) await onVaciarObra(deleteDriveChecked);
                      } else {
                        if (onEliminarObra) await onEliminarObra(deleteDriveChecked);
                      }
                      setIsDangerDialogOpen(false);
                      onClose();
                    } catch (err: any) {
                      setDangerError(err?.message || 'Error al ejecutar la acción');
                    } finally {
                      setIsExecutingDanger(false);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-sm active:scale-95 disabled:opacity-40 min-h-[44px] cursor-pointer"
                >
                  {isExecutingDanger ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Procesando...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>{dangerAction === 'vaciar' ? 'Vaciar Obra' : 'Eliminar Obra'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
