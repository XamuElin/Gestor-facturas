/**
 * Utilidades de formateo, moneda colombiana (COP), fechas y Screen Wake Lock
 */

/**
 * Formatea un monto numérico a Pesos Colombianos (COP) sin decimales visibles.
 * Ejemplo: $ 1.234.567
 */
export function formatCOP(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return '$ 0';
  }
  const numeric = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^0-9.-]+/g, '')) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(numeric);
}

/**
 * Formatea un número puro en formato colombiano (separador de miles con punto)
 * Ejemplo: 1.234.567
 */
export function formatColombianNumber(val: number | string | null | undefined): string {
  if (val === null || val === undefined || isNaN(Number(val))) {
    return '0';
  }
  const numeric = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]+/g, '')) || 0;
  return new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 2,
  }).format(numeric);
}

/**
 * Formatea una fecha a formato dd/mm/aaaa
 */
export function formatDateCO(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const clean = String(dateStr).trim();
    // Si viene en formato AAAA-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
      const [year, month, day] = clean.split('T')[0].split('-');
      return `${day}/${month}/${year}`;
    }
    const d = new Date(clean);
    if (isNaN(d.getTime())) return clean;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return String(dateStr);
  }
}

/**
 * Calcula el hash SHA-256 de un archivo o base64 en el navegador usando Web Crypto API
 */
export async function computeSha256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  let buffer: ArrayBuffer;
  if (typeof data === 'string') {
    const clean = data.replace(/^data:[^;]+;base64,/, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    buffer = bytes.buffer;
  } else if (data instanceof Uint8Array) {
    buffer = data.buffer;
  } else {
    buffer = data;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper para activar Screen Wake Lock durante la subida de documentos
 */
export class WakeLockManager {
  private sentinel: any = null;

  async request(): Promise<boolean> {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        this.sentinel = await (navigator as any).wakeLock.request('screen');
        return true;
      }
    } catch (e) {
      console.warn('[WakeLock] No disponible o denegado:', e);
    }
    return false;
  }

  async release(): Promise<void> {
    try {
      if (this.sentinel) {
        await this.sentinel.release();
        this.sentinel = null;
      }
    } catch (e) {
      console.warn('[WakeLock] Error liberando sentinel:', e);
    }
  }
}
