import { InvoiceData, SheetInvoiceRecord } from '../types';

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: string;
  matchedRecord?: SheetInvoiceRecord;
  confidence: 'high' | 'medium' | 'none';
}

/**
 * Normaliza cadenas de texto para cotejar duplicados sin falsos negativos:
 * Convierte a minúsculas, elimina tildes/acentos, espacios y caracteres especiales.
 */
function normalizeString(s?: string | null): string {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
    .replace(/[^a-z0-9]/g, '') // Solo caracteres alfanuméricos
    .trim();
}

/**
 * Limpia nombres de empresas/proveedores eliminando sufijos legales típicos
 * (SAS, S.A.S, LTDA, S.A., S.L., DE C.V., ETC.)
 */
function cleanVendorName(s?: string | null): string {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(sas|s\.a\.s|ltda|s\.a|s\.l|de c\.v|cia|e\.u|sucursal|constructora|ferreteria|deposito)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Genera el título corporativo oficial de la hoja de cálculo de un proyecto:
 * "<Nombre del Proyecto> Facturación"
 */
export function buildProjectSpreadsheetTitle(projectName: string): string {
  const cleanProject = (projectName || '')
    .replace(/^(Obra:\s*|Proyecto:\s*)/i, '')
    .replace(/[:\/\\?*|"]/g, ' ')
    .trim();
  const base = cleanProject || 'Proyecto';
  if (/facturaci[oó]n/i.test(base)) {
    return base;
  }
  return `${base} Facturación`;
}

/**
 * Valida minuciosamente si una factura ya fue registrada en la hoja de cálculo
 * para impedir bajo cualquier circunstancia la doble facturación.
 */
export function checkInvoiceDuplicate(
  invoice: Partial<InvoiceData | SheetInvoiceRecord>,
  existingInvoices: SheetInvoiceRecord[],
  fileName?: string,
  driveFileId?: string
): DuplicateCheckResult {
  if (!existingInvoices || existingInvoices.length === 0) {
    return { isDuplicate: false, confidence: 'none' };
  }

  const newFileNameNorm = normalizeString(fileName || (invoice as SheetInvoiceRecord).fileName);
  const newBaseFileName = newFileNameNorm.replace(/\.[a-z0-9]+$/i, '');
  const newDriveFileId = (driveFileId || '').trim();

  // 1. Verificación por enlace o ID único de Google Drive
  if (newDriveFileId) {
    const driveMatch = existingInvoices.find((ext) => {
      const url = ext.driveFileUrl || '';
      return url.includes(newDriveFileId);
    });
    if (driveMatch) {
      return {
        isDuplicate: true,
        reason: `El archivo ya se encuentra registrado y vinculado en la hoja de cálculo (${driveMatch.fileName || driveMatch.vendorName}).`,
        matchedRecord: driveMatch,
        confidence: 'high',
      };
    }
  }

  // 2. Verificación por Nombre de Archivo idéntico
  if (newFileNameNorm && newFileNameNorm.length > 3) {
    const fileMatch = existingInvoices.find((ext) => {
      const extFileNorm = normalizeString(ext.fileName);
      const extBaseNorm = extFileNorm.replace(/\.[a-z0-9]+$/i, '');
      return (
        extFileNorm === newFileNameNorm ||
        (extBaseNorm && extBaseNorm === newBaseFileName && newBaseFileName.length > 3)
      );
    });
    if (fileMatch) {
      return {
        isDuplicate: true,
        reason: `Ya existe una factura registrada con el archivo "${fileMatch.fileName}".`,
        matchedRecord: fileMatch,
        confidence: 'high',
      };
    }
  }

  const newInvNum = normalizeString(invoice.invoiceNumber);
  const isGenericInvNum =
    !newInvNum ||
    newInvNum === 'sn' ||
    newInvNum === 's/n' ||
    newInvNum === 'sinnumero' ||
    newInvNum === 'na' ||
    newInvNum === 'null' ||
    newInvNum.length < 2;

  const newVendorNorm = cleanVendorName(invoice.vendorName);
  const newTaxIdNorm = normalizeString(invoice.vendorTaxId);
  const newTotal = Number(invoice.totalAmount ?? (invoice as any).total ?? 0);
  const newDate = String((invoice as any).date || (invoice as SheetInvoiceRecord).issueDate || '').trim();

  // 3. Verificación por Número de Factura + Proveedor / NIT / Total
  if (!isGenericInvNum) {
    for (const ext of existingInvoices) {
      const extInvNum = normalizeString(ext.invoiceNumber);
      if (!extInvNum || extInvNum === 'sn' || extInvNum === 's/n') continue;

      if (extInvNum === newInvNum) {
        // Coincide el número de factura. Verificamos ahora el emisor / NIT / Total
        const extTaxIdNorm = normalizeString(ext.vendorTaxId);
        const extVendorNorm = cleanVendorName(ext.vendorName);
        const extTotal = Number(ext.totalAmount ?? 0);

        // A. Mismo NIT/RUT o CIF
        if (newTaxIdNorm && extTaxIdNorm && newTaxIdNorm === extTaxIdNorm) {
          return {
            isDuplicate: true,
            reason: `La factura N° ${invoice.invoiceNumber} del proveedor "${ext.vendorName}" (NIT ${ext.vendorTaxId}) ya está registrada en la hoja de cálculo.`,
            matchedRecord: ext,
            confidence: 'high',
          };
        }

        // B. Mismo Proveedor o similitud en nombre
        const vendorMatches =
          newVendorNorm && extVendorNorm
            ? newVendorNorm === extVendorNorm ||
              newVendorNorm.includes(extVendorNorm) ||
              extVendorNorm.includes(newVendorNorm)
            : false;

        if (vendorMatches) {
          return {
            isDuplicate: true,
            reason: `La factura N° ${invoice.invoiceNumber} emitida por "${ext.vendorName}" ya se encuentra registrada en la hoja de cálculo.`,
            matchedRecord: ext,
            confidence: 'high',
          };
        }

        // C. Mismo monto total
        if (newTotal > 0 && extTotal > 0 && Math.abs(newTotal - extTotal) < 0.05) {
          return {
            isDuplicate: true,
            reason: `La factura N° ${invoice.invoiceNumber} con importe de $${newTotal.toLocaleString('es-CO')} ya está registrada en la hoja de cálculo.`,
            matchedRecord: ext,
            confidence: 'high',
          };
        }

        // D. Si no hay proveedor detallado pero el número coincide exactamente
        if (!newVendorNorm || !extVendorNorm) {
          return {
            isDuplicate: true,
            reason: `El consecutivo N° ${invoice.invoiceNumber} ya existe registrado en la hoja de cálculo.`,
            matchedRecord: ext,
            confidence: 'high',
          };
        }
      }
    }
  }

  // 4. Verificación por Proveedor + Total Idéntico + Fecha Coincidente (para comprobantes sin número o S/N)
  if (newVendorNorm && newTotal > 0) {
    for (const ext of existingInvoices) {
      const extVendorNorm = cleanVendorName(ext.vendorName);
      const extTotal = Number(ext.totalAmount ?? 0);
      const extDate = String(ext.issueDate || '').trim();

      const vendorMatches =
        newVendorNorm === extVendorNorm ||
        (newVendorNorm.length >= 4 && extVendorNorm.includes(newVendorNorm)) ||
        (extVendorNorm.length >= 4 && newVendorNorm.includes(extVendorNorm));

      const amountMatches = extTotal > 0 && Math.abs(newTotal - extTotal) < 0.05;
      const dateMatches = newDate && extDate ? newDate === extDate : false;

      if (vendorMatches && amountMatches && dateMatches) {
        return {
          isDuplicate: true,
          reason: `Ya existe una factura registrada de "${ext.vendorName}" por $${newTotal.toLocaleString('es-CO')} de fecha ${newDate}. Se omite para no duplicar el gasto.`,
          matchedRecord: ext,
          confidence: 'high',
        };
      }
    }
  }

  return { isDuplicate: false, confidence: 'none' };
}
