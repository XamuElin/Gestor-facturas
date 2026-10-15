export interface InvoiceItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  date: string;
  vendorName: string;
  vendorTaxId: string;
  concept: string;
  category: ConstructionCategory;
  subtotal: number;
  taxRatePercent: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  confidenceNotes?: string;
  items?: InvoiceItem[];
  quantity?: number;
  unitPrice?: number;
}

export type ConstructionCategory =
  | 'Materiales'
  | 'Mano de Obra'
  | 'Maquinaria y Equipos'
  | 'Transporte y Logística'
  | 'Subcontratas'
  | 'Seguridad y Salud'
  | 'Servicios y Licencias'
  | 'Varios';

export const CONSTRUCTION_CATEGORIES: ConstructionCategory[] = [
  'Materiales',
  'Mano de Obra',
  'Maquinaria y Equipos',
  'Transporte y Logística',
  'Subcontratas',
  'Seguridad y Salud',
  'Servicios y Licencias',
  'Varios',
];

export interface DriveFolderItem {
  id: string;
  name: string;
  webViewLink?: string;
  parentId?: string;
  parentName?: string;
}

export interface ProjectWorkspaceConfig {
  projectName?: string;
  evidenceFolderId: string;
  evidenceFolderName: string;
  evidenceFolderUrl?: string;
  evidenceParentId?: string;
  evidenceParentName?: string;
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl?: string;
  spreadsheetParentId?: string;
  spreadsheetParentName?: string;
  activeSheetTab?: string;
  detectedTabs?: SheetTabInfo[];
}

export interface SheetTabInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount?: number;
  columnCount?: number;
  headers?: string[];
  isInvoiceCompatible?: boolean;
}

export interface DynamicColumnMeta {
  key: string;
  header: string;
  index: number;
  type: 'currency' | 'number' | 'date' | 'url' | 'tag' | 'text';
  sampleValues: any[];
  sum?: number;
  avg?: number;
  count: number;
  isNumeric: boolean;
}

export interface IntermediateSubtotal {
  id: string;
  rowIndexInTable: number;
  actualSheetRowIndex: number;
  label: string;
  concept: string;
  rangeDescription: string;
  startSheetRow: number;
  endSheetRow: number;
  rowCount: number;
  amount: number;
  formattedAmount: string;
  costColIndex?: number;
  costColHeader?: string;
  tableId?: string;
}

export interface DynamicSheetRow {
  id: string;
  rowIndex: number;
  values: any[];
  cellsByHeader: Record<string, any>;
  driveFileUrl?: string;
  fileName?: string;
  rawRowData: any[];
  invoiceRecord?: SheetInvoiceRecord;
  isTotalRow?: boolean;
  isSubtotalRow?: boolean;
  subtotalInfo?: IntermediateSubtotal;
  tableId?: string;
}

export interface DynamicSubTable {
  id: string;
  title: string;
  type: 'materials' | 'labor' | 'generic';
  startCol: number;
  endCol: number;
  headers: string[];
  columns: DynamicColumnMeta[];
  rows: DynamicSheetRow[];
  totalRows: number;
  numericSummaries: { header: string; sum: number; avg?: number; isDeclaredTotal?: boolean }[];
  declaredTotal?: number;
  totalsRow?: DynamicSheetRow;
  intermediateSubtotals?: IntermediateSubtotal[];
}

export interface DynamicSheetAnalysis {
  spreadsheetId: string;
  spreadsheetName: string;
  tabs: SheetTabInfo[];
  activeTab: string;
  headers: string[];
  columns: DynamicColumnMeta[];
  rows: DynamicSheetRow[];
  totalRows: number;
  numericSummaries: { header: string; sum: number; avg?: number; isDeclaredTotal?: boolean }[];
  detectedType: 'invoices' | 'budget' | 'materials' | 'generic';
  categoryColumnIndex?: number;
  dateColumnIndex?: number;
  totalColumnIndex?: number;
  subTables?: DynamicSubTable[];
  declaredTotal?: number;
  grandTotal?: number;
  intermediateSubtotals?: IntermediateSubtotal[];
}

export interface ExtractedTableData {
  title?: string;
  headers: string[];
  rows: any[][];
}

export interface ExtractedFileAnalysis {
  fileId?: string;
  fileName: string;
  mimeType: string;
  fileSizeFormatted?: string;
  driveViewLink?: string;
  documentType: string;
  title: string;
  issuer?: string;
  recipient?: string;
  date?: string;
  currency?: string;
  totalAmount?: number;
  summary: string;
  keyDetails: { label: string; value: string }[];
  tables?: ExtractedTableData[];
  sheets?: { name: string; headers: string[]; rows: any[][]; totalRows: number }[];
  items?: { description: string; quantity?: number; unitPrice?: number; total?: number }[];
  isInvoiceCompatible: boolean;
  suggestedCategory?: ConstructionCategory | string;
  rawContentPreview?: string;
  isAiTemporarilyUnavailable?: boolean;
}

export interface ProjectFolder {
  id: string;
  name: string;
  baseFolderId?: string;
  baseFolderName?: string;
  baseLocationName?: string;
  webViewLink?: string;
  // Specific evidence destination folder
  evidenceFolderId?: string;
  evidenceFolderName?: string;
  evidenceFolderUrl?: string;
  evidenceParentId?: string;
  evidenceParentName?: string;
  // Specific spreadsheet destination
  spreadsheetId?: string;
  spreadsheetName?: string;
  spreadsheetUrl?: string;
  spreadsheetParentId?: string;
  spreadsheetParentName?: string;
  // Detected sheets tabs and active tab
  activeSheetTab?: string;
  detectedTabs?: SheetTabInfo[];
}

export interface SheetInvoiceRecord {
  id?: string;
  rowIndex?: number;
  sheetTitle?: string;
  registrationDate: string;
  issueDate: string;
  invoiceNumber: string;
  vendorName: string;
  vendorTaxId: string;
  concept: string;
  category: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  driveFileUrl: string;
  fileName: string;
  quantity?: number;
  unitPrice?: number;
  rawRowData?: any[];
}

export interface BatchProcessSummary {
  total: number;
  successful: number;
  failed: number;
  items: {
    fileName: string;
    invoiceNumber?: string;
    vendorName?: string;
    totalAmount?: number;
    status: 'success' | 'error';
    error?: string;
  }[];
}

export const MAX_INVOICES_LIMIT = 15;

export interface QueuedInvoiceFile {
  id: string;
  name: string;
  sizeFormatted: string;
  sizeBytes: number;
  mimeType: string;
  base64: string;
  status: 'pending' | 'analyzing' | 'extracted' | 'saved' | 'error';
  extractedData?: InvoiceData;
  error?: string;
  savedDriveUrl?: string;
}

export interface UploadProgressState {
  stage: 'idle' | 'analyzing' | 'confirming' | 'uploading_drive' | 'updating_sheet' | 'completed' | 'error';
  progressMessage?: string;
  error?: string;
  resultDriveUrl?: string;
  resultSheetUrl?: string;
}

export interface DriveFilesCheckResult {
  isValid: boolean;
  hasDeletedFiles: boolean;
  hasRenamedFiles: boolean;
  folderStatus: {
    exists: boolean;
    trashed: boolean;
    renamed: boolean;
    currentName?: string;
    expectedName?: string;
    error?: string;
  };
  sheetStatus: {
    exists: boolean;
    trashed: boolean;
    renamed: boolean;
    currentName?: string;
    expectedName?: string;
    error?: string;
  };
  warningMessages: string[];
  summary: string;
}

// ==========================================
// MÓDULO DE PRESUPUESTOS Y NÓMINAS (PAYROLL)
// ==========================================

export type PaymentFrequency = 'Diario' | 'Semanal' | 'Quincenal' | 'Mensual';

export interface Worker {
  id: string; // e.g. "OBR-001"
  name: string;
  dni: string; // Cédula / DNI / NIT
  role: string; // Maestro de Obra, Oficial, Ayudante, Electricista, etc.
  paymentFrequency: PaymentFrequency;
  baseRate: number; // Valor Base (por Día o por Hora)
  rateUnit: 'Dia' | 'Hora';
  overtimeRate: number; // Valor de la Hora Extra
  phone?: string;
  active: boolean;
  joinedDate: string;
  sheetRowIndex?: number;
}

export interface TimeRecord {
  id: string;
  rawId?: string;
  sheetRowIndex?: number;
  workerId: string;
  workerName: string;
  date: string; // YYYY-MM-DD
  regularHours: number; // Horas regulares
  overtimeHours: number; // Horas extras
  daysWorked: number; // Días computados (ej. 1, 0.5)
  activityNotes?: string; // Tarea realizada
  siteLocation?: string; // Frente de obra / sector
}

export interface PayrollCalculation {
  workerId: string;
  workerName: string;
  dni: string;
  role: string;
  paymentFrequency: PaymentFrequency;
  rateUnit: 'Dia' | 'Hora';
  baseRate: number;
  overtimeRate: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalDaysWorked: number;
  basePay: number;
  overtimePay: number;
  grossPay: number;
  deductions: number;
  netPay: number;
}

export interface PayrollBudgetMetrics {
  totalAllocatedBudget: number; // Presupuesto mano de obra obra
  spentBudget: number; // Devengado hasta la fecha
  projectedBudget: number; // Proyección al fin del periodo
  percentageSpent: number; // Porcentaje consumido (0 - 100)
  activeWorkersCount: number;
  totalHoursLogged: number;
  totalOvertimeHoursLogged: number;
}

