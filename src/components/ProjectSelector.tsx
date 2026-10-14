import React, { useState } from 'react';
import { ProjectFolder } from '../types';
import { buildProjectSpreadsheetTitle } from '../utils/duplicateChecker';
import {
  FolderKanban,
  Plus,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Check,
  ChevronDown,
  Settings2,
  Sliders,
  FolderCheck,
  Trash2,
  AlertTriangle,
  X,
  Pencil,
} from 'lucide-react';

interface ProjectSelectorProps {
  projects: ProjectFolder[];
  selectedProject: ProjectFolder | null;
  onSelectProject: (project: ProjectFolder) => void;
  onOpenNewProject: () => void;
  isLoadingProjects: boolean;
  onOpenConfig: () => void;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  onRenameProject?: (projectId: string, newName: string) => Promise<void> | void;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  projects,
  selectedProject,
  onSelectProject,
  onOpenNewProject,
  isLoadingProjects,
  onOpenConfig,
  onDeleteProject,
  onRenameProject,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectFolder | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);

  const handleStartRename = () => {
    if (!selectedProject) return;
    setRenameInput(selectedProject.name);
    setIsRenaming(true);
  };

  const handleConfirmRename = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProject || !onRenameProject) return;
    const trimmed = renameInput.trim();
    if (!trimmed || trimmed === selectedProject.name) {
      setIsRenaming(false);
      return;
    }
    setIsSavingRename(true);
    try {
      await onRenameProject(selectedProject.id, trimmed);
      setIsRenaming(false);
    } catch (err) {
      console.error('Error renombrando obra:', err);
    } finally {
      setIsSavingRename(false);
    }
  };

  const evidenceName =
    selectedProject?.evidenceFolderName || selectedProject?.name || 'Carpeta de la obra';
  const evidenceUrl =
    selectedProject?.evidenceFolderUrl || selectedProject?.webViewLink;
  const evidenceLocation =
    selectedProject?.evidenceParentName || selectedProject?.baseLocationName;

  const sheetName =
    selectedProject?.spreadsheetName ||
    (selectedProject ? buildProjectSpreadsheetTitle(selectedProject.name) : 'Hoja de Cálculo');
  const sheetUrl = selectedProject?.spreadsheetUrl;
  const sheetLocation = selectedProject?.spreadsheetParentName;

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await onDeleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (err) {
      console.error('Error al quitar proyecto:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-lg bg-[#1ca330]/10 text-[#157a24] shrink-0">
            <FolderKanban className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate">Proyecto de Obra Activo</h2>
            <p className="text-xs text-slate-500">
              Selecciona el proyecto. Cada obra sincroniza su carpeta de evidencias y su hoja de cálculo en Drive.
            </p>
          </div>
        </div>

        {selectedProject && (
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            <button
              id="btn-rename-active-project"
              type="button"
              onClick={handleStartRename}
              className="h-8 px-2.5 sm:px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors shadow-2xs cursor-pointer flex-1 sm:flex-initial whitespace-nowrap"
              title="Cambiar o editar el nombre de este proyecto de obra"
            >
              <Pencil className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>Editar Nombre</span>
            </button>

            <button
              id="btn-open-project-config"
              type="button"
              onClick={onOpenConfig}
              className="h-8 px-2.5 sm:px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-[#157a24] bg-[#1ca330]/10 hover:bg-[#1ca330]/20 border border-[#1ca330]/30 rounded-lg transition-colors shadow-2xs flex-1 sm:flex-initial whitespace-nowrap"
              title="Personalizar carpeta de evidencias y hoja de cálculo para esta obra"
            >
              <Settings2 className="w-3.5 h-3.5 text-[#1ca330] shrink-0" />
              <span className="hidden sm:inline">Configurar Destinos</span>
              <span className="sm:hidden">Destinos</span>
            </button>

            <button
              id="btn-remove-active-project"
              type="button"
              onClick={() => setProjectToDelete(selectedProject)}
              className="h-8 px-2.5 sm:px-2.5 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors shrink-0"
              title="Quitar esta obra de la lista de proyectos (no borra nada de Drive)"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-rose-600 shrink-0" />
              <span className="hidden sm:inline">Quitar</span>
            </button>
          </div>
        )}
      </div>

      {/* Inline Project Rename Form */}
      {isRenaming && selectedProject && (
        <form onSubmit={handleConfirmRename} className="mt-3 p-3 bg-slate-50 border border-slate-300 rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 animate-in fade-in">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Nombre del Proyecto / Obra:
            </label>
            <input
              type="text"
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              placeholder="Ingresa el nombre de la obra"
              disabled={isSavingRename}
              autoFocus
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
            />
          </div>
          <div className="flex items-center gap-1.5 pt-1 sm:pt-4">
            <button
              type="submit"
              disabled={isSavingRename || !renameInput.trim()}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-[#1ca330] hover:bg-[#168826] text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
            >
              {isSavingRename ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Guardar</span>
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              disabled={isSavingRename}
              className="flex-1 sm:flex-initial px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 rounded-lg text-xs font-medium transition-colors text-center"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Main Project Switcher Dropdown */}
      <div className="mt-3 relative">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <button
            id="btn-project-dropdown"
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            disabled={isLoadingProjects}
            className="flex-1 min-w-0 flex items-center justify-between bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[#1ca330]/20"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
              <FolderOpen className="w-4 h-4 text-[#1ca330] shrink-0" />
              {isLoadingProjects ? (
                <span className="text-slate-400 flex items-center gap-2 text-xs truncate">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1ca330] shrink-0" /> Cargando proyectos desde Firebase...
                </span>
              ) : selectedProject ? (
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-slate-900 block truncate">{selectedProject.name}</span>
                  {(selectedProject.baseLocationName || selectedProject.evidenceParentName) && (
                    <span className="text-[10px] text-slate-500 block truncate">
                      Ubicación: {selectedProject.baseLocationName || selectedProject.evidenceParentName}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-400 text-xs sm:text-sm truncate block">
                  {projects.length === 0 ? 'Sin proyectos creados. Pulsa "+ Nueva Obra"' : 'Selecciona una obra/proyecto'}
                </span>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          <button
            id="btn-toggle-new-project"
            type="button"
            onClick={() => {
              setIsOpen(false);
              onOpenNewProject();
            }}
            className="inline-flex items-center justify-center gap-1.5 bg-[#1ca330] hover:bg-[#168826] text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors shadow-sm shrink-0 active:scale-95 w-full sm:w-auto h-10 cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Nueva Obra</span>
          </button>
        </div>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {projects.length === 0 && !isLoadingProjects ? (
                <div className="p-5 text-center text-xs text-slate-500">
                  <FolderOpen className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
                  <p className="font-semibold text-slate-700">Aún no hay obras registradas.</p>
                  <p className="mt-1 text-slate-400">
                    Crea tu primera obra con el botón "+ Nueva Obra" para vincularla con Google Drive y Sheets.
                  </p>
                </div>
              ) : (
                (projects || []).map((proj) => {
                  const isSelected = selectedProject?.id === proj.id;
                  return (
                    <div
                      key={proj.id}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition-colors group ${
                        isSelected
                          ? 'bg-[#1ca330]/10 font-semibold text-[#157a24]'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProject(proj);
                          setIsOpen(false);
                        }}
                        className="flex-1 flex items-center gap-2.5 text-left truncate mr-2"
                      >
                        <FolderOpen
                          className={`w-4 h-4 shrink-0 ${
                            isSelected ? 'text-[#1ca330]' : 'text-slate-400 group-hover:text-[#1ca330]'
                          }`}
                        />
                        <div className="truncate">
                          <span className="truncate block font-medium text-slate-800">{proj.name}</span>
                          {(proj.baseLocationName || proj.evidenceParentName) && (
                            <span className="text-[10px] text-slate-400 block truncate">
                              📁 {proj.baseLocationName || proj.evidenceParentName}
                            </span>
                          )}
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isSelected && <Check className="w-4 h-4 text-[#1ca330] shrink-0 mr-1" />}

                        <button
                          type="button"
                          id={`btn-delete-proj-${proj.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(false);
                            setProjectToDelete(proj);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                          title={`Quitar "${proj.name}" de la lista desplegable`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-2 border-t border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenNewProject();
                }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-[#157a24] hover:bg-[#1ca330]/15 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Crear otra obra en Drive con ubicación personalizada...</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Target Folders and Sheets Configuration Banner for Active Project */}
      {selectedProject && (
        <div className="mt-3.5 pt-3 border-t border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center justify-between">
            <span>DESTINOS ASIGNADOS A ESTE PROYECTO:</span>
            <button
              onClick={onOpenConfig}
              className="text-[#1ca330] hover:text-[#157a24] font-semibold transition-colors flex items-center gap-1"
            >
              <span>Cambiar carpeta o sheet</span>
              <Sliders className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {/* Evidence Folder */}
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 truncate">
                <FolderCheck className="w-4 h-4 text-[#1ca330] shrink-0" />
                <div className="truncate">
                  <span className="text-[10px] text-slate-400 block font-medium">
                    Evidencias (Imágenes):
                  </span>
                  <span className="font-semibold text-slate-800 truncate block" title={evidenceName}>
                    {evidenceName}
                  </span>
                  {evidenceLocation && (
                    <span className="text-[10px] text-slate-500 truncate block">
                      📁 Ubicación: {evidenceLocation}
                    </span>
                  )}
                </div>
              </div>
              {evidenceUrl && (
                <a
                  href={evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-400 hover:text-[#1ca330] p-1 shrink-0"
                  title="Abrir carpeta en Google Drive"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            {/* Target Spreadsheet */}
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 truncate">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="truncate">
                  <span className="text-[10px] text-slate-400 block font-medium">
                    Hoja de Cálculo:
                  </span>
                  <span className="font-semibold text-slate-800 truncate block" title={sheetName}>
                    {sheetName}
                  </span>
                  {sheetLocation && (
                    <span className="text-[10px] text-slate-500 truncate block">
                      📊 Ubicación: {sheetLocation}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  id="btn-edit-facturacion-shortcut"
                  type="button"
                  onClick={onOpenConfig}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-100/70 hover:bg-emerald-200/90 border border-emerald-300 rounded-lg transition-colors cursor-pointer shadow-2xs"
                  title="Editar configuración y columnas de facturación de esta obra"
                >
                  <Sliders className="w-3.5 h-3.5 text-emerald-700" />
                  <span className="hidden sm:inline">Edición de Facturación</span>
                  <span className="sm:hidden">Facturación</span>
                </button>
                {sheetUrl && (
                  <a
                    href={sheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-400 hover:text-emerald-600 p-1 shrink-0"
                    title="Abrir hoja de cálculo en Google Sheets"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Delete Project from list */}
      {projectToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                  <Trash2 className="w-5 h-5" />
                </div>
                <button
                  type="button"
                  onClick={() => setProjectToDelete(null)}
                  disabled={isDeleting}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <h3 className="text-base font-bold text-slate-900 mt-3.5">
                ¿Quitar obra de la lista desplegable?
              </h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Estás a punto de retirar la obra{' '}
                <strong className="text-slate-900 font-bold">"{projectToDelete.name}"</strong> de tu
                lista de proyectos activos.
              </p>

              {/* Explicit Drive safety guarantee */}
              <div className="mt-4 p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Tus archivos en Google Drive quedan intactos:</strong> No se borrará ninguna
                  carpeta, archivo ni hoja de Google Sheets. Únicamente se elimina el acceso directo
                  de tu selector en esta aplicación.
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-lg transition-colors"
              >
                Cancelar
              </button>

              <button
                id="btn-confirm-delete-project"
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Eliminando de la lista...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Sí, quitar de la lista</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
