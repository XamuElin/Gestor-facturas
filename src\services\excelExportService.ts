import * as XLSX from 'xlsx';
import {
  FacturaSismoItem,
  BitacoraRecord,
  NominaRecord,
  InventarioRecord,
  AbonoRecordItem,
  calculateTotalMateriales,
  groupBitacorasByMonth,
  calculateTotalAbonos,
  calculateTotalObra,
  calculateSaldoObra,
} from '../utils/constructionCalculations';

export interface ExportDataPayload {
  projectName: string;
  facturas: FacturaSismoItem[];
  bitacoras: BitacoraRecord[];
  nominas: NominaRecord[];
  inventario: InventarioRecord[];
  abonos: AbonoRecordItem[];
}

export function exportConstructionWorkbook(payload: ExportDataPayload): void {
  const wb = XLSX.utils.book_new();

  // -------------------------------------------------------------------------
  // 1. PESTAÑA: FACTURAS ("ADECUACIONES SISMO")
  // Columnas: N.º consecutivo, Concepto, Costo, Fecha, Observación, Factura
  // -------------------------------------------------------------------------
  const facturasHeaders = [
    'N.º Consecutivo',
    'Concepto',
    'Costo',
    'Fecha',
    'Observación',
    'Factura (Archivo)',
  ];

  const facturasRows: any[][] = [facturasHeaders];
  payload.facturas.forEach((f, idx) => {
    facturasRows.push([
      f.consecutivo || idx + 1,
      f.concepto || '',
      Number(f.costo) || 0,
      f.fecha || '',
      f.observacion || '',
      f.facturaVinculada?.fileName || f.facturaVinculada?.url || (f.estado === 'falta_factura' ? 'FALTA FACTURA' : 'SOPORTE DRIVE'),
    ]);
  });

  const wsFacturas = XLSX.utils.aoa_to_sheet(facturasRows);
  const facturasRowCount = payload.facturas.length;
  const lastFacturaRow = facturasRowCount + 1; // 1-indexed

  // Agregar fila TOTAL MATERIALES con fórmula de Excel SUM
  if (facturasRowCount > 0) {
    const totalRowIdx = lastFacturaRow + 1;
    XLSX.utils.sheet_add_aoa(
      wsFacturas,
      [
        ['', 'TOTAL MATERIALES', { t: 'n', f: `SUM(C2:C${lastFacturaRow})`, v: calculateTotalMateriales(payload.facturas) }, '', '', ''],
      ],
      { origin: `A${totalRowIdx}` }
    );
  }
  XLSX.utils.book_append_sheet(wb, wsFacturas, 'FACTURAS');

  // -------------------------------------------------------------------------
  // 2. PESTAÑA: MANO DE OBRA
  // Filas por trabajador: Concepto, DÍA, SALUD, LIQUIDACIÓN, SUBTOTAL, DÍAS, TOTAL
  // SUBTOTAL = DÍA + SALUD + LIQUIDACIÓN
  // TOTAL = SUBTOTAL * DÍAS
  // Agrupado por mes y con subtotales
  // -------------------------------------------------------------------------
  const manoDeObraRows: any[][] = [];
  manoDeObraRows.push(['BITÁCORAS DE MANO DE OBRA - ' + payload.projectName.toUpperCase()]);
  manoDeObraRows.push([]);

  let globalManoDeObraTotal = 0;

  payload.bitacoras.forEach((b, bIdx) => {
    manoDeObraRows.push([`BITÁCORA: ${b.titulo}`, `Período: ${b.fechaInicio} a ${b.fechaFin}`]);
    manoDeObraRows.push(['Concepto', 'DÍA', 'SALUD', 'LIQUIDACIÓN', 'SUBTOTAL', 'DÍAS', 'TOTAL']);

    const startRow = manoDeObraRows.length + 1;
    b.filas.forEach((f) => {
      manoDeObraRows.push([
        f.concepto,
        f.dia,
        f.salud,
        f.liquidacion,
        f.subtotal,
        f.dias,
        f.total,
      ]);
    });
    const endRow = manoDeObraRows.length;

    // Fila Total de la bitácora
    manoDeObraRows.push([
      'TOTAL BITÁCORA',
      '',
      '',
      '',
      '',
      '',
      { t: 'n', f: `SUM(G${startRow}:G${endRow})`, v: b.total },
    ]);
    manoDeObraRows.push([]); // Espacio en blanco
    globalManoDeObraTotal += b.total;
  });

  // Resumen mensual de mano de obra
  const grouped = groupBitacorasByMonth(payload.bitacoras);
  manoDeObraRows.push(['--- RESUMEN POR MES ---']);
  manoDeObraRows.push(['Mes', 'Total del Mes']);
  grouped.meses.forEach((m) => {
    manoDeObraRows.push([m.monthName, m.totalMes]);
  });
  manoDeObraRows.push(['SUBTOTAL MANO DE OBRA', grouped.subtotalManoDeObra]);

  const wsManoDeObra = XLSX.utils.aoa_to_sheet(manoDeObraRows);
  XLSX.utils.book_append_sheet(wb, wsManoDeObra, 'MANO DE OBRA');

  // -------------------------------------------------------------------------
  // 3. PESTAÑA: NOMINAS
  // Por trabajador: ITEM, Nombre, Fecha inicio, Salario, Auxilio de transporte,
  // SUBTOTAL, Descuentos salud/pensión, TOTAL, Valor día, Modo de pago,
  // Días trabajados, Días a descontar, Horas extras, Subtotal HE, A pagar, Notas
  // -------------------------------------------------------------------------
  const nominasRows: any[][] = [];
  nominasRows.push(['CONTROL DE NÓMINAS QUINCENALES - ' + payload.projectName.toUpperCase()]);
  nominasRows.push([]);

  payload.nominas.forEach((nom) => {
    nominasRows.push([nom.titulo, `Período: ${nom.periodo}`]);
    nominasRows.push([
      'ITEM',
      'Nombre',
      'Fecha inicio',
      'Salario',
      'Auxilio transporte',
      'SUBTOTAL',
      'Descuentos',
      'TOTAL',
      'Valor día',
      'Modo de pago',
      'Días trabajados',
      'Días a descontar',
      'Horas extras',
      'Subtotal HE',
      'A PAGAR',
      'Notas',
    ]);

    const startRow = nominasRows.length + 1;
    nom.filas.forEach((f) => {
      nominasRows.push([
        f.item,
        f.nombre,
        f.fechaInicio,
        f.salario,
        f.auxilioTransporte,
        f.subtotal,
        f.descuentos,
        f.total,
        f.valorDia,
        f.modoPago,
        f.diasTrabajados,
        f.diasDescontar,
        f.horasExtras,
        f.subtotalHorasExtras,
        f.aPagar,
        f.notas,
      ]);
    });
    const endRow = nominasRows.length;

    nominasRows.push([
      'TOTAL NÓMINA',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      { t: 'n', f: `SUM(O${startRow}:O${endRow})`, v: nom.total },
      '',
    ]);
    nominasRows.push([]);
  });

  const wsNominas = XLSX.utils.aoa_to_sheet(nominasRows);
  XLSX.utils.book_append_sheet(wb, wsNominas, 'NOMINAS');

  // -------------------------------------------------------------------------
  // 4. PESTAÑA: INVENTARIO
  // Columnas: Nombre, Unidad, Cantidad, Fecha de ingreso, Observación, Factura vinculada
  // -------------------------------------------------------------------------
  const inventarioHeaders = [
    'Nombre',
    'Unidad',
    'Cantidad',
    'Fecha de ingreso',
    'Observación',
    'Factura vinculada',
  ];
  const inventarioRows: any[][] = [inventarioHeaders];

  payload.inventario.forEach((it) => {
    inventarioRows.push([
      it.nombre,
      it.unidad,
      it.cantidad,
      it.fechaIngreso,
      it.observacion || '',
      it.facturaVinculada || '',
    ]);
  });

  const wsInventario = XLSX.utils.aoa_to_sheet(inventarioRows);
  XLSX.utils.book_append_sheet(wb, wsInventario, 'INVENTARIO');

  // -------------------------------------------------------------------------
  // 5. PESTAÑA: ABONO
  // Columnas: Ítem (Primer abono, Segundo abono…), Costo, Fecha, N.º consecutivo
  // Total abonos = suma de costos
  // -------------------------------------------------------------------------
  const abonosHeaders = ['N.º Consecutivo', 'Ítem', 'Costo', 'Fecha', 'Observación'];
  const abonosRows: any[][] = [abonosHeaders];

  payload.abonos.forEach((ab, idx) => {
    abonosRows.push([
      ab.consecutivo || idx + 1,
      ab.item,
      ab.costo,
      ab.fecha,
      ab.observacion || '',
    ]);
  });

  const abonosCount = payload.abonos.length;
  const lastAbonoRow = abonosCount + 1;
  const wsAbonos = XLSX.utils.aoa_to_sheet(abonosRows);

  if (abonosCount > 0) {
    const totalRow = lastAbonoRow + 1;
    XLSX.utils.sheet_add_aoa(
      wsAbonos,
      [
        ['', 'TOTAL ABONOS', { t: 'n', f: `SUM(C2:C${lastAbonoRow})`, v: calculateTotalAbonos(payload.abonos) }, '', ''],
      ],
      { origin: `A${totalRow}` }
    );
  }
  XLSX.utils.book_append_sheet(wb, wsAbonos, 'ABONO');

  // -------------------------------------------------------------------------
  // 6. PESTAÑA: RESUMEN ("CUADRO DE COSTOS")
  // Tarjetas:
  // SUBTOTAL MATERIALES
  // SUBTOTAL MANO DE OBRA
  // TOTAL OBRA = materiales + mano de obra
  // TOTAL ABONOS
  // SALDO = abonos - total obra
  // Total nóminas (referencia)
  // -------------------------------------------------------------------------
  const subtotalMateriales = calculateTotalMateriales(payload.facturas);
  const subtotalManoDeObra = grouped.subtotalManoDeObra;
  const totalObra = calculateTotalObra(subtotalMateriales, subtotalManoDeObra);
  const totalAbonos = calculateTotalAbonos(payload.abonos);
  const saldo = calculateSaldoObra(totalAbonos, totalObra);
  const totalNominas = payload.nominas.reduce((acc, n) => acc + (Number(n.total) || 0), 0);

  const resumenRows: any[][] = [
    ['CUADRO DE COSTOS Y BALANCE GENERAL DE OBRA'],
    ['Proyecto / Obra:', payload.projectName],
    ['Fecha de Generación:', new Date().toISOString().split('T')[0]],
    [],
    ['CONCEPTO FINANCIERO', 'VALOR (COP)', 'FÓRMULA / ORIGEN'],
    ['SUBTOTAL MATERIALES', subtotalMateriales, 'Suma de costos en pestaña FACTURAS'],
    ['SUBTOTAL MANO DE OBRA', subtotalManoDeObra, 'Suma de bitácoras en pestaña MANO DE OBRA'],
    ['TOTAL OBRA', { t: 'n', f: 'B6+B7', v: totalObra }, 'Materiales + Mano de Obra'],
    ['TOTAL ABONOS', totalAbonos, 'Suma de ingresos en pestaña ABONO'],
    ['SALDO DISPONIBLE', { t: 'n', f: 'B9-B8', v: saldo }, 'Abonos − Total Obra'],
    [],
    ['REFERENCIA INFORMATIVA (NÓMINAS)', '', ''],
    ['Total Nóminas Liquidado', totalNominas, 'Informativo (NO se suma al total de obra)'],
  ];

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'RESUMEN');

  // Descarga directa del archivo
  const safeTitle = (payload.projectName || 'Control_Obra').replace(/[^\w\s-]/gi, '_');
  XLSX.writeFile(wb, `${safeTitle}_Control_Costos.xlsx`);
}
