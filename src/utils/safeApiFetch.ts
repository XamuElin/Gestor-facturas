/**
 * Utility for safe API fetch calls that guarantees JSON responses and catches HTML error pages
 * (e.g. 504 Gateway Timeout, 502 Bad Gateway, 503 Overload, 403 Forbidden, 413 Payload Too Large)
 * preventing "Unexpected token '<', '<!doctype '... is not valid JSON" crashes.
 */

export interface SafeFetchResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function safeJsonFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<SafeFetchResult<T>> {
  try {
    const res = await fetch(url, options);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    // 1. If standard JSON response
    if (contentType.includes('application/json')) {
      try {
        const json = await res.json();
        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            error: json.error || json.message || `Error del servidor (HTTP ${res.status})`,
            data: json,
          };
        }
        return {
          ok: true,
          status: res.status,
          data: json,
        };
      } catch (jsonErr: any) {
        return {
          ok: false,
          status: res.status,
          error: 'Error al interpretar los datos devueltos por el servidor.',
        };
      }
    }

    // 2. Response is NOT JSON (HTML error page, proxy timeout, warmup page, etc.)
    const text = await res.text();
    let friendlyMessage = `Respuesta inesperada del servidor (HTTP ${res.status})`;

    const lowerText = text.toLowerCase();
    const isHtml = lowerText.includes('<!doctype') || lowerText.includes('<html') || lowerText.includes('<body');

    if (isHtml) {
      if (res.status === 504 || lowerText.includes('gateway time-out') || lowerText.includes('504')) {
        friendlyMessage =
          'El procesamiento en lote tardó más del tiempo límite de red permitido (Timeout 504). Se recomienda procesar menos archivos por lote o usar el modo secuencial.';
      } else if (res.status === 502 || res.status === 503 || lowerText.includes('warmup') || lowerText.includes('502') || lowerText.includes('503')) {
        friendlyMessage =
          'El servidor se está iniciando o experimenta una alta demanda momentánea. Por favor, espera 5 segundos y vuelve a intentar.';
      } else if (res.status === 403 || lowerText.includes('forbidden')) {
        friendlyMessage =
          'Permisos insuficientes o sesión de Google expirada. Por favor recarga la página o vuelve a autorizar la cuenta.';
      } else if (res.status === 413 || lowerText.includes('too large')) {
        friendlyMessage =
          'El tamaño de los archivos excede el límite permitido. Sube archivos de menor tamaño o procesa en grupos más pequeños.';
      } else {
        friendlyMessage = `El servidor devolvió una página HTML en lugar de datos JSON (HTTP ${res.status}). Por favor reintenta.`;
      }
    } else if (text.trim().length > 0) {
      friendlyMessage = text.slice(0, 250);
    }

    return {
      ok: false,
      status: res.status,
      error: friendlyMessage,
    };
  } catch (netErr: any) {
    const rawMsg = netErr?.message || '';
    let msg = 'Error de conexión con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.';
    if (rawMsg.includes('Unexpected token') || rawMsg.includes('is not valid JSON')) {
      msg = 'El servidor devolvió una respuesta no válida o se agotó el tiempo de espera. Por favor reintenta.';
    } else if (rawMsg) {
      msg = rawMsg;
    }
    return {
      ok: false,
      status: 0,
      error: msg,
    };
  }
}
