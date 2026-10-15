import { Worker, TimeRecord, PayrollCalculation, PayrollBudgetMetrics } from '../types';
import { safeJsonFetch } from '../utils/safeApiFetch';
import { getAccessToken } from './firebaseAuth';

export interface SyncPayrollSheetsResult {
  success: boolean;
  message: string;
  workersTabCreated: boolean;
  timesTabCreated: boolean;
  workers: Worker[];
  timeRecords: TimeRecord[];
}

export interface RolloverResult {
  success: boolean;
  message: string;
  archivedSheetTitle: string;
  newSheetTitle: string;
  workersPreservedCount: number;
}

/**
 * Servicio para la gestión integral de nóminas de obra y tiempos en Google Sheets
 */
export const payrollService = {
  /**
   * Sincroniza o asegura las pestañas 'Obreros' y 'Tiempos_MesActual' en la hoja de cálculo activa
   */
  async syncSheets(token: string, spreadsheetId: string): Promise<SyncPayrollSheetsResult> {
    const fetchRes = await safeJsonFetch<SyncPayrollSheetsResult>('/api/payroll/sync-sheets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ spreadsheetId }),
    });

    if (!fetchRes.ok || !fetchRes.data?.success) {
      const err: any = new Error(fetchRes.error || fetchRes.data?.message || 'Error sincronizando pestañas de nómina en Sheets');
      err.status = fetchRes.status;
      err.isAuthError = fetchRes.status === 401 || (fetchRes.data as any)?.isAuthError;
      throw err;
    }
    return fetchRes.data;
  },

  /**
   * Registra una jornada de trabajo y horas extras en la hoja 'Tiempos_MesActual'
   */
  async logTimeEntry(
    token: string,
    spreadsheetId: string,
    entry: Omit<TimeRecord, 'id'>
  ): Promise<{ success: boolean; id: string; rowValues: any[] }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; id: string; rowValues: any[] }>(
      '/api/payroll/log-time',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          entry,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error registrando tiempo de trabajo en Sheets');
    }
    return fetchRes.data;
  },

  /**
   * Agrega un nuevo obrero a la pestaña 'Obreros'
   */
  async addWorker(
    token: string,
    spreadsheetId: string,
    worker: Omit<Worker, 'id'> & { id?: string }
  ): Promise<{ success: boolean; worker: Worker }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; worker: Worker }>(
      '/api/payroll/add-worker',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          worker,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error agregando nuevo obrero a la hoja');
    }
    return fetchRes.data;
  },

  /**
   * Calcula la liquidación de nómina de los obreros cruzando con sus tiempos registrados
   */
  calculatePayroll(
    workers: Worker[],
    timeRecords: TimeRecord[],
    deductionsMap: Record<string, number> = {}
  ): {
    calculations: PayrollCalculation[];
    metrics: PayrollBudgetMetrics;
  } {
    let totalSpent = 0;
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;

    const calculations: PayrollCalculation[] = workers.map((w) => {
      // Filtrar registros del obrero
      const workerRecords = timeRecords.filter((tr) => tr.workerId === w.id);

      const workerRegularHours = workerRecords.reduce((acc, r) => acc + (Number(r.regularHours) || 0), 0);
      const workerOvertimeHours = workerRecords.reduce((acc, r) => acc + (Number(r.overtimeHours) || 0), 0);
      const workerDaysWorked = workerRecords.reduce((acc, r) => acc + (Number(r.daysWorked) || 0), 0);

      // Cálculo base según unidad (Día o Hora)
      let basePay = 0;
      if (w.rateUnit === 'Dia') {
        basePay = workerDaysWorked * w.baseRate;
      } else {
        basePay = workerRegularHours * w.baseRate;
      }

      // Horas extras
      const overtimePay = workerOvertimeHours * w.overtimeRate;
      const grossPay = basePay + overtimePay;

      const deductions = deductionsMap[w.id] || 0;
      const netPay = Math.max(0, grossPay - deductions);

      totalSpent += grossPay;
      totalRegularHours += workerRegularHours;
      totalOvertimeHours += workerOvertimeHours;

      return {
        workerId: w.id,
        workerName: w.name,
        dni: w.dni,
        role: w.role,
        paymentFrequency: w.paymentFrequency,
        rateUnit: w.rateUnit,
        baseRate: w.baseRate,
        overtimeRate: w.overtimeRate,
        totalRegularHours: workerRegularHours,
        totalOvertimeHours: workerOvertimeHours,
        totalDaysWorked: workerDaysWorked,
        basePay,
        overtimePay,
        grossPay,
        deductions,
        netPay,
      };
    });

    // Estimación o presupuesto asignado por defecto (configurable por obra)
    const activeWorkers = workers.filter((w) => w.active);
    const estimatedMonthlyBudget = activeWorkers.length * 3500000; // Referencia estándar de cuadrilla
    const percentageSpent = estimatedMonthlyBudget > 0 ? (totalSpent / estimatedMonthlyBudget) * 100 : 0;

    const metrics: PayrollBudgetMetrics = {
      totalAllocatedBudget: estimatedMonthlyBudget,
      spentBudget: totalSpent,
      projectedBudget: totalSpent * 1.15,
      percentageSpent: Math.min(100, Math.round(percentageSpent * 10) / 10),
      activeWorkersCount: activeWorkers.length,
      totalHoursLogged: totalRegularHours,
      totalOvertimeHoursLogged: totalOvertimeHours,
    };

    return {
      calculations,
      metrics,
    };
  },

  /**
   * Actualiza los datos de un obrero existente en Google Sheets
   */
  async updateWorker(
    token: string,
    spreadsheetId: string,
    id: string,
    worker: Partial<Worker>
  ): Promise<{ success: boolean; worker: Worker }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; worker: Worker }>(
      `/api/payroll/worker/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          worker,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al actualizar datos del obrero');
    }
    return fetchRes.data;
  },

  /**
   * Elimina un obrero de la pestaña 'Obreros' en Google Sheets
   */
  async deleteWorker(
    token: string,
    spreadsheetId: string,
    id: string,
    extraDetails?: { name?: string; dni?: string; sheetRowIndex?: number }
  ): Promise<{ success: boolean; deletedId: string }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; deletedId: string }>(
      `/api/payroll/worker/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          name: extraDetails?.name,
          dni: extraDetails?.dni,
          sheetRowIndex: extraDetails?.sheetRowIndex,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al eliminar obrero de la hoja');
    }
    return fetchRes.data;
  },

  /**
   * Actualiza un registro de jornada / tiempo en 'Tiempos_MesActual'
   */
  async updateTimeRecord(
    token: string,
    spreadsheetId: string,
    id: string,
    entry: Partial<TimeRecord>
  ): Promise<{ success: boolean; timeRecord: TimeRecord }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; timeRecord: TimeRecord }>(
      `/api/payroll/time/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          entry,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al actualizar registro de tiempo');
    }
    return fetchRes.data;
  },

  /**
   * Elimina un registro de jornada de 'Tiempos_MesActual' con soporte de pistas (hints)
   */
  async deleteTimeRecord(
    token: string,
    spreadsheetId: string,
    id: string,
    hints?: {
      workerId?: string;
      workerName?: string;
      date?: string;
      sheetRowIndex?: number;
    }
  ): Promise<{ success: boolean; deletedId: string }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; deletedId: string }>(
      `/api/payroll/time/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          ...hints,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al eliminar registro de tiempo');
    }
    return fetchRes.data;
  },

  /**
   * Ejecuta el Cierre de Mes (Rollover):
   * Deja los datos de nómina cerrados en la hoja de cálculo preservando el 100% de la información anterior (incluida la facturación),
   * e inicializa una nueva pestaña para el siguiente periodo con la cuadrilla activa y horas en cero.
   */
  async executeMonthRollover(
    token: string,
    spreadsheetId: string,
    archiveMonthName?: string,
    folderId?: string,
    projectName?: string
  ): Promise<RolloverResult> {
    const fetchRes = await safeJsonFetch<RolloverResult>('/api/payroll/rollover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        spreadsheetId,
        archiveMonthName,
        folderId,
        projectName,
      }),
    });

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al ejecutar cierre de mes en Sheets');
    }
    return fetchRes.data;
  },

  /**
   * Importa una hoja de cálculo existente de Google Drive como una nueva pestaña en la hoja activa
   */
  async importSheetAsTab(
    token: string,
    destinationSpreadsheetId: string,
    sourceSpreadsheetIdOrUrl: string,
    newTabTitle?: string
  ): Promise<{ success: boolean; message: string; sheetTitle: string; sheetId?: number }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; message: string; sheetTitle: string; sheetId?: number }>(
      '/api/payroll/import-sheet-tab',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          destinationSpreadsheetId,
          sourceSpreadsheetIdOrUrl,
          newTabTitle,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al importar hoja existente como pestaña');
    }
    return fetchRes.data;
  },

  /**
   * Genera un Reporte Financiero Ejecutivo formateado en Google Sheets
   * con Logo SVH, Colores Corporativos (#1ca330), Banding, Moneda y Fórmulas =SUM
   */
  async exportFinancialReport(
    token: string,
    spreadsheetId: string,
    projectName: string = 'Obra Activa',
    reportTitle: string = 'Liquidación de Nómina de Obra'
  ): Promise<{ success: boolean; message: string; sheetTitle: string }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; message: string; sheetTitle: string }>(
      '/api/payroll/export-report',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          projectName,
          reportTitle,
        }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al generar reporte financiero en Sheets');
    }
    return fetchRes.data;
  },

  /**
   * Exporta y descarga directamente un archivo Excel (.xlsx) con fórmulas nativas =SUM,
   * respetando el 100% del formato original de la hoja de cálculo de Google Drive.
   */
  async downloadExcelReport(
    token: string,
    spreadsheetId: string,
    projectName: string = 'Obra Activa'
  ): Promise<void> {
    const effectiveToken = token || (await getAccessToken()) || '';
    let blob: Blob | null = null;
    const cleanProj = projectName.replace(/^(Obra:\s*|Proyecto:\s*)/i, '').replace(/[:\/\\?*|"]/g, ' ').trim() || projectName.trim();
    let downloadFileName = `${cleanProj}.xlsx`;

    // 1. Intentar exportación de alta fidelidad a través del servidor Node backend
    try {
      const response = await fetch('/api/payroll/export-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
        },
        body: JSON.stringify({
          spreadsheetId,
          projectName,
          accessToken: effectiveToken,
        }),
      });

      if (response.ok) {
        blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition');
        if (disposition && disposition.includes('filename=')) {
          const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (match && match[1]) {
            downloadFileName = match[1].replace(/['"]/g, '').trim();
          }
        }
      } else {
        const errJson = await response.json().catch(() => null);
        if (response.status === 401 || errJson?.isAuthError) {
          const authErr: any = new Error(
            errJson?.error ||
              'Tu sesión con Google Drive y Google Sheets ha expirado. Por favor, pulsa en "Renovar Conexión Google" para renovar tus credenciales.'
          );
          authErr.isAuthError = true;
          authErr.status = 401;
          throw authErr;
        }
        console.warn('Endpoint /api/payroll/export-excel devolvió status no-ok:', response.status);
      }
    } catch (apiErr: any) {
      if (apiErr?.isAuthError || apiErr?.status === 401) {
        throw apiErr;
      }
      console.warn('Aviso en /api/payroll/export-excel, procediendo con descarga directa:', apiErr);
    }

    // 2. Fallback 1: Exportación directa desde el navegador a la API de Google Drive
    if (!blob && effectiveToken) {
      try {
        const driveExportUrl = `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&supportsAllDrives=true`;
        const driveRes = await fetch(driveExportUrl, {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        });
        if (driveRes.ok) {
          blob = await driveRes.blob();
        } else if (driveRes.status === 401) {
          const authErr: any = new Error(
            'Tu sesión con Google Drive ha expirado. Por favor, pulsa en "Renovar Conexión Google".'
          );
          authErr.isAuthError = true;
          authErr.status = 401;
          throw authErr;
        }
      } catch (driveErr: any) {
        if (driveErr?.isAuthError || driveErr?.status === 401) {
          throw driveErr;
        }
        console.warn('Aviso en exportación directa de Google Drive:', driveErr);
      }
    }

    // 3. Fallback 2: Disparador nativo de Google Docs/Sheets en el navegador
    if (!blob) {
      const directGoogleSheetExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
      const fallbackAnchor = document.createElement('a');
      fallbackAnchor.href = directGoogleSheetExportUrl;
      fallbackAnchor.target = '_blank';
      fallbackAnchor.rel = 'noreferrer';
      fallbackAnchor.download = downloadFileName;
      document.body.appendChild(fallbackAnchor);
      fallbackAnchor.click();
      setTimeout(() => {
        if (fallbackAnchor.parentNode) {
          document.body.removeChild(fallbackAnchor);
        }
      }, 500);
      return;
    }

    // Descargar el blob recibido
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      if (a.parentNode) {
        document.body.removeChild(a);
      }
    }, 200);
  },

  /**
   * Aplica la tabla de nómina consolidada y ordenada por obrero a Google Sheets:
   * Paleta profesional Slate-900 / Emerald, sin foto de logo, horas y días totales al frente del obrero.
   */
  async applyPayrollCorporateStyling(
    token: string,
    spreadsheetId: string
  ): Promise<{ success: boolean; message: string }> {
    const fetchRes = await safeJsonFetch<{ success: boolean; message: string }>(
      '/api/payroll/apply-styling',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ spreadsheetId }),
      }
    );

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al aplicar formato corporativo en Sheets');
    }
    return fetchRes.data;
  },

  /**
   * Extrae obreros, precios y datos desde un documento (Excel, CSV, PDF, Imagen)
   */
  async parseWorkersDocument(
    token: string,
    fileBase64: string,
    mimeType: string,
    fileName: string
  ): Promise<{
    success: boolean;
    formatDetected: string;
    documentSummary: string;
    workers: Omit<Worker, 'id' | 'active'>[];
  }> {
    const fetchRes = await safeJsonFetch<{
      success: boolean;
      formatDetected: string;
      documentSummary: string;
      workers: Omit<Worker, 'id' | 'active'>[];
    }>('/api/payroll/parse-workers-document', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fileBase64,
        mimeType,
        fileName,
      }),
    });

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al leer el documento de obreros');
    }
    return fetchRes.data;
  },

  /**
   * Registra múltiples obreros en lote en 'Informacion obrero' en Google Sheets
   */
  async addWorkersBatch(
    token: string,
    spreadsheetId: string,
    workers: Partial<Worker>[]
  ): Promise<{
    success: boolean;
    message: string;
    addedWorkers: Worker[];
  }> {
    const fetchRes = await safeJsonFetch<{
      success: boolean;
      message: string;
      addedWorkers: Worker[];
    }>('/api/payroll/add-workers-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        spreadsheetId,
        workers,
      }),
    });

    if (!fetchRes.ok || !fetchRes.data?.success) {
      throw new Error(fetchRes.error || 'Error al registrar lote de obreros');
    }
    return fetchRes.data;
  },
};
