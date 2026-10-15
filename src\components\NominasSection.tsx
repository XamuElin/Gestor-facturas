import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Settings,
  Pencil,
  Trash2,
  Users,
  CheckCircle2,
  Calendar,
  X,
  Clock,
  DollarSign,
  AlertCircle,
  HelpCircle,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  NominaRecord,
  FilaNomina,
  NominaParametros,
  WorkerCatalogItem,
  DEFAULT_NOMINA_PARAMETROS,
  recalculateFilaNomina,
  calculateTotalNominaPlanilla,
  generateUUID,
} from '../utils/constructionCalculations';
import { formatCOP, formatDateCO } from '../utils/formatters';
import { ProjectFolder } from '../types';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

interface NominasSectionProps {
  project: ProjectFolder | null;
  nominas: NominaRecord[];
  workers: WorkerCatalogItem[];
  settings: NominaParametros;
  onSaveNomina: (nomina: NominaRecord) => Promise<void>;
  onDeleteNomina: (nominaId: string) => Promise<void>;
  onSaveSettings: (settings: NominaParametros) => Promise<void>;
  onOpenCatalog: () => void;
}

export const NominasSection: React.FC<NominasSectionProps> = ({
  project,
  nominas,
  workers,
  settings,
  onSaveNomina,
  onDeleteNomina,
  onSaveSettings,
  onOpenCatalog,
}) => {
  const [selectedNominaId, setSelectedNominaId] = useState<string | null>(
    nominas[0]?.id || null
  );

  // Modal para parámetros de ajuste
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [tempDivisor, setTempDivisor] = useState(settings.divisorMensual || 30);
  const [tempJornada, setTempJornada] = useState(settings.jornadaHoras || 8.5);
  const [tempAuxilio, setTempAuxilio] = useState(settings.auxilioTransporte || 250000);
  const [tempDescuento, setTempDescuento] = useState(settings.descuentoSaludPension || 140000);

  // Modal para crear / editar nómina
  const [isNominaModalOpen, setIsNominaModalOpen] = useState(false);
  const [editingNomina, setEditingNomina] = useState<NominaRecord | null>(null);
  const [titulo, setTitulo] = useState('');
  const [periodo, setPeriodo] = useState('');

  // Modal para agregar / editar trabajador en la nómina
  const [isFilaModalOpen, setIsFilaModalOpen] = useState(false);
  const [editingFila, setEditingFila] = useState<FilaNomina | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [nombre, setNombre] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [salario, setSalario] = useState<number>(1800000);
  const [auxilioTransporte, setAuxilioTransporte] = useState<number>(settings.auxilioTransporte);
  const [descuentos, setDescuentos] = useState<number>(settings.descuentoSaludPension);
  const [modoPago, setModoPago] = useState<'quincena' | 'por dias'>('quincena');
  const [diasTrabajados, setDiasTrabajados] = useState<number>(15);
  const [diasDescontar, setDiasDescontar] = useState<number>(0);
  const [horasExtras, setHorasExtras] = useState<number>(0);
  const [notas, setNotas] = useState('');

  // Confirm delete states
  const [nominaToDelete, setNominaToDelete] = useState<NominaRecord | null>(null);
  const [filaToDelete, setFilaToDelete] = useState<FilaNomina | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Batch delete states
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedFilaIds, setSelectedFilaIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Nómina activa
  const activeNomina = useMemo(() => {
    return nominas.find((n) => n.id === selectedNominaId) || nominas[0] || null;
  }, [nominas, selectedNominaId]);

  const totalGeneralNominas = useMemo(() => {
    return nominas.reduce((acc, n) => acc + (Number(n.total) || 0), 0);
  }, [nominas]);

  // Manejar apertura de modal de ajustes
  const openSettingsModal = () => {
    setTempDivisor(settings.divisorMensual || 30);
    setTempJornada(settings.jornadaHoras || 8.5);
    setTempAuxilio(settings.auxilioTransporte || 250000);
    setTempDescuento(settings.descuentoSaludPension || 140000);
    setIsSettingsModalOpen(true);
  };

  const handleSaveSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated: NominaParametros = {
      divisorMensual: Number(tempDivisor) || 30,
      jornadaHoras: Number(tempJornada) || 8.5,
      auxilioTransporte: Number(tempAuxilio) || 250000,
      descuentoSaludPension: Number(tempDescuento) || 140000,
    };
    await onSaveSettings(updated);
    setIsSettingsModalOpen(false);
  };

  // Manejar creación / edición de nómina
  const openNewNomina = () => {
    setEditingNomina(null);
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const consecutivo = String(nominas.length + 1).padStart(2, '0');
    setTitulo(`NÓMINA ${consecutivo} (01/${m}/${y})-(15/${m}/${y})`);
    setPeriodo(`01/${m}/${y} - 15/${m}/${y}`);
    setFormError(null);
    setSaveSuccess(false);
    setIsNominaModalOpen(true);
  };

  const openEditNomina = (n: NominaRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingNomina(n);
    setTitulo(n.titulo);
    setPeriodo(n.periodo);
    setFormError(null);
    setSaveSuccess(false);
    setIsNominaModalOpen(true);
  };

  const handleSaveNominaMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) {
      setFormError('El título de la nómina es obligatorio');
      return;
    }

    try {
      if (editingNomina) {
        const updated: NominaRecord = {
          ...editingNomina,
          titulo: titulo.trim(),
          periodo: periodo.trim(),
          actualizadoEn: Date.now(),
        };
        await onSaveNomina(updated);
      } else {
        const newNom: NominaRecord = {
          id: generateUUID(),
          obraId: project?.id,
          origen: 'manual',
          creadoEn: Date.now(),
          actualizadoEn: Date.now(),
          titulo: titulo.trim(),
          periodo: periodo.trim(),
          parametros: settings,
          filas: [],
          total: 0,
        };
        await onSaveNomina(newNom);
        setSelectedNominaId(newNom.id);
      }
      setSaveSuccess(true);
      setTimeout(() => {
        setIsNominaModalOpen(false);
        setSaveSuccess(false);
      }, 600);
    } catch (err: any) {
      setFormError(err?.message || 'Error al guardar la nómina');
    }
  };

  // Manejar creación / edición de trabajador en nómina activa
  const openAddWorkerToNomina = () => {
    if (!activeNomina) return;
    setEditingFila(null);
    setSelectedWorkerId('');
    setNombre('');
    setFechaInicio(new Date().toISOString().split('T')[0]);
    setSalario(1800000);
    setAuxilioTransporte(settings.auxilioTransporte);
    setDescuentos(settings.descuentoSaludPension);
    setModoPago('quincena');
    setDiasTrabajados(15);
    setDiasDescontar(0);
    setHorasExtras(0);
    setNotas('');
    setFormError(null);
    setSaveSuccess(false);
    setIsFilaModalOpen(true);
  };

  const openEditFila = (f: FilaNomina) => {
    setEditingFila(f);
    setSelectedWorkerId(f.workerId || '');
    setNombre(f.nombre);
    setFechaInicio(f.fechaInicio);
    setSalario(f.salario);
    setAuxilioTransporte(f.auxilioTransporte);
    setDescuentos(f.descuentos);
    setModoPago(f.modoPago);
    setDiasTrabajados(f.diasTrabajados);
    setDiasDescontar(f.diasDescontar);
    setHorasExtras(f.horasExtras);
    setNotas(f.notas || '');
    setFormError(null);
    setSaveSuccess(false);
    setIsFilaModalOpen(true);
  };

  const handleWorkerSelect = (wId: string) => {
    setSelectedWorkerId(wId);
    const worker = workers.find((w) => w.id === wId);
    if (worker) {
      setNombre(worker.nombre);
      setFechaInicio(worker.fechaInicio);
      setSalario(worker.salarioMensual);
      if (worker.tipo === 'independiente') {
        setAuxilioTransporte(0);
        setDescuentos(0);
      } else {
        setAuxilioTransporte(worker.auxilioTransporte ?? settings.auxilioTransporte);
        setDescuentos(worker.descuentoSaludPension ?? settings.descuentoSaludPension);
      }
    }
  };

  const handleSaveFilaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeNomina) return;
    if (!nombre.trim()) {
      setFormError('El nombre del trabajador es obligatorio');
      return;
    }

    const nextItemNumber = editingFila ? editingFila.item : activeNomina.filas.length + 1;
    const isIndependiente =
      workers.find((w) => w.id === selectedWorkerId)?.tipo === 'independiente' ||
      (auxilioTransporte === 0 && descuentos === 0);

    const recalculated = recalculateFilaNomina(
      {
        id: editingFila ? editingFila.id : generateUUID(),
        obraId: project?.id,
        origen: 'manual',
        creadoEn: editingFila?.creadoEn || Date.now(),
        actualizadoEn: Date.now(),
        item: nextItemNumber,
        workerId: selectedWorkerId || undefined,
        nombre: nombre.trim().toUpperCase(),
        fechaInicio: fechaInicio || new Date().toISOString().split('T')[0],
        salario: Number(salario) || 0,
        auxilioTransporte: Number(auxilioTransporte) || 0,
        subtotal: 0,
        descuentos: Number(descuentos) || 0,
        total: 0,
        valorDia: 0,
        modoPago,
        diasTrabajados: Number(diasTrabajados) || 0,
        diasDescontar: Number(diasDescontar) || 0,
        horasExtras: Number(horasExtras) || 0,
        notas: notas.trim(),
        subtotalHorasExtras: 0,
        aPagar: 0,
      },
      isIndependiente ? 'independiente' : 'con prestaciones',
      settings
    );

    const nextFilas = editingFila
      ? activeNomina.filas.map((f) => (f.id === editingFila.id ? recalculated : f))
      : [...activeNomina.filas, recalculated];

    const nextTotal = calculateTotalNominaPlanilla(nextFilas);
    const updatedNomina: NominaRecord = {
      ...activeNomina,
      filas: nextFilas,
      total: nextTotal,
      actualizadoEn: Date.now(),
    };

    await onSaveNomina(updatedNomina);
    setSaveSuccess(true);
    setTimeout(() => {
      setIsFilaModalOpen(false);
      setSaveSuccess(false);
    }, 600);
  };

  const handleConfirmDeleteNomina = async () => {
    if (!nominaToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteNomina(nominaToDelete.id);
      setNominaToDelete(null);
      setSelectedNominaId(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar la nómina. No se pudo completar la operación.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteFila = async () => {
    if (!activeNomina || !filaToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const nextFilas = activeNomina.filas
        .filter((f) => f.id !== filaToDelete.id)
        .map((f, idx) => ({ ...f, item: idx + 1 }));

      const updatedNomina: NominaRecord = {
        ...activeNomina,
        filas: nextFilas,
        total: calculateTotalNominaPlanilla(nextFilas),
        actualizadoEn: Date.now(),
      };
      await onSaveNomina(updatedNomina);
      setFilaToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar la liquidación del trabajador.');
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelectFila = (id: string) => {
    setSelectedFilaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFilas = () => {
    if (!activeNomina) return;
    if (selectedFilaIds.size === activeNomina.filas.length) {
      setSelectedFilaIds(new Set());
    } else {
      setSelectedFilaIds(new Set(activeNomina.filas.map((f) => f.id)));
    }
  };

  const handleConfirmBatchDeleteFilas = async () => {
    if (!activeNomina || selectedFilaIds.size === 0) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const nextFilas = activeNomina.filas
        .filter((f) => !selectedFilaIds.has(f.id))
        .map((f, idx) => ({ ...f, item: idx + 1 }));

      const updatedNomina: NominaRecord = {
        ...activeNomina,
        filas: nextFilas,
        total: calculateTotalNominaPlanilla(nextFilas),
        actualizadoEn: Date.now(),
      };
      await onSaveNomina(updatedNomina);
      setSelectedFilaIds(new Set());
      setIsSelectionMode(false);
      setIsBatchDeleteDialogOpen(false);
    } catch (err: any) {
      setDeleteError(err?.message || 'Error al eliminar las liquidaciones seleccionadas.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 pb-36 sm:pb-16">
      {deleteError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
            <span>{deleteError}</span>
          </div>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="p-1 text-rose-600 hover:text-rose-900 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* 1. Header con Ajustes y Catálogo */}
      <div className="bg-white p-4 sm:p-5 rounded-[14px] border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Nóminas de la Obra</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-[#0F766E] border border-teal-200">
                Pestaña NOMINAS
              </span>
            </div>
            <p className="text-xs text-[#64748B]">
              Liquidaciones quincenales y control laboral en <strong className="text-slate-800">{project?.name || 'la obra'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            id="btn-ajustes-nomina"
            onClick={openSettingsModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all min-h-[44px]"
            title="Parámetros editables (Divisor 30, jornada 8.5h, auxilio, salud)"
          >
            <Settings className="w-4 h-4 text-slate-500" />
            <span>Ajustes</span>
          </button>

          <button
            type="button"
            id="btn-catalogo-nominas"
            onClick={onOpenCatalog}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all min-h-[44px]"
          >
            <Users className="w-4 h-4 text-[#0F766E]" />
            <span>Catálogo ({workers.length})</span>
          </button>

          <button
            type="button"
            id="btn-nueva-nomina"
            onClick={openNewNomina}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold transition-all shadow-2xs min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>+ Crear Nómina</span>
          </button>
        </div>
      </div>

      {/* 2. Tarjetas de Resumen Financiero */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Total General Nóminas (Referencia)
          </span>
          <p className="text-2xl sm:text-3xl font-extrabold text-[#0F766E] tabular-nums">
            {formatCOP(totalGeneralNominas)}
          </p>
          <span className="text-[10px] text-slate-500">
            {nominas.length} nómina(s) registradas · No se suma al total de obra
          </span>
        </div>

        <div className="bg-white p-4 rounded-[14px] border border-slate-200/90 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Parámetros Actuales de Cálculo
          </span>
          <div className="text-xs text-slate-700 font-semibold space-y-0.5 pt-1">
            <p>Divisor: {settings.divisorMensual} días · Jornada: {settings.jornadaHoras}h</p>
            <p>Auxilio: {formatCOP(settings.auxilioTransporte)} · Salud/Pens: {formatCOP(settings.descuentoSaludPension)}</p>
          </div>
        </div>
      </div>

      {/* 3. Selector de Nóminas */}
      {nominas.length === 0 ? (
        <div className="bg-white p-8 sm:p-12 rounded-[14px] border border-slate-200/90 shadow-2xs text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
            <FileSpreadsheet className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No hay nóminas registradas</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            La obra inicia limpia en $0. Crea tu primera nómina quincenal para liquidar operarios según la fórmula de tu cliente arquitecto.
          </p>
          <button
            type="button"
            onClick={openNewNomina}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F766E] text-white text-xs font-bold shadow-sm hover:bg-[#0d655f] transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>+ Crear Primera Nómina</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Nóminas Quincenales ({nominas.length})
            </h3>
            <span className="text-xs text-slate-400">Toca para abrir planilla</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {nominas.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedNominaId(n.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer border ${
                  activeNomina?.id === n.id
                    ? 'bg-[#0F766E] text-white border-[#0F766E] shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>{n.titulo}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                    activeNomina?.id === n.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {formatCOP(n.total)}
                </span>
              </button>
            ))}
          </div>

          {/* 4. Detalle de la Planilla Activa */}
          {activeNomina && (
            <div className="bg-white rounded-[14px] border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 bg-[#F6F7F9] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900">{activeNomina.titulo}</h3>
                    <button
                      type="button"
                      onClick={(e) => openEditNomina(activeNomina, e)}
                      aria-label="Editar título de la nómina"
                      className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                      title="Editar título o período"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Período: {activeNomina.periodo}</p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="text-right mr-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">TOTAL A PAGAR</span>
                    <span className="text-lg sm:text-xl font-black text-[#0F766E] tabular-nums">
                      {formatCOP(activeNomina.total)}
                    </span>
                  </div>

                  {activeNomina.filas.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelectionMode(!isSelectionMode);
                        setSelectedFilaIds(new Set());
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold min-h-[44px]"
                    >
                      {isSelectionMode ? 'Cancelar' : 'Seleccionar'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={openAddWorkerToNomina}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold rounded-xl shadow-2xs transition-all cursor-pointer min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Agregar Trabajador</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNominaToDelete(activeNomina)}
                    aria-label={`Eliminar nómina ${activeNomina.titulo}`}
                    className="w-11 h-11 flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 cursor-pointer min-h-[44px] min-w-[44px]"
                    title="Eliminar nómina completa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Barra de Selección Múltiple */}
              {isSelectionMode && (
                <div className="bg-slate-900 text-white p-3 sm:p-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={toggleSelectAllFilas}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white"
                  >
                    {selectedFilaIds.size === activeNomina.filas.length ? (
                      <CheckSquare className="w-4 h-4 text-teal-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                    <span>Todos ({selectedFilaIds.size}/{activeNomina.filas.length})</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedFilaIds.size === 0}
                    onClick={() => setIsBatchDeleteDialogOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-40 min-h-[40px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar ({selectedFilaIds.size})</span>
                  </button>
                </div>
              )}

              {activeNomina.filas.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <p className="text-sm font-bold text-slate-800">No hay operarios liquidados en esta nómina</p>
                  <p className="text-xs text-slate-500">
                    Toca "+ Agregar Trabajador" para calcular quincena o pago por días trabajados.
                  </p>
                  <button
                    type="button"
                    onClick={openAddWorkerToNomina}
                    className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-[#0F766E] text-white text-xs font-bold rounded-xl min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Agregar Primer Operario</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Desktop Table (≥ 1024px) */}
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F6F7F9] text-[#64748B] font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <tr>
                          {isSelectionMode && <th className="py-3 px-2 w-8"></th>}
                          <th className="py-3 px-2 text-center w-10">Ítem</th>
                          <th className="py-3 px-3">Nombre</th>
                          <th className="py-3 px-2">Inicio</th>
                          <th className="py-3 px-2 text-right">Salario</th>
                          <th className="py-3 px-2 text-right">Aux. Transp</th>
                          <th className="py-3 px-2 text-right">Subtotal</th>
                          <th className="py-3 px-2 text-right">Desc. Salud</th>
                          <th className="py-3 px-2 text-right font-bold text-slate-900">Total</th>
                          <th className="py-3 px-2 text-right">Valor Día</th>
                          <th className="py-3 px-2 text-center">Modo</th>
                          <th className="py-3 px-2 text-center">Días Trab.</th>
                          <th className="py-3 px-2 text-center">Días Desc.</th>
                          <th className="py-3 px-2 text-center">H. Extras</th>
                          <th className="py-3 px-3 text-right font-black text-[#0F766E]">A PAGAR</th>
                          <th className="py-3 px-3">Notas</th>
                          <th className="py-3 px-2 text-center w-24">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeNomina.filas.map((f) => (
                          <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                            {isSelectionMode && (
                              <td className="py-3 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleSelectFila(f.id)}
                                  className="text-[#0F766E] p-1"
                                >
                                  {selectedFilaIds.has(f.id) ? (
                                    <CheckSquare className="w-4 h-4" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-300" />
                                  )}
                                </button>
                              </td>
                            )}
                            <td className="py-3 px-2 text-center font-mono font-bold text-slate-400">
                              {f.item}
                            </td>
                            <td className="py-3 px-3 font-bold text-slate-900 truncate max-w-[150px]">
                              {f.nombre}
                            </td>
                            <td className="py-3 px-2 text-slate-500 whitespace-nowrap">
                              {formatDateCO(f.fechaInicio)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-slate-700">
                              {formatCOP(f.salario)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-slate-700">
                              {formatCOP(f.auxilioTransporte)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-slate-700 font-semibold">
                              {formatCOP(f.subtotal)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-slate-700">
                              {formatCOP(f.descuentos)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums font-bold text-slate-900 bg-slate-50/50">
                              {formatCOP(f.total)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-slate-600">
                              {formatCOP(f.valorDia)}
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 capitalize">
                                {f.modoPago}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-center font-bold tabular-nums">
                              {f.diasTrabajados}
                            </td>
                            <td className="py-3 px-2 text-center font-bold text-rose-600 tabular-nums">
                              {f.diasDescontar}
                            </td>
                            <td className="py-3 px-2 text-center tabular-nums">
                              {f.horasExtras}h
                            </td>
                            <td className="py-3 px-3 text-right font-black text-[#0F766E] tabular-nums text-sm">
                              {formatCOP(f.aPagar)}
                            </td>
                            <td className="py-3 px-3 text-[11px] text-slate-500 italic truncate max-w-[120px]">
                              {f.notas || '—'}
                            </td>
                            <td className="py-3 px-2 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditFila(f)}
                                  aria-label={`Editar ${f.nombre}`}
                                  className="w-9 h-9 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 cursor-pointer"
                                  title="Editar"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setFilaToDelete(f)}
                                  aria-label={`Eliminar ${f.nombre}`}
                                  className="w-9 h-9 flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 cursor-pointer"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-[#F6F7F9] border-t border-slate-200 font-bold text-xs">
                        <tr>
                          <td colSpan={isSelectionMode ? 14 : 13} className="py-3.5 px-4 text-right uppercase tracking-wider text-slate-600">
                            TOTAL DE LA NÓMINA A PAGAR:
                          </td>
                          <td className="py-3.5 px-3 text-right font-black text-[#0F766E] tabular-nums text-base">
                            {formatCOP(activeNomina.total)}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile Cards (< 1024px) */}
                  <div className="lg:hidden divide-y divide-slate-100">
                    {activeNomina.filas.map((f) => (
                      <div key={f.id} className="p-4 space-y-3 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            {isSelectionMode && (
                              <button
                                type="button"
                                onClick={() => toggleSelectFila(f.id)}
                                className="mt-1 text-[#0F766E] p-1 shrink-0"
                              >
                                {selectedFilaIds.has(f.id) ? (
                                  <CheckSquare className="w-4 h-4" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-300" />
                                )}
                              </button>
                            )}
                            <div>
                              <span className="text-[10px] font-bold text-slate-400">#{f.item}</span>
                              <h4 className="text-xs font-bold text-slate-900 leading-snug">{f.nombre}</h4>
                              <p className="text-[11px] text-slate-500">
                                Modo: <span className="capitalize font-semibold text-slate-700">{f.modoPago}</span>
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">A PAGAR</span>
                            <span className="text-sm font-black text-[#0F766E] tabular-nums">
                              {formatCOP(f.aPagar)}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-center text-xs border border-slate-100">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-semibold">Salario Base</span>
                            <span className="font-bold text-slate-800">{formatCOP(f.salario)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-semibold">Días / Desc</span>
                            <span className="font-bold text-slate-800">
                              {f.diasTrabajados}d {f.diasDescontar > 0 ? `(-${f.diasDescontar})` : ''}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-semibold">H. Extras</span>
                            <span className="font-bold text-slate-800">
                              {f.horasExtras}h
                            </span>
                          </div>
                        </div>

                        {f.notas && (
                          <p className="text-[11px] text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded-xl border border-amber-200">
                            <strong>Nota:</strong> {f.notas}
                          </p>
                        )}

                        {/* Accessible Buttons with 44px min target */}
                        <div className="flex items-center justify-end gap-3 pt-1 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => openEditFila(f)}
                            aria-label={`Editar liquidación de ${f.nombre}`}
                            className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4 text-slate-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setFilaToDelete(f)}
                            aria-label={`Eliminar liquidación de ${f.nombre}`}
                            className="w-11 h-11 flex items-center justify-center rounded-xl border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-100/50 min-h-[44px] min-w-[44px] touch-target-48 transition-colors cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4 text-rose-600" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal: Ajustes Legales de Nómina */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="fixed inset-0" onClick={() => setIsSettingsModalOpen(false)} />
          <div className="relative z-10 bg-white rounded-t-[28px] sm:rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#0F766E]" />
                <h3 className="text-sm font-bold text-slate-900">Parámetros de Liquidación de Nómina</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettingsSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Divisor Mensual (Días)</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={tempDivisor}
                    onChange={(e) => setTempDivisor(Number(e.target.value) || 30)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold tabular-nums text-slate-900"
                  />
                  <span className="text-[10px] text-slate-400">Por defecto: 30</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Jornada Diaria (Horas)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={tempJornada}
                    onChange={(e) => setTempJornada(Number(e.target.value) || 8.5)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold tabular-nums text-slate-900"
                  />
                  <span className="text-[10px] text-slate-400">Por defecto: 8,5 horas</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Auxilio de Transporte Mensual ($)</label>
                <input
                  type="number"
                  step="1000"
                  min="0"
                  value={tempAuxilio}
                  onChange={(e) => setTempAuxilio(Number(e.target.value) || 0)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold tabular-nums text-slate-900"
                />
                <span className="text-[10px] text-slate-400">Por defecto: $250.000</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Descuento Salud y Pensión Mensual ($)</label>
                <input
                  type="number"
                  step="1000"
                  min="0"
                  value={tempDescuento}
                  onChange={(e) => setTempDescuento(Number(e.target.value) || 0)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold tabular-nums text-slate-900"
                />
                <span className="text-[10px] text-slate-400">Por defecto: $140.000</span>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold shadow-sm min-h-[44px]"
                >
                  Guardar Parámetros
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Crear / Editar Nómina */}
      {isNominaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsNominaModalOpen(false)} />
          <div className="relative z-10 bg-white rounded-t-[28px] sm:rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {editingNomina ? 'Editar Título de Nómina' : 'Crear Nueva Nómina Quincenal'}
              </h3>
              <button
                type="button"
                onClick={() => setIsNominaModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveNominaMeta} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Título de la Nómina *</label>
                <input
                  type="text"
                  required
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej: NÓMINA 02 (01/09/2026)-(15/09/2026)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Período de Liquidación *</label>
                <input
                  type="text"
                  required
                  value={periodo}
                  onChange={(e) => setPeriodo(e.target.value)}
                  placeholder="Ej: 01/09/2026 - 15/09/2026"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsNominaModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold shadow-sm min-h-[44px]"
                >
                  {saveSuccess ? 'Guardado ✓' : editingNomina ? 'Guardar Cambios' : 'Crear Nómina'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal / Bottom Sheet: Agregar / Editar Fila de Trabajador en Nómina */}
      {isFilaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsFilaModalOpen(false)} />
          <div className="relative z-10 bg-white rounded-t-[28px] sm:rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {editingFila ? 'Editar Operario en Nómina' : 'Agregar Operario a Nómina'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFilaModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveFilaSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Seleccionar del Catálogo de Trabajadores:
                </label>
                <select
                  value={selectedWorkerId}
                  onChange={(e) => handleWorkerSelect(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                >
                  <option value="">-- Seleccionar o ingresar nuevo --</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.nombre} ({w.rol.toUpperCase()} - {w.tipo})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Nombre Completo *</label>
                  <input
                    type="text"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej: JOSÉ ALFREDO RODRÍGUEZ"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Fecha de Inicio *</label>
                  <input
                    type="date"
                    required
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Salario Mensual</label>
                  <input
                    type="number"
                    step="1000"
                    required
                    value={salario || ''}
                    onChange={(e) => setSalario(Number(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Aux. Transporte</label>
                  <input
                    type="number"
                    step="1000"
                    value={auxilioTransporte || ''}
                    onChange={(e) => setAuxilioTransporte(Number(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Desc. Salud/Pens.</label>
                  <input
                    type="number"
                    step="1000"
                    value={descuentos || ''}
                    onChange={(e) => setDescuentos(Number(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Modo de Pago</label>
                  <select
                    value={modoPago}
                    onChange={(e) => setModoPago(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  >
                    <option value="quincena">Quincena (TOTAL / 2)</option>
                    <option value="por dias">Por días trabajados</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Días Trabajados</label>
                  <input
                    type="number"
                    min="0"
                    max="31"
                    value={diasTrabajados}
                    onChange={(e) => setDiasTrabajados(Number(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Días a Descontar</label>
                  <input
                    type="number"
                    min="0"
                    value={diasDescontar}
                    onChange={(e) => setDiasDescontar(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-rose-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Horas Extras</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={horasExtras}
                    onChange={(e) => setHorasExtras(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notas / Justificación</label>
                <input
                  type="text"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Ej: DESCUENTO UN DIA MAS DOMINICAL"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsFilaModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0d655f] text-white text-xs font-bold shadow-sm min-h-[44px]"
                >
                  {saveSuccess ? 'Guardado ✓' : editingFila ? 'Guardar Cambios' : 'Agregar Operario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Nómina Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!nominaToDelete}
        itemName={nominaToDelete?.titulo || 'esta nómina'}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmDeleteNomina}
        onCancel={() => setNominaToDelete(null)}
      />

      {/* Confirm Delete Fila Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!filaToDelete}
        itemName={filaToDelete?.nombre || 'este operario'}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmDeleteFila}
        onCancel={() => setFilaToDelete(null)}
      />

      {/* Confirm Batch Delete Filas Dialog */}
      <ConfirmDeleteDialog
        isOpen={isBatchDeleteDialogOpen}
        itemName={`${selectedFilaIds.size} operarios seleccionados`}
        description="Podrás deshacerlo durante 8 segundos. Los totales se recalcularán al instante."
        isDeleting={isDeleting}
        onConfirm={handleConfirmBatchDeleteFilas}
        onCancel={() => setIsBatchDeleteDialogOpen(false)}
      />
    </div>
  );
};
