/**
 * Lógica compartida (navegador + servidor) para mapear columnas de las hojas de facturas.
 * Mantener aquí para que todas las rutas escriban y lean filas con el mismo layout.
 */

export const SHEET_HEADERS = [
  'Fecha Registro',
  'Fecha Factura',
  'Nº Factura',
  'Proveedor / Emisor',
  'CIF / NIF / RFC',
  'Concepto / Detalle',
  'Categoría Obra',
  'Base Imponible ($)',
  'IVA / Impuestos ($)',
  'Total ($)',
  'Enlace Factura Drive',
  'Nombre Archivo',
];

/**
 * Normalizes a header title for robust comparison (lowercased, accents removed, symbols stripped).
 */
export function normalizeHeader(header: any): string {
  if (!header) return '';
  return String(header)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ColumnMapping {
  registrationDateCol: number;
  issueDateCol: number;
  invoiceNumberCol: number;
  vendorNameCol: number;
  vendorTaxIdCol: number;
  conceptCol: number;
  categoryCol: number;
  subtotalCol: number;
  taxAmountCol: number;
  taxRateCol: number;
  totalAmountCol: number;
  driveUrlCol: number;
  fileNameCol: number;
  quantityCol: number;
  unitPriceCol: number;
  materialCol: number;
  totalColumns: number;
  isCustomStructure: boolean;
  headers: string[];
}

/**
 * Detects the column positions based on a row of header strings.
 * Adapts flexibly to variations like 'Proveedor', 'Emisor', 'Supplier', 'Factura', 'Nº Factura', etc.
 */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  const norm = (headers || []).map(normalizeHeader);

  const findCol = (regex: RegExp, excludeRegex?: RegExp): number => {
    return norm.findIndex((h) => {
      if (!h) return false;
      if (excludeRegex && excludeRegex.test(h)) return false;
      return regex.test(h);
    });
  };

  // 1. Registration Date vs Issue Date
  let regDateCol = findCol(/fecha.*reg|registro|ingreso|created|f.*reg/);
  let issueDateCol = findCol(/fecha.*factura|fecha.*emision|fecha.*expedicion|f.*factura|date.*inv/);
  if (issueDateCol === -1) {
    issueDateCol = findCol(/^fecha$|^date$|emision|expedicion/, /reg/);
  }

  // 2. Invoice Number
  const invNumCol = findCol(/factura|folio|invoice|num.*fac|no.*fac|n.*fac|nro.*fac|n.*doc|documento/, /fecha/);

  // 3. Vendor / Emisor / Supplier
  const vendorCol = findCol(/proveedor|emisor|supplier|vendor|empresa|razon.*social/);

  // 4. Vendor Tax ID
  const taxIdCol = findCol(/cif|nif|rfc|rut|cuit|tax.*id|nit|id.*fiscal|identificacion.*fiscal/);

  // 5. Concept / Material / Description
  const conceptCol = findCol(/concepto|detalle|descripcion|descripcion.*material|producto|material|articulo|rubro|items|trabajo/);
  const materialCol = findCol(/material|producto|descripcion.*material|item/);

  // 6. Category
  const categoryCol = findCol(/categoria|tipo.*gasto|partida|capitulo|clasificacion/);

  // 7. Quantity
  const quantityCol = findCol(/^cant$|cantidad|^qty$|unidades|piezas/);

  // 8. Unit Price
  const unitPriceCol = findCol(/precio.*unit|valor.*unit|p.*unit|unit.*price|tarifa/);

  // 9. Subtotal / Base
  const subtotalCol = findCol(/\bsub[- ]?total\b|base.*imponible|\bbase\b|neto|monto.*neto|importe.*neto|valor.*subtotal|subtot/);

  // 10. Tax Amount / IVA
  const taxAmountCol = findCol(/\biva\b|cuota.*iva|impuesto|impuestos|tax|monto.*iva|importe.*iva|valor.*iva|retenci/);
  const taxRateCol = findCol(/%.*iva|tipo.*iva|tasa.*iva|porcentaje.*iva/);

  // 11. Total (incluye 'Total a pagar', 'Total Factura', 'Total general', 'Total')
  const totalAmountCol = findCol(/total.*pagar|total.*factura|importe.*total|valor.*total|monto.*total|gran.*total|\btotal\b/);

  // 12. Drive Link / Archivo / Comprobante / Foto
  // Be precise: avoid greedily matching columns like "Tipo de comprobante", "N° Comprobante", "Fecha comprobante"
  let driveUrlCol = findCol(
    /drive|enlace|link|url|foto|fotos|imagen|imagenes|imágenes|adjunto|soporte.*digital|archivo.*drive|comprobante.*archivo|archivo.*comprobante/,
    /tipo.*comp|num.*comp|no.*comp|n.*comp|nro.*comp|serie|fecha/
  );
  if (driveUrlCol === -1) {
    driveUrlCol = findCol(
      /comprobante|soporte|archivo|foto|imagen|documento/,
      /tipo.*comp|num.*comp|no.*comp|n.*comp|nro.*comp|serie|fecha|nombre.*archivo|nombre.*documento|file.*name/
    );
  }
  let fileNameCol = findCol(/nombre.*(?:archivo|documento|doc|factura|soporte)|(?:archivo|documento).*original|file.*name|document.*name|filename/);
  if (fileNameCol === -1) {
    fileNameCol = findCol(/nombre.*archivo|nombre.*documento|nombre.*soporte|nombre.*comprobante/);
  }

  // Check if standard SVH structure
  const isDefaultSVH =
    headers.length >= 10 &&
    Boolean(norm[0]?.includes('fecha') && norm[1]?.includes('fecha') && norm[2]?.includes('factura'));

  return {
    registrationDateCol: regDateCol !== -1 ? regDateCol : isDefaultSVH ? 0 : -1,
    issueDateCol: issueDateCol !== -1 ? issueDateCol : isDefaultSVH ? 1 : -1,
    invoiceNumberCol: invNumCol !== -1 ? invNumCol : isDefaultSVH ? 2 : -1,
    vendorNameCol: vendorCol !== -1 ? vendorCol : isDefaultSVH ? 3 : -1,
    vendorTaxIdCol: taxIdCol !== -1 ? taxIdCol : isDefaultSVH ? 4 : -1,
    conceptCol: conceptCol !== -1 ? conceptCol : isDefaultSVH ? 5 : -1,
    categoryCol: categoryCol !== -1 ? categoryCol : isDefaultSVH ? 6 : -1,
    subtotalCol: subtotalCol !== -1 ? subtotalCol : isDefaultSVH ? 7 : -1,
    taxAmountCol: taxAmountCol !== -1 ? taxAmountCol : isDefaultSVH ? 8 : -1,
    taxRateCol,
    totalAmountCol: totalAmountCol !== -1 ? totalAmountCol : isDefaultSVH ? 9 : -1,
    driveUrlCol: driveUrlCol !== -1 ? driveUrlCol : isDefaultSVH ? 10 : -1,
    fileNameCol: fileNameCol !== -1 ? fileNameCol : isDefaultSVH ? 11 : -1,
    quantityCol,
    unitPriceCol,
    materialCol,
    totalColumns: headers.length,
    isCustomStructure: !isDefaultSVH,
    headers,
  };
}

/** Celda con importe, número o fecha: indica fila de datos, no de encabezados. */
export function looksLikeDataValue(cell: any): boolean {
  if (typeof cell === 'number') return true;
  const s = String(cell ?? '').trim();
  return /^[$€]?\s?-?[\d.,]+$/.test(s) || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(s);
}

/**
 * Converts a 0-indexed column number to standard A1 notation (0 -> A, 25 -> Z, 26 -> AA).
 */
export function colIndexToA1Notation(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}
