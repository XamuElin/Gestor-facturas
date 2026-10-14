import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  RotateCcw,
  Clock,
  Sparkles,
  MousePointerClick,
  Layers,
} from 'lucide-react';

export interface DateRangeValue {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  selectedDates: string[]; // List of specific selected YYYY-MM-DD
  workingDays: number;
  formattedLabel: string;
  skipSundays: boolean;
  selectionMode: 'range' | 'individual';
}

export interface DateRangePickerProps {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  selectedDates?: string[]; // YYYY-MM-DD array
  onChange: (value: DateRangeValue) => void;
  label?: string;
  placeholder?: string;
  skipSundaysDefault?: boolean;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  inline?: boolean; // Si es true, se muestra directamente tipo calendario en la página
  showPresets?: boolean;
  showSundaysToggle?: boolean;
  initialMode?: 'range' | 'individual';
}

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const WEEKDAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Convierte Date a string YYYY-MM-DD usando hora local
 */
export function formatDateToIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parsea string YYYY-MM-DD a Date local seguro (sin offset UTC de medianoche)
 */
export function parseIsoDate(str?: string): Date | null {
  if (!str) return null;
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return new Date(y, m, d);
}

/**
 * Genera array de fechas entre start y end
 */
export function getDatesBetween(startStr: string, endStr: string, skipSundays: boolean): string[] {
  const start = parseIsoDate(startStr);
  const end = parseIsoDate(endStr);
  if (!start || !end) return startStr ? [startStr] : [];

  const actualStart = start <= end ? start : end;
  const actualEnd = start <= end ? end : start;

  const dates: string[] = [];
  const cur = new Date(actualStart);
  while (cur <= actualEnd) {
    if (!skipSundays || cur.getDay() !== 0) {
      dates.push(formatDateToIso(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/**
 * Formatea etiqueta amigable en español
 */
export function formatFriendlyDateLabel(
  dates: string[],
  startStr?: string,
  endStr?: string,
  mode: 'range' | 'individual' = 'range'
): string {
  if (!dates || dates.length === 0) {
    if (startStr) return startStr;
    return '';
  }

  const sorted = [...dates].sort();
  const count = sorted.length;
  const daysSuffix = ` (${count} ${count === 1 ? 'día' : 'días'})`;

  if (count === 1) {
    const parts = sorted[0].split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}${daysSuffix}`;
  }

  if (mode === 'range' && startStr && endStr && startStr !== endStr) {
    const sParts = startStr.split('-');
    const eParts = endStr.split('-');
    return `${sParts[2]}/${sParts[1]} al ${eParts[2]}/${eParts[1]}/${eParts[0]}${daysSuffix}`;
  }

  // Si son pocos días en modo individual, mostrarlos abreviados: ej: 03/10, 05/10, 07/10
  if (count <= 3) {
    const list = sorted.map((d) => {
      const p = d.split('-');
      return `${p[2]}/${p[1]}`;
    }).join(', ');
    return `${list}${daysSuffix}`;
  }

  // Muchos días seleccionados
  const first = sorted[0].split('-');
  const last = sorted[sorted.length - 1].split('-');
  return `${count} días seleccionados (${first[2]}/${first[1]} ... ${last[2]}/${last[1]})${daysSuffix}`;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate = '',
  endDate = '',
  selectedDates = [],
  onChange,
  label,
  placeholder = 'Seleccionar días laborados en el calendario...',
  skipSundaysDefault = true,
  disabled = false,
  className = '',
  compact = false,
  inline = false,
  showPresets = true,
  showSundaysToggle = true,
  initialMode = 'range',
}) => {
  const [isOpen, setIsOpen] = useState(inline);
  const [mode, setMode] = useState<'range' | 'individual'>(initialMode);
  const [skipSundays, setSkipSundays] = useState(skipSundaysDefault);

  // Fechas de rango temporal
  const [rangeStart, setRangeStart] = useState<string>(startDate || formatDateToIso(new Date()));
  const [rangeEnd, setRangeEnd] = useState<string>(endDate || startDate || formatDateToIso(new Date()));
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Conjunto de días seleccionados (tanto en rango como uno a uno)
  const [activeDates, setActiveDates] = useState<string[]>(() => {
    if (selectedDates && selectedDates.length > 0) return selectedDates;
    if (startDate && endDate) return getDatesBetween(startDate, endDate, skipSundaysDefault);
    if (startDate) return [startDate];
    return [formatDateToIso(new Date())];
  });

  // Mes visible en el calendario
  const refDate = parseIsoDate(rangeStart) || parseIsoDate(activeDates[0]) || new Date();
  const [viewYear, setViewYear] = useState<number>(refDate.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(refDate.getMonth()); // 0-11

  const containerRef = useRef<HTMLDivElement>(null);

  // Sincronizar props cuando cambien externamente
  useEffect(() => {
    if (startDate) setRangeStart(startDate);
    if (endDate) setRangeEnd(endDate);
    if (selectedDates && selectedDates.length > 0) {
      setActiveDates(selectedDates);
    } else if (startDate && endDate) {
      setActiveDates(getDatesBetween(startDate, endDate, skipSundays));
    }
  }, [startDate, endDate, selectedDates]);

  // Cerrar popover al hacer clic fuera (solo si no es inline)
  useEffect(() => {
    if (inline) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, inline]);

  // Navegación mensual
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleGoToToday = () => {
    const today = new Date();
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  // Matriz de días del mes
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const totalDays = lastDay.getDate();

    let startingDayOfWeek = firstDay.getDay() - 1;
    if (startingDayOfWeek === -1) startingDayOfWeek = 6; // Domingo

    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();
    const days: {
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSunday: boolean;
    }[] = [];

    // Mes anterior
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(viewYear, viewMonth - 1, dayNum);
      const str = formatDateToIso(prevDate);
      days.push({
        dateStr: str,
        dayNumber: dayNum,
        isCurrentMonth: false,
        isToday: false,
        isSunday: prevDate.getDay() === 0,
      });
    }

    // Mes actual
    const todayStr = formatDateToIso(new Date());
    for (let d = 1; d <= totalDays; d++) {
      const curDate = new Date(viewYear, viewMonth, d);
      const str = formatDateToIso(curDate);
      days.push({
        dateStr: str,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: str === todayStr,
        isSunday: curDate.getDay() === 0,
      });
    }

    // Rellenar resto de la semana
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const nextDate = new Date(viewYear, viewMonth + 1, d);
        const str = formatDateToIso(nextDate);
        days.push({
          dateStr: str,
          dayNumber: d,
          isCurrentMonth: false,
          isToday: false,
          isSunday: nextDate.getDay() === 0,
        });
      }
    }

    return days;
  }, [viewYear, viewMonth]);

  // Notificar cambio
  const emitChange = (dates: string[], s: string, e: string, curMode: 'range' | 'individual', skipSun: boolean) => {
    const sorted = [...dates].sort();
    const workingDays = Math.max(1, sorted.length);
    const formattedLabel = formatFriendlyDateLabel(sorted, s, e, curMode);

    onChange({
      startDate: s || sorted[0] || '',
      endDate: e || sorted[sorted.length - 1] || s || '',
      selectedDates: sorted,
      workingDays,
      formattedLabel,
      skipSundays: skipSun,
      selectionMode: curMode,
    });
  };

  // Clic en un día del calendario
  const handleDayClick = (dateStr: string) => {
    if (mode === 'individual') {
      // Modo UNO POR UNO: Alternar (toggle) el día seleccionado
      let nextDates: string[];
      if (activeDates.includes(dateStr)) {
        nextDates = activeDates.filter((d) => d !== dateStr);
        if (nextDates.length === 0) {
          nextDates = [dateStr]; // Al menos 1 día
        }
      } else {
        nextDates = [...activeDates, dateStr];
      }
      nextDates.sort();
      setActiveDates(nextDates);
      const s = nextDates[0];
      const e = nextDates[nextDates.length - 1];
      setRangeStart(s);
      setRangeEnd(e);
      emitChange(nextDates, s, e, 'individual', skipSundays);
    } else {
      // Modo RANGO (Desde - Hasta):
      if (!rangeStart || (rangeStart && rangeEnd && rangeStart !== rangeEnd)) {
        // Primer clic: Iniciar nuevo rango
        setRangeStart(dateStr);
        setRangeEnd(dateStr);
        setHoverDate(null);
        const newDates = [dateStr];
        setActiveDates(newDates);
        emitChange(newDates, dateStr, dateStr, 'range', skipSundays);
      } else {
        // Segundo clic: Completar rango
        let s = rangeStart;
        let e = dateStr;
        if (dateStr < rangeStart) {
          s = dateStr;
          e = rangeStart;
        }
        setRangeStart(s);
        setRangeEnd(e);
        setHoverDate(null);
        const dates = getDatesBetween(s, e, skipSundays);
        setActiveDates(dates);
        emitChange(dates, s, e, 'range', skipSundays);
      }
    }
  };

  // Presets Rápidos
  const applyPreset = (preset: 'q1' | 'q2' | 'this_month' | 'this_week' | 'weekdays' | 'today') => {
    const today = new Date();
    const curYear = viewYear;
    const curMonth = viewMonth;

    let s = '';
    let e = '';
    let dates: string[] = [];

    if (preset === 'today') {
      s = formatDateToIso(today);
      e = s;
      dates = [s];
    } else if (preset === 'q1') {
      s = formatDateToIso(new Date(curYear, curMonth, 1));
      e = formatDateToIso(new Date(curYear, curMonth, 15));
      dates = getDatesBetween(s, e, skipSundays);
    } else if (preset === 'q2') {
      const lastDay = new Date(curYear, curMonth + 1, 0).getDate();
      s = formatDateToIso(new Date(curYear, curMonth, 16));
      e = formatDateToIso(new Date(curYear, curMonth, lastDay));
      dates = getDatesBetween(s, e, skipSundays);
    } else if (preset === 'this_month') {
      s = formatDateToIso(new Date(curYear, curMonth, 1));
      const lastDay = new Date(curYear, curMonth + 1, 0).getDate();
      e = formatDateToIso(new Date(curYear, curMonth, lastDay));
      dates = getDatesBetween(s, e, skipSundays);
    } else if (preset === 'this_week') {
      const day = today.getDay();
      const diffToMonday = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.getFullYear(), today.getMonth(), diffToMonday);
      const sunday = new Date(today.getFullYear(), today.getMonth(), diffToMonday + 6);
      s = formatDateToIso(monday);
      e = formatDateToIso(sunday);
      dates = getDatesBetween(s, e, skipSundays);
    } else if (preset === 'weekdays') {
      // Días de lunes a viernes del mes visible
      const lastDay = new Date(curYear, curMonth + 1, 0).getDate();
      s = formatDateToIso(new Date(curYear, curMonth, 1));
      e = formatDateToIso(new Date(curYear, curMonth, lastDay));
      dates = [];
      for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(curYear, curMonth, d);
        if (dateObj.getDay() !== 0 && dateObj.getDay() !== 6) {
          dates.push(formatDateToIso(dateObj));
        }
      }
    }

    setRangeStart(s);
    setRangeEnd(e);
    setActiveDates(dates);
    emitChange(dates, s, e, mode, skipSundays);
  };

  // Limpiar selección
  const handleClear = () => {
    const todayStr = formatDateToIso(new Date());
    setRangeStart(todayStr);
    setRangeEnd(todayStr);
    setActiveDates([todayStr]);
    emitChange([todayStr], todayStr, todayStr, mode, skipSundays);
  };

  // Cambiar toggle de omitir domingos
  const handleToggleSundays = (checked: boolean) => {
    setSkipSundays(checked);
    if (mode === 'range' && rangeStart && rangeEnd) {
      const dates = getDatesBetween(rangeStart, rangeEnd, checked);
      setActiveDates(dates);
      emitChange(dates, rangeStart, rangeEnd, 'range', checked);
    } else if (checked) {
      // En modo individual, si activa omitir domingos, filtrar domingos
      const filtered = activeDates.filter((d) => {
        const obj = parseIsoDate(d);
        return obj ? obj.getDay() !== 0 : true;
      });
      setActiveDates(filtered.length > 0 ? filtered : activeDates);
      emitChange(filtered.length > 0 ? filtered : activeDates, rangeStart, rangeEnd, 'individual', checked);
    }
  };

  // Rango visual para modo rango
  const effectiveHoverEnd = hoverDate && rangeStart && rangeStart === rangeEnd ? hoverDate : rangeEnd;
  const rangeMin = rangeStart && effectiveHoverEnd ? (rangeStart <= effectiveHoverEnd ? rangeStart : effectiveHoverEnd) : rangeStart;
  const rangeMax = rangeStart && effectiveHoverEnd ? (rangeStart <= effectiveHoverEnd ? effectiveHoverEnd : rangeStart) : rangeStart;

  // Renderizado del Calendario
  const renderCalendarContent = () => (
    <div className="w-full bg-white rounded-2xl border border-slate-200/90 p-2.5 sm:p-3 shadow-xs select-none">
      {/* Selector de Modo: RANGO vs UNO POR UNO */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-1.5 pb-1.5 mb-1.5 border-b border-slate-100">
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => {
              setMode('range');
              if (rangeStart && rangeEnd) {
                const dates = getDatesBetween(rangeStart, rangeEnd, skipSundays);
                setActiveDates(dates);
                emitChange(dates, rangeStart, rangeEnd, 'range', skipSundays);
              }
            }}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              mode === 'range'
                ? 'bg-[#1ca330] text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Seleccionar un período continuo (ej: del 1 al 15)"
          >
            <Layers className="w-3 h-3" />
            <span>Por Rango</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('individual')}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              mode === 'individual'
                ? 'bg-[#1ca330] text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Hacer clic en cada día que trabajó para marcarlo o desmarcarlo"
          >
            <MousePointerClick className="w-3 h-3" />
            <span>Uno por Uno</span>
          </button>
        </div>

        {/* Resumen dinámico de días laborados */}
        <div className="flex items-center justify-between sm:justify-end gap-1.5">
          <span className="text-[11px] font-extrabold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 font-mono flex items-center gap-1 shadow-2xs">
            <Check className="w-3 h-3 stroke-[2.5] text-[#1ca330]" />
            <span>{activeDates.length} {activeDates.length === 1 ? 'día' : 'días'}</span>
            <span className="text-[9px] text-emerald-600 font-normal">({activeDates.length * 8}h)</span>
          </span>
        </div>
      </div>

      {/* Subtítulo explicativo del modo activo */}
      <div className="flex items-center justify-between gap-1.5 px-2 py-1 mb-1.5 bg-slate-50 rounded-lg text-[10px] text-slate-600 border border-slate-200/60">
        <span className="flex items-center gap-1 font-medium truncate">
          {mode === 'range' ? (
            <>
              <Layers className="w-2.5 h-2.5 text-[#1ca330] shrink-0" />
              <span className="truncate">
                <strong>Rango:</strong> Clic en el día inicial y luego en el final.
              </span>
            </>
          ) : (
            <>
              <MousePointerClick className="w-2.5 h-2.5 text-[#1ca330] shrink-0" />
              <span className="truncate">
                <strong>Uno a uno:</strong> Clic sobre cada día trabajado para marcar (✓).
              </span>
            </>
          )}
        </span>
      </div>

      {/* Navegación de Mes */}
      <div className="flex items-center justify-between pb-1.5 mb-1.5">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors cursor-pointer border border-slate-200"
          title="Mes anterior"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs sm:text-sm font-bold text-slate-800">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button
            type="button"
            onClick={handleGoToToday}
            className="text-[9px] font-bold text-[#1ca330] hover:bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 transition-colors cursor-pointer"
          >
            Hoy
          </button>
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors cursor-pointer border border-slate-200"
          title="Mes siguiente"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Botones de Presets Rápidos */}
      {showPresets && (
        <div className="mb-2 pb-1.5 border-b border-slate-100">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-center">
            <button
              type="button"
              onClick={() => applyPreset('q1')}
              className="px-1.5 py-1 text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-md border border-emerald-200/80 transition-colors cursor-pointer truncate"
              title="Del 1 al 15 del mes"
            >
              1-15 (1ª Q)
            </button>
            <button
              type="button"
              onClick={() => applyPreset('q2')}
              className="px-1.5 py-1 text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-md border border-emerald-200/80 transition-colors cursor-pointer truncate"
              title="Del 16 a fin del mes"
            >
              16-Fin (2ª Q)
            </button>
            <button
              type="button"
              onClick={() => applyPreset('this_month')}
              className="px-1.5 py-1 text-[10px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-md border border-slate-200 transition-colors cursor-pointer truncate"
            >
              Mes Todo
            </button>
            <button
              type="button"
              onClick={() => applyPreset('weekdays')}
              className="px-1.5 py-1 text-[10px] font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-md border border-slate-200 transition-colors cursor-pointer truncate"
              title="Todos los lunes a viernes del mes"
            >
              Lun-Vie
            </button>
            <button
              type="button"
              onClick={() => applyPreset('this_week')}
              className="px-1.5 py-1 text-[10px] font-semibold bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md border border-slate-200 transition-colors cursor-pointer truncate"
            >
              Semana
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-1.5 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 rounded-md border border-rose-200 transition-colors cursor-pointer truncate"
            >
              Limpiar
            </button>
          </div>
        </div>
      )}

      {/* Cabecera de Días de la Semana */}
      <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
        {WEEKDAY_NAMES.map((d, idx) => (
          <span
            key={d}
            className={`text-[9px] font-bold uppercase py-0.5 ${
              idx === 6 ? 'text-amber-700 font-extrabold' : 'text-slate-400'
            }`}
          >
            {d}
          </span>
        ))}
      </div>

      {/* Cuadrícula interactiva de Días */}
      <div className="grid grid-cols-7 gap-y-0.5 gap-x-0.5 text-center mb-2">
        {calendarDays.map((day) => {
          const { dateStr, dayNumber, isCurrentMonth, isToday, isSunday } = day;

          const isSkippedSunday = skipSundays && isSunday;
          const isSelectedInIndividual = activeDates.includes(dateStr);
          const isStart = rangeMin === dateStr;
          const isEnd = rangeMax === dateStr;
          const isInRange = rangeMin && rangeMax && dateStr >= rangeMin && dateStr <= rangeMax;

          // Determinación visual activa: si es domingo omitido, no está seleccionado
          const isSelected = isSkippedSunday
            ? false
            : mode === 'individual'
            ? isSelectedInIndividual
            : isInRange
            ? activeDates.includes(dateStr) || (!skipSundays || !isSunday)
            : isStart;

          return (
            <div
              key={dateStr}
              onMouseEnter={() => mode === 'range' && rangeStart && setHoverDate(dateStr)}
              onClick={() => handleDayClick(dateStr)}
              className={`relative py-0.5 text-[11px] font-semibold select-none cursor-pointer transition-all ${
                !isCurrentMonth ? 'opacity-30' : ''
              } ${
                mode === 'range' && isInRange && rangeMin !== rangeMax && !isSkippedSunday
                  ? isStart
                    ? 'bg-emerald-100 rounded-l-lg'
                    : isEnd
                    ? 'bg-emerald-100 rounded-r-lg'
                    : 'bg-emerald-50'
                  : ''
              }`}
              title={`${dateStr} ${isSunday ? '(Domingo)' : ''}`}
            >
              <div
                className={`w-7 h-7 sm:w-7.5 sm:h-7.5 mx-auto flex flex-col items-center justify-center rounded-lg transition-all relative ${
                  isSelected
                    ? 'bg-[#1ca330] text-white font-black shadow-2xs scale-105 ring-1.5 ring-emerald-300'
                    : isToday
                    ? 'ring-1.5 ring-[#1ca330] text-[#1ca330] font-bold hover:bg-emerald-50'
                    : isSunday
                    ? 'text-amber-700/90 hover:bg-amber-50 font-medium'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>{dayNumber}</span>
                {isSelected && (
                  <span className="w-1 h-1 rounded-full bg-white absolute bottom-0.5" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Opciones Inferiores: Omitir domingos y resumen de días */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100 text-[11px] text-slate-600">
        {showSundaysToggle && (
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-[10px] font-medium text-slate-700">
            <input
              type="checkbox"
              checked={skipSundays}
              onChange={(e) => handleToggleSundays(e.target.checked)}
              className="rounded border-slate-300 text-[#1ca330] focus:ring-[#1ca330] w-3 h-3"
            />
            <span>Omitir domingos</span>
          </label>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]">
            {formatFriendlyDateLabel(activeDates, rangeStart, rangeEnd, mode)}
          </span>
          {!inline && (
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-2.5 py-0.5 bg-[#1ca330] hover:bg-[#168826] text-white text-[11px] font-bold rounded-md shadow-2xs cursor-pointer"
            >
              Aceptar
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Si es inline, mostrar directamente en el contenedor
  if (inline) {
    return (
      <div className={`w-full ${className}`}>
        {label && (
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
              <CalendarIcon className="w-3.5 h-3.5 text-[#1ca330]" />
              <span>{label}</span>
            </label>
            <span className="text-[10px] text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              {mode === 'range' ? 'Modo Rango' : 'Modo Uno por Uno'}
            </span>
          </div>
        )}
        {renderCalendarContent()}
      </div>
    );
  }

  // Si no es inline, mostrar como disparador desplegable
  const triggerLabel = formatFriendlyDateLabel(activeDates, rangeStart, rangeEnd, mode);

  return (
    <div ref={containerRef} className={`relative inline-block w-full ${className}`}>
      {label && (
        <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-[#1ca330]" />
            <span>{label}</span>
          </span>
          {triggerLabel && (
            <span className="text-[10px] text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              {activeDates.length} {activeDates.length === 1 ? 'día' : 'días'}
            </span>
          )}
        </label>
      )}

      {/* Disparador de entrada interactivo */}
      <div
        id="btn-date-range-picker-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition-all cursor-pointer select-none ${
          disabled
            ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
            : isOpen
            ? 'bg-white border-[#1ca330] ring-2 ring-[#1ca330]/20 shadow-xs'
            : 'bg-slate-50/90 hover:bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
        } ${compact ? 'text-xs py-1.5' : 'text-xs'}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <CalendarIcon className={`w-4 h-4 shrink-0 ${triggerLabel ? 'text-[#1ca330]' : 'text-slate-400'}`} />
          {triggerLabel ? (
            <span className="font-semibold text-slate-800 truncate">{triggerLabel}</span>
          ) : (
            <span className="text-slate-400 truncate">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-slate-400 font-mono">📅 ▾</span>
        </div>
      </div>

      {/* Popover desplegable */}
      {isOpen && (
        <div
          id="popover-date-range-picker"
          className="absolute z-50 mt-2 left-0 sm:left-auto right-auto top-full w-full sm:w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 animate-in fade-in zoom-in-95 duration-150"
        >
          {renderCalendarContent()}
        </div>
      )}
    </div>
  );
};
