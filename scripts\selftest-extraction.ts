/**
 * Pruebas rápidas sin red de la normalización de facturas y del mapeo de columnas.
 * Ejecutar: npx tsx scripts/selftest-extraction.ts
 */
import assert from 'node:assert/strict';
import {
  cleanLocaleAmount,
  normalizeDate,
  normalizeCategory,
  validateAndNormalizeExtraction,
  extractInvoice,
} from '../src/server/invoiceExtraction';
import { detectColumnMapping, SHEET_HEADERS } from '../src/utils/sheetColumns';
import { nextQuotaReset, DailyQuotaError } from '../src/server/gemini';
import { buildRowValues, getSheetSession, appendInvoiceRow, withGoogleRetry } from '../src/server/sheetsWriter';

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
};

await test('importes colombianos y regionales', () => {
  assert.equal(cleanLocaleAmount('$ 1.500.000'), 1500000);
  assert.equal(cleanLocaleAmount('70.509'), 70509);
  assert.equal(cleanLocaleAmount('1.250,50'), 1250.5);
  assert.equal(cleanLocaleAmount('1,500,000.75'), 1500000.75);
  assert.equal(cleanLocaleAmount('1250.50'), 1250.5);
  assert.equal(cleanLocaleAmount(922964), 922964);
  assert.equal(cleanLocaleAmount(null), 0);
});

await test('fechas DD/MM/AAAA → AAAA-MM-DD', () => {
  assert.equal(normalizeDate('05/03/2026'), '2026-03-05');
  assert.equal(normalizeDate('2026-3-5'), '2026-03-05');
  assert.equal(normalizeDate('5-3-26'), '2026-03-05');
});

await test('categorías heredadas se mapean a las de la interfaz', () => {
  assert.equal(normalizeCategory('material'), 'Materiales');
  assert.equal(normalizeCategory('EPP'), 'Seguridad y Salud');
  assert.equal(normalizeCategory('herramienta'), 'Maquinaria y Equipos');
  assert.equal(normalizeCategory('Transporte y Logística'), 'Transporte y Logística');
  assert.equal(normalizeCategory('???'), 'Varios');
});

await test('factura cuadrada → leida con claves de interfaz y español', () => {
  const { data, status } = validateAndNormalizeExtraction({
    proveedor: 'Ferretería El Constructor SAS',
    nit: '900123456-7',
    numero_factura: 'FE-1024',
    fecha: '12/09/2026',
    subtotal: 775600,
    iva: 147364,
    retenciones: 0,
    descuentos: 0,
    total: 922964,
    moneda: 'cop',
    concepto_resumen: 'COMPRA CEMENTO Y VARILLA',
    categoria: 'Materiales',
    items: [
      { descripcion: 'Cemento gris 50kg', cantidad: 20, valor_unitario: 28780 },
      { descripcion: 'Varilla 1/2', cantidad: 10, valor_total: 200000 },
    ],
    confianza: 0.95,
  });
  assert.equal(status, 'leida');
  assert.equal(data.vendorName, 'Ferretería El Constructor SAS');
  assert.equal(data.date, '2026-09-12');
  assert.equal(data.totalAmount, 922964);
  assert.equal(data.taxAmount, 147364);
  assert.equal(data.taxRatePercent, 19);
  assert.equal(data.currency, 'COP');
  assert.equal(data.category, 'Materiales');
  assert.equal(data.items[0].total, 575600);
  assert.equal(data.items[1].unitPrice, 20000);
  assert.equal(data.items[0].description, 'Cemento gris 50kg');
  assert.equal(data.proveedor, data.vendorName);
});

await test('descuadre o datos faltantes → revisar con motivos', () => {
  const { status, reasons, camposDudosos } = validateAndNormalizeExtraction({
    proveedor: null,
    fecha: null,
    subtotal: 100000,
    iva: 19000,
    total: 150000,
    items: [],
    confianza: 0.6,
  });
  assert.equal(status, 'revisar');
  assert.ok(reasons.some((r) => r.startsWith('Descuadre')));
  assert.ok(camposDudosos.includes('proveedor') && camposDudosos.includes('fecha'));
});

await test('redondeo de IVA por línea dentro de tolerancia', () => {
  const { status } = validateAndNormalizeExtraction({
    proveedor: 'ACME', fecha: '2026-01-01', subtotal: 1000000, iva: 190000, total: 1190003,
    items: [{ descripcion: 'x', valor_total: 1000000 }], confianza: 0.9,
  });
  assert.equal(status, 'leida');
});

await test('fila para hoja estándar SVH en el orden correcto', () => {
  const mapping = detectColumnMapping([...SHEET_HEADERS]);
  const { data } = validateAndNormalizeExtraction({
    proveedor: 'ACME', nit: '9001', numero_factura: 'A-1', fecha: '2026-01-02',
    subtotal: 100, iva: 19, total: 119, items: [], confianza: 0.9, categoria: 'Varios', concepto_resumen: 'PRUEBA',
  });
  const row = buildRowValues(mapping, data, 'https://drive.google.com/file/d/abc/view', 'f.pdf');
  assert.deepEqual(row.slice(1), [
    '2026-01-02', 'A-1', 'ACME', '9001', 'PRUEBA', 'Varios', 100, 19, 119,
    '=HYPERLINK("https://drive.google.com/file/d/abc/view", "Ver Factura en Drive")', 'f.pdf',
  ]);
});

await test('fila para hoja con columnas propias', () => {
  const mapping = detectColumnMapping(['Fecha', 'Proveedor', 'NIT', 'Concepto', 'Total', 'Soporte']);
  const row = buildRowValues(mapping, { date: '2026-01-02', vendorName: 'ACME', vendorTaxId: '9', concept: 'C', totalAmount: 5 }, 'u', '');
  assert.equal(row[0], '2026-01-02');
  assert.equal(row[1], 'ACME');
  assert.equal(row[4], 5);
  assert.ok(String(row[5]).startsWith('=HYPERLINK'));
});

await test('20 facturas en paralelo leen la hoja una sola vez', async () => {
  let reads = 0;
  let appends = 0;
  const fakeSheets: any = {
    spreadsheets: {
      get: async () => { reads++; return { data: { sheets: [{ properties: { title: 'Facturas' } }] } }; },
      values: {
        get: async (p: any) => {
          reads++;
          return { data: { values: p.range.endsWith('1:6') ? [[...SHEET_HEADERS]] : [[...SHEET_HEADERS]] } };
        },
        update: async () => ({}),
        append: async () => { appends++; return {}; },
      },
    },
  };
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      appendInvoiceRow({ sheets: fakeSheets, spreadsheetId: 'S1', tab: 'Facturas', invoice: { vendorName: `P${i}` }, token: 'tok-abc' })
    )
  );
  const session = await getSheetSession(fakeSheets, 'tok-abc', 'S1', 'Facturas');
  assert.equal(session.layout.tab, 'Facturas');
  assert.equal(appends, 20);
  assert.equal(reads, 3); // metadatos + encabezados + registros existentes
});

await test('Google 429 se reintenta en vez de fallar', async () => {
  let calls = 0;
  const value = await withGoogleRetry(async () => {
    calls++;
    if (calls < 2) throw Object.assign(new Error('Quota exceeded for quota metric Read requests'), { code: 429, response: { headers: { 'retry-after': '0.01' } } });
    return 'ok';
  }, 'test');
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
});

await test('reinicio del cupo diario a medianoche del Pacífico', () => {
  // 13 oct 2026 15:00 UTC = 08:00 PDT → reinicio 14 oct 07:00 UTC (02:00 Colombia)
  assert.equal(nextQuotaReset(new Date('2026-10-13T15:00:00Z')).toISOString(), '2026-10-14T07:00:00.000Z');
  // En invierno (PST) el reinicio es a las 08:00 UTC (03:00 Colombia)
  assert.equal(nextQuotaReset(new Date('2026-12-01T15:00:00Z')).toISOString(), '2026-12-02T08:00:00.000Z');
  assert.ok(new DailyQuotaError().message.includes('cupo diario'));
});

await test('hoja con logo arriba y filas vacías: encabezado en fila 4 y números de fila reales', async () => {
  const { analyzeAndFetchDynamicSheet } = await import('../src/services/googleDriveSheets');
  const header = ['Fecha', 'Cliente / Proveedor', 'NIT / RUT', 'Concepto / Detalle', 'Categoría', 'Subtotal', 'IVA', 'Total a Pagar', 'Comprobante / Archivo'];
  const values = [
    [], [], [], header,
    ['2026-09-21', 'MARCELA', '1088', 'SILICONA', 'Materiales', '$10,420.17', '$1,979.83', '$12,400.00', 'Ver Factura en Drive'],
    [],
    ['2021-09-10', 'FERREINOX', '8908', 'ACRILICO', 'Materiales', '$1,593,246.00', '$287,034.47', '$1,880,280.47', 'Ver Factura en Drive'],
  ];
  const link = (id: string) => `=HYPERLINK("https://drive.google.com/file/d/${id}/view", "Ver Factura en Drive")`;
  const formulas = values.map((r, i) => (r.length && i > 3 ? [...r.slice(0, 8), link(`FILE${i + 1}`)] : r));
  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    const body = url.includes('/values/')
      ? { values: url.includes('FORMULA') ? formulas : values }
      : { properties: { title: 'Obra' }, sheets: [{ properties: { sheetId: 0, title: 'Hoja 1', index: 0 } }] };
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  try {
    const a = await analyzeAndFetchDynamicSheet('tok', 'S1', 'Control Facturas');
    assert.equal(a.activeTab, 'Hoja 1');
    assert.equal(a.headers[0], 'Fecha');
    assert.deepEqual(a.rows.map((r) => r.rowIndex), [5, 7]);
    assert.equal(a.rows[1].invoiceRecord?.vendorName, 'FERREINOX');
    assert.equal(a.rows[1].invoiceRecord?.totalAmount, 1880280.47);
    assert.equal(a.rows[1].invoiceRecord?.driveFileUrl, 'https://drive.google.com/file/d/FILE7/view');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test('sin clave de Gemini → error claro en español', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(extractInvoice({ base64: 'aGVsbG8=', mimeType: 'image/jpeg' }), /GEMINI_API_KEY/);
  if (saved) process.env.GEMINI_API_KEY = saved;
});

console.log(`\n${passed} pruebas superadas`);
