import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  Star,
  FolderOpen,
  Plus,
  X,
  Clock,
  Receipt,
  DollarSign,
  ChevronRight,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { ProjectFolder } from '../types';
import { formatCOP } from '../utils/formatters';

interface ObraSelectorSheetProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectFolder[];
  selectedProject: ProjectFolder | null;
  onSelectProject: (project: ProjectFolder) => void;
  onOpenNewProjectModal: () => void;
  invoicesCountByProject?: Record<string, number>;
  totalAmountByProject?: Record<string, number>;
}

export const ObraSelectorSheet: React.FC<ObraSelectorSheetProps> = ({
  isOpen,
  onClose,
  projects,
  selectedProject,
  onSelectProject,
  onOpenNewProjectModal,
  invoicesCountByProject = {},
  totalAmountByProject = {},
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('svh_favorite_obras');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [recentObras, setRecentObras] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('svh_recent_obras');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus en campo de búsqueda al abrir
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  const toggleFavorite = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId];
      localStorage.setItem('svh_favorite_obras', JSON.stringify(next));
      return next;
    });
  };

  const handleChoose = (project: ProjectFolder) => {
    // Guardar en recientes
    const updatedRecent = [project.id, ...recentObras.filter((id) => id !== project.id)].slice(0, 3);
    setRecentObras(updatedRecent);
    localStorage.setItem('svh_recent_obras', JSON.stringify(updatedRecent));
    localStorage.setItem('svh_last_selected_obra_id', project.id);
    onSelectProject(project);
    onClose();
  };

  // Filtrado insensible a tildes y mayúsculas
  const normalizeText = (text: string) =>
    (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const filteredProjects = useMemo(() => {
    const q = normalizeText(searchTerm.trim());
    const list = projects.filter((p) => {
      if (!q) return true;
      const nameNorm = normalizeText(p.name);
      const locNorm = normalizeText(p.baseLocationName || '');
      return nameNorm.includes(q) || locNorm.includes(q);
    });

    // Ordenar: primero favoritas, luego alfabéticamente
    return list.sort((a, b) => {
      const aFav = favorites.includes(a.id);
      const bFav = favorites.includes(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
  }, [projects, searchTerm, favorites]);

  const recentProjectItems = useMemo(() => {
    return recentObras
      .map((id) => projects.find((p) => p.id === id))
      .filter((p): p is ProjectFolder => Boolean(p));
  }, [recentObras, projects]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full md:max-w-2xl h-[85vh] md:h-auto md:max-h-[85vh] rounded-t-[20px] md:rounded-[18px] border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 md:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del selector */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-[#F6F7F9] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Seleccionar Obra</h2>
              <p className="text-xs text-[#64748B]">Carpetas de Google Drive vinculadas a tus proyectos</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-[14px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Buscador con autofocus */}
        <div className="p-4 border-b border-slate-100 bg-white shrink-0 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Buscar obra por nombre o ubicación..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-12 pl-10 pr-4 bg-[#F6F7F9] rounded-[14px] text-sm text-[#0F172A] placeholder:text-slate-400 border border-transparent focus:border-[#0F766E] focus:bg-white focus:outline-none transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1.5 py-0.5"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* Obras recientes (Chips) */}
          {recentProjectItems.length > 0 && !searchTerm && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              <span className="text-[11px] font-semibold text-[#64748B] flex items-center gap-1 shrink-0">
                <Clock className="w-3 h-3" /> Recientes:
              </span>
              {recentProjectItems.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleChoose(p)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors border ${
                    selectedProject?.id === p.id
                      ? 'bg-[#0F766E] text-white border-[#0F766E]'
                      : 'bg-[#F6F7F9] text-slate-700 hover:bg-slate-200/80 border-slate-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lista de obras como tarjetas */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 divide-y-0">
          {filteredProjects.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No se encontraron obras</p>
              <p className="text-xs text-slate-400 mt-1">Prueba con otro término o crea una nueva obra</p>
            </div>
          ) : (
            filteredProjects.map((proj) => {
              const isSelected = selectedProject?.id === proj.id;
              const isFav = favorites.includes(proj.id);
              const count = invoicesCountByProject[proj.id] || 0;
              const totalAmount = totalAmountByProject[proj.id] || 0;

              return (
                <div
                  key={proj.id}
                  onClick={() => handleChoose(proj)}
                  className={`p-3.5 sm:p-4 rounded-[14px] border transition-all cursor-pointer flex items-center justify-between gap-3 group ${
                    isSelected
                      ? 'bg-[#0F766E]/5 border-[#0F766E] shadow-xs'
                      : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-[#F6F7F9]/60 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Botón estrella de favoritos */}
                    <button
                      type="button"
                      onClick={(e) => toggleFavorite(proj.id, e)}
                      className={`p-2 rounded-xl transition-colors ${
                        isFav
                          ? 'text-amber-500 bg-amber-50 hover:bg-amber-100'
                          : 'text-slate-300 hover:text-amber-500 hover:bg-slate-100'
                      }`}
                      title={isFav ? 'Quitar de favoritas' : 'Marcar como favorita'}
                    >
                      <Star className={`w-4 h-4 ${isFav ? 'fill-amber-500' : ''}`} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[#0F172A] truncate group-hover:text-[#0F766E] transition-colors">
                          {proj.name}
                        </h3>
                        {isSelected && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0F766E] text-white shrink-0">
                            Activa
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-xs text-[#64748B]">
                        <span className="flex items-center gap-1">
                          <Receipt className="w-3.5 h-3.5" />
                          <span>{count} facturas</span>
                        </span>
                        <span>•</span>
                        <span className="font-mono font-medium text-slate-800">
                          {formatCOP(totalAmount)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#0F766E] shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>
              );
            })
          )}
        </div>

        {/* Pie: Botón Grande "Nueva Obra" */}
        <div className="p-4 border-t border-slate-100 bg-white shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenNewProjectModal();
            }}
            className="w-full h-12 bg-[#0F766E] hover:bg-[#0d655f] text-white rounded-[14px] font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            <span>Nueva Obra (Crear carpeta en Drive)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
