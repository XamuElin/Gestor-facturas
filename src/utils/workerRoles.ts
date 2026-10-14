/**
 * Gestión de roles y oficios para obreros de construcción.
 * Permite mantener la lista de roles estándar predeterminados y persistir
 * nuevos roles personalizados ingresados manualmente por el usuario.
 */

export const DEFAULT_WORKER_ROLES: string[] = [
  'Maestro de Obra',
  'Oficial Albañil',
  'Ayudante de Construcción',
  'Electricista de Obra',
  'Plomero / Fontanero',
  'Fierrero / Armador',
  'Pintor',
  'Carpintero de Formaleta',
  'Soldador',
  'Topógrafo',
  'Operador de Maquinaria',
];

const STORAGE_KEY = 'svh_custom_worker_roles';

/**
 * Obtiene la lista combinada de roles: los oficiales por defecto + los roles personalizados guardados.
 */
export function getStoredWorkerRoles(): string[] {
  if (typeof window === 'undefined') return DEFAULT_WORKER_ROLES;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleanCustom = parsed
          .map((r) => String(r || '').trim())
          .filter((r) => r.length > 0 && !DEFAULT_WORKER_ROLES.some((d) => d.toLowerCase() === r.toLowerCase()));

        return Array.from(new Set([...DEFAULT_WORKER_ROLES, ...cleanCustom]));
      }
    }
  } catch (err) {
    console.warn('Error leyendo roles personalizados de obreros de localStorage:', err);
  }

  return DEFAULT_WORKER_ROLES;
}

/**
 * Guarda un nuevo rol personalizado ingresado por el usuario en localStorage.
 * Retorna la lista actualizada de roles.
 */
export function saveCustomWorkerRole(roleName: string): string[] {
  const clean = String(roleName || '').trim();
  if (!clean || typeof window === 'undefined') return getStoredWorkerRoles();

  try {
    const isDefault = DEFAULT_WORKER_ROLES.some((d) => d.toLowerCase() === clean.toLowerCase());
    const currentList = getStoredWorkerRoles();
    const exists = currentList.some((r) => r.toLowerCase() === clean.toLowerCase());

    if (!exists) {
      const customOnly = currentList.filter(
        (r) => !DEFAULT_WORKER_ROLES.some((d) => d.toLowerCase() === r.toLowerCase())
      );
      const updatedCustom = [...customOnly, clean];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedCustom));
      return Array.from(new Set([...DEFAULT_WORKER_ROLES, ...updatedCustom]));
    }
  } catch (err) {
    console.warn('Error guardando rol personalizado en localStorage:', err);
  }

  return getStoredWorkerRoles();
}
