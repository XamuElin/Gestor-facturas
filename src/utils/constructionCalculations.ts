/**
 * Funciones puras de cálculo contable y financiero para obras de construcción.
 * Replicando exactamente la matemática y fórmulas del Excel del cliente.
 */

export type RegistroOrigen = 'manual' | 'importado' | 'ia';

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface WorkerCatalogItem {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  nombre: string;
  rol: 'oficial' | 'ayudante' | 'cielo raso' | 'otro';
  fechaInicio: string;
  tipo: 'con prestaciones' | 'independiente';
  salarioMensual: number;
  auxilioTransporte: number;
  descuentoSaludPension: number;
}

export interface FilaBitacora {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  workerId?: string;
  concepto: string; // nombre + rol
  dia: number; // valor del día
  salud: number;
  liquidacion: number;
  subtotal: number; // DÍA + SALUD + LIQUIDACIÓN
  dias: number; // acepta pasos de 0.5
  total: number; // SUBTOTAL * DÍAS
}

export interface BitacoraRecord {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  titulo: string; // Ej: "Bitácora 16/09/2026 – 30/09/2026"
  fechaInicio: string;
  fechaFin: string;
  filas: FilaBitacora[];
  total: number;
  createdAt?: number;
}

export interface NominaParametros {
  divisorMensual: number; // por defecto 30
  jornadaHoras: number; // por defecto 8.5
  auxilioTransporte: number; // por defecto 250000
  descuentoSaludPension: number; // por defecto 140000
}

export const DEFAULT_NOMINA_PARAMETROS: NominaParametros = {
  divisorMensual: 30,
  jornadaHoras: 8.5,
  auxilioTransporte: 250000,
  descuentoSaludPension: 140000,
};

export interface FilaNomina {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  item: number;
  workerId?: string;
  nombre: string;
  fechaInicio: string;
  salario: number;
  auxilioTransporte: number;
  subtotal: number; // Salario + Auxilio
  descuentos: number; // Salud / pensión
  total: number; // SUBTOTAL - Descuentos (independiente: Salario)
  valorDia: number; // TOTAL / 30
  modoPago: 'quincena' | 'por dias';
  diasTrabajados: number;
  diasDescontar: number;
  horasExtras: number;
  notas: string;
  subtotalHorasExtras: number; // Horas extras * VALOR DÍA / 8.5
  aPagar: number;
}

export interface NominaRecord {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  titulo: string; // Ej: "NÓMINA 02 (01/09/2026)-(15/09/2026)"
  periodo: string;
  parametros?: NominaParametros;
  filas: FilaNomina[];
  total: number;
  createdAt?: number;
}

export interface FacturaSismoItem {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  consecutivo: number; // 1, 2, 3...
  concepto: string;
  costo: number;
  fecha: string;
  observacion: string; // PAGADO, FALTA FACTURA, o texto libre
  facturaVinculada?: {
    fileId?: string;
    fileName?: string;
    webViewLink?: string;
    url?: string;
  };
  estado: 'todas' | 'por_revisar' | 'falta_factura' | 'pagado' | 'confirmada';
  origenJobId?: string;
  createdAt?: number;
}

export interface InventarioRecord {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  nombre: string;
  unidad: string; // UN, M, KG, etc.
  cantidad: number;
  fechaIngreso: string;
  observacion: string;
  facturaVinculada?: string;
  createdAt?: number;
}

export interface AbonoRecordItem {
  id: string;
  obraId?: string;
  origen?: RegistroOrigen;
  creadoEn?: number | string;
  actualizadoEn?: number | string;
  consecutivo: number; // 1, 2, 3...
  item: string; // "Primer abono", "Segundo abono", etc.
  costo: number;
  fecha: string;
  observacion?: string;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// 1. MANO DE OBRA (BITÁCORAS)
// ---------------------------------------------------------------------------

/**
 * SUBTOTAL = DÍA + SALUD + LIQUIDACIÓN
 */
export function calculateSubtotalFilaBitacora(dia: number, salud: number, liquidacion: number): number {
  return (Number(dia) || 0) + (Number(salud) || 0) + (Number(liquidacion) || 0);
}

/**
 * TOTAL = SUBTOTAL × DÍAS
 */
export function calculateTotalFilaBitacora(subtotal: number, dias: number): number {
  return Math.round((Number(subtotal) || 0) * (Number(dias) || 0));
}

/**
 * Recalcula completamente una fila de bitácora
 */
export function recalculateFilaBitacora(fila: Partial<FilaBitacora>): FilaBitacora {
  const dia = Number(fila.dia) || 0;
  const salud = Number(fila.salud) || 0;
  const liquidacion = Number(fila.liquidacion) || 0;
  const dias = Math.max(0, Number(fila.dias) || 0);
  const subtotal = calculateSubtotalFilaBitacora(dia, salud, liquidacion);
  const total = calculateTotalFilaBitacora(subtotal, dias);

  return {
    id: fila.id || `fila-${Date.now()}-${Math.random()}`,
    workerId: fila.workerId,
    concepto: fila.concepto || 'TRABAJADOR DE OBRA',
    dia,
    salud,
    liquidacion,
    subtotal,
    dias,
    total,
  };
}

/**
 * Total de cada bitácora = suma de los TOTAL
 */
export function calculateTotalBitacora(filas: FilaBitacora[]): number {
  return filas.reduce((acc, f) => acc + (Number(f.total) || 0), 0);
}

/**
 * Agrupa las bitácoras por mes de la fecha fin (ej. Agosto, Septiembre)
 * y muestra el total de cada mes y el SUBTOTAL MANO DE OBRA (suma de los meses).
 */
export interface MonthGroupedBitacoras {
  monthKey: string; // ej. "2026-09"
  monthName: string; // ej. "Septiembre 2026"
  bitacoras: BitacoraRecord[];
  totalMes: number;
}

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function groupBitacorasByMonth(bitacoras: BitacoraRecord[]): {
  meses: MonthGroupedBitacoras[];
  subtotalManoDeObra: number;
} {
  const groups: Record<string, MonthGroupedBitacoras> = {};

  for (const b of bitacoras) {
    const dateStr = b.fechaFin || b.fechaInicio || new Date().toISOString().split('T')[0];
    const parts = dateStr.split('-');
    const year = parts[0] || '2026';
    const monthIdx = Math.max(0, Math.min(11, (parseInt(parts[1], 10) || 1) - 1));
    const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    const monthName = `${MONTH_NAMES_ES[monthIdx]} ${year}`;

    if (!groups[monthKey]) {
      groups[monthKey] = {
        monthKey,
        monthName,
        bitacoras: [],
        totalMes: 0,
      };
    }

    groups[monthKey].bitacoras.push(b);
    groups[monthKey].totalMes += Number(b.total) || 0;
  }

  // Ordenar cronológicamente descendente
  const meses = Object.values(groups).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const subtotalManoDeObra = meses.reduce((acc, m) => acc + m.totalMes, 0);

  return { meses, subtotalManoDeObra };
}

// ---------------------------------------------------------------------------
// 2. NÓMINAS (QUINCENALES)
// ---------------------------------------------------------------------------

/**
 * SUBTOTAL = Salario + Auxilio
 */
export function calculateSubtotalNomina(salario: number, auxilio: number): number {
  return (Number(salario) || 0) + (Number(auxilio) || 0);
}

/**
 * TOTAL = SUBTOTAL − Descuentos
 * Para "independiente": sin auxilio ni descuentos, TOTAL = Salario
 */
export function calculateTotalNomina(
  salario: number,
  auxilio: number,
  descuentos: number,
  tipoTrabajador: 'con prestaciones' | 'independiente' = 'con prestaciones'
): number {
  if (tipoTrabajador === 'independiente') {
    return Number(salario) || 0;
  }
  const subtotal = calculateSubtotalNomina(salario, auxilio);
  return Math.max(0, subtotal - (Number(descuentos) || 0));
}

/**
 * VALOR DÍA = TOTAL / 30 (divisor mensual)
 */
export function calculateValorDiaNomina(total: number, divisorMensual = 30): number {
  const div = divisorMensual > 0 ? divisorMensual : 30;
  return Math.round((Number(total) || 0) / div);
}

/**
 * SUBTOTAL HORAS EXTRAS = Horas extras × VALOR DÍA / 8,5 (jornada horas)
 */
export function calculateSubtotalHorasExtras(
  horasExtras: number,
  valorDia: number,
  jornadaHoras = 8.5
): number {
  const jh = jornadaHoras > 0 ? jornadaHoras : 8.5;
  return Math.round(((Number(horasExtras) || 0) * (Number(valorDia) || 0)) / jh);
}

/**
 * A PAGAR = (si modo "quincena": TOTAL / 2; si modo "por días": VALOR DÍA × Días trabajados)
 *           + SUBTOTAL HORAS EXTRAS − (VALOR DÍA × Días a descontar)
 */
export function calculateAPagarNomina(params: {
  modoPago: 'quincena' | 'por dias';
  total: number;
  valorDia: number;
  diasTrabajados: number;
  diasDescontar: number;
  subtotalHorasExtras: number;
}): number {
  const base =
    params.modoPago === 'quincena'
      ? Math.round((Number(params.total) || 0) / 2)
      : Math.round((Number(params.valorDia) || 0) * (Number(params.diasTrabajados) || 0));

  const descuentoDias = Math.round((Number(params.valorDia) || 0) * (Number(params.diasDescontar) || 0));
  const final = base + (Number(params.subtotalHorasExtras) || 0) - descuentoDias;
  return Math.max(0, final);
}

/**
 * Recalcula completamente una fila de nómina con los parámetros dados
 */
export function recalculateFilaNomina(
  fila: Partial<FilaNomina>,
  tipoTrabajador: 'con prestaciones' | 'independiente' = 'con prestaciones',
  parametros: NominaParametros = DEFAULT_NOMINA_PARAMETROS
): FilaNomina {
  const salario = Number(fila.salario) || 0;
  const auxilio = tipoTrabajador === 'independiente' ? 0 : (fila.auxilioTransporte ?? parametros.auxilioTransporte);
  const descuentos = tipoTrabajador === 'independiente' ? 0 : (fila.descuentos ?? parametros.descuentoSaludPension);

  const subtotal = calculateSubtotalNomina(salario, auxilio);
  const total = calculateTotalNomina(salario, auxilio, descuentos, tipoTrabajador);
  const valorDia = calculateValorDiaNomina(total, parametros.divisorMensual);
  const horasExtras = Math.max(0, Number(fila.horasExtras) || 0);
  const subtotalHorasExtras = calculateSubtotalHorasExtras(horasExtras, valorDia, parametros.jornadaHoras);

  const modoPago = fila.modoPago || 'quincena';
  const diasTrabajados = Number(fila.diasTrabajados) || (modoPago === 'quincena' ? 15 : 0);
  const diasDescontar = Math.max(0, Number(fila.diasDescontar) || 0);

  const aPagar = calculateAPagarNomina({
    modoPago,
    total,
    valorDia,
    diasTrabajados,
    diasDescontar,
    subtotalHorasExtras,
  });

  return {
    id: fila.id || `nom-fila-${Date.now()}-${Math.random()}`,
    item: Number(fila.item) || 1,
    workerId: fila.workerId,
    nombre: fila.nombre || 'TRABAJADOR',
    fechaInicio: fila.fechaInicio || new Date().toISOString().split('T')[0],
    salario,
    auxilioTransporte: auxilio,
    subtotal,
    descuentos,
    total,
    valorDia,
    modoPago,
    diasTrabajados,
    diasDescontar,
    horasExtras,
    notas: fila.notas || '',
    subtotalHorasExtras,
    aPagar,
  };
}

/**
 * Total de la nómina = suma de "A pagar"
 */
export function calculateTotalNominaPlanilla(filas: FilaNomina[]): number {
  return filas.reduce((acc, f) => acc + (Number(f.aPagar) || 0), 0);
}

// ---------------------------------------------------------------------------
// 3. FACTURAS ("ADECUACIONES SISMO")
// ---------------------------------------------------------------------------

/**
 * Total materiales = suma de todos los costos
 */
export function calculateTotalMateriales(facturas: FacturaSismoItem[]): number {
  return facturas.reduce((acc, f) => acc + (Number(f.costo) || 0), 0);
}

/**
 * Cantidad de facturas que faltan (observación "FALTA FACTURA" o estado 'falta_factura')
 */
export function countFacturasFaltantes(facturas: FacturaSismoItem[]): number {
  return facturas.filter((f) => {
    const obs = (f.observacion || '').toUpperCase();
    return obs.includes('FALTA FACTURA') || f.estado === 'falta_factura' || !f.facturaVinculada?.url;
  }).length;
}

/**
 * Cantidad de facturas pendientes de revisión
 */
export function countFacturasPorRevisar(facturas: FacturaSismoItem[]): number {
  return facturas.filter((f) => f.estado === 'por_revisar').length;
}

// ---------------------------------------------------------------------------
// 4. ABONOS
// ---------------------------------------------------------------------------

/**
 * Total abonos = suma de costos
 */
export function calculateTotalAbonos(abonos: AbonoRecordItem[]): number {
  return abonos.reduce((acc, a) => acc + (Number(a.costo) || 0), 0);
}

/**
 * Genera el nombre automático para el ítem consecutivo de abono
 */
export function getNombreConsecutivoAbono(consecutivo: number): string {
  const ordinales = [
    'Primer abono',
    'Segundo abono',
    'Tercer abono',
    'Cuarto abono',
    'Quinto abono',
    'Sexto abono',
    'Séptimo abono',
    'Octavo abono',
    'Noveno abono',
    'Décimo abono',
  ];
  return ordinales[consecutivo - 1] || `Abono N.º ${consecutivo}`;
}

// ---------------------------------------------------------------------------
// 5. RESUMEN ("CUADRO DE COSTOS")
// ---------------------------------------------------------------------------

/**
 * TOTAL OBRA = materiales + mano de obra
 */
export function calculateTotalObra(subtotalMateriales: number, subtotalManoDeObra: number): number {
  return (Number(subtotalMateriales) || 0) + (Number(subtotalManoDeObra) || 0);
}

/**
 * SALDO = abonos − total obra
 */
export function calculateSaldoObra(totalAbonos: number, totalObra: number): number {
  return (Number(totalAbonos) || 0) - (Number(totalObra) || 0);
}

/**
 * Gráfico comparativo por mes de Materiales vs Mano de obra
 */
export interface MesComparativaData {
  mesKey: string; // "2026-09"
  mesNombre: string; // "Sep 2026"
  materiales: number;
  manoDeObra: number;
  total: number;
}

export function calculateMonthlyComparison(
  facturas: FacturaSismoItem[],
  bitacoras: BitacoraRecord[]
): MesComparativaData[] {
  const map: Record<string, { mesNombre: string; materiales: number; manoDeObra: number }> = {};

  // 1. Sumar facturas por mes de fecha
  for (const f of facturas) {
    const d = f.fecha || '2026-09-01';
    const parts = d.split('-');
    const year = parts[0] || '2026';
    const month = parts[1] || '09';
    const key = `${year}-${month}`;
    const mIdx = parseInt(month, 10) - 1;
    const name = `${MONTH_NAMES_ES[mIdx]?.slice(0, 3) || 'Mes'} ${year.slice(2)}`;

    if (!map[key]) {
      map[key] = { mesNombre: name, materiales: 0, manoDeObra: 0 };
    }
    map[key].materiales += Number(f.costo) || 0;
  }

  // 2. Sumar bitácoras por mes de fechaFin
  for (const b of bitacoras) {
    const d = b.fechaFin || b.fechaInicio || '2026-09-01';
    const parts = d.split('-');
    const year = parts[0] || '2026';
    const month = parts[1] || '09';
    const key = `${year}-${month}`;
    const mIdx = parseInt(month, 10) - 1;
    const name = `${MONTH_NAMES_ES[mIdx]?.slice(0, 3) || 'Mes'} ${year.slice(2)}`;

    if (!map[key]) {
      map[key] = { mesNombre: name, materiales: 0, manoDeObra: 0 };
    }
    map[key].manoDeObra += Number(b.total) || 0;
  }

  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mesKey, val]) => ({
      mesKey,
      mesNombre: val.mesNombre,
      materiales: Math.round(val.materiales),
      manoDeObra: Math.round(val.manoDeObra),
      total: Math.round(val.materiales + val.manoDeObra),
    }));
}
