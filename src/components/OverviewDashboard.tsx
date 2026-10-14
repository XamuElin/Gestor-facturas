import React, { useMemo } from 'react';
import {
  FileSpreadsheet,
  Receipt,
  HardHat,
  Package,
  PiggyBank,
  TrendingUp,
  AlertTriangle,
  Clock,
  ArrowRight,
  Plus,
  DollarSign,
  Download,
  FolderOpen,
  Calendar,
  Layers,
  Users,
  CheckCircle2,
} from 'lucide-react';
import {
  FacturaSismoItem,
  BitacoraRecord,
  NominaRecord,
  InventarioRecord,
  AbonoRecordItem,
  calculateTotalMateriales,
  groupBitacorasByMonth,
  calculateTotalObra,
  calculateTotalAbonos,
  countFacturasFaltantes,
  countFacturasPorRevisar,
  calculateMonthlyComparison,
} from '../utils/constructionCalculations';
import { formatCOP } from '../utils/formatters';
import { ProjectFolder } from '../types';

interface OverviewDashboardProps {
  project: ProjectFolder | null;
  facturas: FacturaSismoItem[];
  bitacoras: BitacoraRecord[];
  nominas: NominaRecord[];
  inventario: InventarioRecord[];
  abonos: AbonoRecordItem[];
  onNavigateToSection: (
    section: 'facturas' | 'mano_de_obra' | 'nominas' | 'inventario' | 'abonos'
  ) => void;
  onOpenUploadModal: () => void;
  onOpenObraSelector: () => void;
  onOpenCatalog: () => void;
  onExportExcel: () => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  project,
  facturas,
  bitacoras,
  nominas,
  inventario,
  abonos,
  onNavigateToSection,
  onOpenUploadModal,
  onOpenObraSelector,
  onOpenCatalog,
  onExportExcel,
}) => {
  // 1. Cálculos puros utilizando el módulo constructionCalculations
  const subtotalMateriales = useMemo(() => calculateTotalMateriales(facturas), [facturas]);

  const { subtotalManoDeObra } = useMemo(() => groupBitacorasByMonth(bitacoras), [bitacoras]);

  const totalObra = useMemo(
    () => calculateTotalObra(subtotalMateriales, subtotalManoDeObra),
    [subtotalMateriales, subtotalManoDeObra]
  );

  const totalAbonos = useMemo(() => calculateTotalAbonos(abonos), [abonos]);


  const totalNominas = useMemo(
    () => nominas.reduce((acc, n) => acc + (Number(n.total) || 0), 0),
    [nominas]
  );

  const facturasPorRevisar = useMemo(() => countFacturasPorRevisar(facturas), [facturas]);
  const facturasFaltantes = useMemo(() => countFacturasFaltantes(facturas), [facturas]);

  const monthlyComparison = useMemo(
    () => calculateMonthlyComparison(facturas, bitacoras),
    [facturas, bitacoras]
  );

  // Valor máximo para escalar el gráfico de barras por mes
  const maxMonthlyVal = useMemo(() => {
    let max = 1;
    for (const m of monthlyComparison) {
      if (m.materiales > max) max = m.materiales;
      if (m.manoDeObra > max) max = m.manoDeObra;
      if (m.total > max) max = m.total;
    }
    return max;
  }, [monthlyComparison]);

  return (
    <div className="space-y-6">
      {/* 1. Header del Cuadro de Costos con Acción de Exportación a Excel */}
      <div className="bg-white p-4 sm:p-6 rounded-[16px] border border-slate-200/90 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-11 h-11 rounded-[14px] bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">
                Cuadro de Costos y Balance
              </h2>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 uppercase tracking-wide">
                Excel Replicado
              </span>
            </div>
            <p className="text-xs text-[#64748B] mt-0.5">
              Obra activa:{' '}
              <strong className="text-slate-800 font-bold">
                {project?.name || 'Selecciona una obra'}
              </strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            id="btn-export-excel-dashboard"
            onClick={onExportExcel}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer min-h-[44px]"
            title="Genera un libro .xlsx con fórmulas de Excel SUM en todas las pestañas"
          >
            <Download className="w-4 h-4" />
            <span>Exportar a Excel (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={onOpenUploadModal}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[12px] bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer min-h-[44px]"
          >
            <Receipt className="w-4 h-4 text-emerald-400" />
            <span>Subir Facturas</span>
          </button>
        </div>
      </div>

      {/* 2. Tarjetas Principales del Cuadro de Costos (4 Indicadores Clave) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Tarjeta 1: SUBTOTAL MATERIALES */}
        <div
          onClick={() => onNavigateToSection('facturas')}
          className="bg-white p-4 sm:p-5 rounded-[14px] border border-slate-200/90 shadow-2xs hover:border-[#0F766E]/50 transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Subtotal Materiales
            </span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-[#0F766E] flex items-center justify-center font-bold">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono tracking-tight tabular-nums">
            {formatCOP(subtotalMateriales)}
          </div>
          <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
            <span>De Facturas ({facturas.length})</span>
            <span className="text-[#0F766E] font-bold group-hover:underline flex items-center gap-0.5">
              Ver <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* Tarjeta 2: SUBTOTAL MANO DE OBRA */}
        <div
          onClick={() => onNavigateToSection('mano_de_obra')}
          className="bg-white p-4 sm:p-5 rounded-[14px] border border-slate-200/90 shadow-2xs hover:border-[#0F766E]/50 transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Subtotal Mano de Obra
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <HardHat className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono tracking-tight tabular-nums">
            {formatCOP(subtotalManoDeObra)}
          </div>
          <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
            <span>Bitácoras ({bitacoras.length})</span>
            <span className="text-[#0F766E] font-bold group-hover:underline flex items-center gap-0.5">
              Ver <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* Tarjeta 3: TOTAL OBRA = Materiales + Mano de Obra */}
        <div className="bg-slate-900 text-white p-4 sm:p-5 rounded-[14px] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
              Total Obra
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 font-mono font-bold">
              Mat + M.O.
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-white font-mono tracking-tight tabular-nums">
            {formatCOP(totalObra)}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Costo total ejecutado en la obra
          </div>
        </div>

        {/* Tarjeta 4: TOTAL ABONOS */}
        <div
          onClick={() => onNavigateToSection('abonos')}
          className="bg-white p-4 sm:p-5 rounded-[14px] border border-slate-200/90 shadow-2xs hover:border-[#0F766E]/50 transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total Abonos
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
              <PiggyBank className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono tracking-tight tabular-nums">
            {formatCOP(totalAbonos)}
          </div>
          <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
            <span>Ingresos cliente ({abonos.length})</span>
            <span className="text-[#0F766E] font-bold group-hover:underline flex items-center gap-0.5">
              Ver <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>

      {/* 3. Tarjeta Secundaria de Referencia: TOTAL NÓMINAS */}
      <div
        onClick={() => onNavigateToSection('nominas')}
        className="bg-slate-50 p-4 rounded-[14px] border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-100/70 transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center font-bold shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800">
                Total Nóminas Liquidadas (Informativo)
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold uppercase">
                NO se suma al total de obra
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Control quincenal con horas extras, descuentos de salud/pensión y días a descontar.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-center">
          <span className="text-base sm:text-lg font-black text-slate-800 font-mono tabular-nums">
            {formatCOP(totalNominas)}
          </span>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700" />
        </div>
      </div>

      {/* 4. Alertas de Facturas (Por revisar y Faltantes) */}
      {(facturasPorRevisar > 0 || facturasFaltantes > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {facturasPorRevisar > 0 && (
            <div className="p-4 rounded-[14px] bg-amber-50 border border-amber-200 text-amber-900 flex items-start justify-between gap-3 shadow-2xs">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">
                    {facturasPorRevisar} factura(s) por revisar
                  </div>
                  <p className="text-[11px] text-amber-800/90 mt-0.5">
                    Leídas automáticamente por Gemini y esperando confirmación de importes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToSection('facturas')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold shrink-0 transition-colors cursor-pointer"
              >
                Revisar
              </button>
            </div>
          )}

          {facturasFaltantes > 0 && (
            <div className="p-4 rounded-[14px] bg-rose-50 border border-rose-200 text-rose-900 flex items-start justify-between gap-3 shadow-2xs">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">
                    {facturasFaltantes} gasto(s) sin factura vinculada
                  </div>
                  <p className="text-[11px] text-rose-800/90 mt-0.5">
                    Marcados con "FALTA FACTURA" pendientes de adjuntar comprobante de Drive.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToSection('facturas')}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold shrink-0 transition-colors cursor-pointer"
              >
                Adjuntar
              </button>
            </div>
          )}
        </div>
      )}

      {/* 5. Gráfico de Barras por Mes: Materiales vs Mano de Obra */}
      <div className="bg-white p-5 sm:p-6 rounded-[16px] border border-slate-200/90 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#0F766E]" />
              Comparativo Mensual: Materiales vs Mano de Obra
            </h3>
            <p className="text-xs text-slate-500">
              Distribución de gastos acumulados por mes de facturación y fin de bitácora
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-[#0F766E]" />
              <span className="text-slate-600">Materiales</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-amber-500" />
              <span className="text-slate-600">Mano de Obra</span>
            </div>
          </div>
        </div>

        {monthlyComparison.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Aún no hay facturas ni bitácoras registradas en esta obra para comparar por mes.
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            {monthlyComparison.map((m) => {
              const matWidth = Math.max(3, Math.round((m.materiales / maxMonthlyVal) * 100));
              const moWidth = Math.max(3, Math.round((m.manoDeObra / maxMonthlyVal) * 100));

              return (
                <div key={m.mesKey} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 text-xs sm:text-sm">
                      {m.mesNombre}
                    </span>
                    <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm">
                      Total mes: {formatCOP(m.total)}
                    </span>
                  </div>

                  {/* Barras duales */}
                  <div className="space-y-1">
                    {/* Barra Materiales */}
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 sm:w-24 text-slate-500 truncate text-[10px] font-semibold">
                        Materiales
                      </span>
                      <div className="flex-1 bg-slate-100 h-4 rounded-md overflow-hidden relative">
                        <div
                          className="bg-[#0F766E] h-full rounded-md transition-all duration-500 flex items-center justify-end pr-1.5"
                          style={{ width: `${matWidth}%` }}
                        />
                      </div>
                      <span className="w-28 text-right font-mono font-bold text-[#0F766E] text-[11px] tabular-nums">
                        {formatCOP(m.materiales)}
                      </span>
                    </div>

                    {/* Barra Mano de Obra */}
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 sm:w-24 text-slate-500 truncate text-[10px] font-semibold">
                        Mano de obra
                      </span>
                      <div className="flex-1 bg-slate-100 h-4 rounded-md overflow-hidden relative">
                        <div
                          className="bg-amber-500 h-full rounded-md transition-all duration-500 flex items-center justify-end pr-1.5"
                          style={{ width: `${moWidth}%` }}
                        />
                      </div>
                      <span className="w-28 text-right font-mono font-bold text-amber-700 text-[11px] tabular-nums">
                        {formatCOP(m.manoDeObra)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Accesos Rápidos a Todos los Módulos de la Obra */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Módulo Facturas */}
        <button
          type="button"
          onClick={() => onNavigateToSection('facturas')}
          className="p-3.5 rounded-[14px] bg-white hover:bg-slate-50 border border-slate-200/90 text-left transition-all active:scale-[0.98] cursor-pointer shadow-2xs flex flex-col justify-between"
        >
          <Receipt className="w-5 h-5 text-[#0F766E]" />
          <div className="mt-2">
            <div className="text-xs font-bold text-slate-900">Facturas</div>
            <div className="text-[10px] text-slate-500">{facturas.length} registros</div>
          </div>
        </button>

        {/* Módulo Mano de Obra */}
        <button
          type="button"
          onClick={() => onNavigateToSection('mano_de_obra')}
          className="p-3.5 rounded-[14px] bg-white hover:bg-slate-50 border border-slate-200/90 text-left transition-all active:scale-[0.98] cursor-pointer shadow-2xs flex flex-col justify-between"
        >
          <HardHat className="w-5 h-5 text-amber-600" />
          <div className="mt-2">
            <div className="text-xs font-bold text-slate-900">Mano de Obra</div>
            <div className="text-[10px] text-slate-500">{bitacoras.length} bitácoras</div>
          </div>
        </button>

        {/* Módulo Nóminas */}
        <button
          type="button"
          onClick={() => onNavigateToSection('nominas')}
          className="p-3.5 rounded-[14px] bg-white hover:bg-slate-50 border border-slate-200/90 text-left transition-all active:scale-[0.98] cursor-pointer shadow-2xs flex flex-col justify-between"
        >
          <FileSpreadsheet className="w-5 h-5 text-sky-600" />
          <div className="mt-2">
            <div className="text-xs font-bold text-slate-900">Nóminas</div>
            <div className="text-[10px] text-slate-500">{nominas.length} quincenas</div>
          </div>
        </button>

        {/* Módulo Inventario */}
        <button
          type="button"
          onClick={() => onNavigateToSection('inventario')}
          className="p-3.5 rounded-[14px] bg-white hover:bg-slate-50 border border-slate-200/90 text-left transition-all active:scale-[0.98] cursor-pointer shadow-2xs flex flex-col justify-between"
        >
          <Package className="w-5 h-5 text-emerald-600" />
          <div className="mt-2">
            <div className="text-xs font-bold text-slate-900">Inventario</div>
            <div className="text-[10px] text-slate-500">{inventario.length} materiales</div>
          </div>
        </button>

        {/* Módulo Abonos */}
        <button
          type="button"
          onClick={() => onNavigateToSection('abonos')}
          className="p-3.5 rounded-[14px] bg-white hover:bg-slate-50 border border-slate-200/90 text-left transition-all active:scale-[0.98] cursor-pointer shadow-2xs flex flex-col justify-between"
        >
          <PiggyBank className="w-5 h-5 text-teal-600" />
          <div className="mt-2">
            <div className="text-xs font-bold text-slate-900">Abonos</div>
            <div className="text-[10px] text-slate-500">{abonos.length} ingresos</div>
          </div>
        </button>

        {/* Catálogo de Trabajadores */}
        <button
          type="button"
          onClick={onOpenCatalog}
          className="p-3.5 rounded-[14px] bg-white hover:bg-slate-50 border border-slate-200/90 text-left transition-all active:scale-[0.98] cursor-pointer shadow-2xs flex flex-col justify-between"
        >
          <Users className="w-5 h-5 text-indigo-600" />
          <div className="mt-2">
            <div className="text-xs font-bold text-slate-900">Catálogo Personal</div>
            <div className="text-[10px] text-slate-500">Salarios y roles</div>
          </div>
        </button>
      </div>
    </div>
  );
};
