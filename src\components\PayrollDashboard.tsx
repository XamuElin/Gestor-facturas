import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users,
  Clock,
  DollarSign,
  TrendingUp,
  Plus,
  FileText,
  Calendar,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Check,
  Loader2,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  RotateCcw,
  Briefcase,
  HelpCircle,
  Download,
  Pencil,
  Trash2,
  LayoutGrid,
  List,
  FileSpreadsheet,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { Worker, TimeRecord, PayrollCalculation, PayrollBudgetMetrics, PaymentFrequency } from '../types';
import { payrollService } from '../services/payrollService';
import { generatePayrollReceiptPdf } from '../utils/generatePayrollPdf';
import { createCustomSpreadsheet } from '../services/googleDriveSheets';
import { buildProjectSpreadsheetTitle } from '../utils/duplicateChecker';
import { EditWorkerModal } from './Payroll/EditWorkerModal';
import { ConfirmDeleteModal } from './Payroll/ConfirmDeleteModal';
import { EditTimeRecordModal } from './Payroll/EditTimeRecordModal';
import { ImportSheetModal } from './Payroll/ImportSheetModal';
import { ImportWorkersModal } from './Payroll/ImportWorkersModal';
import { WorkerRoleSelect } from './Payroll/WorkerRoleSelect';
import { saveCustomWorkerRole } from '../utils/workerRoles';
import { DateRangePicker, getDatesBetween } from './Common/DateRangePicker';

interface PayrollDashboardProps {
  accessToken: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  projectName: string;
  folderId?: string;
  onReauthenticate?: () => Promise<string | null>;
  onOpenConfig?: () => void;
  onSpreadsheetCreated?: (sheet: { id: string; name: string; url: string }) => void;
}

export const PayrollDashboard: React.FC<PayrollDashboardProps> = ({
  accessToken,
  spreadsheetId,
  spreadsheetUrl,
  projectName,
  folderId,
  onReauthenticate,
  onOpenConfig,
  onSpreadsheetCreated,
}) => {
  // Estado principal de datos
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [timeRecords, setTimeRecords] = useState<TimeRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Presupuesto total asignado a mano de obra (configurable por el arquitecto)
  const [customTotalBudget, setCustomTotalBudget] = useState<number>(25000000); // $25,000,000 COP por defecto
  const [isEditingBudget, setIsEditingBudget] = useState<boolean>(false);

  // Formulario de registro de jornada con calendario interactivo (Rango y Uno por Uno)
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single');
  const [selectionMode, setSelectionMode] = useState<'range' | 'individual'>('range');
  const [logDate, setLogDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [logDateStart, setLogDateStart] = useState<string>(() => {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${yr}-${mo}-01`;
  });
  const [logDateEnd, setLogDateEnd] = useState<string>(() => {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${yr}-${mo}-15`;
  });
  const [selectedDatesList, setSelectedDatesList] = useState<string[]>([new Date().toISOString().split('T')[0]]);
  const [showInlineCalendar, setShowInlineCalendar] = useState<boolean>(true);
  const [skipSundays, setSkipSundays] = useState<boolean>(false);
  const [regularHours, setRegularHours] = useState<number | ''>(8);
  const [overtimeHours, setOvertimeHours] = useState<number | ''>(0);
  const [daysWorked, setDaysWorked] = useState<number | ''>(1);
  const [activityNotes, setActivityNotes] = useState<string>('');
  const [isSubmittingLog, setIsSubmittingLog] = useState<boolean>(false);

  // Modal para agregar nuevo obrero
  const [isAddWorkerModalOpen, setIsAddWorkerModalOpen] = useState<boolean>(false);
  const [newWorkerName, setNewWorkerName] = useState<string>('');
  const [newWorkerDni, setNewWorkerDni] = useState<string>('');
  const [newWorkerRole, setNewWorkerRole] = useState<string>('Oficial Albañil');
  const [newWorkerFrequency, setNewWorkerFrequency] = useState<PaymentFrequency>('Semanal');
  const [newWorkerRateUnit, setNewWorkerRateUnit] = useState<'Dia' | 'Hora'>('Dia');
  const [newWorkerBaseRate, setNewWorkerBaseRate] = useState<number | ''>(85000);
  const [newWorkerOvertimeRate, setNewWorkerOvertimeRate] = useState<number | ''>(16000);
  const [newWorkerPhone, setNewWorkerPhone] = useState<string>('');
  const [isSavingWorker, setIsSavingWorker] = useState<boolean>(false);

  // Deducciones manuales (anticipos, préstamos)
  const [deductionsMap, setDeductionsMap] = useState<Record<string, number>>({});

  // Cierre de mes (Rollover)
  const [isRolloverModalOpen, setIsRolloverModalOpen] = useState<boolean>(false);
  const [isExecutingRollover, setIsExecutingRollover] = useState<boolean>(false);
  const [rolloverArchiveName, setRolloverArchiveName] = useState<string>('');

  // Modales de Edición y Eliminación de Obrero (CRUD)
  const [workerToEdit, setWorkerToEdit] = useState<Worker | null>(null);
  const [isEditWorkerModalOpen, setIsEditWorkerModalOpen] = useState<boolean>(false);
  const [workerToDelete, setWorkerToDelete] = useState<Worker | null>(null);
  const [isDeleteWorkerModalOpen, setIsDeleteWorkerModalOpen] = useState<boolean>(false);

  // Modal de Edición de Jornada / Tiempo (Registro de Horas)
  const [recordToEdit, setRecordToEdit] = useState<TimeRecord | null>(null);
  const [isEditRecordModalOpen, setIsEditRecordModalOpen] = useState<boolean>(false);
  const [lastLoggedRecord, setLastLoggedRecord] = useState<TimeRecord | null>(null);

  // Modal para Añadir Hoja Existente como Pestaña
  const [isImportSheetModalOpen, setIsImportSheetModalOpen] = useState<boolean>(false);

  // Modal para Importar Obreros desde Documento (Excel / PDF / Imagen)
  const [isImportWorkersModalOpen, setIsImportWorkersModalOpen] = useState<boolean>(false);

  // Vista activa: 'crew' (Cuadrilla & Liquidación) | 'times' (Historial de Jornadas Registradas)
  const [activeTabSection, setActiveTabSection] = useState<'crew' | 'times'>('crew');

  // Modo de visualización de cuadrilla: 'cards' o 'table'
  const [crewViewMode, setCrewViewMode] = useState<'cards' | 'table'>('table');

  // Estado de exportación de Reportes Financieros
  const [isExportingSheets, setIsExportingSheets] = useState<boolean>(false);
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false);
  const [isApplyingStyling, setIsApplyingStyling] = useState<boolean>(false);
  const [isRenewingAuth, setIsRenewingAuth] = useState<boolean>(false);

  // Filtros para la visualización del Formato de Días Laborados
  const [filterWorkerId, setFilterWorkerId] = useState<string>('all');
  const [filterDateStart, setFilterDateStart] = useState<string>('');
  const [filterDateEnd, setFilterDateEnd] = useState<string>('');

  // Restaurar progreso local de presupuesto y deducciones cuando se abre el proyecto
  useEffect(() => {
    if (!spreadsheetId) return;
    try {
      const savedBudget = localStorage.getItem(`svh_payroll_budget_${spreadsheetId}`);
      if (savedBudget) {
        const val = Number(savedBudget);
        if (!isNaN(val) && val >= 0) setCustomTotalBudget(val);
      }
      const savedDeductions = localStorage.getItem(`svh_payroll_deductions_${spreadsheetId}`);
      if (savedDeductions) {
        setDeductionsMap(JSON.parse(savedDeductions));
      }
    } catch (e) {
      console.warn('Aviso cargando progreso local de nómina:', e);
    }
  }, [spreadsheetId]);

  // Persistir en localStorage los cambios del presupuesto y deducciones
  useEffect(() => {
    if (!spreadsheetId) return;
    try {
      localStorage.setItem(`svh_payroll_budget_${spreadsheetId}`, String(customTotalBudget));
    } catch {}
  }, [spreadsheetId, customTotalBudget]);

  useEffect(() => {
    if (!spreadsheetId) return;
    try {
      localStorage.setItem(`svh_payroll_deductions_${spreadsheetId}`, JSON.stringify(deductionsMap));
    } catch {}
  }, [spreadsheetId, deductionsMap]);

  const isRetryingAuthRef = useRef(false);

  // 1. Cargar / Sincronizar datos desde Google Sheets al montar o cambiar proyecto
  const loadPayrollData = async (tokenOverride?: string) => {
    const activeToken = tokenOverride || accessToken;
    if (!spreadsheetId) return;
    if (!activeToken) {
      setError('Se requiere una conexión activa con Google Sheets. Pulsa en "Renovar Conexión Google".');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await payrollService.syncSheets(activeToken, spreadsheetId);
      setWorkers(result.workers);
      setTimeRecords(result.timeRecords);
      if (result.workers.length > 0 && !selectedWorkerId) {
        setSelectedWorkerId(result.workers[0].id);
      }
    } catch (err: any) {
      const errStr = String(err?.message || '').toLowerCase();
      const isAuth =
        err?.status === 401 ||
        err?.isAuthError ||
        errStr.includes('expirad') ||
        errStr.includes('sesión') ||
        errStr.includes('credenciales') ||
        errStr.includes('renovar conexión google') ||
        errStr.includes('invalid authentication credentials') ||
        errStr.includes('token de autenticación') ||
        errStr.includes('expected oauth 2') ||
        errStr.includes('unauthenticated') ||
        errStr.includes('401');

      if (isAuth) {
        // Intento silencioso de auto-renovación si está disponible
        if (onReauthenticate && !isRetryingAuthRef.current) {
          try {
            isRetryingAuthRef.current = true;
            const refreshedToken = await onReauthenticate();
            if (refreshedToken) {
              const retryRes = await payrollService.syncSheets(refreshedToken, spreadsheetId);
              setWorkers(retryRes.workers);
              setTimeRecords(retryRes.timeRecords);
              if (retryRes.workers.length > 0 && !selectedWorkerId) {
                setSelectedWorkerId(retryRes.workers[0].id);
              }
              setError(null);
              return;
            }
          } catch {
            // Ignorar para desplegar mensaje amigable al usuario
          } finally {
            isRetryingAuthRef.current = false;
          }
        }

        setError('Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para actualizar tus credenciales de acceso.');
      } else {
        console.warn('Aviso sincronizando nóminas:', err?.message || err);
        setError(err?.message || 'No se pudieron sincronizar las hojas de nómina.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenewConnection = async () => {
    if (!onReauthenticate) return;
    setIsRenewingAuth(true);
    setError(null);
    try {
      const newToken = await onReauthenticate();
      if (newToken) {
        await loadPayrollData(newToken);
      }
    } catch (e: any) {
      setError('No se pudo renovar la sesión de Google: ' + (e.message || 'Error desconocido'));
    } finally {
      setIsRenewingAuth(false);
    }
  };

  useEffect(() => {
    loadPayrollData();
  }, [accessToken, spreadsheetId]);

  // 2. Cálculos automáticos de nómina y métricas de presupuesto
  const { calculations, metrics } = useMemo(() => {
    const res = payrollService.calculatePayroll(workers, timeRecords, deductionsMap);

    // Ajustar con el presupuesto total asignado configurable
    const totalAllocated = customTotalBudget > 0 ? customTotalBudget : res.metrics.totalAllocatedBudget;
    const spent = res.metrics.spentBudget;
    const pct = totalAllocated > 0 ? Math.min(100, Math.round((spent / totalAllocated) * 1000) / 10) : 0;

    return {
      calculations: res.calculations,
      metrics: {
        ...res.metrics,
        totalAllocatedBudget: totalAllocated,
        percentageSpent: pct,
      },
    };
  }, [workers, timeRecords, deductionsMap, customTotalBudget]);

  // Obrero seleccionado actualmente en el formulario
  const activeWorkerForForm = useMemo(() => {
    return workers.find((w) => w.id === selectedWorkerId);
  }, [workers, selectedWorkerId]);

  // Cálculo de cantidad de días entre 2 fechas
  const getDaysCountInRange = (startStr: string, endStr: string, omitSundays: boolean) => {
    if (!startStr || !endStr) return 1;
    const start = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 1;

    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      if (!omitSundays || cur.getDay() !== 0) {
        count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, count);
  };

  const handleRangeDatesChange = (start: string, end: string, omitSun: boolean) => {
    setLogDateStart(start);
    setLogDateEnd(end);
    setSelectionMode('range');
    const dates = getDatesBetween(start, end, omitSun);
    setSelectedDatesList(dates);
    const count = Math.max(1, dates.length);
    setDaysWorked(count);
    setRegularHours(count * 8);
    setLogDate(start === end ? start : `${start} al ${end}`);
  };

  const setQuincena1 = () => {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const s = `${yr}-${mo}-01`;
    const e = `${yr}-${mo}-15`;
    setDateMode('range');
    handleRangeDatesChange(s, e, skipSundays);
  };

  const setQuincena2 = () => {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = d.getMonth() + 1;
    const lastDay = new Date(yr, mo, 0).getDate();
    const moStr = String(mo).padStart(2, '0');
    const s = `${yr}-${moStr}-16`;
    const e = `${yr}-${moStr}-${lastDay}`;
    setDateMode('range');
    handleRangeDatesChange(s, e, skipSundays);
  };

  const setMesCompleto = () => {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = d.getMonth() + 1;
    const lastDay = new Date(yr, mo, 0).getDate();
    const moStr = String(mo).padStart(2, '0');
    const s = `${yr}-${moStr}-01`;
    const e = `${yr}-${moStr}-${lastDay}`;
    setDateMode('range');
    handleRangeDatesChange(s, e, skipSundays);
  };

  // Estimación en tiempo real del registro del día o período
  const estimatedDayPay = useMemo(() => {
    if (!activeWorkerForForm) return 0;
    const rH = Number(regularHours) || 0;
    const dW = Number(daysWorked) || 0;
    const oH = Number(overtimeHours) || 0;
    const base =
      activeWorkerForForm.rateUnit === 'Hora'
        ? rH * activeWorkerForForm.baseRate
        : dW * activeWorkerForForm.baseRate;
    const extras = oH * activeWorkerForForm.overtimeRate;
    return base + extras;
  }, [activeWorkerForForm, regularHours, overtimeHours, daysWorked]);

  // 3. Manejador: Registrar Jornada y Horas Extras (Día individual o Período del 1 al 15)
  const handleSubmitTimeLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !spreadsheetId || !selectedWorkerId || !activeWorkerForForm) return;

    setIsSubmittingLog(true);
    setError(null);
    try {
      let effectiveDate: string;
      if (selectedDatesList.length > 1) {
        if (selectionMode === 'range' && logDateStart && logDateEnd && logDateStart !== logDateEnd) {
          effectiveDate = `${logDateStart} al ${logDateEnd}`;
        } else {
          // Si son días seleccionados uno por uno
          effectiveDate = selectedDatesList.join(', ');
        }
      } else {
        effectiveDate = selectedDatesList[0] || logDateStart || logDate;
      }

      const defaultNotes =
        selectedDatesList.length > 1
          ? `Período laborado (${daysWorked} días: ${effectiveDate})`
          : 'Jornada ordinaria de obra';

      const activity = activityNotes.trim() || defaultNotes;

      await payrollService.logTimeEntry(accessToken, spreadsheetId, {
        workerId: selectedWorkerId,
        workerName: activeWorkerForForm.name,
        date: effectiveDate,
        regularHours: Number(regularHours) || 0,
        overtimeHours: Number(overtimeHours) || 0,
        daysWorked: Number(daysWorked) || 0,
        activityNotes: activity,
        siteLocation: activity,
      });

      setSuccessMessage(
        `Jornadas registradas exitosamente para ${activeWorkerForForm.name}: ${daysWorked} días laborados (${effectiveDate}) y ${overtimeHours}h extras ($${estimatedDayPay.toLocaleString()}) agregados a Google Sheets.`
      );
      setTimeout(() => setSuccessMessage(null), 6000);

      // Resetear campos parciales
      setOvertimeHours(0);
      setActivityNotes('');

      // Recargar datos
      await loadPayrollData();
    } catch (err: any) {
      console.error('Error registrando jornada:', err);
      setError(err.message || 'Error al guardar jornada en Google Sheets.');
    } finally {
      setIsSubmittingLog(false);
    }
  };

  // 4. Manejador: Agregar Nuevo Obrero
  const handleCreateWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !spreadsheetId || !newWorkerName.trim()) return;

    setIsSavingWorker(true);
    setError(null);
    try {
      if (newWorkerRole.trim()) {
        saveCustomWorkerRole(newWorkerRole.trim());
      }

      const result = await payrollService.addWorker(accessToken, spreadsheetId, {
        name: newWorkerName.trim(),
        dni: newWorkerDni.trim(),
        role: newWorkerRole.trim() || 'Oficial Albañil',
        paymentFrequency: newWorkerFrequency,
        rateUnit: newWorkerRateUnit,
        baseRate: Number(newWorkerBaseRate) || 0,
        overtimeRate: Number(newWorkerOvertimeRate) || 0,
        phone: newWorkerPhone.trim(),
        active: true,
        joinedDate: new Date().toISOString().split('T')[0],
      });

      setSuccessMessage(`Obrero "${result.worker.name}" agregado exitosamente a la cuadrilla.`);
      setTimeout(() => setSuccessMessage(null), 5000);

      setIsAddWorkerModalOpen(false);
      setNewWorkerName('');
      setNewWorkerDni('');
      setNewWorkerPhone('');
      setNewWorkerBaseRate(85000);
      setNewWorkerOvertimeRate(16000);

      await loadPayrollData();
    } catch (err: any) {
      console.error('Error agregando obrero:', err);
      setError(err.message || 'Error agregando obrero a la hoja de cálculo.');
    } finally {
      setIsSavingWorker(false);
    }
  };

  // Manejador: Actualizar datos de obrero existente (PUT)
  const handleUpdateWorker = async (updatedWorker: Worker) => {
    if (!accessToken || !spreadsheetId) return;
    try {
      if (updatedWorker.role && updatedWorker.role.trim()) {
        saveCustomWorkerRole(updatedWorker.role.trim());
      }

      // 1. Actualización optimista inmediata en memoria para recálculo instantáneo
      setWorkers((prev) =>
        prev.map((w) => (w.id === updatedWorker.id ? updatedWorker : w))
      );

      // 2. Persistir en Google Sheets
      const res = await payrollService.updateWorker(
        accessToken,
        spreadsheetId,
        updatedWorker.id,
        updatedWorker
      );

      setSuccessMessage(`Obrero "${res.worker.name}" actualizado correctamente en Google Sheets.`);
      setTimeout(() => setSuccessMessage(null), 4000);

      // 3. Sincronizar estado completo
      await loadPayrollData();
    } catch (err: any) {
      console.error('Error actualizando obrero:', err);
      // Revertir recargando datos originales
      await loadPayrollData();
      throw err;
    }
  };

  // Manejador: Eliminar obrero de la cuadrilla (DELETE)
  const handleDeleteWorker = async () => {
    if (!accessToken || !spreadsheetId || !workerToDelete) return;
    const deletedId = workerToDelete.id;
    const workerName = workerToDelete.name;
    const workerDni = workerToDelete.dni;

    try {
      // 1. Actualización optimista inmediata en memoria para recálculo instantáneo
      setWorkers((prev) => prev.filter((w) => w.id !== deletedId));
      setTimeRecords((prev) => prev.filter((t) => t.workerId !== deletedId));
      if (selectedWorkerId === deletedId) {
        setSelectedWorkerId('');
      }

      // 2. Persistir eliminación en Google Sheets enviando identificadores y nombres para fallback resiliente
      await payrollService.deleteWorker(accessToken, spreadsheetId, deletedId, {
        name: workerName,
        dni: workerDni,
      });

      setSuccessMessage(`Obrero "${workerName}" eliminado correctamente de la nómina.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setIsDeleteWorkerModalOpen(false);
      setWorkerToDelete(null);

      // 3. Sincronizar datos
      await loadPayrollData();
    } catch (err: any) {
      console.error('Error eliminando obrero:', err);
      setIsDeleteWorkerModalOpen(false);
      setWorkerToDelete(null);
      await loadPayrollData();
      throw err;
    }
  };

  // 5. Manejador: Generar Desprendible de Pago (PDF) con fechas exactas registradas
  const handleDownloadPdf = (calc: PayrollCalculation) => {
    try {
      const monthNames = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ];
      const now = new Date();
      const periodLabel = `Periodo ${calc.paymentFrequency} - ${monthNames[now.getMonth()]} ${now.getFullYear()}`;

      // Calcular fechas exactas de inicio y fin de pago registrado para este obrero
      const workerRecords = timeRecords.filter((tr) => tr.workerId === calc.workerId && tr.date);
      let startDateStr = '';
      let endDateStr = '';

      if (workerRecords.length > 0) {
        const sortedDates = workerRecords
          .map((r) => r.date)
          .filter(Boolean)
          .sort();
        if (sortedDates.length > 0) {
          const rawStart = sortedDates[0];
          const rawEnd = sortedDates[sortedDates.length - 1];

          // Formatear fechas a DD/MM/AAAA
          const formatD = (dStr: string) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
              const [y, m, d] = dStr.split('-');
              return `${d}/${m}/${y}`;
            }
            return dStr;
          };

          startDateStr = formatD(rawStart);
          endDateStr = formatD(rawEnd);
        }
      }

      // Si no hay jornadas registradas para el obrero en el mes, usar fechas del periodo actual
      if (!startDateStr || !endDateStr) {
        const y = now.getFullYear();
        const m = now.getMonth();
        if (calc.paymentFrequency === 'Quincenal') {
          if (now.getDate() <= 15) {
            startDateStr = `01/${String(m + 1).padStart(2, '0')}/${y}`;
            endDateStr = `15/${String(m + 1).padStart(2, '0')}/${y}`;
          } else {
            const lastDay = new Date(y, m + 1, 0).getDate();
            startDateStr = `16/${String(m + 1).padStart(2, '0')}/${y}`;
            endDateStr = `${lastDay}/${String(m + 1).padStart(2, '0')}/${y}`;
          }
        } else if (calc.paymentFrequency === 'Semanal') {
          const curr = new Date();
          const first = curr.getDate() - curr.getDay() + 1;
          const last = first + 5;
          const firstDay = new Date(curr.setDate(first));
          const lastDay = new Date(curr.setDate(last));
          startDateStr = `${String(firstDay.getDate()).padStart(2, '0')}/${String(firstDay.getMonth() + 1).padStart(2, '0')}/${firstDay.getFullYear()}`;
          endDateStr = `${String(lastDay.getDate()).padStart(2, '0')}/${String(lastDay.getMonth() + 1).padStart(2, '0')}/${lastDay.getFullYear()}`;
        } else {
          const lastDay = new Date(y, m + 1, 0).getDate();
          startDateStr = `01/${String(m + 1).padStart(2, '0')}/${y}`;
          endDateStr = `${lastDay}/${String(m + 1).padStart(2, '0')}/${y}`;
        }
      }

      generatePayrollReceiptPdf({
        calculation: calc,
        projectName,
        payPeriod: periodLabel,
        startDate: startDateStr,
        endDate: endDateStr,
      });

      setSuccessMessage(
        `Desprendible PDF generado para ${calc.workerName} (Periodo registrado: ${startDateStr} al ${endDateStr}).`
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (pdfErr: any) {
      console.error('Error generando PDF:', pdfErr);
      setError('Error generando el desprendible de pago en PDF: ' + pdfErr.message);
    }
  };

  // 6. Manejador: Cierre de Mes (Rollover) con hoja independiente
  const handleExecuteRollover = async () => {
    if (!accessToken || !spreadsheetId) return;
    setIsExecutingRollover(true);
    setError(null);
    try {
      const result = await payrollService.executeMonthRollover(
        accessToken,
        spreadsheetId,
        rolloverArchiveName.trim() || undefined,
        folderId,
        projectName
      );

      setSuccessMessage(
        `¡Cierre de mes exitoso! Los datos de nómina de ${result.archivedSheetTitle} se mantuvieron intactos en la hoja de cálculo. Se habilitó la nueva pestaña "${result.newSheetTitle}" con horas en cero y se conservó toda la información anterior (incluida la facturación).`
      );
      setIsRolloverModalOpen(false);
      setRolloverArchiveName('');

      await loadPayrollData();
    } catch (err: any) {
      console.error('Error en cierre de mes:', err);
      setError(err.message || 'Error ejecutando el cierre de mes.');
    } finally {
      setIsExecutingRollover(false);
    }
  };

  // Manejador: Actualizar registro de jornada (si hubo error al registrar)
  const handleSaveTimeRecord = async (recordId: string, updated: Partial<TimeRecord>) => {
    if (!accessToken || !spreadsheetId) return;
    try {
      await payrollService.updateTimeRecord(accessToken, spreadsheetId, recordId, updated);
      setSuccessMessage('Registro de jornada actualizado correctamente en Google Sheets.');
      setTimeout(() => setSuccessMessage(null), 5000);
      await loadPayrollData();
    } catch (err: any) {
      console.error('Error actualizando jornada:', err);
      throw err;
    }
  };

  // Manejador: Eliminar registro de jornada erróneo
  const handleDeleteTimeRecord = async (recordId: string, recordHint?: TimeRecord) => {
    if (!accessToken || !spreadsheetId) return;
    try {
      const targetRecord = recordHint || timeRecords.find((tr) => tr.id === recordId);
      await payrollService.deleteTimeRecord(accessToken, spreadsheetId, recordId, {
        workerId: targetRecord?.workerId,
        workerName: targetRecord?.workerName,
        date: targetRecord?.date,
        sheetRowIndex: targetRecord?.sheetRowIndex,
      });
      // Inmediatamente depurar del estado local para feedback reactivo
      setTimeRecords((prev) => prev.filter((tr) => tr.id !== recordId));
      setSuccessMessage('Registro de jornada eliminado de Google Sheets.');
      setTimeout(() => setSuccessMessage(null), 5000);
      await loadPayrollData();
    } catch (err: any) {
      console.error('Error eliminando jornada:', err);
      // Si el error indica que no se encontró o que era #REF!, retirar del estado local igualmente
      if (
        String(err?.message || '').includes('No se encontró') ||
        String(err?.message || '').includes('#REF!') ||
        String(err?.message || '').includes('retirado')
      ) {
        setTimeRecords((prev) => prev.filter((tr) => tr.id !== recordId));
        setSuccessMessage('Registro depurado de la aplicación.');
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        throw err;
      }
    }
  };

  // 7. Manejador: Generar Reporte Ejecutivo de Nómina en Google Sheets (Con Branding y Fórmulas)
  const handleExportReportSheets = async () => {
    if (!accessToken || !spreadsheetId) return;
    setIsExportingSheets(true);
    setError(null);
    try {
      const result = await payrollService.exportFinancialReport(
        accessToken,
        spreadsheetId,
        projectName,
        'Liquidación Oficial de Cuadrilla de Obra'
      );
      setSuccessMessage(
        `¡Reporte generado con éxito! Se creó la pestaña "${result.sheetTitle}" en Google Sheets con branding SVH, logo y fórmulas automáticas.`
      );
      setTimeout(() => setSuccessMessage(null), 6000);
      await loadPayrollData();
    } catch (err: any) {
      console.warn('Aviso exportando reporte a Sheets:', err?.message || err);
      setError(err.message || 'No se pudo generar el reporte en Google Sheets.');
    } finally {
      setIsExportingSheets(false);
    }
  };

  // 8. Manejador: Descargar Reporte en Excel (.xlsx)
  const handleExportExcel = async () => {
    if (!accessToken) {
      setError('Se requiere una sesión activa con Google Drive. Pulsa en "Renovar Conexión Google".');
      return;
    }
    if (!spreadsheetId) {
      setError('No hay una hoja de cálculo vinculada a esta obra. Vincula o crea la hoja para exportarla a Excel.');
      return;
    }
    setIsExportingExcel(true);
    setError(null);
    try {
      await payrollService.downloadExcelReport(accessToken, spreadsheetId, projectName);
      setSuccessMessage('¡Hoja de cálculo exportada a Excel (.xlsx) exitosamente respetando todo su formato corporativo!');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      console.warn('Aviso descargando Excel:', err);
      const isAuth =
        err?.status === 401 ||
        err?.isAuthError ||
        String(err?.message || '').includes('401') ||
        String(err?.message || '').includes('invalid authentication credentials') ||
        String(err?.message || '').includes('expirado') ||
        String(err?.message || '').includes('Expected OAuth 2');

      if (isAuth && onReauthenticate) {
        try {
          const newToken = await onReauthenticate();
          if (newToken) {
            await payrollService.downloadExcelReport(newToken, spreadsheetId, projectName);
            setSuccessMessage('¡Hoja de cálculo exportada a Excel (.xlsx) exitosamente tras renovar credenciales!');
            setTimeout(() => setSuccessMessage(null), 5000);
            return;
          }
        } catch (renewErr) {
          console.warn('No se pudo renovar token para Excel:', renewErr);
        }
      }

      setError(
        isAuth
          ? 'Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para renovar tus credenciales.'
          : (err.message || 'Error al descargar archivo Excel.')
      );
    } finally {
      setIsExportingExcel(false);
    }
  };

  // 9. Manejador: Aplicar Formato Oficial SVH a Google Sheets (con Foto del Arquitecto y Banding)
  const handleApplyStyling = async () => {
    if (!accessToken || !spreadsheetId) return;
    setIsApplyingStyling(true);
    setError(null);
    try {
      const res = await payrollService.applyPayrollCorporateStyling(accessToken, spreadsheetId);
      setSuccessMessage(res.message || '¡Formato oficial de SVH Arquitectos aplicado a Google Sheets con éxito!');
      setTimeout(() => setSuccessMessage(null), 6000);
      await loadPayrollData();
    } catch (err: any) {
      console.error('Error aplicando formato oficial a Sheets:', err);
      setError(err.message || 'No se pudo aplicar el formato corporativo.');
    } finally {
      setIsApplyingStyling(false);
    }
  };

  // Registros filtrados para el Formato de Días Laborados
  const filteredTimeRecords = useMemo(() => {
    let list = timeRecords;
    if (filterWorkerId !== 'all') {
      list = list.filter((tr) => tr.workerId === filterWorkerId);
    }
    if (filterDateStart) {
      list = list.filter((tr) => {
        if (!tr.date) return false;
        if (tr.date.includes(',')) {
          const parts = tr.date.split(',').map((p) => p.trim());
          const minFilter = filterDateStart;
          const maxFilter = filterDateEnd || filterDateStart;
          return parts.some((p) => p >= minFilter && p <= maxFilter);
        }
        const recEnd = tr.date.includes('al') ? tr.date.split('al')[1].trim() : tr.date;
        const recStart = tr.date.includes('al') ? tr.date.split('al')[0].trim() : tr.date;
        const minFilter = filterDateStart;
        const maxFilter = filterDateEnd || filterDateStart;
        return recEnd >= minFilter && recStart <= maxFilter;
      });
    }
    return list;
  }, [timeRecords, filterWorkerId, filterDateStart, filterDateEnd]);

  // Resumen acumulado para el Formato 1 (Días Laborados y Asistencia)
  const timesSummary = useMemo(() => {
    let totalDays = 0;
    let totalRegular = 0;
    let totalOvertime = 0;
    let totalDevengado = 0;

    filteredTimeRecords.forEach((tr) => {
      const worker = workers.find((w) => w.id === tr.workerId);
      const baseRate = worker?.baseRate || 0;
      const overtimeRate = worker?.overtimeRate || 0;
      const estBase = (worker?.rateUnit === 'Hora' ? tr.regularHours : tr.daysWorked) * baseRate;
      const estExtras = tr.overtimeHours * overtimeRate;
      totalDays += tr.daysWorked;
      totalRegular += tr.regularHours;
      totalOvertime += tr.overtimeHours;
      totalDevengado += estBase + estExtras;
    });

    return { totalDays, totalRegular, totalOvertime, totalDevengado };
  }, [filteredTimeRecords, workers]);

  // Resumen acumulado para el Formato 2 (Planilla de Liquidación de Cuadrilla)
  const crewSummary = useMemo(() => {
    let totalBase = 0;
    let totalOvertime = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    calculations.forEach((c) => {
      totalBase += c.basePay;
      totalOvertime += c.overtimePay;
      totalDeductions += c.deductions;
      totalNet += c.netPay;
    });

    return { totalBase, totalOvertime, totalDeductions, totalNet };
  }, [calculations]);

  // Color dinámico de la barra de progreso de presupuesto
  const progressColorClass = useMemo(() => {
    if (metrics.percentageSpent >= 90) return 'from-rose-500 to-red-600';
    if (metrics.percentageSpent >= 75) return 'from-amber-500 to-yellow-500';
    return 'from-[#1ca330] to-[#98d52c]';
  }, [metrics.percentageSpent]);

  const [isCreatingSheetForObra, setIsCreatingSheetForObra] = useState(false);
  const handleCreateSheetForObra = async () => {
    if (!accessToken) return;
    setIsCreatingSheetForObra(true);
    setError(null);
    try {
      const title = buildProjectSpreadsheetTitle(projectName);
      const cleanFolderId = !folderId || folderId === 'root' || folderId === 'shared-with-me' || folderId === 'shared-drives' ? undefined : folderId;
      const created = await createCustomSpreadsheet(accessToken, title, cleanFolderId);
      if (onSpreadsheetCreated) {
        onSpreadsheetCreated({
          id: created.id,
          name: created.name,
          url: created.webViewLink,
        });
      }
    } catch (err: any) {
      console.error('Error creando hoja para nóminas:', err);
      setError(err.message || 'No se pudo crear la hoja de cálculo para la obra.');
    } finally {
      setIsCreatingSheetForObra(false);
    }
  };

  if (!spreadsheetId) {
    return (
      <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-slate-200/80 p-8 text-center shadow-xs">
        <Briefcase className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-800">
          Obra sin Hoja de Cálculo Vinculada
        </h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
          Para gestionar las nóminas y registrar los tiempos de los obreros, la obra activa debe tener vinculada una hoja de cálculo en Google Sheets.
        </p>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 max-w-md mx-auto">
            {error}
          </div>
        )}

        <div className="flex items-center justify-center gap-3 mt-5 flex-wrap">
          <button
            type="button"
            onClick={handleCreateSheetForObra}
            disabled={isCreatingSheetForObra}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1ca330] hover:bg-[#168826] text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isCreatingSheetForObra ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Creando hoja en Google Drive...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4" />
                <span>Crear Hoja de Cálculo para esta Obra ahora</span>
              </>
            )}
          </button>

          {onOpenConfig && (
            <button
              type="button"
              onClick={onOpenConfig}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4 text-slate-500" />
              <span>Vincular hoja existente</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alertas y Mensajes */}
      {error && (
        <div className="p-4 bg-rose-50/95 backdrop-blur-md border border-rose-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-900 shadow-sm animate-in fade-in">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold">Aviso de Nóminas: </span>
              <span>
                {error.includes('invalid authentication credentials') ||
                error.includes('Token de autenticación') ||
                error.includes('expirado') ||
                error.includes('OAuth') ||
                error.includes('conexión activa')
                  ? 'Tu sesión de Google Drive y Google Sheets ha expirado. Para continuar gestionando las nóminas, renueva tu conexión con un solo clic.'
                  : error}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            {(error.includes('invalid authentication credentials') ||
              error.includes('Token de autenticación') ||
              error.includes('expirado') ||
              error.includes('OAuth') ||
              error.includes('conexión activa')) &&
              onReauthenticate && (
                <button
                  type="button"
                  onClick={handleRenewConnection}
                  disabled={isRenewingAuth}
                  className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Conectar nuevamente con Google Workspace para renovar permisos"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRenewingAuth ? 'animate-spin' : ''}`} />
                  <span>{isRenewingAuth ? 'Renovando...' : 'Renovar Conexión Google'}</span>
                </button>
              )}
            <button
              onClick={() => setError(null)}
              className="text-rose-500 hover:text-rose-700 font-bold px-2 py-1 cursor-pointer"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-50/90 backdrop-blur-md border border-emerald-200 rounded-2xl flex items-center gap-3 text-xs text-emerald-800 animate-in fade-in shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold flex-1">{successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-800 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* SECCIÓN 1: Glassmorphism Budget & KPI Dashboard */}
      <div className="relative overflow-hidden bg-white/70 backdrop-blur-xl border border-white/60 rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/50">
        {/* Glow decorativo de fondo */}
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-gradient-to-br from-[#1ca330]/15 to-[#98d52c]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 w-80 h-80 bg-gradient-to-tr from-sky-400/10 to-teal-400/15 rounded-full blur-3xl pointer-events-none" />

        {/* Cabecera del Dashboard con Foto del Arquitecto y Guía Oficial SVH */}
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5 pb-6 border-b border-slate-200/60">
          <div className="flex items-center gap-4">
            <div className="relative group shrink-0">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl p-1 bg-white border border-emerald-300 shadow-sm flex items-center justify-center overflow-hidden">
                <img
                  src="https://i.postimg.cc/Hn6LNwm0/image.png"
                  alt="SVH Arquitectos - Arq. Santiago Valderrama Hoyos"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    // Si la imagen tarda, mantener dimensiones y estilo limpio
                    (e.currentTarget as any).style.display = 'none';
                  }}
                />
              </div>
              <div
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#1ca330] border-2 border-white flex items-center justify-center text-white shadow-xs"
                title="Dirección Técnica Oficial de Obra"
              >
                <CheckCircle2 className="w-3 h-3" />
              </div>
            </div>

            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[#1ca330] text-[11px] font-bold uppercase tracking-wider mb-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>SVH ARQUITECTOS & ASOC. • CONTROL DE OBRA</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight font-serif flex items-center gap-2">
                <span>Planilla y Jornadas:</span>
                <span className="text-[#1ca330]">{projectName}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Dirección Técnica: <strong className="text-slate-800 font-semibold">Arq. Santiago Valderrama Hoyos</strong> • Estructura oficial para Días Laborados y Nómina de Cuadrilla.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto mt-3 lg:mt-0">
            {/* Botón Aplicar Formato Oficial a Sheets */}
            <button
              type="button"
              onClick={handleApplyStyling}
              disabled={isApplyingStyling}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-xs hover:shadow-md transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap cursor-pointer w-full sm:w-auto"
              title="Aplica la tabla de nómina consolidada y ordenada por obrero con paleta profesional, sin foto del logo, totales al frente y formato contable"
            >
              {isApplyingStyling ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white shrink-0" />
                  <span className="truncate">Formateando...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-yellow-300 shrink-0" />
                  <span className="hidden sm:inline">Formato Oficial Sheets</span>
                  <span className="sm:hidden">Formato Sheets</span>
                </>
              )}
            </button>

            {spreadsheetUrl && (
              <a
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-white/90 hover:bg-white text-slate-700 border border-slate-200 shadow-2xs hover:shadow-xs transition-all whitespace-nowrap w-full sm:w-auto"
                title="Abrir libro de cálculo con las pestañas Obreros y Tiempos"
              >
                <span>Ver en Sheets</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </a>
            )}

            {/* Botón Reporte Financiero Google Sheets con Branding */}
            <button
              type="button"
              onClick={handleExportReportSheets}
              disabled={isExportingSheets || calculations.length === 0}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap cursor-pointer w-full sm:w-auto"
              title="Crear pestaña con formato financiero, logo de SVH, colores corporativos y fórmulas =SUM"
            >
              {isExportingSheets ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700 shrink-0" />
                  <span className="truncate">Exportando...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="hidden sm:inline">Reporte Financiero</span>
                  <span className="sm:hidden">Reporte Fin.</span>
                </>
              )}
            </button>

            {/* Botón Exportar Excel (.xlsx) */}
            <button
              id="btn-export-excel-payroll"
              type="button"
              onClick={handleExportExcel}
              disabled={isExportingExcel || !spreadsheetId}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap w-full sm:w-auto"
              title={
                spreadsheetId
                  ? 'Descargar la hoja de cálculo completa en formato Excel (.xlsx) respetando todo su formato'
                  : 'Vincula una hoja de cálculo a esta obra para exportarla en Excel'
              }
            >
              {isExportingExcel ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600 shrink-0" />
                  <span className="truncate">Exportando...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Excel (.xlsx)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsRolloverModalOpen(true)}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-900 border border-amber-300/60 shadow-2xs transition-all whitespace-nowrap cursor-pointer w-full sm:w-auto"
              title="Archivar el mes actual como histórico y crear hoja nueva"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>Cierre de Mes</span>
            </button>

            <button
              type="button"
              onClick={() => setIsImportWorkersModalOpen(true)}
              className="h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs hover:shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap w-full sm:w-auto"
              title="Leer archivo de obreros, tarifas y datos (Excel, PDF, Foto) y registrarlos con IA"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#1ca330] shrink-0" />
              <span className="hidden sm:inline">Importar Documento</span>
              <span className="sm:hidden">Importar</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddWorkerModalOpen(true)}
              className="col-span-2 sm:col-span-1 h-9 px-2.5 sm:px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-xs hover:shadow-md transition-all active:scale-95 cursor-pointer whitespace-nowrap w-full sm:w-auto"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
              <span>+ Nuevo Obrero</span>
            </button>
          </div>
        </div>

        {/* Barra de Progreso de Consumo de Presupuesto */}
        <div className="relative mt-6 p-5 bg-white/80 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Consumo Presupuestal de Mano de Obra
              </span>
              <p className="text-[11px] text-slate-500">
                Gasto acumulado frente al presupuesto asignado a la cuadrilla de la obra
              </p>
            </div>

            <div className="flex items-center gap-3">
              {isEditingBudget ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-bold">$</span>
                  <input
                    type="number"
                    value={customTotalBudget}
                    onChange={(e) => setCustomTotalBudget(Math.max(1, Number(e.target.value)))}
                    className="w-32 px-2 py-1 text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1ca330]"
                  />
                  <button
                    type="button"
                    onClick={() => setIsEditingBudget(false)}
                    className="px-2 py-1 bg-[#1ca330] text-white text-[10px] font-bold rounded-md"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingBudget(true)}
                  className="text-[11px] text-slate-400 hover:text-slate-700 underline font-medium"
                  title="Cambiar presupuesto total asignado"
                >
                  Editar meta
                </button>
              )}

              <span className="text-sm font-extrabold text-slate-900">
                {metrics.percentageSpent}% consumido
              </span>
            </div>
          </div>

          {/* Progress Bar Container */}
          <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${progressColorClass} transition-all duration-700 shadow-xs`}
              style={{ width: `${Math.min(100, metrics.percentageSpent)}%` }}
            />
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              Devengado hasta hoy:{' '}
              <strong className="text-slate-900 font-bold">
                ${metrics.spentBudget.toLocaleString()}
              </strong>
            </span>
            <span>
              Presupuesto Total:{' '}
              <strong className="text-slate-900 font-bold">
                ${metrics.totalAllocatedBudget.toLocaleString()}
              </strong>
            </span>
            <span>
              Saldo Disponible:{' '}
              <strong
                className={`font-bold ${
                  metrics.totalAllocatedBudget - metrics.spentBudget < 0
                    ? 'text-rose-600'
                    : 'text-emerald-700'
                }`}
              >
                ${Math.max(0, metrics.totalAllocatedBudget - metrics.spentBudget).toLocaleString()}
              </strong>
            </span>
          </div>
        </div>

        {/* Cuadrícula de KPIs Rápidos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-5">
          <div className="p-4 bg-white/70 backdrop-blur-md rounded-2xl border border-slate-200/60 shadow-2xs">
            <div className="flex items-center gap-2 text-slate-500 text-[11px] font-semibold mb-1">
              <Users className="w-3.5 h-3.5 text-[#1ca330]" />
              <span>Obreros Activos</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900">
              {metrics.activeWorkersCount}
            </div>
            <span className="text-[10px] text-slate-400">En nómina de la obra</span>
          </div>

          <div className="p-4 bg-white/70 backdrop-blur-md rounded-2xl border border-slate-200/60 shadow-2xs">
            <div className="flex items-center gap-2 text-slate-500 text-[11px] font-semibold mb-1">
              <Clock className="w-3.5 h-3.5 text-sky-600" />
              <span>Horas Ordinarias</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900">
              {metrics.totalHoursLogged} hrs
            </div>
            <span className="text-[10px] text-slate-400">Jornadas acumuladas</span>
          </div>

          <div className="p-4 bg-white/70 backdrop-blur-md rounded-2xl border border-slate-200/60 shadow-2xs">
            <div className="flex items-center gap-2 text-slate-500 text-[11px] font-semibold mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
              <span>Horas Extras</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900">
              {metrics.totalOvertimeHoursLogged} hrs
            </div>
            <span className="text-[10px] text-amber-700 font-medium">Trabajo suplementario</span>
          </div>

          <div className="p-4 bg-white/70 backdrop-blur-md rounded-2xl border border-slate-200/60 shadow-2xs">
            <div className="flex items-center gap-2 text-slate-500 text-[11px] font-semibold mb-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              <span>Total Devengado</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900 truncate">
              ${metrics.spentBudget.toLocaleString()}
            </div>
            <span className="text-[10px] text-slate-400">Bruto acumulado mes</span>
          </div>
        </div>
      </div>

      {/* SECCIÓN 2: Formulario Rápido de Registro de Jornada Diaria & Horas Extras */}
      <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-3xl p-6 sm:p-7 shadow-lg shadow-slate-200/40">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#1ca330] to-[#98d52c] text-white flex items-center justify-center shadow-xs">
              <Clock className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Registro Rápido de Jornada y Horas Extras
              </h3>
              <p className="text-[11px] text-slate-500">
                Selecciona al obrero, ingresa las horas y se inyectará directamente en Google Sheets.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Selector de Vista: Calendario Abierto vs Compacto */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setShowInlineCalendar(true)}
                className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer text-xs ${
                  showInlineCalendar
                    ? 'bg-[#1ca330] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Mostrar el calendario directamente en pantalla para seleccionar días"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Vista Calendario</span>
              </button>
              <button
                type="button"
                onClick={() => setShowInlineCalendar(false)}
                className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer text-xs ${
                  !showInlineCalendar
                    ? 'bg-[#1ca330] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Mostrar selector de fecha compacto"
              >
                <span>Compacto</span>
              </button>
            </div>

            {activeWorkerForForm && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                <span>{daysWorked > 1 ? 'Valor estimado del período:' : 'Valor estimado del día:'}</span>
                <strong className="text-emerald-950 font-extrabold">
                  ${estimatedDayPay.toLocaleString()}
                </strong>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmitTimeLog} className="space-y-4">
          {showInlineCalendar ? (
            /* ============================================================== */
            /* VISTA TIPO CALENDARIO ABIERTO EN PANTALLA                      */
            /* ============================================================== */
            <div className="space-y-4">
              {/* 1. Datos del Obrero y Horas */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/80">
                {/* Obrero */}
                <div className="sm:col-span-5 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                      Obrero / Cuadrilla
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsImportWorkersModalOpen(true)}
                        className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline flex items-center gap-1 cursor-pointer"
                        title="Importar obreros con sus precios y datos desde documento (Excel, PDF, Foto)"
                      >
                        <FileSpreadsheet className="w-3 h-3 text-[#1ca330]" />
                        <span>Leer Documento</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddWorkerModalOpen(true)}
                        className="text-[11px] font-bold text-[#1ca330] hover:underline cursor-pointer"
                      >
                        + Nuevo
                      </button>
                    </div>
                  </div>
                  <select
                    value={selectedWorkerId}
                    onChange={(e) => setSelectedWorkerId(e.target.value)}
                    disabled={workers.length === 0 || isSubmittingLog}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                  >
                    {workers.length === 0 ? (
                      <option value="">(Sin obreros registrados - Pulsa "+ Agregar Obrero")</option>
                    ) : (
                      workers.map((w, idx) => (
                        <option key={`w-sel1-${w.id}-${idx}`} value={w.id}>
                          {w.name} ({w.role})
                        </option>
                      ))
                    )}
                  </select>
                  {activeWorkerForForm ? (
                    <span className="text-[10px] text-slate-400 block truncate">
                      Tarifa: ${activeWorkerForForm.baseRate.toLocaleString()} / {activeWorkerForForm.rateUnit} • Extra: ${activeWorkerForForm.overtimeRate.toLocaleString()}
                    </span>
                  ) : null}
                </div>

                {/* Horas Ordinarias (sincronizadas automáticamente con los días del calendario) */}
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center justify-between">
                    <span>Horas Ordinarias</span>
                    <span className="text-[10px] font-mono text-emerald-700 font-bold">
                      {daysWorked} {daysWorked === 1 ? 'día' : 'días'}
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={regularHours}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setRegularHours('');
                          setDaysWorked('');
                        } else {
                          const h = Math.max(0, parseFloat(val) || 0);
                          setRegularHours(h);
                          setDaysWorked(Math.round((h / 8) * 100) / 100);
                        }
                      }}
                      disabled={isSubmittingLog}
                      placeholder="0"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const d = Number(daysWorked) || 1;
                        setRegularHours(d * 8);
                      }}
                      className="px-2 py-1.5 text-[10px] font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg shrink-0 transition-colors"
                      title="Restaurar a jornada estándar (8 horas por día seleccionado)"
                    >
                      {Number(daysWorked) || 1}x8h
                    </button>
                  </div>
                </div>

                {/* Horas Extras */}
                <div className="sm:col-span-4 space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center justify-between">
                    <span>Horas Extras</span>
                    {(Number(overtimeHours) || 0) > 0 && (
                      <span className="text-[10px] font-bold text-amber-700">
                        +${((activeWorkerForForm?.overtimeRate || 0) * (Number(overtimeHours) || 0)).toLocaleString()}
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={overtimeHours}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setOvertimeHours('');
                        } else {
                          setOvertimeHours(Math.max(0, parseFloat(val) || 0));
                        }
                      }}
                      disabled={isSubmittingLog}
                      placeholder="0"
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                    />
                    <button
                      type="button"
                      onClick={() => setOvertimeHours((prev) => (Number(prev) || 0) + 1)}
                      className="px-2 py-1.5 text-[10px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg shrink-0 transition-colors cursor-pointer"
                    >
                      +1h
                    </button>
                    <button
                      type="button"
                      onClick={() => setOvertimeHours((prev) => (Number(prev) || 0) + 8)}
                      className="px-2 py-1.5 text-[10px] font-bold bg-amber-200 hover:bg-amber-300 text-amber-900 rounded-lg shrink-0 transition-colors cursor-pointer"
                      title="Añadir 8 horas extras"
                    >
                      +8h
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. CALENDARIO INTERACTIVO DIRECTAMENTE EN PANTALLA (Diseño compacto y centrado) */}
              <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-slate-50/40 p-2 sm:p-2.5 max-w-lg sm:max-w-xl mx-auto shadow-2xs">
                <DateRangePicker
                  inline={true}
                  compact={true}
                  label="Calendario de Jornada Laboral (Selecciona por rango o elige uno por uno)"
                  startDate={logDateStart}
                  endDate={logDateEnd}
                  selectedDates={selectedDatesList}
                  skipSundaysDefault={skipSundays}
                  onChange={(val) => {
                    setSkipSundays(val.skipSundays);
                    setLogDateStart(val.startDate);
                    setLogDateEnd(val.endDate);
                    setSelectedDatesList(val.selectedDates);
                    setSelectionMode(val.selectionMode);
                    if (val.selectionMode === 'individual') {
                      setDateMode('range');
                      setLogDate(val.selectedDates.join(', '));
                    } else if (val.startDate === val.endDate || !val.endDate) {
                      setDateMode('single');
                      setLogDate(val.startDate);
                    } else {
                      setDateMode('range');
                      setLogDate(`${val.startDate} al ${val.endDate}`);
                    }
                    setDaysWorked(val.workingDays);
                    setRegularHours(val.workingDays * 8);
                  }}
                  disabled={isSubmittingLog}
                />
              </div>

              {/* 3. Frente de Obra & Botón Registrar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Frente de obra / Tarea realizada (ej: Armado de vigas eje 3-B, estuco piso 2)..."
                    value={activityNotes}
                    onChange={(e) => setActivityNotes(e.target.value)}
                    disabled={isSubmittingLog}
                    className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                  />
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {activeWorkerForForm && (
                    <div className="text-right hidden md:block">
                      <span className="text-[10px] text-slate-500 block">Total a liquidar:</span>
                      <strong className="text-xs font-black text-emerald-900">
                        ${estimatedDayPay.toLocaleString()}
                      </strong>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmittingLog || !selectedWorkerId}
                    className="px-6 py-2.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-xs hover:shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {isSubmittingLog ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Registrando en Sheets...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>
                          Registrar {daysWorked} {daysWorked === 1 ? 'Día' : 'Días'} en Sheets
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ============================================================== */
            /* VISTA COMPACTA CON SELECTOR DESPLEGABLE                        */
            /* ============================================================== */
            <div className="space-y-4">
              {/* Barra Superior de Presets Rápidos para el Calendario */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-2.5 bg-slate-100/90 rounded-2xl border border-slate-200/80">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#1ca330]" />
                    <span>Períodos rápidos de nómina:</span>
                  </span>
                  <button
                    type="button"
                    onClick={setQuincena1}
                    className="px-2.5 py-1 text-[11px] font-bold bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    title="1 al 15 del mes actual"
                  >
                    1 al 15 (1ra Quincena)
                  </button>
                  <button
                    type="button"
                    onClick={setQuincena2}
                    className="px-2.5 py-1 text-[11px] font-bold bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    title="16 a fin de mes actual"
                  >
                    16 a fin de mes (2da Quincena)
                  </button>
                  <button
                    type="button"
                    onClick={setMesCompleto}
                    className="px-2.5 py-1 text-[11px] font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    title="Todo el mes en curso"
                  >
                    Mes Completo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const todayStr = new Date().toISOString().split('T')[0];
                      setDateMode('single');
                      setLogDate(todayStr);
                      setLogDateStart(todayStr);
                      setLogDateEnd(todayStr);
                      setSelectedDatesList([todayStr]);
                      setDaysWorked(1);
                      setRegularHours(8);
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
                  >
                    Solo Hoy
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-600 font-mono">
                    {daysWorked} {daysWorked === 1 ? 'día computado' : 'días computados'} ({regularHours}h ord.)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                {/* 1. Selector de Obrero */}
                <div className="sm:col-span-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                      Obrero / Cuadrilla
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsImportWorkersModalOpen(true)}
                        className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline flex items-center gap-1 cursor-pointer"
                        title="Importar obreros con sus precios y datos desde documento (Excel, PDF, Foto)"
                      >
                        <FileSpreadsheet className="w-3 h-3 text-[#1ca330]" />
                        <span>Leer Documento</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddWorkerModalOpen(true)}
                        className="text-[11px] font-bold text-[#1ca330] hover:underline cursor-pointer"
                      >
                        + Nuevo
                      </button>
                    </div>
                  </div>
                  <select
                    value={selectedWorkerId}
                    onChange={(e) => setSelectedWorkerId(e.target.value)}
                    disabled={workers.length === 0 || isSubmittingLog}
                    className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                  >
                    {workers.length === 0 ? (
                      <option value="">(Sin obreros registrados - Pulsa "+ Agregar Obrero")</option>
                    ) : (
                      workers.map((w, idx) => (
                        <option key={`w-sel2-${w.id}-${idx}`} value={w.id}>
                          {w.name} ({w.role})
                        </option>
                      ))
                    )}
                  </select>
                  {activeWorkerForForm ? (
                    <span className="text-[10px] text-slate-400 block truncate">
                      Tarifa: ${activeWorkerForForm.baseRate.toLocaleString()} / {activeWorkerForForm.rateUnit} • Extra: ${activeWorkerForForm.overtimeRate.toLocaleString()}
                    </span>
                  ) : null}
                </div>

                {/* 2. Calendario Interactivo con Date Range Picker (Rango o Uno por Uno) */}
                <div className="sm:col-span-5 space-y-1">
                  <DateRangePicker
                    label="Calendario de Trabajo (Rango o Uno por Uno)"
                    placeholder="Elige fechas o rango en el calendario..."
                    startDate={dateMode === 'single' ? logDate : logDateStart}
                    endDate={dateMode === 'single' ? logDate : logDateEnd}
                    selectedDates={selectedDatesList}
                    skipSundaysDefault={skipSundays}
                    onChange={(val) => {
                      setSkipSundays(val.skipSundays);
                      setLogDateStart(val.startDate);
                      setLogDateEnd(val.endDate);
                      setSelectedDatesList(val.selectedDates);
                      setSelectionMode(val.selectionMode);
                      if (val.selectionMode === 'individual') {
                        setDateMode('range');
                        setLogDate(val.selectedDates.join(', '));
                      } else if (val.startDate === val.endDate || !val.endDate) {
                        setDateMode('single');
                        setLogDate(val.startDate);
                      } else {
                        setDateMode('range');
                        setLogDate(`${val.startDate} al ${val.endDate}`);
                      }
                      setDaysWorked(val.workingDays);
                      setRegularHours(val.workingDays * 8);
                    }}
                    disabled={isSubmittingLog}
                  />
                </div>

                {/* 3. Horas Regulares y Días Computados */}
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center justify-between">
                    <span>Horas Ord.</span>
                    <span className="text-[10px] font-normal text-slate-500 font-mono">
                      {daysWorked} {daysWorked === 1 ? 'día' : 'días'}
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={regularHours}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setRegularHours('');
                          setDaysWorked('');
                        } else {
                          const h = Math.max(0, parseFloat(val) || 0);
                          setRegularHours(h);
                          setDaysWorked(Math.round((h / 8) * 100) / 100);
                        }
                      }}
                      disabled={isSubmittingLog}
                      placeholder="0"
                      className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                    />
                  </div>
                </div>

                {/* 4. Horas Extras */}
                <div className="sm:col-span-1 space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                    Extras
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={overtimeHours}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setOvertimeHours('');
                      } else {
                        setOvertimeHours(Math.max(0, parseFloat(val) || 0));
                      }
                    }}
                    disabled={isSubmittingLog}
                    placeholder="0"
                    className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                  />
                </div>
              </div>

              {/* Frente de Obra / Actividad realizada */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Frente de obra / Tarea realizada (ej: Armado de vigas eje 3-B, estuco piso 2)..."
                    value={activityNotes}
                    onChange={(e) => setActivityNotes(e.target.value)}
                    disabled={isSubmittingLog}
                    className="w-full bg-slate-50/90 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1ca330]/30 focus:border-[#1ca330]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingLog || !selectedWorkerId}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-xs hover:shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  {isSubmittingLog ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Registrando en Sheets...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Registrar Jornada</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </form>

        {/* Notificación de última jornada registrada con botón de edición rápida si hubo error */}
        {lastLoggedRecord && (
          <div className="mt-3 p-3 bg-emerald-50/90 rounded-2xl border border-emerald-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#1ca330] shrink-0" />
              <span className="text-emerald-950 font-semibold">
                Jornada guardada: {lastLoggedRecord.workerName} ({lastLoggedRecord.date}) — {lastLoggedRecord.regularHours}h ord, {lastLoggedRecord.overtimeHours}h extra.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setRecordToEdit(lastLoggedRecord);
                setIsEditRecordModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg font-bold text-[11px] transition-colors shrink-0 shadow-2xs"
            >
              <Pencil className="w-3 h-3 text-emerald-700" />
              <span>Editar esta jornada</span>
            </button>
          </div>
        )}
      </div>

      {/* SECCIÓN 3: Formatos Oficiales de Obra (Días Laborados vs Planilla de Nómina) */}
      <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-3xl p-6 sm:p-7 shadow-xl shadow-slate-200/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-100 mb-5">
          {/* Conmutador de Pestañas: Formato 1 (Días Laborados) vs Formato 2 (Planilla de Nómina) */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setActiveTabSection('crew')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTabSection === 'crew'
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span>Formato 2: Planilla de Nómina ({calculations.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTabSection('times')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTabSection === 'times'
                  ? 'bg-[#1ca330] text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-yellow-200" />
              <span>Formato 1: Días Laborados ({filteredTimeRecords.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            {activeTabSection === 'crew' && (
              /* Selector de Vista: Tabla o Tarjetas Glassmorphism */
              <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setCrewViewMode('table')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    crewViewMode === 'table'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="Vista de Tabla detallada de nómina con acciones"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Tabla</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCrewViewMode('cards')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    crewViewMode === 'cards'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="Vista de Tarjetas individuales"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Tarjetas</span>
                </button>
              </div>
            )}

            <span className="text-xs font-semibold text-slate-500">
              {activeTabSection === 'crew'
                ? `${calculations.length} ${calculations.length === 1 ? 'obrero' : 'obreros'}`
                : `${filteredTimeRecords.length} ${filteredTimeRecords.length === 1 ? 'jornada' : 'jornadas'}`}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin text-[#1ca330]" />
            <p className="text-xs font-semibold">Cargando planilla desde Google Sheets...</p>
          </div>
        ) : activeTabSection === 'times' ? (
          /* ========================================================================= */
          /* FORMATO 1: CONTROL OFICIAL DE ASISTENCIA Y DÍAS LABORADOS DE OBREROS     */
          /* ========================================================================= */
          <div className="space-y-4">
            {/* Banner de Guía Oficial Formato 1 */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200/90 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-emerald-950">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-2xl bg-[#1ca330] text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold uppercase tracking-wide text-emerald-950">
                      FORMATO OFICIAL 1: CONTROL DE ASISTENCIA Y DÍAS LABORADOS
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-emerald-800 border border-emerald-300">
                      SVH Arquitectos
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-800/90 mt-0.5">
                    Guía oficial para asentar jornales diarios: N°, Fecha, Obrero, Días Laborados, Horas Ordinarias (8h), Horas Extras, Frente de Obra, Subtotal Base, Extras y Total Devengado.
                  </p>
                </div>
              </div>

              {/* Selector de Filtro por Obrero y Rango de Fechas */}
              <div className="flex flex-wrap items-center gap-2 shrink-0 bg-white/80 p-1.5 rounded-xl border border-emerald-200">
                <span className="text-[11px] font-bold text-slate-700 pl-1">Filtrar:</span>
                <select
                  value={filterWorkerId}
                  onChange={(e) => setFilterWorkerId(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#1ca330]"
                >
                  <option value="all">Todos los Obreros ({timeRecords.length})</option>
                  {workers.map((w, idx) => (
                    <option key={`w-opt3-${w.id}-${idx}`} value={w.id}>
                      {w.name} ({w.role})
                    </option>
                  ))}
                </select>

                <div className="w-48 sm:w-56">
                  <DateRangePicker
                    compact
                    placeholder="Filtrar por fechas..."
                    startDate={filterDateStart}
                    endDate={filterDateEnd}
                    onChange={(val) => {
                      setFilterDateStart(val.startDate);
                      setFilterDateEnd(val.endDate);
                    }}
                  />
                </div>
              </div>
            </div>

            {filteredTimeRecords.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs bg-slate-50/50 rounded-2xl border border-slate-200/60">
                No hay jornadas registradas para este filtro en el mes actual. Usa el formulario de registro rápido superior para ingresar una jornada.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/50 shadow-2xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/75 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      <th className="py-3.5 px-3">Item / ID</th>
                      <th className="py-3.5 px-3">Fecha</th>
                      <th className="py-3.5 px-3">Obrero Asignado</th>
                      <th className="py-3.5 px-3">Cargo / Oficio</th>
                      <th className="py-3.5 px-3 text-center">Días Laborados</th>
                      <th className="py-3.5 px-3 text-center">Horas Ord.</th>
                      <th className="py-3.5 px-3 text-center">H. Extras</th>
                      <th className="py-3.5 px-3">Frente de Obra / Notas</th>
                      <th className="py-3.5 px-3 text-right">Tarifa Base</th>
                      <th className="py-3.5 px-3 text-right">Subtotal Base</th>
                      <th className="py-3.5 px-3 text-right">Subtotal Extras</th>
                      <th className="py-3.5 px-3 text-right">Total Devengado</th>
                      <th className="py-3.5 px-4 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredTimeRecords.map((tr, idx) => {
                      const worker = workers.find((w) => w.id === tr.workerId);
                      const baseRate = worker?.baseRate || 0;
                      const overtimeRate = worker?.overtimeRate || 0;
                      const estBase = (worker?.rateUnit === 'Hora' ? tr.regularHours : tr.daysWorked) * baseRate;
                      const estExtras = tr.overtimeHours * overtimeRate;
                      const estTotal = estBase + estExtras;

                      return (
                        <tr key={`tr-${tr.id || 'rec'}-${tr.sheetRowIndex ?? idx}-${idx}`} className="hover:bg-slate-50/80 transition-colors group">
                          {/* Item / ID */}
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                            #{idx + 1}
                            <span className="block text-[9px] text-slate-400 truncate max-w-[70px]">
                              {tr.id}
                            </span>
                          </td>

                          {/* Fecha */}
                          <td className="py-3 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                            {tr.date || '—'}
                          </td>

                          {/* Obrero Asignado */}
                          <td className="py-3 px-3">
                            <span className="font-bold text-slate-900 block truncate group-hover:text-[#1ca330] transition-colors">
                              {tr.workerName || worker?.name || tr.workerId}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {worker?.dni ? `CC: ${worker.dni}` : tr.workerId}
                            </span>
                          </td>

                          {/* Cargo */}
                          <td className="py-3 px-3 text-slate-600 text-[11px]">
                            {worker?.role || 'Ayudante'}
                          </td>

                          {/* Días Laborados */}
                          <td className="py-3 px-3 text-center">
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-bold text-[11px] border border-emerald-200">
                              {tr.daysWorked} {tr.daysWorked === 1 ? 'día' : 'días'}
                            </span>
                          </td>

                          {/* Horas Ordinarias */}
                          <td className="py-3 px-3 text-center font-semibold text-slate-700 text-[11px]">
                            {tr.regularHours}h
                          </td>

                          {/* Horas Extras */}
                          <td className="py-3 px-3 text-center">
                            {tr.overtimeHours > 0 ? (
                              <span className="inline-block px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 font-bold text-[11px] border border-amber-200">
                                +{tr.overtimeHours}h
                              </span>
                            ) : (
                              <span className="text-slate-300 font-mono text-xs">—</span>
                            )}
                          </td>

                          {/* Frente de Obra */}
                          <td className="py-3 px-3 text-slate-600 max-w-xs truncate text-[11px]">
                            {tr.activityNotes || tr.siteLocation || 'Jornada ordinaria'}
                          </td>

                          {/* Tarifa Base */}
                          <td className="py-3 px-3 text-right font-mono text-[11px] text-slate-600">
                            ${baseRate.toLocaleString()}
                            <span className="text-[9px] text-slate-400 block">
                              /{worker?.rateUnit === 'Hora' ? 'h' : 'día'}
                            </span>
                          </td>

                          {/* Subtotal Base */}
                          <td className="py-3 px-3 text-right font-mono text-slate-800 font-semibold">
                            ${estBase.toLocaleString()}
                          </td>

                          {/* Subtotal Extras */}
                          <td className="py-3 px-3 text-right font-mono text-amber-700">
                            {estExtras > 0 ? `+$${estExtras.toLocaleString()}` : '—'}
                          </td>

                          {/* Total Devengado */}
                          <td className="py-3 px-3 text-right font-mono font-extrabold text-emerald-700">
                            ${estTotal.toLocaleString()}
                          </td>

                          {/* Acciones */}
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Botón Editar Jornada / Horas */}
                              <button
                                type="button"
                                onClick={() => {
                                  setRecordToEdit(tr);
                                  setIsEditRecordModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors shadow-2xs hover:shadow-xs active:scale-95"
                                title="Editar horas, extras o fecha de esta jornada"
                              >
                                <Pencil className="w-3 h-3 text-blue-600" />
                                <span>Editar</span>
                              </button>

                              {/* Botón Eliminar Registro */}
                              <button
                                type="button"
                                onClick={() => handleDeleteTimeRecord(tr.id, tr)}
                                className="p-1 rounded-lg text-rose-500 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 border border-rose-200/60 transition-colors"
                                title="Eliminar registro de Google Sheets"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Resumen de Totales Consolidados de Asistencia */}
            {filteredTimeRecords.length > 0 && (
              <div className="mt-3 p-4 bg-slate-50/90 border border-slate-200/80 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#1ca330]" />
                  <span className="font-bold text-slate-800">
                    Totales del Formato de Días Laborados ({filteredTimeRecords.length} registros):
                  </span>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-slate-600">
                    Días Totales: <strong className="font-bold text-slate-900">{timesSummary.totalDays} días</strong>
                  </span>
                  <span className="text-slate-600">
                    Horas Ord.: <strong className="font-bold text-slate-900">{timesSummary.totalRegular}h</strong>
                  </span>
                  <span className="text-amber-700 font-medium">
                    Horas Extras: <strong className="font-bold text-amber-800">+{timesSummary.totalOvertime}h</strong>
                  </span>
                  <div className="px-3 py-1 bg-emerald-100 border border-emerald-300 rounded-xl">
                    <span className="text-[10px] text-emerald-800 font-bold uppercase block">Total Liquidado</span>
                    <span className="font-mono font-extrabold text-emerald-900 text-sm">
                      ${timesSummary.totalDevengado.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : calculations.length === 0 ? (
          <div className="py-12 px-4 text-center max-w-md mx-auto space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Users className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">No hay obreros en esta obra</h4>
            <p className="text-xs text-slate-500">
              No se crean obreros de ejemplo automáticamente. Añade a cada uno de tus trabajadores individualmente para registrar su asistencia y liquidación.
            </p>
            <div className="flex items-center gap-2.5 flex-wrap justify-center pt-1">
              <button
                type="button"
                onClick={() => setIsAddWorkerModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1ca330] hover:bg-[#168826] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Añadir Obrero Manualmente</span>
              </button>
              <button
                type="button"
                onClick={() => setIsImportWorkersModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
                title="Carga un archivo Excel, PDF o Foto con tus obreros y sus precios"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#1ca330]" />
                <span>📄 Leer Documento de Obreros</span>
              </button>
            </div>
          </div>
        ) : crewViewMode === 'table' ? (
          /* ========================================================================= */
          /* FORMATO 2: PLANILLA OFICIAL DE LIQUIDACIÓN DE NÓMINA DE CUADRILLA        */
          /* ========================================================================= */
          <div className="space-y-4">
            {/* Banner de Guía Oficial Formato 2 */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200/90 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-emerald-950">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
                  <Users className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold uppercase tracking-wide text-slate-900">
                      FORMATO OFICIAL 2: PLANILLA DE LIQUIDACIÓN DE NÓMINA DE CUADRILLA
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1ca330] text-white">
                      Liquidación Salarial
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Guía oficial de dispersión: Tarifa base, Días laborados acumulados, Subtotal base, Trabajo suplementario, Deducciones/Anticipos y Neto a pagar con desprendible PDF firmado.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsImportWorkersModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs hover:shadow-xs transition-colors cursor-pointer"
                  title="Importar cuadrilla desde Excel, PDF o Foto"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#1ca330]" />
                  <span>Importar Cuadrilla</span>
                </button>
                <span className="text-[11px] font-semibold text-slate-600 bg-white/80 px-3 py-1.5 rounded-xl border border-slate-200">
                  {calculations.length} obreros en planilla
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/50 shadow-2xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/75 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-3.5 px-4">Obrero</th>
                    <th className="py-3.5 px-3">Cargo / Frecuencia</th>
                    <th className="py-3.5 px-3 text-right">Tarifa Base</th>
                    <th className="py-3.5 px-3 text-center">Días Laborados</th>
                    <th className="py-3.5 px-3 text-right">Subtotal Base</th>
                    <th className="py-3.5 px-3 text-center">H. Extras</th>
                    <th className="py-3.5 px-3 text-right">Subtotal Extras</th>
                    <th className="py-3.5 px-3 text-right">Anticipos / Deduc.</th>
                    <th className="py-3.5 px-3 text-right">NETO A PAGAR</th>
                    <th className="py-3.5 px-3 text-center">Comprobante</th>
                    <th className="py-3.5 px-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {calculations.map((calc, idx) => {
                    const matchingWorker = workers.find((w) => w.id === calc.workerId);
                    return (
                      <tr
                        key={`calc-${calc.workerId || 'w'}-${idx}`}
                        className="hover:bg-slate-50/80 transition-colors group"
                      >
                        {/* Obrero */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs border border-slate-200 shrink-0">
                              {calc.workerName.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <span className="font-bold text-slate-900 block truncate group-hover:text-[#1ca330] transition-colors">
                                {calc.workerName}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {calc.dni ? `CC: ${calc.dni}` : calc.workerId}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Cargo / Frecuencia */}
                        <td className="py-3 px-3">
                          <span className="font-medium text-slate-800 block text-xs">
                            {calc.role}
                          </span>
                          <span className="inline-block mt-0.5 text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                            {calc.paymentFrequency}
                          </span>
                        </td>

                        {/* Tarifa Base y Botón Editar Salario */}
                        <td className="py-3 px-3 text-right">
                          <span className="font-semibold text-slate-900 font-mono">
                            ${calc.baseRate.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            /{calc.rateUnit === 'Dia' ? 'día' : 'hora'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const targetWorker = matchingWorker || {
                                id: calc.workerId,
                                name: calc.workerName,
                                role: calc.role,
                                paymentFrequency: calc.paymentFrequency,
                                rateUnit: calc.rateUnit,
                                baseRate: calc.baseRate,
                                overtimeRate: calc.overtimeRate,
                                active: true,
                              };
                              setWorkerToEdit(targetWorker);
                              setIsEditWorkerModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 mt-1 rounded-md text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors shadow-2xs hover:shadow-xs active:scale-95"
                            title="Editar salario y tarifas de este obrero"
                          >
                            <DollarSign className="w-3 h-3 text-emerald-600" />
                            <span>Editar Salario</span>
                          </button>
                        </td>

                        {/* Días Laborados */}
                        <td className="py-3 px-3 text-center">
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-bold text-[11px] border border-emerald-100">
                            {calc.rateUnit === 'Dia'
                              ? `${calc.totalDaysWorked} días`
                              : `${calc.totalRegularHours}h`}
                          </span>
                        </td>

                        {/* Subtotal Base */}
                        <td className="py-3 px-3 text-right font-mono font-semibold text-slate-900">
                          ${calc.basePay.toLocaleString()}
                        </td>

                        {/* Horas Extras */}
                        <td className="py-3 px-3 text-center">
                          {calc.totalOvertimeHours > 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 font-bold text-[11px] border border-amber-200">
                              +{calc.totalOvertimeHours}h
                            </span>
                          ) : (
                            <span className="text-slate-300 font-mono text-xs">—</span>
                          )}
                        </td>

                        {/* Subtotal Extras */}
                        <td className="py-3 px-3 text-right font-mono text-amber-700">
                          {calc.overtimePay > 0 ? `+$${calc.overtimePay.toLocaleString()}` : '—'}
                        </td>

                        {/* Deducciones / Anticipos (Editable en vivo) */}
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-xs text-rose-500 font-bold">-</span>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={
                                deductionsMap[calc.workerId] !== undefined && deductionsMap[calc.workerId] > 0
                                  ? deductionsMap[calc.workerId]
                                  : ''
                              }
                              onChange={(e) => {
                                const raw = e.target.value;
                                const val = raw === '' ? 0 : Math.max(0, parseFloat(raw) || 0);
                                const updated = { ...deductionsMap, [calc.workerId]: val };
                                setDeductionsMap(updated);
                                if (spreadsheetId) {
                                  localStorage.setItem(`svh_payroll_deductions_${spreadsheetId}`, JSON.stringify(updated));
                                }
                              }}
                              className="w-20 px-2 py-1 text-right font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1ca330]"
                              placeholder="0"
                              title="Ingresar anticipos o deducciones para este obrero"
                            />
                          </div>
                        </td>

                        {/* Neto a Pagar */}
                        <td className="py-3 px-3 text-right">
                          <span className="font-extrabold text-emerald-700 text-sm font-mono block">
                            ${calc.netPay.toLocaleString()}
                          </span>
                        </td>

                        {/* Comprobante PDF */}
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(calc)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs hover:shadow-xs transition-all active:scale-95"
                            title="Descargar comprobante en PDF con membrete de SVH Arquitectos"
                          >
                            <Download className="w-3 h-3 text-emerald-600" />
                            <span>PDF</span>
                          </button>
                        </td>

                        {/* Columna Acciones */}
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Botón Editar Obrero (Lápiz) */}
                            <button
                              type="button"
                              onClick={() => {
                                const targetWorker = matchingWorker || {
                                  id: calc.workerId,
                                  name: calc.workerName,
                                  role: calc.role,
                                  paymentFrequency: calc.paymentFrequency,
                                  rateUnit: calc.rateUnit,
                                  baseRate: calc.baseRate,
                                  overtimeRate: calc.overtimeRate,
                                  active: true,
                                };
                                setWorkerToEdit(targetWorker);
                                setIsEditWorkerModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-700 border border-transparent hover:border-blue-200 transition-colors"
                              title="Editar datos del obrero"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            {/* Botón Eliminar Obrero */}
                            <button
                              type="button"
                              onClick={() => {
                                const targetWorker = matchingWorker || {
                                  id: calc.workerId,
                                  name: calc.workerName,
                                  role: calc.role,
                                  paymentFrequency: calc.paymentFrequency,
                                  rateUnit: calc.rateUnit,
                                  baseRate: calc.baseRate,
                                  overtimeRate: calc.overtimeRate,
                                  active: true,
                                };
                                setWorkerToDelete(targetWorker);
                                setIsDeleteWorkerModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg text-rose-500 bg-rose-50/60 hover:bg-rose-100 hover:text-rose-700 border border-rose-200/60 transition-colors"
                              title="Eliminar obrero de Google Sheets"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Resumen de Totales Consolidados de Planilla de Nómina */}
            <div className="mt-3 p-4 bg-emerald-50/80 border border-emerald-300 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
              <div>
                <span className="font-extrabold text-emerald-950 uppercase tracking-wide block">
                  TOTAL GENERAL DE LIQUIDACIÓN DE CUADRILLA
                </span>
                <span className="text-[11px] text-slate-500">
                  Total a dispersar a los {calculations.length} obreros de la obra {projectName}
                </span>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <span>Subtotal Base: <strong className="font-mono font-bold text-slate-900">${crewSummary.totalBase.toLocaleString()}</strong></span>
                <span>Extras: <strong className="font-mono font-bold text-amber-700">+${crewSummary.totalOvertime.toLocaleString()}</strong></span>
                <span>Deducciones: <strong className="font-mono font-bold text-rose-700">-${crewSummary.totalDeductions.toLocaleString()}</strong></span>
                <div className="px-3.5 py-1.5 rounded-xl bg-white border border-emerald-400 shadow-2xs">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Gran Total a Pagar</span>
                  <span className="text-base font-extrabold font-mono text-[#1ca330]">
                    ${crewSummary.totalNet.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* VISTA 2: TARJETAS GRID DETALLADAS CON ACCIONES */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {calculations.map((calc, idx) => {
              const matchingWorker = workers.find((w) => w.id === calc.workerId);
              return (
                <div
                  key={`card-${calc.workerId || 'calc'}-${idx}`}
                  className="relative group bg-white/70 backdrop-blur-md rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:shadow-md hover:border-slate-300 transition-all flex flex-col justify-between"
                >
                  {/* Cabecera Tarjeta Obrero */}
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm border border-slate-200">
                          {calc.workerName.charAt(0)}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 group-hover:text-[#1ca330] transition-colors">
                            {calc.workerName}
                          </h4>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span>{calc.role}</span>
                            <span>•</span>
                            <span className="font-semibold text-slate-600">{calc.paymentFrequency}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          {calc.workerId}
                        </span>

                        {/* Botón Editar Obrero */}
                        <button
                          type="button"
                          onClick={() => {
                            const targetWorker = matchingWorker || {
                              id: calc.workerId,
                              name: calc.workerName,
                              role: calc.role,
                              paymentFrequency: calc.paymentFrequency,
                              rateUnit: calc.rateUnit,
                              baseRate: calc.baseRate,
                              overtimeRate: calc.overtimeRate,
                              active: true,
                            };
                            setWorkerToEdit(targetWorker);
                            setIsEditWorkerModalOpen(true);
                          }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200/60 transition-colors"
                          title="Editar salario y datos del obrero"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {/* Botón Eliminar Obrero con tono rojizo */}
                        <button
                          type="button"
                          onClick={() => {
                            const targetWorker = matchingWorker || {
                              id: calc.workerId,
                              name: calc.workerName,
                              role: calc.role,
                              paymentFrequency: calc.paymentFrequency,
                              rateUnit: calc.rateUnit,
                              baseRate: calc.baseRate,
                              overtimeRate: calc.overtimeRate,
                              active: true,
                            };
                            setWorkerToDelete(targetWorker);
                            setIsDeleteWorkerModalOpen(true);
                          }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-rose-500 bg-rose-50/80 hover:bg-rose-100 hover:text-rose-700 border border-rose-200/80 transition-colors"
                          title="Eliminar obrero"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Detalle de horas trabajadas y tarifas */}
                    <div className="grid grid-cols-3 gap-2 py-3 px-3.5 bg-slate-50/80 rounded-xl border border-slate-100 text-[11px] mb-3.5">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Ordinarias</span>
                        <strong className="text-slate-800 font-bold">
                          {calc.rateUnit === 'Dia'
                            ? `${calc.totalDaysWorked} días`
                            : `${calc.totalRegularHours} hrs`}
                        </strong>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px]">Horas Extras</span>
                        <strong className="text-amber-700 font-bold">
                          {calc.totalOvertimeHours} hrs
                        </strong>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px]">Tarifa Base</span>
                        <strong className="text-slate-800 font-bold block">
                          ${calc.baseRate.toLocaleString()}
                        </strong>
                        <button
                          type="button"
                          onClick={() => {
                            const targetWorker = matchingWorker || {
                              id: calc.workerId,
                              name: calc.workerName,
                              role: calc.role,
                              paymentFrequency: calc.paymentFrequency,
                              rateUnit: calc.rateUnit,
                              baseRate: calc.baseRate,
                              overtimeRate: calc.overtimeRate,
                              active: true,
                            };
                            setWorkerToEdit(targetWorker);
                            setIsEditWorkerModalOpen(true);
                          }}
                          className="mt-1 flex items-center gap-1 text-[9px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 transition-colors"
                        >
                          <DollarSign className="w-2.5 h-2.5 text-emerald-600" />
                          <span>Editar Salario</span>
                        </button>
                      </div>
                    </div>

                    {/* Desglose de Pago */}
                    <div className="space-y-1.5 text-xs pb-3.5 border-b border-slate-100">
                      <div className="flex items-center justify-between text-slate-500 text-[11px]">
                        <span>Salario Base Acumulado:</span>
                        <span className="font-semibold text-slate-800">${calc.basePay.toLocaleString()}</span>
                      </div>

                      <div className="flex items-center justify-between text-slate-500 text-[11px]">
                        <span>Horas Extras Devengadas:</span>
                        <span className="font-semibold text-amber-700">+${calc.overtimePay.toLocaleString()}</span>
                      </div>

                      {/* Deducciones / Anticipos (Editable de 0 a infinito) */}
                      <div className="flex items-center justify-between text-slate-600 text-[11px] pt-0.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                          Deducciones / Anticipos ($):
                        </span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={deductionsMap[calc.workerId] !== undefined && deductionsMap[calc.workerId] > 0 ? deductionsMap[calc.workerId] : ''}
                          placeholder="0"
                          onChange={(e) => {
                            const raw = e.target.value;
                            const val = raw === '' ? 0 : Math.max(0, parseFloat(raw) || 0);
                            const updated = { ...deductionsMap, [calc.workerId]: val };
                            setDeductionsMap(updated);
                            if (spreadsheetId) {
                              localStorage.setItem(`svh_payroll_deductions_${spreadsheetId}`, JSON.stringify(updated));
                            }
                          }}
                          className="w-24 px-2 py-0.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-rose-400 rounded-lg text-xs font-bold text-rose-700 text-right focus:outline-none focus:ring-1 focus:ring-rose-400 transition-colors"
                          title="Ingresa valor de anticipos o deducciones (de 0 a infinito)"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Footer Tarjeta: Total Neto a Pagar & Botón PDF */}
                  <div className="pt-3.5 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Neto a Pagar
                      </span>
                      <span className="text-base font-extrabold text-emerald-700">
                        ${calc.netPay.toLocaleString()}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(calc)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs hover:shadow-xs transition-all active:scale-95"
                      title="Descargar comprobante en PDF con membrete de SVH Arquitectos"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Desprendible PDF</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: Agregar Nuevo Obrero */}
      {isAddWorkerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#1ca330] text-white flex items-center justify-center font-bold">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Agregar Obrero a la Cuadrilla</h3>
                  <p className="text-[11px] text-slate-500">Se registrará en la pestaña 'Obreros' de Google Sheets.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddWorkerModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateWorker} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: José Ramiro Hernández"
                  value={newWorkerName}
                  onChange={(e) => setNewWorkerName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Documento / Cédula</label>
                  <input
                    type="text"
                    placeholder="Ej: 1020394857"
                    value={newWorkerDni}
                    onChange={(e) => setNewWorkerDni(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Teléfono</label>
                  <input
                    type="text"
                    placeholder="Ej: 3101234567"
                    value={newWorkerPhone}
                    onChange={(e) => setNewWorkerPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Rol en Obra</label>
                  <WorkerRoleSelect
                    value={newWorkerRole}
                    onChange={setNewWorkerRole}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Frecuencia de Pago</label>
                  <select
                    value={newWorkerFrequency}
                    onChange={(e) => setNewWorkerFrequency(e.target.value as PaymentFrequency)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  >
                    <option value="Semanal">Semanal</option>
                    <option value="Quincenal">Quincenal</option>
                    <option value="Mensual">Mensual</option>
                    <option value="Diario">Diario</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Modalidad</label>
                  <select
                    value={newWorkerRateUnit}
                    onChange={(e) => setNewWorkerRateUnit(e.target.value as 'Dia' | 'Hora')}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  >
                    <option value="Dia">Por Día</option>
                    <option value="Hora">Por Hora</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Valor Base ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={newWorkerBaseRate}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setNewWorkerBaseRate('');
                      } else {
                        const num = parseFloat(val);
                        setNewWorkerBaseRate(isNaN(num) ? '' : Math.max(0, num));
                      }
                    }}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Hora Extra ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={newWorkerOvertimeRate}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setNewWorkerOvertimeRate('');
                      } else {
                        const num = parseFloat(val);
                        setNewWorkerOvertimeRate(isNaN(num) ? '' : Math.max(0, num));
                      }
                    }}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#1ca330]"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddWorkerModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isSavingWorker}
                  className="px-5 py-2 text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                >
                  {isSavingWorker ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar Obrero</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Automatización de Cierre de Mes (Rollover) */}
      {isRolloverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-500/10">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Cierre de Mes (Rollover)</h3>
                  <p className="text-[11px] text-slate-500">Archiva el histórico y resetea las horas a cero.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRolloverModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-700">
              <p>
                Esta acción ejecutará automáticamente el cierre de mes preservando el 100% de tu información:
              </p>

              <ol className="list-decimal pl-4 space-y-2 text-slate-600 text-[11px]">
                <li>
                  <strong>Conserva los datos de nómina cerrados</strong> directamente en la hoja de cálculo, manteniendo su historial, fórmulas y subtotales ordenados por obrero.
                </li>
                <li>
                  <strong>Preserva intacta la facturación</strong> y todas las demás pestañas existentes en el libro sin borrar ninguna información previa.
                </li>
                <li>
                  <strong>Habilita una nueva pestaña</strong> para el nuevo periodo con la cuadrilla activa lista y horas en cero para comenzar el nuevo mes.
                </li>
              </ol>

              <div className="space-y-1 pt-2">
                <label className="font-bold text-slate-800 text-[11px]">
                  Nombre de referencia para el mes cerrado:
                </label>
                <input
                  type="text"
                  placeholder="Ej: Nomina_Septiembre_2026"
                  value={rolloverArchiveName}
                  onChange={(e) => setRolloverArchiveName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800 flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Toda la facturación y los datos anteriores quedan 100% resguardados en tu hoja de cálculo.
                </span>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/50">
              <button
                type="button"
                onClick={() => setIsRolloverModalOpen(false)}
                disabled={isExecutingRollover}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleExecuteRollover}
                disabled={isExecutingRollover}
                className="px-5 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isExecutingRollover ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Generando hoja de cierre...</span>
                  </>
                ) : (
                  <span>Confirmar y Cerrar Mes</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Editar Ficha de Obrero (CRUD) */}
      <EditWorkerModal
        isOpen={isEditWorkerModalOpen}
        onClose={() => {
          setIsEditWorkerModalOpen(false);
          setWorkerToEdit(null);
        }}
        worker={workerToEdit}
        onSave={handleUpdateWorker}
      />

      {/* MODAL 4: Confirmar Eliminación de Obrero (CRUD) */}
      <ConfirmDeleteModal
        isOpen={isDeleteWorkerModalOpen}
        onClose={() => {
          setIsDeleteWorkerModalOpen(false);
          setWorkerToDelete(null);
        }}
        title="Eliminar Obrero de la Nómina"
        description="¿Estás seguro de que deseas eliminar a este obrero de la cuadrilla? Se eliminará su registro de la pestaña 'Informacion obrero' en Google Sheets y se recalcularán automáticamente los totales de nómina."
        itemIdentifier={workerToDelete?.id}
        itemName={workerToDelete?.name}
        warningNote="La fila del obrero será eliminada definitivamente de la hoja de cálculo. Sus registros históricos pasados archivados permanecerán intactos."
        onConfirm={handleDeleteWorker}
      />

      {/* MODAL 5: Editar Registro de Jornada / Horas (si hubo error al registrar) */}
      <EditTimeRecordModal
        isOpen={isEditRecordModalOpen}
        onClose={() => {
          setIsEditRecordModalOpen(false);
          setRecordToEdit(null);
        }}
        record={recordToEdit}
        workers={workers}
        onSave={handleSaveTimeRecord}
        onDelete={handleDeleteTimeRecord}
      />

      {/* MODAL 6: Añadir Hoja de Cálculo Existente como Pestaña */}
      {spreadsheetId && (
        <ImportSheetModal
          isOpen={isImportSheetModalOpen}
          onClose={() => setIsImportSheetModalOpen(false)}
          accessToken={accessToken}
          destinationSpreadsheetId={spreadsheetId}
          onSuccess={(msg) => {
            setSuccessMessage(msg);
            loadPayrollData();
          }}
        />
      )}

      {/* MODAL 7: Importar Obreros desde Documento (Excel / CSV / PDF / Imagen) */}
      {spreadsheetId && (
        <ImportWorkersModal
          isOpen={isImportWorkersModalOpen}
          onClose={() => setIsImportWorkersModalOpen(false)}
          token={accessToken}
          spreadsheetId={spreadsheetId}
          existingWorkers={workers}
          onWorkersImported={(newWorkers) => {
            setWorkers((prev) => [...prev, ...newWorkers]);
            setSuccessMessage(`Se importaron ${newWorkers.length} obreros con sus tarifas exitosamente.`);
            setTimeout(() => setSuccessMessage(null), 5000);
            loadPayrollData();
          }}
        />
      )}
    </div>
  );
};
