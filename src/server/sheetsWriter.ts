import type { sheets_v4 } from 'googleapis';
import { SHEET_HEADERS, detectColumnMapping, colIndexToA1Notation, type ColumnMapping } from '../utils/sheetColumns';

/**
 * Escritura de facturas en Google Sheets desde el servidor usando el mismo mapeo de columnas
 * que la interfaz (src/utils/sheetColumns.ts), para que las filas aparezcan en la página.
 */

const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`;

const googleStatus = (err: any): number =>
  Number(err?.code ?? err?.status ?? err?.response?.status ?? err?.response?.data?.error?.code) || 0;

/** Límite de cuota de Google (p. ej. 60 lecturas/min de Sheets) o fallo temporal del servicio. */
export function isGoogleRateLimitError(err: any): boolean {
  const status = googleStatus(err);
  if (status === 429) return true;
  const msg = String(err?.message || err?.response?.data?.error?.message || '').toLowerCase();
  return /quota exceeded|rate limit|ratelimitexceeded|userratelimitexceeded|too many requests/.test(msg);
}

/**
 * Ejecuta una llamada a Google APIs reintentando ante 429/5xx con espera exponencial
 * (respeta Retry-After si viene). Evita que un lote de facturas falle por la cuota por minuto.
 */
export async function withGoogleRetry<T>(fn: () => Promise<T>, label = 'Google API', maxAttempts = 5): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = googleStatus(err);
      const retriable = isGoogleRateLimitError(err) || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retriable || attempt === maxAttempts) throw err;
      const retryAfter = Number(err?.response?.headers?.['retry-after']);
      const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, 60000) : Math.min(2000 * 2 ** (attempt - 1), 30000);
      console.warn(`[${label}] Google respondió ${status || 'error temporal'}; reintento ${attempt}/${maxAttempts - 1} en ${delay} ms`);
      await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
    }
  }
  throw lastErr;
}

export async function resolveTabTitle(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  preferred?: string
): Promise<string> {
  const meta = await withGoogleRetry(
    () => sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' }),
    'Sheets metadatos'
  );
  const titles = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean) as string[];
  if (preferred) {
    const match = titles.find((t) => t.toLowerCase() === preferred.toLowerCase());
    if (match) return match;
  }
  return titles[0] || preferred || 'Hoja 1';
}

/** Igual que getTabHeaders del cliente: elige entre las filas 1-6 la que parece encabezado. */
export async function readHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string
): Promise<{ headers: string[]; rowIndex: number }> {
  const res = await withGoogleRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId, range: `${quoteTab(tab)}!1:6` }),
    'Sheets encabezados'
  );
  const rows: any[][] = res.data.values || [];
  let best = -1;
  let bestScore = -1;
  rows.forEach((row, i) => {
    const filled = (row || []).filter((c) => String(c ?? '').trim() !== '');
    if (filled.length === 0) return;
    let score = filled.length;
    if (/factura|folio|fecha|proveedor|subtotal|total|concepto|iva|nit/i.test(row.join(' '))) score += 25;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best === -1) return { headers: [], rowIndex: -1 };
  return { headers: rows[best].map((c) => String(c ?? '').trim()), rowIndex: best };
}

export function buildRowValues(
  mapping: ColumnMapping,
  invoice: any,
  driveUrl: string,
  fileName: string
): any[] {
  const width = Math.max(mapping.totalColumns, mapping.driveUrlCol + 1, mapping.fileNameCol + 1, SHEET_HEADERS.length);
  const row = new Array(width).fill('');
  const set = (col: number, value: any) => {
    if (col >= 0) row[col] = value ?? '';
  };
  const link = driveUrl ? `=HYPERLINK("${driveUrl}", "Ver Factura en Drive")` : '';

  set(mapping.registrationDateCol, new Date().toISOString().split('T')[0]);
  set(mapping.issueDateCol, invoice.date || invoice.fecha || '');
  set(mapping.invoiceNumberCol, invoice.invoiceNumber || invoice.numero_factura || 'S/N');
  set(mapping.vendorNameCol, invoice.vendorName || invoice.proveedor || '');
  set(mapping.vendorTaxIdCol, invoice.vendorTaxId || invoice.nit || '');
  set(mapping.conceptCol, invoice.concept || invoice.concepto_resumen || '');
  set(mapping.categoryCol, invoice.category || invoice.categoria || 'Varios');
  set(mapping.subtotalCol, Number(invoice.subtotal) || 0);
  set(mapping.taxAmountCol, Number(invoice.taxAmount ?? invoice.iva) || 0);
  set(mapping.totalAmountCol, Number(invoice.totalAmount ?? invoice.total) || 0);
  if (mapping.taxRateCol >= 0 && invoice.taxRatePercent) set(mapping.taxRateCol, invoice.taxRatePercent);
  if (mapping.quantityCol >= 0 && invoice.items?.[0]?.quantity !== undefined) set(mapping.quantityCol, invoice.items[0].quantity);
  if (mapping.unitPriceCol >= 0 && invoice.items?.[0]?.unitPrice !== undefined) set(mapping.unitPriceCol, invoice.items[0].unitPrice);
  set(mapping.driveUrlCol, link);
  set(mapping.fileNameCol, fileName || '');
  return row;
}

export interface SheetLayout {
  spreadsheetId: string;
  tab: string;
  mapping: ColumnMapping;
  headerRowIndex: number;
}

/**
 * Resuelve la pestaña y sus columnas. Si está vacía escribe los encabezados estándar SVH;
 * si no hay columna de enlace a Drive, la añade al final.
 */
export async function ensureSheetLayout(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  preferredTab?: string
): Promise<SheetLayout> {
  const tab = await resolveTabTitle(sheets, spreadsheetId, preferredTab);
  let { headers, rowIndex } = await readHeaderRow(sheets, spreadsheetId, tab);

  if (headers.length === 0) {
    await withGoogleRetry(
      () =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${quoteTab(tab)}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [SHEET_HEADERS] },
        }),
      'Sheets encabezados'
    );
    headers = [...SHEET_HEADERS];
    rowIndex = 0;
  }

  const mapping = detectColumnMapping(headers);
  if (mapping.driveUrlCol === -1) {
    mapping.driveUrlCol = headers.length;
    await withGoogleRetry(
      () =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${quoteTab(tab)}!${colIndexToA1Notation(mapping.driveUrlCol)}${rowIndex + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['Enlace Factura Drive']] },
        }),
      'Sheets encabezados'
    );
  }
  return { spreadsheetId, tab, mapping, headerRowIndex: rowIndex };
}

export async function appendRowWithLayout(
  sheets: sheets_v4.Sheets,
  layout: SheetLayout,
  invoice: any,
  driveUrl?: string,
  fileName?: string
): Promise<void> {
  const row = buildRowValues(layout.mapping, invoice, driveUrl || '', fileName || '');
  await withGoogleRetry(
    () =>
      sheets.spreadsheets.values.append({
        spreadsheetId: layout.spreadsheetId,
        range: `${quoteTab(layout.tab)}!A:${colIndexToA1Notation(row.length - 1)}`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      }),
    'Sheets añadir fila'
  );
}

/** Añade una factura a la hoja respetando sus columnas (ver ensureSheetLayout). */
export async function appendInvoiceRow(params: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  tab?: string;
  invoice: any;
  driveUrl?: string;
  fileName?: string;
  /** Si se pasa, reutiliza la estructura de la hoja entre facturas (menos lecturas a Sheets). */
  token?: string;
}): Promise<{ tab: string }> {
  const layout = params.token
    ? (await getSheetSession(params.sheets, params.token, params.spreadsheetId, params.tab)).layout
    : await ensureSheetLayout(params.sheets, params.spreadsheetId, params.tab);
  try {
    await appendRowWithLayout(params.sheets, layout, params.invoice, params.driveUrl, params.fileName);
  } catch (err) {
    if (params.token) invalidateSheetSession(params.token, params.spreadsheetId, params.tab);
    throw err;
  }
  return { tab: layout.tab };
}

const norm = (v: any) => String(v ?? '').trim().toLowerCase();

/**
 * Índice de lo ya registrado en la hoja para detectar duplicados sin releerla en cada archivo:
 * IDs de Drive enlazados, nombres de archivo y pares proveedor + número de factura.
 */
export class SheetDuplicateIndex {
  private fileIds = new Set<string>();
  private fileNames = new Set<string>();
  private invoiceKeys = new Set<string>();

  static async load(sheets: sheets_v4.Sheets, layout: SheetLayout): Promise<SheetDuplicateIndex> {
    const index = new SheetDuplicateIndex();
    const res = await withGoogleRetry(
      () =>
        sheets.spreadsheets.values.get({
          spreadsheetId: layout.spreadsheetId,
          range: `${quoteTab(layout.tab)}!A1:Z5000`,
          valueRenderOption: 'FORMULA',
        }),
      'Sheets registros'
    );
    const m = layout.mapping;
    for (const r of (res.data.values || []).slice(layout.headerRowIndex + 1)) {
      if (m.driveUrlCol >= 0) {
        const id = String(r[m.driveUrlCol] ?? '').match(/\/d\/([a-zA-Z0-9_-]{10,})|[?&]id=([a-zA-Z0-9_-]{10,})/);
        if (id) index.fileIds.add(id[1] || id[2]);
      }
      if (m.fileNameCol >= 0 && r[m.fileNameCol]) index.fileNames.add(norm(r[m.fileNameCol]));
      if (m.vendorNameCol >= 0 && m.invoiceNumberCol >= 0) {
        index.addInvoiceKey(r[m.vendorNameCol], r[m.invoiceNumberCol]);
      }
    }
    return index;
  }

  private addInvoiceKey(vendor: any, number: any) {
    const v = norm(vendor);
    const n = norm(number);
    if (v && n && n !== 's/n') this.invoiceKeys.add(`${v}__${n}`);
  }

  /** Duplicado por archivo (antes de gastar una llamada a la IA). */
  checkFile(fileId?: string | null, fileName?: string | null): string | null {
    if (fileId && this.fileIds.has(fileId)) return 'El archivo ya está registrado en la hoja.';
    if (fileName && this.fileNames.has(norm(fileName))) return `Ya existe un registro con el archivo "${fileName}".`;
    return null;
  }

  /** Duplicado por contenido (proveedor + número de factura). */
  checkInvoice(invoice: any): string | null {
    const v = norm(invoice.vendorName || invoice.proveedor);
    const n = norm(invoice.invoiceNumber || invoice.numero_factura);
    if (v && n && n !== 's/n' && this.invoiceKeys.has(`${v}__${n}`)) {
      return `La factura Nº ${invoice.invoiceNumber || invoice.numero_factura} de "${invoice.vendorName || invoice.proveedor}" ya está registrada.`;
    }
    return null;
  }

  add(fileId: string | null | undefined, fileName: string | null | undefined, invoice: any) {
    if (fileId) this.fileIds.add(fileId);
    if (fileName) this.fileNames.add(norm(fileName));
    this.addInvoiceKey(invoice.vendorName || invoice.proveedor, invoice.invoiceNumber || invoice.numero_factura);
  }
}

/**
 * Sesión de escritura compartida por todas las peticiones de un mismo lote: la hoja se lee una vez
 * (pestaña, encabezados y registros existentes) y se reutiliza unos minutos. Así 20 facturas no
 * hacen 60 lecturas a Sheets y no se supera la cuota de 60 lecturas por minuto.
 */
export interface SheetSession {
  layout: SheetLayout;
  dupIndex: SheetDuplicateIndex;
}

const SESSION_TTL_MS = 5 * 60 * 1000;
const sessionCache = new Map<string, { expires: number; promise: Promise<SheetSession> }>();

// La clave incluye el final del token para no compartir datos entre usuarios distintos
const sessionKey = (token: string, spreadsheetId: string, tab?: string) =>
  `${token.slice(-24)}|${spreadsheetId}|${(tab || '').toLowerCase()}`;

export function getSheetSession(
  sheets: sheets_v4.Sheets,
  token: string,
  spreadsheetId: string,
  preferredTab?: string
): Promise<SheetSession> {
  const now = Date.now();
  for (const [k, v] of sessionCache) if (v.expires < now) sessionCache.delete(k);

  const key = sessionKey(token, spreadsheetId, preferredTab);
  const cached = sessionCache.get(key);
  if (cached) return cached.promise;

  const promise = (async () => {
    const layout = await ensureSheetLayout(sheets, spreadsheetId, preferredTab);
    const dupIndex = await SheetDuplicateIndex.load(sheets, layout);
    return { layout, dupIndex };
  })();
  sessionCache.set(key, { expires: now + SESSION_TTL_MS, promise });
  promise.catch(() => sessionCache.delete(key));
  return promise;
}

/** Descarta la sesión en caché (p. ej. si la hoja cambió de estructura o falló al escribir). */
export function invalidateSheetSession(token: string, spreadsheetId: string, preferredTab?: string) {
  sessionCache.delete(sessionKey(token, spreadsheetId, preferredTab));
}

/** Ejecuta tareas con un máximo de `limit` en paralelo, conservando el orden de resultados. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
