import { Type } from '@google/genai';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { callGemini, parseModelJson, describeGeminiError } from './gemini';
import { CONSTRUCTION_CATEGORIES, type ConstructionCategory } from '../types';

/**
 * Extracción de facturas: un único esquema, un único prompt y una única normalización
 * para todas las rutas (subida directa, cola en segundo plano, Drive y reprocesado).
 * La salida incluye las claves que usa la interfaz (InvoiceData: vendorName, date, totalAmount…)
 * y sus equivalentes en español (proveedor, fecha, total…) que usan el servidor y Sheets.
 */

export const INVOICE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    proveedor: { type: Type.STRING, description: 'Razón social del emisor/proveedor que vende (no el cliente comprador)' },
    nit: { type: Type.STRING, description: 'NIT/RUT del proveedor tal como aparece, con dígito de verificación si lo tiene (ej. 900123456-7)' },
    numero_factura: { type: Type.STRING, description: 'Número o prefijo+número de la factura (ej. FE-12345)' },
    fecha: { type: Type.STRING, description: 'Fecha de emisión en formato AAAA-MM-DD' },
    subtotal: { type: Type.NUMBER, description: 'Base gravable / subtotal antes de impuestos' },
    tasa_iva: { type: Type.NUMBER, description: 'Porcentaje de IVA aplicado (ej. 19), 0 si no aplica' },
    iva: { type: Type.NUMBER, description: 'Valor total de IVA/impuestos' },
    retenciones: { type: Type.NUMBER, description: 'Suma de retenciones (ReteFuente, ReteICA, ReteIVA) o 0' },
    descuentos: { type: Type.NUMBER, description: 'Descuentos aplicados o 0' },
    total: { type: Type.NUMBER, description: 'Total final a pagar del documento' },
    moneda: { type: Type.STRING, description: 'Código ISO de moneda (COP por defecto)' },
    concepto_resumen: { type: Type.STRING, description: '3 a 8 palabras en MAYÚSCULAS con lo principal que se compró' },
    categoria: { type: Type.STRING, enum: [...CONSTRUCTION_CATEGORIES] },
    items: {
      type: Type.ARRAY,
      description: 'Todas las líneas de la factura, en orden',
      items: {
        type: Type.OBJECT,
        properties: {
          descripcion: { type: Type.STRING },
          cantidad: { type: Type.NUMBER },
          unidad: { type: Type.STRING },
          valor_unitario: { type: Type.NUMBER },
          valor_total: { type: Type.NUMBER },
        },
        required: ['descripcion', 'valor_total'],
      },
    },
    confianza: { type: Type.NUMBER, description: 'Confianza global de la lectura entre 0 y 1' },
    campos_dudosos: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Campos ilegibles o dudosos' },
  },
  required: ['proveedor', 'fecha', 'total', 'moneda', 'concepto_resumen', 'categoria', 'items', 'confianza'],
};

export const SYSTEM_INSTRUCTION = `Eres un auditor contable que extrae datos de facturas, remisiones y recibos de obras de construcción en Colombia.
Devuelve SOLO JSON según el esquema. Nunca inventes datos: si algo no aparece o es ilegible, usa null y añádelo a "campos_dudosos".
Reglas:
- "proveedor" es quien EMITE la factura (encabezado/logo), no el cliente al que se factura.
- Montos como número puro, sin símbolos ni separadores de miles. En Colombia "1.500.000" = 1500000 y "70.509" = 70509; "1.250,50" = 1250.5.
- "total" es el valor final a pagar ("TOTAL A PAGAR", "NETO A PAGAR", "TOTAL"). No lo confundas con el subtotal ni con el total de una línea.
- Comprueba que subtotal + iva - retenciones - descuentos ≈ total y que la suma de las líneas ≈ subtotal. Si el documento muestra un total explícito, ese prevalece; si no cuadra, baja "confianza".
- Fecha de emisión en AAAA-MM-DD (las fechas colombianas suelen venir como DD/MM/AAAA).
- "categoria": Materiales (cemento, acero, ferretería…), Mano de Obra, Maquinaria y Equipos (alquiler/compra de equipos y herramienta), Transporte y Logística (fletes, acarreos, combustible), Subcontratas, Seguridad y Salud (EPP, dotación, señalización), Servicios y Licencias, o Varios.`;

export interface ExtractionInput {
  base64: string;
  mimeType?: string;
  fileName?: string;
  preferredModel?: string;
}

export type ExtractionStatus = 'leida' | 'revisar';

// ---------------------------------------------------------------------------
// Utilidades numéricas y de normalización
// ---------------------------------------------------------------------------

/** Convierte importes en cualquier formato regional ("$ 1.500.000", "1,500.50", "1500,5") a número. */
export function cleanLocaleAmount(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  let str = String(val).trim().replace(/[€$£¥\s]/g, '').replace(/COP|USD|EUR|MXN|PEN|CLP/gi, '').trim();
  if (!str) return 0;
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    str = lastDot < lastComma ? str.replace(/\./g, '').replace(',', '.') : str.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const parts = str.split(',');
    if (parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3)) str = str.replace(/,/g, '');
    else str = parts[0] + '.' + parts[1];
  } else if (lastDot !== -1) {
    const parts = str.split('.');
    if (parts.length > 2 || parts[1].length === 3) str = str.replace(/\./g, '');
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function cleanText(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' ? '' : s;
}

/** Normaliza fechas a AAAA-MM-DD aceptando DD/MM/AAAA, DD-MM-AAAA y AAAA/MM/DD. */
export function normalizeDate(raw: any): string {
  const s = cleanText(raw);
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return s;
}

const CATEGORY_ALIASES: Array<[RegExp, ConstructionCategory]> = [
  [/material|ferreter|cement|acero|ladrill/i, 'Materiales'],
  [/mano.*obra|labor|jornal/i, 'Mano de Obra'],
  [/maquin|equipo|herramient/i, 'Maquinaria y Equipos'],
  [/transport|logist|flete|combustib/i, 'Transporte y Logística'],
  [/subcontrat/i, 'Subcontratas'],
  [/segur|salud|epp|dotaci/i, 'Seguridad y Salud'],
  [/servici|licenci/i, 'Servicios y Licencias'],
];

export function normalizeCategory(raw: any): ConstructionCategory {
  const s = cleanText(raw);
  const exact = CONSTRUCTION_CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  for (const [re, cat] of CATEGORY_ALIASES) if (re.test(s)) return cat;
  return 'Varios';
}

/**
 * Valida matemáticamente y normaliza la salida del modelo (o datos ya normalizados).
 * Devuelve el objeto canónico con claves en inglés (interfaz) y en español (servidor/Sheets).
 */
export function validateAndNormalizeExtraction(extracted: any): {
  data: any;
  status: ExtractionStatus;
  camposDudosos: string[];
  reasons: string[];
} {
  const e = extracted || {};
  const dudosos = new Set<string>(Array.isArray(e.campos_dudosos) ? e.campos_dudosos.map(String) : []);
  const reasons: string[] = [];

  const items = (Array.isArray(e.items) ? e.items : [])
    .map((it: any) => {
      const description = cleanText(it.descripcion ?? it.description);
      const quantity = cleanLocaleAmount(it.cantidad ?? it.quantity) || 1;
      let unitPrice = cleanLocaleAmount(it.valor_unitario ?? it.precioUnitario ?? it.unitPrice);
      let total = cleanLocaleAmount(it.valor_total ?? it.total);
      if (!total && unitPrice) total = round2(quantity * unitPrice);
      if (!unitPrice && total) unitPrice = round2(total / quantity);
      const unidad = cleanText(it.unidad ?? it.unit);
      return {
        description, quantity, unitPrice, total, unit: unidad,
        descripcion: description, cantidad: quantity, precioUnitario: unitPrice, valor_unitario: unitPrice, valor_total: total, unidad,
      };
    })
    .filter((it: any) => it.description || it.total);

  const sumItems = round2(items.reduce((acc: number, it: any) => acc + (it.total || 0), 0));

  let total = cleanLocaleAmount(e.total ?? e.totalAmount);
  let iva = cleanLocaleAmount(e.iva ?? e.taxAmount);
  const retenciones = cleanLocaleAmount(e.retenciones);
  const descuentos = cleanLocaleAmount(e.descuentos);
  let subtotal = cleanLocaleAmount(e.subtotal);

  if (!subtotal && sumItems) subtotal = sumItems;
  if (!total && (subtotal || iva)) total = round2(subtotal + iva - retenciones - descuentos);
  if (!subtotal && total) subtotal = round2(total - iva + retenciones + descuentos);

  let taxRatePercent = cleanLocaleAmount(e.tasa_iva ?? e.taxRatePercent);
  if (!taxRatePercent && subtotal > 0 && iva > 0) taxRatePercent = Math.round((iva / subtotal) * 100);

  if (total <= 0) {
    dudosos.add('total');
    reasons.push('No se detectó el total a pagar.');
  }
  const calculated = round2(subtotal + iva - retenciones - descuentos);
  // Tolerancia: $1 o 0,5 % del total (redondeos de IVA por línea)
  const tolerance = Math.max(1.05, total * 0.005);
  if (total > 0 && subtotal > 0 && Math.abs(calculated - total) > tolerance) {
    dudosos.add('subtotal').add('iva').add('total');
    reasons.push(
      `Descuadre: subtotal ${subtotal.toLocaleString('es-CO')} + IVA ${iva.toLocaleString('es-CO')} − retenciones ${retenciones.toLocaleString('es-CO')} − descuentos ${descuentos.toLocaleString('es-CO')} = ${calculated.toLocaleString('es-CO')}, pero el total es ${total.toLocaleString('es-CO')}.`
    );
  }

  const fecha = normalizeDate(e.fecha ?? e.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha).getTime())) {
    dudosos.add('fecha');
    reasons.push('Fecha no detectada o inválida.');
  }

  const proveedor = cleanText(e.proveedor ?? e.vendorName ?? e.cliente);
  if (proveedor.length < 2) {
    dudosos.add('proveedor');
    reasons.push('Proveedor no identificado.');
  }

  const confianza = typeof e.confianza === 'number' ? Math.max(0, Math.min(1, e.confianza)) : 0.8;
  if (confianza < 0.75) reasons.push(`Confianza de lectura baja (${Math.round(confianza * 100)} %).`);

  const status: ExtractionStatus = dudosos.size > 0 || reasons.length > 0 ? 'revisar' : 'leida';
  const confidence = status === 'leida' && confianza >= 0.8 ? 'alta' : confianza >= 0.5 ? 'media' : 'baja';

  const nit = cleanText(e.nit ?? e.vendorTaxId ?? e.nitRut);
  const numeroFactura = cleanText(e.numero_factura ?? e.invoiceNumber ?? e.numeroFactura) || 'S/N';
  const concepto =
    cleanText(e.concepto_resumen ?? e.concept ?? e.concepto) ||
    items.map((i: any) => i.description).filter(Boolean).slice(0, 3).join(', ').toUpperCase();
  const categoria = normalizeCategory(e.categoria ?? e.category);
  const moneda = (cleanText(e.moneda ?? e.currency) || 'COP').toUpperCase();
  const camposDudosos = Array.from(dudosos);

  const data = {
    // Claves de la interfaz (InvoiceData)
    invoiceNumber: numeroFactura,
    date: fecha,
    vendorName: proveedor,
    vendorTaxId: nit,
    concept: concepto,
    category: categoria,
    subtotal,
    taxRatePercent,
    taxAmount: iva,
    totalAmount: total,
    currency: moneda,
    confidenceNotes: reasons.join(' '),
    items,
    quantity: items[0]?.quantity,
    unitPrice: items[0]?.unitPrice,
    // Claves en español (servidor, Sheets, cola)
    proveedor,
    nit,
    numero_factura: numeroFactura,
    fecha,
    iva,
    retenciones,
    descuentos,
    total,
    moneda,
    concepto_resumen: concepto,
    categoria,
    confianza,
    campos_dudosos: camposDudosos,
    reasons,
    confidence,
    // Alias heredados
    cliente: proveedor,
    nitRut: nit,
    numeroFactura,
    concepto,
  };

  return { data, status, camposDudosos, reasons };
}

// ---------------------------------------------------------------------------
// Preparación del documento
// ---------------------------------------------------------------------------

export function detectMimeType(base64: string, mimeType?: string, fileName = ''): string {
  const name = fileName.toLowerCase();
  if (base64.startsWith('JVBERi0') || name.endsWith('.pdf') || mimeType?.includes('pdf')) return 'application/pdf';
  if (name.endsWith('.png') || mimeType?.includes('png')) return 'image/png';
  if (name.endsWith('.webp') || mimeType?.includes('webp')) return 'image/webp';
  if (name.endsWith('.heic') || mimeType?.includes('heic')) return 'image/heic';
  if (/\.(xlsx|xls)$/.test(name) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (name.endsWith('.csv') || mimeType?.includes('csv')) return 'text/csv';
  return mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
}

/** Texto nativo del PDF como apoyo al modelo (rápido; sin renderizar páginas). */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const res = await Promise.race([
      parser.getText({ first: 4 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    return (res as any)?.text?.trim() || '';
  } catch {
    return '';
  } finally {
    parser.destroy().catch(() => {});
  }
}

function spreadsheetToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  return grid.slice(0, 80).map((r) => r.join(' | ')).join('\n');
}

// ---------------------------------------------------------------------------
// Extracción principal
// ---------------------------------------------------------------------------

export class InvoiceExtractionError extends Error {
  constructor(message: string, public cause?: any) {
    super(message);
  }
}

export async function extractInvoice(input: ExtractionInput): Promise<{
  data: any;
  status: ExtractionStatus;
  reasons: string[];
  modelUsed?: string;
  durationMs: number;
}> {
  const fileName = input.fileName || 'factura';
  const base64 = (input.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) throw new InvoiceExtractionError('El archivo está vacío.');

  const mime = detectMimeType(base64, input.mimeType, fileName);
  const buffer = Buffer.from(base64, 'base64');
  const parts: any[] = [];
  let hint = '';

  if (mime === 'application/pdf') {
    parts.push({ inlineData: { mimeType: mime, data: base64 } });
    const text = await extractPdfText(buffer);
    if (text.length > 20) hint = `\n\nTexto digital del PDF (úsalo para confirmar cifras):\n${text.slice(0, 12000)}`;
  } else if (mime.includes('spreadsheet') || mime === 'text/csv') {
    const text = mime === 'text/csv' ? buffer.toString('utf8') : spreadsheetToText(buffer);
    parts.push({ text: `Contenido de la hoja de cálculo "${fileName}":\n${text.slice(0, 15000)}` });
  } else {
    parts.push({ inlineData: { mimeType: mime, data: base64 } });
  }
  parts.push({ text: `Extrae los datos de la factura "${fileName}" según el esquema.${hint}` });

  const result = await callGemini(
    [{ role: 'user', parts }],
    { responseMimeType: 'application/json', responseSchema: INVOICE_SCHEMA, systemInstruction: SYSTEM_INSTRUCTION },
    { task: `Factura ${fileName}`, preferredModel: input.preferredModel }
  );

  if (!result.success || !result.text) {
    throw new InvoiceExtractionError(describeGeminiError(result.error), result.error);
  }

  let parsed: any;
  try {
    parsed = parseModelJson(result.text);
  } catch (err) {
    throw new InvoiceExtractionError('La IA devolvió un formato no válido. Vuelve a intentarlo.', err);
  }

  const validated = validateAndNormalizeExtraction(parsed);
  return {
    data: { ...validated.data, aiExtracted: true, modelUsed: result.modelUsed || null },
    status: validated.status,
    reasons: validated.reasons,
    modelUsed: result.modelUsed,
    durationMs: result.durationMs,
  };
}
