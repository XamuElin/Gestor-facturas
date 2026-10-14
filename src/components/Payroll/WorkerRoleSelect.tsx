import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Sparkles, Plus } from 'lucide-react';
import { getStoredWorkerRoles, DEFAULT_WORKER_ROLES } from '../../utils/workerRoles';

interface WorkerRoleSelectProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  className?: string;
}

export const WorkerRoleSelect: React.FC<WorkerRoleSelectProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<string[]>(DEFAULT_WORKER_ROLES);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAvailableRoles(getStoredWorkerRoles());
  }, []);

  // Cerrar al hacer clic fuera del componente
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const trimmedValue = value.trim();
  const isExistingRole = availableRoles.some(
    (r) => r.toLowerCase() === trimmedValue.toLowerCase()
  );
  const isNewCustomRole = trimmedValue.length > 0 && !isExistingRole;

  // Filtrar sugerencias mientras el usuario escribe
  const filteredRoles = trimmedValue
    ? availableRoles.filter((r) =>
        r.toLowerCase().includes(trimmedValue.toLowerCase())
      )
    : availableRoles;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Escribe o selecciona un rol..."
          disabled={disabled}
          list="worker-roles-native-datalist"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330] focus:bg-white transition-colors"
        />

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          disabled={disabled}
          className="absolute right-2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer transition-transform"
          title="Ver lista de roles disponibles"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-[#1ca330]' : ''
            }`}
          />
        </button>
      </div>

      {/* Datalist nativo para compatibilidad de autocompletado en navegadores móviles y desktop */}
      <datalist id="worker-roles-native-datalist">
        {availableRoles.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      {/* Dropdown interactivo con opciones y sugerencias */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto divide-y divide-slate-100 animate-in fade-in zoom-in-95">
          {/* Opción de nuevo rol personalizado si está escribiendo uno que no existe */}
          {isNewCustomRole && (
            <div
              onClick={() => setIsOpen(false)}
              className="p-2.5 bg-emerald-50/70 hover:bg-emerald-100/70 cursor-pointer flex items-center justify-between text-xs text-emerald-900 border-b border-emerald-100 transition-colors"
            >
              <div className="flex items-center gap-2 truncate">
                <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">
                  Usar: <strong>"{value}"</strong>
                </span>
              </div>
              <span className="text-[10px] bg-emerald-200/80 text-emerald-800 font-bold px-1.5 py-0.5 rounded shrink-0">
                Nuevo Rol
              </span>
            </div>
          )}

          {filteredRoles.length === 0 && !isNewCustomRole ? (
            <div className="p-3 text-center text-xs text-slate-400">
              No se encontraron coincidencias. Puedes escribirlo directamente.
            </div>
          ) : (
            <div className="py-1">
              {filteredRoles.map((roleOption) => {
                const isSelected =
                  roleOption.toLowerCase() === trimmedValue.toLowerCase();
                const isCustomSaved = !DEFAULT_WORKER_ROLES.includes(roleOption);

                return (
                  <button
                    key={roleOption}
                    type="button"
                    onClick={() => {
                      onChange(roleOption);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-900 font-bold'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="truncate">{roleOption}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isCustomSaved && (
                        <span className="text-[9px] bg-slate-100 text-slate-600 px-1 py-0.5 rounded font-medium">
                          Personalizado
                        </span>
                      )}
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[#1ca330]" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Nota cuando se ingresa un rol nuevo que se guardará */}
      {isNewCustomRole && !isOpen && (
        <p className="text-[10px] text-emerald-700 flex items-center gap-1 mt-1 font-medium">
          <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
          <span>Este rol quedará guardado para futuras recomendaciones.</span>
        </p>
      )}
    </div>
  );
};
