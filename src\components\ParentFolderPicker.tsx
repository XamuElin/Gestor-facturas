import React, { useState, useEffect } from 'react';
import { searchDriveFolders } from '../services/googleDriveSheets';
import { DriveFolderNavigator } from './DriveFolderNavigator';
import { Folder, FolderOpen, Search, Check, ChevronDown, ChevronUp, Loader2, HardDrive, Compass } from 'lucide-react';

interface ParentFolderPickerProps {
  accessToken: string;
  selectedFolderId: string; // 'root' or specific ID
  selectedFolderName: string;
  onSelect: (folderId: string, folderName: string) => void;
  label?: string;
  allowProjectFolder?: { id: string; name: string };
}

export const ParentFolderPicker: React.FC<ParentFolderPickerProps> = ({
  accessToken,
  selectedFolderId,
  selectedFolderName,
  onSelect,
  label = 'Ubicación en Google Drive:',
  allowProjectFolder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isNavigatorModalOpen, setIsNavigatorModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [folders, setFolders] = useState<{ id: string; name: string; webViewLink?: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !accessToken) return;
    const fetchFolders = async () => {
      setIsLoading(true);
      try {
        const results = await searchDriveFolders(accessToken, search);
        setFolders(results);
      } catch (err) {
        console.error('Error buscando carpetas para ubicación:', err);
      } finally {
        setIsLoading(false);
      }
    };
    const t = setTimeout(fetchFolders, 250);
    return () => clearTimeout(t);
  }, [isOpen, accessToken, search]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-slate-700">{label}</label>
        <button
          type="button"
          onClick={() => setIsNavigatorModalOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1ca330] hover:text-[#158023] hover:underline"
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Explorar jerarquía completa</span>
        </button>
      </div>

      {/* Selected location trigger */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between bg-white border border-slate-300 hover:border-slate-400 p-2.5 rounded-lg cursor-pointer transition-colors shadow-2xs"
      >
        <div className="flex items-center gap-2 truncate">
          {selectedFolderId === 'root' ? (
            <HardDrive className="w-4 h-4 text-sky-600 shrink-0" />
          ) : (
            <FolderOpen className="w-4 h-4 text-amber-600 shrink-0" />
          )}
          <div className="truncate">
            <span className="text-xs font-semibold text-slate-900 truncate block">
              {selectedFolderName || (selectedFolderId === 'root' ? 'Mi Unidad (Raíz de Drive)' : 'Carpeta de Drive')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-sky-700 font-medium shrink-0">
          <span>{isOpen ? 'Ocultar' : 'Cambiar ubicación'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </div>

      {/* Selector Dropdown / Panel */}
      {isOpen && (
        <div className="border border-slate-200 rounded-xl bg-slate-50/80 p-3 space-y-2.5 animate-in fade-in zoom-in-95 duration-100">
          {/* Quick presets & hierarchical button */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onSelect('root', 'Mi Unidad (Raíz de Google Drive)');
                setIsOpen(false);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                selectedFolderId === 'root'
                  ? 'bg-sky-100 border-sky-300 text-sky-900 font-semibold'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 text-sky-600" />
              <span>Mi Unidad (Raíz)</span>
              {selectedFolderId === 'root' && <Check className="w-3 h-3 text-sky-600" />}
            </button>

            {allowProjectFolder && allowProjectFolder.id !== 'root' && (
              <button
                type="button"
                onClick={() => {
                  onSelect(allowProjectFolder.id, allowProjectFolder.name);
                  setIsOpen(false);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedFolderId === allowProjectFolder.id
                    ? 'bg-sky-100 border-sky-300 text-sky-900 font-semibold'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-amber-600" />
                <span className="truncate max-w-[160px]">{allowProjectFolder.name}</span>
                {selectedFolderId === allowProjectFolder.id && <Check className="w-3 h-3 text-sky-600" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setIsNavigatorModalOpen(true);
                setIsOpen(false);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-[#1ca330] transition-colors ml-auto"
            >
              <Compass className="w-3.5 h-3.5 text-[#1ca330]" />
              <span>Navegar en Drive</span>
            </button>
          </div>

          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar otra carpeta en Google Drive..."
              className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Folder list */}
          <div className="max-h-40 overflow-y-auto divide-y divide-slate-200/60 border border-slate-200 rounded-lg bg-white">
            {isLoading ? (
              <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
                <span>Cargando carpetas de Drive...</span>
              </div>
            ) : folders.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400">
                No se encontraron carpetas coincidentes.
              </div>
            ) : (
              folders.map((f) => {
                const isSel = selectedFolderId === f.id;
                return (
                  <div
                    key={f.id}
                    onClick={() => {
                      onSelect(f.id, f.name);
                      setIsOpen(false);
                    }}
                    className={`p-2.5 flex items-center justify-between text-xs cursor-pointer transition-colors ${
                      isSel ? 'bg-sky-50 text-sky-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </div>
                    {isSel && <Check className="w-3.5 h-3.5 text-sky-600 shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Modal Hierarchical Navigator */}
      {isNavigatorModalOpen && (
        <DriveFolderNavigator
          accessToken={accessToken}
          isModal={true}
          onClose={() => setIsNavigatorModalOpen(false)}
          initialFolderId={selectedFolderId === 'root' ? 'root' : selectedFolderId}
          initialFolderName={selectedFolderName}
          selectedFolderId={selectedFolderId}
          onSelectFolder={(folder) => {
            onSelect(folder.id, folder.name);
          }}
          title="Navegador Jerárquico de Google Drive"
          subtitle="Explora carpetas y subcarpetas para seleccionar la ubicación exacta"
          selectButtonLabel="Seleccionar esta ubicación"
        />
      )}
    </div>
  );
};

