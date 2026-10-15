import React, { useState, useEffect } from 'react';
import { ProjectFolder, SheetTabInfo } from '../types';
import {
  createDriveFolder,
  createCustomSpreadsheet,
  searchDriveFolders,
  searchDriveSpreadsheets,
  getSpreadsheetTabs,
  getTabHeaders,
  renameDriveFile,
  updateTabHeaders,
} from '../services/googleDriveSheets';
import { ParentFolderPicker } from './ParentFolderPicker';
import { DriveFolderNavigator } from './DriveFolderNavigator';
import { buildProjectSpreadsheetTitle } from '../utils/duplicateChecker';
import { EditFacturacionModal } from './EditFacturacionModal';
import {
  FolderPlus,
  FilePlus,
  FolderOpen,
  FileSpreadsheet,
  Check,
  X,
  Loader2,
  HardDrive,
  Search,
  AlertCircle,
  FolderKanban,
  Table,
  CheckCircle2,
  Minus,
  Maximize2,
  Minimize2,
  FileEdit,
  Pencil,
  ExternalLink,
  Save,
  Plus,
  Trash2,
  Sparkles,
  Sliders,
} from 'lucide-react';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string;
  onProjectCreated: (project: ProjectFolder) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  onProjectCreated,
}) => {
  const [projectName, setProjectName] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);

  // Folder creation or selection mode
  const [folderMode, setFolderMode] = useState<'create' | 'existing'>('create');
  const [parentLocationId, setParentLocationId] = useState('root');
  const [parentLocationName, setParentLocationName] = useState('Mi Unidad (Raíz de Drive)');
  const [folderSearch, setFolderSearch] = useState('');
  const [existingFolders, setExistingFolders] = useState<
    { id: string; name: string; webViewLink?: string }[]
  >([]);
  const [selectedExistingFolder, setSelectedExistingFolder] = useState<{
    id: string;
    name: string;
    webViewLink?: string;
  } | null>(null);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // Spreadsheet creation or selection mode
  const [sheetMode, setSheetMode] = useState<'create' | 'existing'>('create');
  const [sheetSearch, setSheetSearch] = useState('');
  const [existingSheets, setExistingSheets] = useState<
    { id: string; name: string; webViewLink?: string }[]
  >([]);
  const [selectedExistingSheet, setSelectedExistingSheet] = useState<{
    id: string;
    name: string;
    webViewLink?: string;
  } | null>(null);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);

  // Tab detection
  const [detectedTabs, setDetectedTabs] = useState<SheetTabInfo[]>([]);
  const [selectedTabTitle, setSelectedTabTitle] = useState<string>('');
  const [tabHeaders, setTabHeaders] = useState<string[]>([]);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);

  // Estados para Edición de Facturación
  const [isEditFacturacionOpen, setIsEditFacturacionOpen] = useState(false);
  const [editSheetNameInput, setEditSheetNameInput] = useState('');
  const [isRenamingSheet, setIsRenamingSheet] = useState(false);
  const [renameSheetSuccess, setRenameSheetSuccess] = useState<string | null>(null);
  const [renameSheetError, setRenameSheetError] = useState<string | null>(null);

  // Edición de columnas / encabezados de facturación
  const [customColumns, setCustomColumns] = useState<string[]>([]);
  const [newColumnInput, setNewColumnInput] = useState('');
  const [isSavingHeaders, setIsSavingHeaders] = useState(false);
  const [headersSuccessMsg, setHeadersSuccessMsg] = useState<string | null>(null);
  const [headersErrorMsg, setHeadersErrorMsg] = useState<string | null>(null);

  const handleOpenEditFacturacion = (sheetOverride?: { id: string; name: string; webViewLink?: string } | null) => {
    const targetSheet = sheetOverride || selectedExistingSheet;
    if (!targetSheet) return;
    if (targetSheet.id !== selectedExistingSheet?.id) {
      setSelectedExistingSheet(targetSheet);
    }
    setEditSheetNameInput(targetSheet.name);
    setCustomColumns(
      tabHeaders.length > 0
        ? [...tabHeaders]
        : [
            'Fecha',
            'Cliente / Proveedor',
            'NIT / RUT',
            'Concepto / Detalle',
            'Categoría',
            'Subtotal',
            'IVA',
            'Total a Pagar',
            'Comprobante / Archivo',
          ]
    );
    setNewColumnInput('');
    setRenameSheetSuccess(null);
    setRenameSheetError(null);
    setHeadersSuccessMsg(null);
    setHeadersErrorMsg(null);
    setIsEditFacturacionOpen(true);
  };

  const handleSaveRenameSheet = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedExistingSheet || !accessToken) return;
    const trimmed = editSheetNameInput.trim();
    if (!trimmed) {
      setRenameSheetError('El nombre no puede estar vacío.');
      return;
    }
    setIsRenamingSheet(true);
    setRenameSheetError(null);
    setRenameSheetSuccess(null);
    try {
      await renameDriveFile(accessToken, selectedExistingSheet.id, trimmed);
      setSelectedExistingSheet((prev) => (prev ? { ...prev, name: trimmed } : null));
      setExistingSheets((prev) =>
        prev.map((s) => (s.id === selectedExistingSheet.id ? { ...s, name: trimmed } : s))
      );
      setRenameSheetSuccess(`¡Nombre actualizado a "${trimmed}" en Google Drive!`);
      setTimeout(() => setRenameSheetSuccess(null), 4000);
    } catch (err: any) {
      setRenameSheetError(err?.message || 'Error al renombrar la hoja en Google Drive.');
    } finally {
      setIsRenamingSheet(false);
    }
  };

  const handleSaveCustomHeaders = async () => {
    if (!selectedExistingSheet || !accessToken) return;
    const targetTab = selectedTabTitle || detectedTabs[0]?.title || 'Hoja 1';
    setIsSavingHeaders(true);
    setHeadersErrorMsg(null);
    setHeadersSuccessMsg(null);
    try {
      const ok = await updateTabHeaders(
        accessToken,
        selectedExistingSheet.id,
        targetTab,
        customColumns
      );
      if (ok) {
        setTabHeaders([...customColumns]);
        setHeadersSuccessMsg(`¡Columnas de facturación actualizadas en "${targetTab}"!`);
        setTimeout(() => setHeadersSuccessMsg(null), 4000);
      } else {
        setHeadersErrorMsg('No se pudieron guardar las columnas en Google Sheets.');
      }
    } catch (err: any) {
      setHeadersErrorMsg(err?.message || 'Error guardando columnas.');
    } finally {
      setIsSavingHeaders(false);
    }
  };

  const handleResetDefaultHeaders = () => {
    setCustomColumns([
      'Fecha',
      'Cliente / Proveedor',
      'NIT / RUT',
      'Concepto / Detalle',
      'Categoría',
      'Subtotal',
      'IVA',
      'Total a Pagar',
      'Comprobante / Archivo',
    ]);
  };

  const handleAddColumn = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newColumnInput.trim();
    if (!trimmed) return;
    if (!customColumns.includes(trimmed)) {
      setCustomColumns([...customColumns, trimmed]);
    }
    setNewColumnInput('');
  };

  const handleRemoveColumn = (indexToRemove: number) => {
    setCustomColumns(customColumns.filter((_, idx) => idx !== indexToRemove));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search existing folders
  useEffect(() => {
    if (!isOpen || folderMode !== 'existing') return;
    const fetchF = async () => {
      setIsLoadingFolders(true);
      try {
        const res = await searchDriveFolders(accessToken, folderSearch);
        setExistingFolders(res);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingFolders(false);
      }
    };
    const t = setTimeout(fetchF, 250);
    return () => clearTimeout(t);
  }, [isOpen, folderMode, accessToken, folderSearch]);

  // Search existing sheets
  useEffect(() => {
    if (!isOpen || sheetMode !== 'existing') return;
    const fetchS = async () => {
      setIsLoadingSheets(true);
      try {
        const res = await searchDriveSpreadsheets(accessToken, sheetSearch);
        setExistingSheets(res);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingSheets(false);
      }
    };
    const t = setTimeout(fetchS, 250);
    return () => clearTimeout(t);
  }, [isOpen, sheetMode, accessToken, sheetSearch]);

  // Load tabs when an existing sheet is picked
  useEffect(() => {
    if (!isOpen || !selectedExistingSheet?.id || !accessToken) {
      setDetectedTabs([]);
      setSelectedTabTitle('');
      setTabHeaders([]);
      return;
    }
    let isCancelled = false;

    const loadSheetTabs = async () => {
      setIsLoadingTabs(true);
      try {
        const tabs = await getSpreadsheetTabs(accessToken, selectedExistingSheet.id);
        if (isCancelled) return;
        setDetectedTabs(tabs);
        const defaultTab = tabs[0]?.title || 'Hoja1';
        setSelectedTabTitle(defaultTab);
        const headers = await getTabHeaders(accessToken, selectedExistingSheet.id, defaultTab);
        if (!isCancelled) setTabHeaders(headers);
      } catch (err) {
        console.warn('Error detectando pestañas de la hoja seleccionada:', err);
      } finally {
        if (!isCancelled) setIsLoadingTabs(false);
      }
    };

    loadSheetTabs();
    return () => {
      isCancelled = true;
    };
  }, [isOpen, selectedExistingSheet?.id, accessToken]);

  const handleTabChange = async (newTab: string) => {
    setSelectedTabTitle(newTab);
    if (!selectedExistingSheet?.id) return;
    try {
      const headers = await getTabHeaders(accessToken, selectedExistingSheet.id, newTab);
      setTabHeaders(headers);
    } catch (e) {
      console.warn('Error leyendo encabezados de pestaña:', e);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setErrorMsg('Por favor ingresa un nombre para el proyecto.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let finalFolderId = '';
      let finalFolderName = '';
      let finalFolderUrl = '';

      // 1. Resolve Project Folder
      if (folderMode === 'create') {
        const cleanName = projectName.trim().toLowerCase().startsWith('obra')
          ? projectName.trim()
          : `Obra: ${projectName.trim()}`;

        const createdFolder = await createDriveFolder(
          accessToken,
          cleanName,
          parentLocationId === 'root' ? undefined : parentLocationId
        );
        finalFolderId = createdFolder.id;
        finalFolderName = createdFolder.name;
        finalFolderUrl = createdFolder.webViewLink;
      } else {
        const folder = selectedExistingFolder || {
          id: parentLocationId || 'root',
          name: parentLocationName || 'Mi Unidad',
          webViewLink: '',
        };
        finalFolderId = folder.id;
        finalFolderName = folder.name;
        finalFolderUrl = folder.webViewLink || '';
      }

      // 2. Resolve Spreadsheet
      let finalSheetId = '';
      let finalSheetName = '';
      let finalSheetUrl = '';

      if (sheetMode === 'create') {
        // La hoja de cálculo se crea con el nombre del proyecto más "Facturación"
        const sheetTitle = buildProjectSpreadsheetTitle(projectName.trim() || finalFolderName);
        // Put spreadsheet directly inside the folder where the user is located
        const createdSheet = await createCustomSpreadsheet(accessToken, sheetTitle, finalFolderId);
        finalSheetId = createdSheet.id;
        finalSheetName = createdSheet.name;
        finalSheetUrl = createdSheet.webViewLink;
      } else {
        if (!selectedExistingSheet) {
          setErrorMsg('Selecciona una hoja de cálculo existente de Google Drive.');
          setIsSubmitting(false);
          return;
        }
        finalSheetId = selectedExistingSheet.id;
        finalSheetName = selectedExistingSheet.name;
        finalSheetUrl = selectedExistingSheet.webViewLink || '';
      }

      const newProject: ProjectFolder = {
        id: finalFolderId,
        name: projectName.trim(),
        baseFolderId: finalFolderId,
        baseFolderName: finalFolderName,
        baseLocationName: parentLocationName,
        webViewLink: finalFolderUrl,
        evidenceFolderId: finalFolderId,
        evidenceFolderName: finalFolderName,
        evidenceFolderUrl: finalFolderUrl,
        evidenceParentName: parentLocationName,
        spreadsheetId: finalSheetId,
        spreadsheetName: finalSheetName,
        spreadsheetUrl: finalSheetUrl,
        activeSheetTab: sheetMode === 'existing' ? (selectedTabTitle || 'Hoja1') : 'Facturas',
        detectedTabs: detectedTabs.length > 0 ? detectedTabs : undefined,
      };

      onProjectCreated(newProject);
      onClose();
    } catch (err: any) {
      setErrorMsg('Error al crear el proyecto: ' + err.message);
    } finally {
      setIsSubmitting(false);
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
              {projectName.trim() || 'Nueva Obra / Proyecto'}
            </span>
            <span className="text-[10px] text-slate-400">Pestaña minimizada</span>
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
    'w-full md:max-w-5xl h-[90vh] md:h-auto md:max-h-[90vh] bg-white rounded-t-[20px] md:rounded-[18px] border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 md:zoom-in-95 duration-200';

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
                <h3 className="text-base sm:text-lg font-bold text-slate-900">Nueva Obra / Proyecto</h3>
                {isFullscreen && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hidden sm:inline-block">
                    Página Completa
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Elige el nombre y la ubicación exacta en tu Google Drive sin carpetas forzadas.
              </p>
            </div>
          </div>

          {/* Window Control Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              id="btn-minimize-new-project-tab"
              onClick={() => setIsMinimized(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
              title="Minimizar pestaña (-)"
            >
              <Minus className="w-5 h-5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              id="btn-toggle-fullscreen-new-project-tab"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 rounded-xl transition-colors hidden sm:inline-flex cursor-pointer"
              title={isFullscreen ? 'Restaurar tamaño ventana' : 'Abrir en página completa'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              id="btn-close-new-project-tab"
              onClick={onClose}
              disabled={isSubmitting}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              title="Cerrar pestaña (x)"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="m-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form Body - Spacious and responsive */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl w-full mx-auto">
          {/* Project Name */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              1. Nombre del Proyecto de Obra:
            </label>
            <input
              id="input-new-project-title"
              type="text"
              required
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Ej: Residencial Los Olivos / Reforma Gran Vía"
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
              autoFocus
            />
          </div>

          {/* Location for Folder */}
          <div className="p-4 sm:p-5 bg-slate-50/80 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4 text-sky-600" />
                <span>2. Carpeta de Almacenamiento en Google Drive:</span>
              </label>

              <div className="flex gap-1 bg-white p-0.5 rounded-xl border border-slate-200 text-xs self-start sm:self-auto">
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
                <button
                  type="button"
                  onClick={() => setFolderMode('existing')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    folderMode === 'existing'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Usar Existente
                </button>
              </div>
            </div>

            {folderMode === 'create' ? (
              <div className="space-y-3">
                <ParentFolderPicker
                  accessToken={accessToken}
                  selectedFolderId={parentLocationId}
                  selectedFolderName={parentLocationName}
                  onSelect={(id, name) => {
                    setParentLocationId(id);
                    setParentLocationName(name);
                  }}
                  label="¿Dónde deseas crear la carpeta de esta obra en Google Drive?"
                />
                <p className="text-[11px] text-slate-500">
                  Se creará la carpeta <strong>"Obra: {projectName || '...'}"</strong> dentro de la ubicación seleccionada.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <DriveFolderNavigator
                  accessToken={accessToken}
                  initialFolderId="root"
                  selectedFolderId={selectedExistingFolder?.id}
                  onSelectFolder={(folder) => {
                    setSelectedExistingFolder({
                      id: folder.id,
                      name: folder.name,
                      webViewLink: folder.webViewLink,
                    });
                  }}
                  onSpreadsheetCreated={(sheet) => {
                    setSelectedExistingSheet({
                      id: sheet.id,
                      name: sheet.name,
                      webViewLink: sheet.url,
                    });
                    setSheetMode('existing');
                  }}
                  onSelectSpreadsheet={(sheet) => {
                    setSelectedExistingSheet({
                      id: sheet.id,
                      name: sheet.name,
                      webViewLink: sheet.webViewLink,
                    });
                    setSheetMode('existing');
                  }}
                  onEditFacturacion={(sheet) => {
                    handleOpenEditFacturacion({
                      id: sheet.id,
                      name: sheet.name,
                      webViewLink: sheet.webViewLink,
                    });
                  }}
                  title="Navegar carpetas en Google Drive"
                  subtitle="Explora la jerarquía real para ubicar la carpeta donde se creará el Sheets y se guardará la obra"
                  selectButtonLabel="Vincular esta carpeta de obra"
                  compact={false}
                />

                {selectedExistingFolder && (
                  <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between text-xs text-emerald-950 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Carpeta actual seleccionada:{' '}
                        <strong className="underline">{selectedExistingFolder.name}</strong>
                        <span className="text-emerald-700 block text-[11px]">
                          (El archivo Google Sheets se creará directamente dentro de esta carpeta donde te ubicas)
                        </span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Location for Spreadsheet */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>3. Hoja de Cálculo (Google Sheets):</span>
              </label>

              <div className="flex gap-1 bg-white p-0.5 rounded-lg border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setSheetMode('create')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    sheetMode === 'create'
                      ? 'bg-emerald-600 text-white font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Crear Automática
                </button>
                <button
                  type="button"
                  onClick={() => setSheetMode('existing')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    sheetMode === 'existing'
                      ? 'bg-emerald-600 text-white font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Usar Existente
                </button>
              </div>
            </div>

            {sheetMode === 'create' ? (
              <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-1.5 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    La hoja de cálculo se creará en la carpeta donde estás ubicado:
                  </span>
                </div>
                <p className="text-slate-600">
                  Se creará automáticamente el archivo{' '}
                  <strong className="text-slate-900">
                    "{buildProjectSpreadsheetTitle(
                      projectName.trim() ||
                        (folderMode === 'existing' && selectedExistingFolder?.name
                          ? selectedExistingFolder.name
                          : 'Obra')
                    )}"
                  </strong>{' '}
                  dentro de{' '}
                  <strong className="text-emerald-800">
                    "{folderMode === 'existing'
                      ? selectedExistingFolder?.name || 'la carpeta donde te ubicas'
                      : parentLocationName}"
                  </strong>{' '}
                  con formato contable oficial.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={sheetSearch}
                    onChange={(e) => setSheetSearch(e.target.value)}
                    placeholder="Filtrar hojas de cálculo de tu Drive..."
                    className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
                  {isLoadingSheets ? (
                    <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                      <span>Buscando hojas de cálculo en Drive...</span>
                    </div>
                  ) : existingSheets.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-400">
                      No se encontraron hojas coincidentes.
                    </div>
                  ) : (
                    existingSheets.map((s) => {
                      const isSel = selectedExistingSheet?.id === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => setSelectedExistingSheet(s)}
                          className={`p-2.5 flex items-center justify-between text-xs cursor-pointer ${
                            isSel ? 'bg-emerald-50 text-emerald-900 font-semibold' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              id={`btn-edit-facturacion-sheet-${s.id}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditFacturacion(s);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 bg-white hover:bg-emerald-100 rounded-md border border-emerald-300 transition-colors cursor-pointer shadow-2xs"
                              title="Editar facturación (nombre y columnas) de esta hoja"
                            >
                              <Sliders className="w-3 h-3 text-emerald-700" />
                              <span className="hidden sm:inline">Edición de Facturación</span>
                            </button>
                            {isSel && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Detected tabs and columns in the selected sheet */}
                {selectedExistingSheet && (
                  <div className="p-3 bg-slate-50/90 border border-slate-200/90 rounded-xl space-y-2 text-xs animate-in fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Table className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Pestaña de destino en la hoja:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {detectedTabs.length > 0
                            ? `${detectedTabs.length} pestaña${detectedTabs.length === 1 ? '' : 's'} detectada${detectedTabs.length === 1 ? '' : 's'}`
                            : 'Consultando...'}
                        </span>
                        <button
                          id="btn-edit-facturacion-selected-sheet"
                          type="button"
                          onClick={() => handleOpenEditFacturacion(selectedExistingSheet)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 transition-colors shadow-2xs cursor-pointer active:scale-95"
                          title="Abrir edición de facturación para personalizar nombre y columnas"
                        >
                          <Sliders className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Edición de Facturación</span>
                        </button>
                      </div>
                    </div>

                    {isLoadingTabs ? (
                      <div className="flex items-center gap-2 text-slate-500 py-1">
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                        <span>Leyendo estructura y pestañas...</span>
                      </div>
                    ) : detectedTabs.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {detectedTabs.map((tab) => {
                            const isTabActive =
                              (selectedTabTitle || detectedTabs[0]?.title) === tab.title;
                            return (
                              <button
                                key={tab.sheetId}
                                type="button"
                                onClick={() => handleTabChange(tab.title)}
                                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
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

                        {/* Column Structure preview */}
                        <div className="pt-1.5 border-t border-slate-200">
                          <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                            <span className="font-semibold text-slate-700 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Columnas identificadas en "{selectedTabTitle || detectedTabs[0]?.title}":
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-emerald-700 font-medium text-[10px] bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                Formato respetado
                              </span>
                              <button
                                id="btn-edit-facturacion-columns-preview"
                                type="button"
                                onClick={() => handleOpenEditFacturacion(selectedExistingSheet)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition-colors cursor-pointer"
                                title="Personalizar nombres y columnas de facturación"
                              >
                                <Pencil className="w-3 h-3 text-emerald-600" />
                                <span>Editar Columnas</span>
                              </button>
                            </div>
                          </div>

                          {tabHeaders.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1 bg-white rounded-md border border-slate-200">
                              {tabHeaders.map((hdr, hIdx) => (
                                <span
                                  key={hIdx}
                                  className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-medium"
                                >
                                  {hdr || `Col ${hIdx + 1}`}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-200">
                              Esta pestaña está vacía. Se configurarán encabezados estándar al guardar facturas.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-[10px]">
                        Se registrarán los datos en la primera pestaña activa.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              id="btn-submit-create-custom-project"
              type="submit"
              disabled={isSubmitting || !projectName.trim()}
              className="inline-flex items-center gap-2 bg-[#1ca330] hover:bg-[#168826] text-white font-semibold text-xs px-5 py-2.5 rounded-lg shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Configurando en Google Drive...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Crear y Guardar Proyecto</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Modal de Edición de Facturación */}
        {isEditFacturacionOpen && selectedExistingSheet && (
          <EditFacturacionModal
            isOpen={isEditFacturacionOpen}
            onClose={() => setIsEditFacturacionOpen(false)}
            accessToken={accessToken}
            spreadsheet={selectedExistingSheet}
            activeTab={selectedTabTitle}
            detectedTabs={detectedTabs}
            currentHeaders={tabHeaders}
            onSpreadsheetRenamed={(newTitle) => {
              setSelectedExistingSheet((prev) => (prev ? { ...prev, name: newTitle } : null));
              setExistingSheets((prev) =>
                prev.map((s) => (s.id === selectedExistingSheet.id ? { ...s, name: newTitle } : s))
              );
            }}
            onHeadersUpdated={(newHeaders, tabTitle) => {
              setTabHeaders([...newHeaders]);
              if (tabTitle) setSelectedTabTitle(tabTitle);
            }}
          />
        )}
      </div>
    </div>
  );
};
