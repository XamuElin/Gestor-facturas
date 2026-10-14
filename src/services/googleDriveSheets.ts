import {
  InvoiceData,
  ProjectFolder,
  SheetInvoiceRecord,
  DriveFilesCheckResult,
  SheetTabInfo,
  DynamicSheetAnalysis,
  DynamicColumnMeta,
  DynamicSheetRow,
  DynamicSubTable,
  IntermediateSubtotal,
  ExtractedFileAnalysis,
  ExtractedTableData,
} from '../types';
import * as XLSX from 'xlsx';
import { safeJsonFetch } from '../utils/safeApiFetch';
import { buildProjectSpreadsheetTitle } from '../utils/duplicateChecker';

import { SHEET_HEADERS, normalizeHeader, detectColumnMapping, colIndexToA1Notation } from '../utils/sheetColumns';
export { SHEET_HEADERS, normalizeHeader, detectColumnMapping, colIndexToA1Notation };
export type { ColumnMapping } from '../utils/sheetColumns';
const ROOT_FOLDER_NAME = 'Obras y Facturas (Automatización)';


/**
 * Valida respuestas HTTP de Google APIs y despacha 'svh_google_auth_expired' de inmediato si el token expiró.
 */
export function checkGoogleAuthResponse(res: Response, errText: string, operationName: string): Error {
  const isAuth =
    res.status === 401 ||
    errText.toLowerCase().includes('invalid authentication credentials') ||
    errText.toLowerCase().includes('expected oauth 2') ||
    errText.toLowerCase().includes('unauthenticated') ||
    errText.toLowerCase().includes('invalid credentials') ||
    errText.toLowerCase().includes('autherror');

  if (isAuth && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('svh_google_auth_expired'));
    const err: any = new Error(`${operationName}: Tu sesión con Google Drive ha expirado. Por favor, pulsa en "Renovar Conexión Google".`);
    err.status = 401;
    err.isAuthError = true;
    return err;
  }
  const err: any = new Error(`${operationName}: ${errText}`);
  err.status = res.status;
  return err;
}

/**
 * Checks the precise status of a Google Drive file or folder:
 * - whether it exists
 * - whether it is in the trash (trashed = true)
 * - its actual current name in Drive
 */
export async function getDriveFileStatus(
  accessToken: string,
  fileId: string
): Promise<{
  exists: boolean;
  trashed: boolean;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  error?: string;
}> {
  if (!fileId || fileId === 'root') {
    return { exists: true, trashed: false, name: 'Mi Unidad (Google Drive)' };
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,trashed,mimeType,webViewLink&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (res.status === 404) {
      return {
        exists: false,
        trashed: true,
        error: 'El archivo no existe o fue eliminado permanentemente en Google Drive (404).',
      };
    }

    if (!res.ok) {
      const errText = await res.text();
      return {
        exists: false,
        trashed: false,
        error: `Error al consultar Drive (${res.status}): ${errText}`,
      };
    }

    const data = await res.json();
    return {
      exists: true,
      trashed: Boolean(data.trashed),
      name: data.name,
      mimeType: data.mimeType,
      webViewLink: data.webViewLink,
    };
  } catch (err: any) {
    return {
      exists: false,
      trashed: false,
      error: err.message || 'Error de conexión con Google Drive',
    };
  }
}

/**
 * Verifies if the Drive files and folders for a given project still exist and haven't been deleted or renamed.
 * Checks:
 * 1. Evidence folder (project.evidenceFolderId || project.id)
 * 2. Control Spreadsheet (project.spreadsheetId)
 */
export async function verifyProjectDriveFiles(
  accessToken: string,
  project: ProjectFolder
): Promise<DriveFilesCheckResult> {
  const targetFolderId = project.evidenceFolderId || project.id;
  const expectedFolderName = project.evidenceFolderName || project.name;

  const targetSheetId = project.spreadsheetId;
  const expectedSheetName = project.spreadsheetName;

  // 1. Check folder status
  const folderCheck = await getDriveFileStatus(accessToken, targetFolderId);

  // 2. Check spreadsheet status (if configured)
  let sheetCheck: any = { exists: true, trashed: false };
  if (targetSheetId) {
    sheetCheck = await getDriveFileStatus(accessToken, targetSheetId);
  }

  const warningMessages: string[] = [];

  // Folder evaluation
  const folderDeleted = !folderCheck.exists || Boolean(folderCheck.trashed);
  let folderRenamed = false;

  if (folderDeleted) {
    warningMessages.push(
      `La carpeta de evidencias "${expectedFolderName}" ya no existe en Google Drive porque fue eliminada o enviada a la papelera.`
    );
  } else if (
    folderCheck.name &&
    expectedFolderName &&
    folderCheck.name.trim() !== expectedFolderName.trim()
  ) {
    folderRenamed = true;
    warningMessages.push(
      `La carpeta de evidencias cambió de nombre en Drive (Registrado: "${expectedFolderName}" ➔ Actual: "${folderCheck.name}").`
    );
  }

  // Spreadsheet evaluation
  let sheetDeleted = false;
  let sheetRenamed = false;

  if (targetSheetId) {
    sheetDeleted = !sheetCheck.exists || Boolean(sheetCheck.trashed);
    if (sheetDeleted) {
      warningMessages.push(
        `La hoja de cálculo de control "${expectedSheetName || 'Google Sheets'}" ya no existe en Google Drive porque fue eliminada o enviada a la papelera.`
      );
    } else if (
      sheetCheck.name &&
      expectedSheetName &&
      sheetCheck.name.trim() !== expectedSheetName.trim()
    ) {
      sheetRenamed = true;
      warningMessages.push(
        `La hoja de cálculo de control cambió de nombre en Drive (Registrado: "${expectedSheetName}" ➔ Actual: "${sheetCheck.name}").`
      );
    }
  }

  const hasDeletedFiles = folderDeleted || sheetDeleted;
  const hasRenamedFiles = folderRenamed || sheetRenamed;
  const isValid = !hasDeletedFiles;

  let summary = '';
  if (hasDeletedFiles && hasRenamedFiles) {
    summary =
      'Aviso: Algunos archivos creados en Google Drive para esta obra ya no existen porque fueron eliminados, y otros cambiaron su nombre.';
  } else if (hasDeletedFiles) {
    summary =
      'Aviso: Los archivos creados en Google Drive para esta obra ya no existen porque fueron eliminados o cambiaron su nombre.';
  } else if (hasRenamedFiles) {
    summary =
      'Aviso: Los archivos creados en Google Drive para esta obra cambiaron de nombre en tu Google Drive.';
  }

  return {
    isValid,
    hasDeletedFiles,
    hasRenamedFiles,
    folderStatus: {
      exists: folderCheck.exists && !folderCheck.trashed,
      trashed: folderDeleted,
      renamed: folderRenamed,
      currentName: folderCheck.name,
      expectedName: expectedFolderName,
      error: folderCheck.error,
    },
    sheetStatus: {
      exists: sheetCheck.exists && !sheetCheck.trashed,
      trashed: sheetDeleted,
      renamed: sheetRenamed,
      currentName: sheetCheck.name,
      expectedName: expectedSheetName,
      error: sheetCheck.error,
    },
    warningMessages,
    summary,
  };
}

/**
 * Automatically regenerates missing files/folders in Drive for a project when they were deleted,
 * and returns the updated project configuration.
 */
export async function repairMissingDriveFiles(
  accessToken: string,
  project: ProjectFolder,
  rootFolderId?: string
): Promise<{ updatedProject: ProjectFolder; messages: string[] }> {
  const check = await verifyProjectDriveFiles(accessToken, project);
  const messages: string[] = [];
  const updated: ProjectFolder = { ...project };

  // 1. If folder was deleted, create a new folder
  if (check.folderStatus.trashed) {
    const parent = project.evidenceParentId || rootFolderId;
    const folderName = project.evidenceFolderName || project.name;
    const newFolder = await createDriveFolder(accessToken, folderName, parent);
    updated.evidenceFolderId = newFolder.id;
    updated.evidenceFolderName = newFolder.name;
    updated.evidenceFolderUrl = newFolder.webViewLink;
    if (project.id === project.evidenceFolderId) {
      updated.id = newFolder.id;
      updated.webViewLink = newFolder.webViewLink;
    }
    messages.push(`Se ha creado una nueva carpeta de evidencias en Drive: "${newFolder.name}"`);
  } else if (check.folderStatus.renamed && check.folderStatus.currentName) {
    // If it was renamed in Drive, sync the name
    updated.evidenceFolderName = check.folderStatus.currentName;
    messages.push(`Se ha sincronizado el nombre de la carpeta: "${check.folderStatus.currentName}"`);
  }

  // 2. If spreadsheet was deleted, create a new spreadsheet with decorated headers
  if (check.sheetStatus.trashed) {
    const parentFolder = updated.evidenceFolderId || updated.id;
    const sheetTitle = project.spreadsheetName || buildProjectSpreadsheetTitle(updated.name);
    const newSheet = await createCustomSpreadsheet(accessToken, sheetTitle, parentFolder);
    updated.spreadsheetId = newSheet.id;
    updated.spreadsheetName = newSheet.name;
    updated.spreadsheetUrl = newSheet.webViewLink;
    messages.push(`Se ha creado una nueva hoja de cálculo en Drive: "${newSheet.name}"`);
  } else if (check.sheetStatus.renamed && check.sheetStatus.currentName) {
    // If it was renamed in Drive, sync the name
    updated.spreadsheetName = check.sheetStatus.currentName;
    messages.push(`Se ha sincronizado el nombre de la hoja de cálculo: "${check.sheetStatus.currentName}"`);
  }

  return { updatedProject: updated, messages };
}

export type DriveItemType = 'folder' | 'spreadsheet' | 'document' | 'pdf' | 'invoice' | 'image' | 'file';

export interface DriveHierarchicalItem {
  id: string;
  name: string;
  mimeType: string;
  itemType: DriveItemType;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  size?: number;
  sizeFormatted?: string;
  modifiedTime?: string;
  modifiedTimeFormatted?: string;
  parents?: string[];
  sharedWithMe?: boolean;
  ownerName?: string;
  isSharedDrive?: boolean;
}

/**
 * Searches or lists folders in Google Drive, including shared folders and shared drives.
 */
export async function searchDriveFolders(
  accessToken: string,
  searchTerm?: string,
  parentFolderId?: string,
  scope: 'all' | 'mine' | 'shared' = 'all'
): Promise<{ id: string; name: string; webViewLink?: string; shared?: boolean }[]> {
  let q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  
  if (scope === 'shared') {
    q += ' and sharedWithMe = true';
  } else if (parentFolderId && parentFolderId !== 'shared-with-me') {
    q += ` and '${parentFolderId}' in parents`;
  }
  
  if (searchTerm && searchTerm.trim()) {
    const escaped = searchTerm.replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const query = encodeURIComponent(q);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink,shared,owners)&orderBy=modifiedTime desc&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error al buscar carpetas en Google Drive: ${errText}`);
  }

  const data = await res.json();
  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    webViewLink: f.webViewLink,
    shared: f.shared || (f.owners && f.owners[0]?.me === false),
  }));
}

/**
 * Fetches only the direct children (subfolders and files) of a given folder in Google Drive.
 * Fully supports:
 * - 'root': Mi Unidad
 * - 'shared-with-me': Carpetas y archivos compartidos conmigo
 * - 'shared-drives': Unidades compartidas de Google Workspace
 * - Cualquier carpeta propia o compartida (con subcarpetas y archivos respetando la jerarquía real)
 */
export async function fetchFolderDirectContents(
  accessToken: string,
  folderId: string = 'root'
): Promise<{
  currentFolder: { id: string; name: string; webViewLink?: string; parents?: string[]; isSharedRoot?: boolean };
  items: DriveHierarchicalItem[];
  foldersCount: number;
  filesCount: number;
}> {
  // Case A: Shared Drives listing
  if (folderId === 'shared-drives') {
    try {
      const drivesRes = await fetch(
        'https://www.googleapis.com/drive/v3/drives?pageSize=50',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (drivesRes.ok) {
        const drivesData = await drivesRes.json();
        const driveItems: DriveHierarchicalItem[] = (drivesData.drives || []).map((d: any) => ({
          id: d.id,
          name: d.name,
          mimeType: 'application/vnd.google-apps.folder',
          itemType: 'folder',
          isSharedDrive: true,
          sizeFormatted: 'Unidad Compartida',
        }));
        return {
          currentFolder: {
            id: 'shared-drives',
            name: 'Unidades compartidas',
            isSharedRoot: true,
            parents: [],
          },
          items: driveItems,
          foldersCount: driveItems.length,
          filesCount: 0,
        };
      }
    } catch (e) {
      console.warn('Error fetching shared drives:', e);
    }
  }

  // Case B: Shared with me root
  if (folderId === 'shared-with-me') {
    const q = 'sharedWithMe = true and trashed = false';
    const query = encodeURIComponent(q);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,iconLink,webViewLink,thumbnailLink,modifiedTime,size,parents,owners,shared)&pageSize=100&orderBy=folder,modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error al leer elementos compartidos: ${errText}`);
    }

    const data = await res.json();
    const rawFiles: any[] = data.files || [];
    const items = mapAndSortDriveItems(rawFiles, true);

    return {
      currentFolder: {
        id: 'shared-with-me',
        name: 'Compartido conmigo',
        isSharedRoot: true,
        parents: [],
      },
      items,
      foldersCount: items.filter((i) => i.itemType === 'folder').length,
      filesCount: items.filter((i) => i.itemType !== 'folder').length,
    };
  }

  // Case C: Regular folder (Mi Unidad root or any folder ID, own or shared)
  let currentFolder = {
    id: folderId || 'root',
    name: folderId === 'root' || !folderId ? 'Mi Unidad' : 'Carpeta de Drive',
    webViewLink: undefined as string | undefined,
    parents: [] as string[] | undefined,
    isSharedRoot: false,
  };

  if (folderId && folderId !== 'root') {
    try {
      const folderRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,parents,webViewLink,shared,owners&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (folderRes.ok) {
        const folderData = await folderRes.json();
        currentFolder = {
          id: folderData.id,
          name: folderData.name || 'Carpeta',
          webViewLink: folderData.webViewLink,
          parents: folderData.parents,
          isSharedRoot: folderData.shared || (folderData.owners && folderData.owners[0]?.me === false),
        };
      }
    } catch (e) {
      console.warn('Error fetching folder metadata:', e);
    }
  }

  const targetParent = folderId && folderId !== 'root' ? folderId : 'root';
  const q = `'${targetParent}' in parents and trashed = false`;
  const query = encodeURIComponent(q);

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,iconLink,webViewLink,thumbnailLink,modifiedTime,size,parents,owners,shared)&pageSize=100&orderBy=folder,name&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw checkGoogleAuthResponse(res, errText, 'Error al leer contenido de Google Drive');
  }

  const data = await res.json();
  const rawFiles: any[] = data.files || [];
  const items = mapAndSortDriveItems(rawFiles);

  const foldersCount = items.filter((i) => i.itemType === 'folder').length;
  const filesCount = items.filter((i) => i.itemType !== 'folder').length;

  return {
    currentFolder,
    items,
    foldersCount,
    filesCount,
  };
}

/**
 * Helper to normalize and sort Google Drive items.
 */
function mapAndSortDriveItems(rawFiles: any[], defaultShared = false): DriveHierarchicalItem[] {
  const items: DriveHierarchicalItem[] = rawFiles.map((f) => {
    const name = f.name || '';
    const mime = f.mimeType || '';
    const lowerName = name.toLowerCase();
    const isOwnerMe = f.owners && f.owners[0]?.me !== false;
    const isShared = defaultShared || f.shared || !isOwnerMe;

    let itemType: DriveItemType = 'file';
    if (mime === 'application/vnd.google-apps.folder') {
      itemType = 'folder';
    } else if (
      mime === 'application/vnd.google-apps.spreadsheet' ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.ods')
    ) {
      itemType = 'spreadsheet';
    } else if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
      if (
        lowerName.includes('factura') ||
        lowerName.includes('recibo') ||
        lowerName.includes('invoice') ||
        lowerName.includes('ticket') ||
        lowerName.includes('comprobante')
      ) {
        itemType = 'invoice';
      } else {
        itemType = 'pdf';
      }
    } else if (
      mime.includes('word') ||
      mime.includes('document') ||
      mime === 'application/vnd.google-apps.document' ||
      lowerName.endsWith('.docx') ||
      lowerName.endsWith('.doc') ||
      lowerName.endsWith('.odt') ||
      lowerName.endsWith('.txt')
    ) {
      itemType = 'document';
    } else if (
      mime.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(lowerName)
    ) {
      if (
        lowerName.includes('factura') ||
        lowerName.includes('recibo') ||
        lowerName.includes('ticket') ||
        lowerName.includes('comprobante')
      ) {
        itemType = 'invoice';
      } else {
        itemType = 'image';
      }
    } else {
      itemType = 'file';
    }

    let sizeFormatted: string | undefined;
    if (f.size) {
      const bytes = parseInt(f.size, 10);
      if (!isNaN(bytes)) {
        if (bytes < 1024) sizeFormatted = `${bytes} B`;
        else if (bytes < 1024 * 1024) sizeFormatted = `${(bytes / 1024).toFixed(1)} KB`;
        else sizeFormatted = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      }
    }

    let modifiedTimeFormatted: string | undefined;
    if (f.modifiedTime) {
      try {
        const d = new Date(f.modifiedTime);
        modifiedTimeFormatted = d.toLocaleDateString('es-ES', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      } catch {
        modifiedTimeFormatted = f.modifiedTime;
      }
    }

    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      itemType,
      webViewLink: f.webViewLink,
      thumbnailLink: f.thumbnailLink,
      iconLink: f.iconLink,
      size: f.size ? parseInt(f.size, 10) : undefined,
      sizeFormatted,
      modifiedTime: f.modifiedTime,
      modifiedTimeFormatted,
      parents: f.parents,
      sharedWithMe: isShared,
      ownerName: f.owners?.[0]?.displayName,
    };
  });

  // Sort: folders first alphabetically, then files alphabetically
  items.sort((a, b) => {
    if (a.itemType === 'folder' && b.itemType !== 'folder') return -1;
    if (a.itemType !== 'folder' && b.itemType === 'folder') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return items;
}

/**
 * Gets metadata for a folder, or returns default for root, shared-with-me or shared-drives.
 */
export async function getFolderMetadata(
  accessToken: string,
  folderId: string
): Promise<{ id: string; name: string; webViewLink?: string; parents?: string[]; isSharedRoot?: boolean }> {
  if (!folderId || folderId === 'root') {
    return { id: 'root', name: 'Mi Unidad (Raíz de Google Drive)', parents: [] };
  }
  if (folderId === 'shared-with-me') {
    return { id: 'shared-with-me', name: 'Compartido conmigo', parents: [], isSharedRoot: true };
  }
  if (folderId === 'shared-drives') {
    return { id: 'shared-drives', name: 'Unidades compartidas', parents: [], isSharedRoot: true };
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,parents,webViewLink,shared,owners&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      return { id: folderId, name: 'Carpeta en Drive' };
    }
    const data = await res.json();
    return {
      id: data.id,
      name: data.name || 'Carpeta en Drive',
      webViewLink: data.webViewLink,
      parents: data.parents,
      isSharedRoot: data.shared || (data.owners && data.owners[0]?.me === false),
    };
  } catch {
    return { id: folderId, name: 'Carpeta en Drive' };
  }
}

/**
 * Searches or lists spreadsheets (Google Sheets, Excel .xlsx, .csv) in Google Drive,
 * including spreadsheets from shared folders and shared drives.
 */
export async function searchDriveSpreadsheets(
  accessToken: string,
  searchTerm?: string
): Promise<{ id: string; name: string; webViewLink?: string; isExcel?: boolean; mimeType?: string }[]> {
  let q = "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains '.xlsx' or name contains '.csv') and trashed = false";
  if (searchTerm && searchTerm.trim()) {
    const escaped = searchTerm.replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const query = encodeURIComponent(q);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,webViewLink)&orderBy=modifiedTime desc&pageSize=40&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw checkGoogleAuthResponse(res, errText, 'Error al buscar hojas de cálculo en Google Drive');
  }

  const data = await res.json();
  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    webViewLink: f.webViewLink,
    isExcel: f.mimeType !== 'application/vnd.google-apps.spreadsheet',
    mimeType: f.mimeType,
  }));
}

/**
 * Creates a generic folder anywhere in Google Drive.
 */
export async function createDriveFolder(
  accessToken: string,
  folderName: string,
  parentFolderId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const cleanName = folderName.trim();
  const body: any = {
    name: cleanName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentFolderId && parentFolderId !== 'root' && parentFolderId !== 'shared-with-me' && parentFolderId !== 'shared-drives') {
    body.parents = [parentFolderId];
  }

  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error creando la carpeta: ${errText}`);
  }

  return await res.json();
}

/**
 * Applies executive styling and decoration to Google Sheets:
 * - Professional dark navy executive header with sky-blue and emerald accents
 * - Header height, clean borders and column separators
 * - Auto-sized column widths so text is not truncated
 * - Freeze panes on the header row
 * - Formats price/value columns with Pesos ($) currency format ("$"#,##0.00)
 * - Centers dates, document numbers, and tax IDs
 * - Sets interactive table filter
 */
export async function applySpreadsheetStyling(
  accessToken: string,
  spreadsheetId: string,
  specificSheetId?: number
): Promise<void> {
  // 1. Get sheet tab ID if not provided
  let sheetId = specificSheetId;
  if (sheetId === undefined) {
    try {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        sheetId = meta.sheets?.[0]?.properties?.sheetId ?? 0;
      } else {
        sheetId = 0;
      }
    } catch {
      sheetId = 0;
    }
  }

  // 2. Check if headers already exist before overwriting to respect existing sheet formats
  try {
    const existingHeaderRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:L1`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    let hasExistingHeaders = false;
    if (existingHeaderRes.ok) {
      const existingData = await existingHeaderRes.json();
      const firstRow = existingData.values?.[0] || [];
      hasExistingHeaders = firstRow.some((cell: any) => cell && String(cell).trim().length > 0);
    }

    // Only set default SHEET_HEADERS if the header row is completely empty
    if (!hasExistingHeaders) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:L1?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [SHEET_HEADERS],
          }),
        }
      );
    }
  } catch (e) {
    console.warn('Advertencia verificando títulos de cabecera:', e);
  }

  // 3. Prepare styling batch requests
  const requests: any[] = [
    // A. Freeze top header row & enable gridlines
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
            hideGridlines: false,
          },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines',
      },
    },

    // B. Header row height: 44px (generous executive height)
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 0,
          endIndex: 1,
        },
        properties: {
          pixelSize: 44,
        },
        fields: 'pixelSize',
      },
    },

    // C. Set distinct, generous column widths
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 280 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 155 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 155 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 165 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 175 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 195 }, fields: 'pixelSize' } },

    // D. Decorated Header Row styling:
    // Deep Corporate Navy (#0F244A) background, Bold white text, centered, with bright sky-blue bottom accent border
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.06, green: 0.14, blue: 0.29 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              fontSize: 10,
              bold: true,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            borders: {
              bottom: {
                style: 'SOLID_THICK',
                color: { red: 0.14, green: 0.60, blue: 0.95 },
              },
              right: {
                style: 'SOLID',
                color: { red: 0.14, green: 0.24, blue: 0.42 },
              },
              left: {
                style: 'SOLID',
                color: { red: 0.14, green: 0.24, blue: 0.42 },
              },
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders)',
      },
    },

    // E. Total ($) Column Header Accent (Column 9):
    // Decorated with Deep Emerald (#073B2C) and vibrant mint underline for high visual hierarchy
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 9,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.03, green: 0.23, blue: 0.17 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              fontSize: 10,
              bold: true,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            borders: {
              bottom: {
                style: 'SOLID_THICK',
                color: { red: 0.18, green: 0.85, blue: 0.55 },
              },
              right: {
                style: 'SOLID',
                color: { red: 0.10, green: 0.35, blue: 0.28 },
              },
              left: {
                style: 'SOLID',
                color: { red: 0.10, green: 0.35, blue: 0.28 },
              },
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders)',
      },
    },

    // F. Formats currency columns (Base Imponible, IVA, Total -> Cols 7, 8, 9) with Pesos ($) format:
    // Format: "$"#,##0.00 across all data rows
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 7,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'CURRENCY',
              pattern: '"$"#,##0.00',
            },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // G. Emphasize Total ($) values with bold weight in data rows
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 9,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
            },
          },
        },
        fields: 'userEnteredFormat(textFormat)',
      },
    },

    // H. Center align dates (Cols 0, 1)
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },

    // I. Center align document Nº (Col 2) and CIF/RFC (Col 4)
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },

    // J. Interactive table filter
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
        },
      },
    },
  ];

  try {
    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!batchRes.ok) {
      console.warn('Advertencia aplicando estilos a Google Sheets:', await batchRes.text());
    }
  } catch (err) {
    console.warn('Error en llamada batchUpdate de estilos:', err);
  }

  // Soft alternating row striping (gentle call)
  try {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              addBanding: {
                bandedRange: {
                  range: {
                    sheetId,
                    startRowIndex: 0,
                    startColumnIndex: 0,
                    endColumnIndex: 12,
                  },
                  rowProperties: {
                    headerColor: { red: 0.06, green: 0.14, blue: 0.29 },
                    firstBandColor: { red: 1.0, green: 1.0, blue: 1.0 },
                    secondBandColor: { red: 0.97, green: 0.98, blue: 1.0 },
                  },
                },
              },
            },
          ],
        }),
      }
    );
  } catch {
    // Ignore if banding already present
  }
}

/**
 * Aplica el diseño corporativo infalible de SVH Arquitectos a una hoja existente o nueva de Google Sheets:
 * - Inserta el logo en A1 con fórmula =IMAGE("https://i.postimg.cc/Hn6LNwm0/image.png", 1)
 * - Combina celdas A1:E3 con mergeCells
 * - Encabezados en Fila 4 con Verde Oscuro #337337, texto blanco y negrita
 * - Alternancia de filas (banding) con Verde Claro suave #94C23D
 * - Formato de moneda CURRENCY ("$"#,##0.00) en columnas numéricas
 * - autoResizeDimensions para ancho perfecto de columnas
 */
export async function applySpreadsheetCorporateStyling(
  accessToken: string,
  spreadsheetId: string,
  specificSheetId?: number
): Promise<void> {
  let sheetId = specificSheetId;
  let sheetTitle = 'Control Facturas';

  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      const first = meta.sheets?.[0]?.properties;
      sheetId = sheetId ?? first?.sheetId ?? 0;
      sheetTitle = first?.title ?? sheetTitle;
    } else {
      sheetId = sheetId ?? 0;
    }
  } catch {
    sheetId = sheetId ?? 0;
  }

  // Inyectar Logo en A1
  const logoFormula = '=IMAGE("https://i.postimg.cc/Hn6LNwm0/image.png", 1)';
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetTitle)}'!A1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[logoFormula]],
      }),
    }
  ).catch(console.warn);

  // Inyectar Encabezados en Fila 4 si no están presentes
  const headers = [
    'Fecha',
    'Cliente / Proveedor',
    'NIT / RUT',
    'Concepto / Detalle',
    'Categoría',
    'Subtotal',
    'IVA',
    'Total a Pagar',
    'Comprobante / Archivo',
  ];

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetTitle)}'!A4:I4?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [headers],
      }),
    }
  ).catch(console.warn);

  const darkGreenColor = { red: 0.2, green: 0.451, blue: 0.216 }; // #337337
  const softGreenRowColor = { red: 0.94, green: 0.98, blue: 0.92 }; // Suave #94C23D
  const whiteColor = { red: 1.0, green: 1.0, blue: 1.0 };

  const requests: any[] = [
    // 1. Merge A1:E3
    {
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
        mergeType: 'MERGE_ALL',
      },
    },
    // Centrar área de logo
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: whiteColor,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)',
      },
    },
    // 2. Fila 4: Encabezados #337337
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 0,
          endColumnIndex: 9,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: darkGreenColor,
            textFormat: {
              foregroundColor: whiteColor,
              fontSize: 11,
              bold: true,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // 3. Moneda en columnas 5, 6, 7 (Subtotal, IVA, Total)
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 4,
          startColumnIndex: 5,
          endColumnIndex: 8,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'CURRENCY',
              pattern: '"$"#,##0.00',
            },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // 4. Inmovilizar fila 4
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 4,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // 5. Autoajustar ancho de columnas
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: 9,
        },
      },
    },
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  }).catch(console.warn);

  // Banding opcional
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            addBanding: {
              bandedRange: {
                range: {
                  sheetId,
                  startRowIndex: 3,
                  startColumnIndex: 0,
                  endColumnIndex: 9,
                },
                rowProperties: {
                  headerColor: darkGreenColor,
                  firstBandColor: whiteColor,
                  secondBandColor: softGreenRowColor,
                },
              },
            },
          },
        ],
      }),
    });
  } catch {
    // Ignore if banding already exists
  }
}

/**
 * Creates a new Google Spreadsheet and initializes its headers with decorated styling.
 */
export async function createCustomSpreadsheet(
  accessToken: string,
  title: string,
  parentFolderId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const cleanTitle = title.trim();
  const body: any = {
    name: cleanTitle,
    mimeType: 'application/vnd.google-apps.spreadsheet',
  };

  if (parentFolderId && parentFolderId !== 'shared-with-me' && parentFolderId !== 'shared-drives') {
    if (parentFolderId !== 'root') {
      body.parents = [parentFolderId];
    }
  }

  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error creando la hoja de cálculo: ${errText}`);
  }

  const newSheet = await res.json();

  // Apply complete decorated headers and Peso ($) formatting
  await applySpreadsheetStyling(accessToken, newSheet.id);

  return newSheet;
}

/**
 * Ensures header row exists in any given spreadsheet and applies decorated styling.
 */
export async function ensureSheetHeaders(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  try {
    await applySpreadsheetStyling(accessToken, spreadsheetId);
  } catch (err) {
    console.warn('Advertencia al estilizar cabeceras del sheet:', err);
  }
}

export async function getOrCreateRootFolder(accessToken: string): Promise<string> {
  const query = encodeURIComponent(
    `name = '${ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Error buscando carpeta raíz en Drive: ${errText}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create root folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: ROOT_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Carpeta principal para gestión de proyectos de obra y facturación automatizada',
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Error creando carpeta raíz en Drive: ${errText}`);
  }

  const newFolder = await createRes.json();
  return newFolder.id;
}

/**
 * Lists all project folders inside the root folder.
 */
export async function listProjectFolders(
  accessToken: string,
  rootFolderId: string
): Promise<ProjectFolder[]> {
  const query = encodeURIComponent(
    `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)&orderBy=name&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error al listar carpetas de proyectos: ${errText}`);
  }

  const data = await res.json();
  const folders: ProjectFolder[] = (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    webViewLink: f.webViewLink,
  }));

  return folders;
}

/**
 * Creates a new project folder in Google Drive.
 */
export async function createProjectFolder(
  accessToken: string,
  rootFolderId: string,
  projectName: string
): Promise<ProjectFolder> {
  const cleanName = projectName.trim();
  const folderName = cleanName.toLowerCase().startsWith('obra')
    ? cleanName
    : `Obra: ${cleanName}`;

  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error creando la carpeta del proyecto: ${errText}`);
  }

  const folder = await res.json();
  // Automatically initialize the Google Sheet inside the new project folder using the exact project name
  const sheet = await getOrCreateProjectSheet(accessToken, folder.id, cleanName);

  return {
    id: folder.id,
    name: folder.name,
    webViewLink: folder.webViewLink,
    spreadsheetId: sheet.id,
    spreadsheetName: sheet.name,
    spreadsheetUrl: sheet.webViewLink,
  };
}

/**
 * Finds or creates the dedicated Google Sheet inside the project folder.
 */
export async function getOrCreateProjectSheet(
  accessToken: string,
  projectFolderId: string,
  projectName: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  // Check if a spreadsheet already exists in this folder
  const query = encodeURIComponent(
    `'${projectFolderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      const file = searchData.files[0];
      return {
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink,
      };
    }
  }

  // Create a new Google Spreadsheet inside this project folder using project name + Facturación
  const sheetTitle = buildProjectSpreadsheetTitle(projectName);

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: sheetTitle,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [projectFolderId],
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Error creando la hoja de cálculo en Drive: ${errText}`);
  }

  const newSheet = await createRes.json();

  // Initialize and apply decorated headers with Peso ($) formatting
  await applySpreadsheetStyling(accessToken, newSheet.id);

  return {
    id: newSheet.id,
    name: newSheet.name,
    webViewLink: newSheet.webViewLink,
  };
}

/**
 * Uploads an image file to Google Drive using multipart upload.
 */
export async function uploadInvoiceImageToDrive(
  accessToken: string,
  projectFolderId: string,
  fileName: string,
  mimeType: string,
  base64Data: string
): Promise<{ fileId: string; webViewLink: string; name: string }> {
  // Clean base64
  const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');

  // Convert base64 to binary ArrayBuffer
  const binaryString = atob(cleanBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const metadata = {
    name: fileName,
    parents: [projectFolderId],
    mimeType: mimeType || 'image/jpeg',
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metaBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json; charset=UTF-8' });
  const fileBlob = new Blob([bytes], { type: mimeType || 'image/jpeg' });

  // Build multipart form body
  const body = new FormData();
  // Instead of raw FormData which Google Drive expects as multipart/related, we construct the multipart payload
  const multipartHeader = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
    metadata
  )}${delimiter}Content-Type: ${mimeType || 'image/jpeg'}\r\n\r\n`;

  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(multipartHeader);
  const footerBytes = encoder.encode(closeDelimiter);

  const combinedPayload = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
  combinedPayload.set(headerBytes, 0);
  combinedPayload.set(bytes, headerBytes.length);
  combinedPayload.set(footerBytes, headerBytes.length + bytes.length);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: combinedPayload,
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    if (
      uploadRes.status === 404 ||
      errText.toLowerCase().includes('notfound') ||
      errText.toLowerCase().includes('file not found') ||
      errText.toLowerCase().includes('trashed')
    ) {
      throw new Error(
        'Los archivos o la carpeta de evidencias creados en Google Drive ya no existen porque fueron eliminados o cambiaron su nombre al tratar de añadir la factura.'
      );
    }
    throw new Error(`Error subiendo la imagen a Google Drive: ${errText}`);
  }

  const uploadedFile = await uploadRes.json();
  const effectiveWebViewLink =
    uploadedFile.webViewLink || (uploadedFile.id ? `https://drive.google.com/file/d/${uploadedFile.id}/view` : '');

  return {
    fileId: uploadedFile.id,
    webViewLink: effectiveWebViewLink,
    name: uploadedFile.name,
  };
}

/**
 * Interpreta las comas (,) y puntos (.) según el formato local contable de obras y facturación
 * (soporta $ 1.500.000, 450.000, 775.600, 775.6, 70.509, 1,500,000.00, 1500,50, 1500000).
 * No trunca las cifras de moneda ni confunde separadores de miles con decimales.
 */
export function parseLocaleAmount(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  let str = String(val).trim().replace(/[€$£¥\s]/g, '').replace(/COP|USD|EUR|MXN|PEN|CLP/gi, '').trim();
  if (!str) return 0;

  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastDot < lastComma) {
      // e.g. 1.500.000,50 -> dot is thousand, comma is decimal
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // e.g. 1,500,000.50 -> comma is thousand, dot is decimal
      str = str.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const commas = (str.match(/,/g) || []).length;
    if (commas > 1) {
      str = str.replace(/,/g, '');
    } else {
      const parts = str.split(',');
      if (parts[1].length === 3 && parts[0].length <= 3) {
        str = str.replace(',', '');
      } else {
        str = parts[0] + '.' + parts[1];
      }
    }
  } else if (lastDot !== -1) {
    const dots = (str.match(/\./g) || []).length;
    if (dots > 1) {
      str = str.replace(/\./g, '');
    } else {
      const parts = str.split('.');
      if (parts[1].length === 3) {
        // e.g. "775.600" -> "775600", "70.509" -> "70509"
        str = str.replace('.', '');
      }
      // If parts[1].length === 1 or 2 (e.g. "1250.50" or "450.5"): keep dot as standard decimal!
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Cleans and converts currency strings into clean numbers using standard locale rules.
 */
function parseCurrencyNumber(val: any): number {
  return parseLocaleAmount(val);
}


/**
 * Fetches all tabs/sheets metadata from a Google Spreadsheet.
 */
export async function getSpreadsheetTabs(
  accessToken: string,
  spreadsheetId: string
): Promise<SheetTabInfo[]> {
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title,index,gridProperties))`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      console.warn('Error al consultar pestañas de la hoja de cálculo:', errText);
      return [];
    }
    const data = await res.json();
    const sheetsList = data.sheets || [];
    const tabs: SheetTabInfo[] = [];

    for (const s of sheetsList) {
      const props = s.properties || {};
      tabs.push({
        sheetId: props.sheetId ?? 0,
        title: props.title || 'Hoja1',
        index: props.index ?? 0,
        rowCount: props.gridProperties?.rowCount,
        columnCount: props.gridProperties?.columnCount,
      });
    }
    return tabs;
  } catch (err) {
    console.warn('Excepción al obtener pestañas de la hoja:', err);
    return [];
  }
}

/**
 * Reads header row of a specific tab (or the first tab) in a spreadsheet.
 * Scans rows 1 to 6 to find the row with real column headers (e.g. Factura, Total, Proveedor).
 */
export async function getTabHeaders(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle?: string
): Promise<string[]> {
  const range = sheetTitle ? `'${sheetTitle.replace(/'/g, "''")}'!1:6` : '1:6';
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const rows: any[][] = data.values || [];
    if (rows.length === 0) return [];

    let bestRowIdx = 0;
    let maxScore = -1;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const nonEmpties = row.filter((c: any) => c !== undefined && String(c).trim() !== '');
      if (nonEmpties.length === 0) continue;
      
      let score = nonEmpties.length;
      const joined = row.map((c: any) => String(c || '').toLowerCase()).join(' ');
      if (/factura|folio|fecha|proveedor|subtotal|total|concepto|iva|nit/i.test(joined)) {
        score += 25;
      }
      if (score > maxScore) {
        maxScore = score;
        bestRowIdx = r;
      }
    }

    return (rows[bestRowIdx] || []).map((c: any) => String(c || '').trim());
  } catch (err) {
    console.warn('Error leyendo encabezados de pestaña:', err);
    return [];
  }
}

/**
 * Actualiza los encabezados / columnas de una pestaña en Google Sheets.
 */
export async function updateTabHeaders(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  headers: string[],
  rowNumber: number = 1
): Promise<boolean> {
  if (!spreadsheetId || !sheetTitle || !headers || headers.length === 0) return false;
  try {
    const range = `'${sheetTitle.replace(/'/g, "''")}'!A${rowNumber}:${rowNumber}`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [headers],
        }),
      }
    );
    return res.ok;
  } catch (err) {
    console.error('Error actualizando encabezados en Google Sheets:', err);
    return false;
  }
}

/**
 * Appends an invoice record to the project's Google Sheet, adapting intelligently to existing columns.
 */
export async function appendInvoiceToSheet(
  accessToken: string,
  spreadsheetId: string,
  invoice: InvoiceData,
  driveFileUrl: string,
  fileName: string,
  sheetTitle?: string
): Promise<void> {
  const registrationDate = new Date().toISOString().split('T')[0];

  const subtotalNum =
    typeof invoice.subtotal === 'number'
      ? invoice.subtotal
      : parseFloat(String(invoice.subtotal).replace(/[^0-9.-]/g, '')) || 0;
  const taxNum =
    typeof invoice.taxAmount === 'number'
      ? invoice.taxAmount
      : parseFloat(String(invoice.taxAmount).replace(/[^0-9.-]/g, '')) || 0;
  const totalNum =
    typeof invoice.totalAmount === 'number'
      ? invoice.totalAmount
      : parseFloat(String(invoice.totalAmount).replace(/[^0-9.-]/g, '')) || 0;

  // 1. Inspect existing headers on this sheet/tab
  const existingHeaders = await getTabHeaders(accessToken, spreadsheetId, sheetTitle);

  let rowValues: any[] = [];
  const tabPrefix = sheetTitle ? `'${sheetTitle.replace(/'/g, "''")}'!` : '';

  if (existingHeaders.length === 0) {
    // If the sheet is completely empty, initialize it with standard SVH headers first
    try {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabPrefix + 'A1:L1')}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [SHEET_HEADERS] }),
        }
      );
    } catch (e) {
      console.warn('No se pudieron inicializar encabezados en hoja vacía:', e);
    }

    // Ensure Drive link is entered as a direct clickable HYPERLINK in Google Sheets
    const effectiveDriveCell = driveFileUrl
      ? (driveFileUrl.startsWith('=HYPERLINK')
          ? driveFileUrl
          : `=HYPERLINK("${driveFileUrl}", "Ver Factura en Drive")`)
      : '';

    rowValues = [
      registrationDate,
      invoice.date || '',
      invoice.invoiceNumber || 'S/N',
      invoice.vendorName || 'Sin proveedor',
      invoice.vendorTaxId || '',
      invoice.concept || (invoice.items?.map((i) => i.description).join(', ') || ''),
      invoice.category || 'Varios',
      subtotalNum,
      taxNum,
      totalNum,
      effectiveDriveCell,
      fileName || '',
    ];
  } else {
    // Tab has existing headers: Map dynamically to respect the existing layout
    const mapping = detectColumnMapping(existingHeaders);

    // If existing headers don't have a column for Drive links, dynamically add 'Enlace Factura Drive'
    if (mapping.driveUrlCol === -1 && driveFileUrl) {
      mapping.driveUrlCol = existingHeaders.length;
      try {
        const headerCell = `${tabPrefix}${colIndexToA1Notation(mapping.driveUrlCol)}1`;
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(headerCell)}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [['Enlace Factura Drive']] }),
          }
        );
      } catch (err) {
        console.warn('No se pudo añadir columna de Enlace Factura Drive:', err);
      }
    }

    const numCols = Math.max(existingHeaders.length, mapping.driveUrlCol >= 0 ? mapping.driveUrlCol + 1 : 12);
    rowValues = new Array(numCols).fill('');

    if (mapping.registrationDateCol >= 0) rowValues[mapping.registrationDateCol] = registrationDate;
    if (mapping.issueDateCol >= 0) rowValues[mapping.issueDateCol] = invoice.date || '';
    if (mapping.invoiceNumberCol >= 0) rowValues[mapping.invoiceNumberCol] = invoice.invoiceNumber || 'S/N';
    if (mapping.vendorNameCol >= 0) rowValues[mapping.vendorNameCol] = invoice.vendorName || 'Sin proveedor';
    if (mapping.vendorTaxIdCol >= 0) rowValues[mapping.vendorTaxIdCol] = invoice.vendorTaxId || '';
    
    // Concept / description of materials
    const conceptText = invoice.concept || (invoice.items?.map((i) => i.description).join(', ') || '');
    if (mapping.conceptCol >= 0) rowValues[mapping.conceptCol] = conceptText;
    if (mapping.categoryCol >= 0) rowValues[mapping.categoryCol] = invoice.category || 'Varios';
    if (mapping.subtotalCol >= 0) rowValues[mapping.subtotalCol] = subtotalNum;
    if (mapping.taxAmountCol >= 0) rowValues[mapping.taxAmountCol] = taxNum;
    if (mapping.totalAmountCol >= 0) rowValues[mapping.totalAmountCol] = totalNum;

    // Materials / quantity / unit price if matching columns exist
    if (mapping.quantityCol >= 0) {
      const q = invoice.quantity ?? invoice.items?.[0]?.quantity;
      if (q !== undefined) rowValues[mapping.quantityCol] = q;
    }
    if (mapping.unitPriceCol >= 0) {
      const p = invoice.unitPrice ?? invoice.items?.[0]?.unitPrice;
      if (p !== undefined) rowValues[mapping.unitPriceCol] = p;
    }

    if (mapping.driveUrlCol >= 0) {
      const displayLabel = (fileName || 'Ver Factura en Drive').replace(/"/g, '""');
      rowValues[mapping.driveUrlCol] = driveFileUrl
        ? (driveFileUrl.startsWith('=HYPERLINK')
            ? driveFileUrl
            : `=HYPERLINK("${driveFileUrl}", "${displayLabel}")`)
        : '';
    }
    if (mapping.fileNameCol >= 0) rowValues[mapping.fileNameCol] = fileName || '';
  }

  // 1. Intentar primero a través de la ruta segura del servidor con el SDK oficial de Google Sheets
  try {
    const srvRes = await fetch('/api/append-invoice-row', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        spreadsheetId,
        sheetTitle: sheetTitle || 'Facturas',
        rowValues,
      }),
    });

    if (srvRes.ok) {
      const srvData = await srvRes.json();
      if (srvData.success) {
        await syncSpreadsheetTotalRow(accessToken, spreadsheetId, sheetTitle).catch((e) =>
          console.warn('No se pudo sincronizar fila TOTAL en Sheets:', e)
        );
        return;
      }
    }
  } catch (srvErr) {
    console.warn('Ruta /api/append-invoice-row no disponible, reintentando por llamada directa:', srvErr);
  }

  // 2. Fallback por llamada directa a Google Sheets API v4 con URL correctamente construida (:append literal fuera de la codificación)
  const targetRange = tabPrefix ? `${tabPrefix}A1` : 'A1';
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(targetRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const appendRes = await fetch(appendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [rowValues],
    }),
  });

  if (!appendRes.ok) {
    const errText = await appendRes.text();
    if (
      appendRes.status === 404 ||
      errText.toLowerCase().includes('notfound') ||
      errText.toLowerCase().includes('requested entity was not found')
    ) {
      throw new Error(
        'La hoja de cálculo de Google Sheets en Drive ya no existe o cambió de nombre al registrar la factura.'
      );
    }

    let cleanErr = errText;
    if (cleanErr.includes('<html') || cleanErr.includes('<!DOCTYPE') || cleanErr.includes('ppConfig')) {
      cleanErr = `Error HTTP ${appendRes.status} al conectar con Google Sheets API. La fila no pudo ser registrada directamente.`;
    }
    throw new Error(`Error registrando los datos en Google Sheets: ${cleanErr}`);
  }

  // Synchronize Google Sheets total row without combining with MVP
  await syncSpreadsheetTotalRow(accessToken, spreadsheetId, sheetTitle).catch((e) =>
    console.warn('No se pudo sincronizar fila TOTAL en Sheets:', e)
  );
}

/**
 * Ensures Google Sheets has an explicit, clean 'TOTAL GENERAL' row at the bottom of the table
 * with the sum of Subtotal, IVA, and Total a Pagar, without combining with the MVP item accounting.
 */
export async function syncSpreadsheetTotalRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle?: string
): Promise<void> {
  try {
    const tabPrefix = sheetTitle ? `'${sheetTitle.replace(/'/g, "''")}'!` : '';
    const range = `${tabPrefix}A1:ZZ`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return;

    const data = await res.json();
    const rows: any[][] = data.values || [];
    if (rows.length === 0) return;

    // 1. Locate header row
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r] || [];
      const joined = row.map((c: any) => String(c || '').toLowerCase()).join(' ');
      if (/fecha|proveedor|subtotal|total|concepto|iva|nit/i.test(joined)) {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx === -1) return;

    const headers = (rows[headerRowIdx] || []).map((c: any) => String(c || '').trim());
    const mapping = detectColumnMapping(headers);
    if (mapping.totalAmountCol < 0 && mapping.subtotalCol < 0) return;

    // 2. Identify data rows and calculate sums
    let subtotalSum = 0;
    let taxSum = 0;
    let totalSum = 0;
    let lastDataRowIdx = headerRowIdx;
    const existingTotalRowIndices: number[] = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.length === 0 || row.every((c: any) => c === undefined || String(c).trim() === '')) {
        continue;
      }

      if (isAnyTotalsRow(row)) {
        existingTotalRowIndices.push(r);
        continue;
      }

      // Check if subtotal intermediate
      const isSub = row.some((c: any) => isSubtotalCell(String(c || '')));
      if (isSub) continue;

      lastDataRowIdx = r;

      if (mapping.subtotalCol >= 0 && row[mapping.subtotalCol] !== undefined) {
        subtotalSum += parseLocaleAmount(row[mapping.subtotalCol]);
      }
      if (mapping.taxAmountCol >= 0 && row[mapping.taxAmountCol] !== undefined) {
        taxSum += parseLocaleAmount(row[mapping.taxAmountCol]);
      }
      if (mapping.totalAmountCol >= 0 && row[mapping.totalAmountCol] !== undefined) {
        totalSum += parseLocaleAmount(row[mapping.totalAmountCol]);
      }
    }

    if (totalSum === 0 && subtotalSum > 0) {
      totalSum = subtotalSum + taxSum;
    }

    // 3. Construct the clean TOTAL row
    const targetColsCount = Math.max(headers.length, 12);
    const totalRowValues: any[] = new Array(targetColsCount).fill('');

    const labelCol = mapping.conceptCol >= 0 ? mapping.conceptCol : (mapping.vendorNameCol >= 0 ? mapping.vendorNameCol : 0);
    totalRowValues[labelCol] = 'TOTAL GENERAL';

    if (mapping.subtotalCol >= 0) totalRowValues[mapping.subtotalCol] = subtotalSum;
    if (mapping.taxAmountCol >= 0) totalRowValues[mapping.taxAmountCol] = taxSum;
    if (mapping.totalAmountCol >= 0) totalRowValues[mapping.totalAmountCol] = totalSum;

    // 4. Target row in Google Sheets (1-indexed) is immediately below last data row
    const targetRow1Index = lastDataRowIdx + 1 + 1;

    // Write TOTAL row across all columns
    const endColLetter = colIndexToA1Notation(targetColsCount - 1);
    const writeRange = `${tabPrefix}A${targetRow1Index}:${endColLetter}${targetRow1Index}`;
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [totalRowValues] }),
      }
    );

    // Formatear la fila de total con negrita, borde superior sólido y borde inferior doble contable
    try {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        const foundSheet = sheetTitle
          ? metaData.sheets?.find((s: any) => s.properties?.title === sheetTitle)
          : metaData.sheets?.[0];
        const tabSheetId = foundSheet?.properties?.sheetId ?? 0;
        const totalRow0Index = targetRow1Index - 1;

        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId: tabSheetId,
                      startRowIndex: totalRow0Index,
                      endRowIndex: totalRow0Index + 1,
                      startColumnIndex: 0,
                      endColumnIndex: targetColsCount,
                    },
                    cell: {
                      userEnteredFormat: {
                        textFormat: { bold: true },
                        borders: {
                          top: { style: 'SOLID', color: { red: 0.15, green: 0.45, blue: 0.22 } },
                          bottom: { style: 'SOLID_DOUBLE', color: { red: 0.10, green: 0.30, blue: 0.15 } },
                        },
                      },
                    },
                    fields: 'userEnteredFormat(textFormat,borders)',
                  },
                },
              ],
            }),
          }
        ).catch(() => {});
      }
    } catch {
      // Ignorar si hay restricciones de permisos en batchUpdate
    }

    // Clear any obsolete total rows that were located lower in the sheet
    for (const oldIdx of existingTotalRowIndices) {
      const oldRow1Index = oldIdx + 1;
      if (oldRow1Index > targetRow1Index) {
        const clearRange = `${tabPrefix}A${oldRow1Index}:ZZ${oldRow1Index}`;
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(clearRange)}:clear`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Advertencia al sincronizar fila TOTAL en Google Sheets:', err);
  }
}

/**
 * Updates an existing invoice row in Google Sheets in-place without duplicating.
 * Preserves unmapped columns and formulas.
 */
export async function updateInvoiceInSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string | undefined,
  rowIndex: number,
  updatedInvoice: Partial<SheetInvoiceRecord>,
  existingRawRow?: any[]
): Promise<void> {
  const tabPrefix = sheetTitle ? `'${sheetTitle.replace(/'/g, "''")}'!` : '';

  // 1. Get tab headers to understand column layout
  const headers = await getTabHeaders(accessToken, spreadsheetId, sheetTitle);
  const mapping = detectColumnMapping(headers);

  // 2. Fetch current row values if existingRawRow is not provided
  let currentRow = existingRawRow ? [...existingRawRow] : [];
  if (currentRow.length === 0) {
    try {
      const getRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabPrefix + rowIndex + ':' + rowIndex)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (getRes.ok) {
        const getData = await getRes.json();
        if (getData.values && getData.values.length > 0) {
          currentRow = [...getData.values[0]];
        }
      }
    } catch (e) {
      console.warn('No se pudo leer la fila previa antes de actualizar:', e);
    }
  }

  // Ensure row has enough slots
  const targetLength = Math.max(headers.length, currentRow.length, 12);
  while (currentRow.length < targetLength) {
    currentRow.push('');
  }

  // 3. Determine effective column indices with fallbacks to standard 12-column layout if needed
  const effectiveSubtotalCol = mapping.subtotalCol >= 0 ? mapping.subtotalCol : (headers.length >= 8 ? 7 : -1);
  const effectiveTaxCol = mapping.taxAmountCol >= 0 ? mapping.taxAmountCol : (headers.length >= 9 ? 8 : -1);
  const effectiveTotalCol = mapping.totalAmountCol >= 0 ? mapping.totalAmountCol : (headers.length >= 10 ? 9 : -1);

  if (mapping.issueDateCol >= 0 && updatedInvoice.issueDate !== undefined) {
    currentRow[mapping.issueDateCol] = updatedInvoice.issueDate;
  }
  if (mapping.invoiceNumberCol >= 0 && updatedInvoice.invoiceNumber !== undefined) {
    currentRow[mapping.invoiceNumberCol] = updatedInvoice.invoiceNumber;
  }
  if (mapping.vendorNameCol >= 0 && updatedInvoice.vendorName !== undefined) {
    currentRow[mapping.vendorNameCol] = updatedInvoice.vendorName;
  }
  if (mapping.vendorTaxIdCol >= 0 && updatedInvoice.vendorTaxId !== undefined) {
    currentRow[mapping.vendorTaxIdCol] = updatedInvoice.vendorTaxId;
  }
  if (mapping.conceptCol >= 0 && updatedInvoice.concept !== undefined) {
    currentRow[mapping.conceptCol] = updatedInvoice.concept;
  }
  if (mapping.categoryCol >= 0 && updatedInvoice.category !== undefined) {
    currentRow[mapping.categoryCol] = updatedInvoice.category;
  }
  if (effectiveSubtotalCol >= 0 && updatedInvoice.subtotal !== undefined) {
    currentRow[effectiveSubtotalCol] = updatedInvoice.subtotal;
  }
  if (effectiveTaxCol >= 0 && updatedInvoice.taxAmount !== undefined) {
    currentRow[effectiveTaxCol] = updatedInvoice.taxAmount;
  }
  if (effectiveTotalCol >= 0 && updatedInvoice.totalAmount !== undefined) {
    currentRow[effectiveTotalCol] = updatedInvoice.totalAmount;
  }
  if (mapping.quantityCol >= 0 && updatedInvoice.quantity !== undefined) {
    currentRow[mapping.quantityCol] = updatedInvoice.quantity;
  }
  if (mapping.unitPriceCol >= 0 && updatedInvoice.unitPrice !== undefined) {
    currentRow[mapping.unitPriceCol] = updatedInvoice.unitPrice;
  }
  // Manejo robusto del enlace y nombre del documento
  const newFileName = updatedInvoice.fileName?.trim();
  const rawUrl = updatedInvoice.driveFileUrl !== undefined ? updatedInvoice.driveFileUrl : currentRow[mapping.driveUrlCol];
  const cleanLink = typeof rawUrl === 'string'
    ? (rawUrl.startsWith('=HYPERLINK') ? (rawUrl.match(/"([^"]+)"/)?.[1] || rawUrl) : rawUrl)
    : '';

  const effectiveLabel = newFileName || (typeof rawUrl === 'string' && rawUrl.startsWith('=HYPERLINK') ? (rawUrl.match(/,\s*"([^"]+)"\)/)?.[1] || 'Ver Factura en Drive') : 'Ver Factura en Drive');

  if (mapping.driveUrlCol >= 0) {
    if (cleanLink) {
      currentRow[mapping.driveUrlCol] = `=HYPERLINK("${cleanLink}", "${effectiveLabel.replace(/"/g, '""')}")`;
    }
  } else if (cleanLink) {
    mapping.driveUrlCol = headers.length;
    currentRow[mapping.driveUrlCol] = `=HYPERLINK("${cleanLink}", "${effectiveLabel.replace(/"/g, '""')}")`;
    try {
      const headerCell = `${tabPrefix}${colIndexToA1Notation(mapping.driveUrlCol)}1`;
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(headerCell)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [['Enlace Factura Drive']] }),
        }
      );
    } catch (err) {
      console.warn('No se pudo añadir columna de Enlace Factura Drive:', err);
    }
  }

  if (mapping.fileNameCol >= 0 && newFileName !== undefined) {
    currentRow[mapping.fileNameCol] = newFileName;
  }

  // Si el nombre del documento cambió y está en Drive, renombrar el archivo en Google Drive
  if (newFileName) {
    const driveId =
      extractDriveFileId(cleanLink) ||
      extractDriveFileId(updatedInvoice.driveFileUrl) ||
      (updatedInvoice.id && !updatedInvoice.id.includes('_') ? updatedInvoice.id : null);
    if (driveId) {
      try {
        await renameDriveFile(accessToken, driveId, newFileName);
      } catch (err) {
        console.warn('Aviso sincronizando nuevo nombre con Google Drive:', err);
      }
    }
  }

  // 4. Update row in Google Sheets
  const updateRange = `${tabPrefix}${rowIndex}:${rowIndex}`;
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [currentRow],
      }),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Error actualizando la factura en Google Sheets: ${errText}`);
  }

  // Synchronize Google Sheets total row without combining with MVP
  await syncSpreadsheetTotalRow(accessToken, spreadsheetId, sheetTitle).catch((e) =>
    console.warn('No se pudo sincronizar fila TOTAL en Sheets tras actualizar:', e)
  );
}

/**
 * Fetches all existing invoice records from the project's Google Sheet,
 * dynamically mapping columns based on the sheet's header row.
 */
export async function fetchSheetInvoiceRecords(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle?: string
): Promise<SheetInvoiceRecord[]> {
  const tabPrefix = sheetTitle ? `'${sheetTitle.replace(/'/g, "''")}'!` : '';
  const range = `${tabPrefix}A1:ZZ`;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.warn('No se pudieron leer registros de Google Sheets:', err);
    return [];
  }

  const data = await res.json();
  if (!data.values || data.values.length < 2) {
    return [];
  }

  const headers = data.values[0] || [];
  const mapping = detectColumnMapping(headers);
  const rows = data.values.slice(1);

  const records: SheetInvoiceRecord[] = [];

  rows.forEach((row: any[], index: number) => {
    // Check if row is completely empty
    const hasData = row.some((cell) => cell !== undefined && String(cell).trim() !== '');
    if (!hasData) return;

    const rowIndex = index + 2;

    const registrationDate = mapping.registrationDateCol >= 0 ? String(row[mapping.registrationDateCol] || '') : '';
    const issueDate = mapping.issueDateCol >= 0 ? String(row[mapping.issueDateCol] || '') : '';
    const invoiceNumber = mapping.invoiceNumberCol >= 0 ? String(row[mapping.invoiceNumberCol] || '') : '';
    const vendorName = mapping.vendorNameCol >= 0 ? String(row[mapping.vendorNameCol] || '') : '';
    const vendorTaxId = mapping.vendorTaxIdCol >= 0 ? String(row[mapping.vendorTaxIdCol] || '') : '';
    const concept = mapping.conceptCol >= 0 ? String(row[mapping.conceptCol] || '') : '';
    const category = mapping.categoryCol >= 0 ? String(row[mapping.categoryCol] || 'Varios') : 'Varios';
    const subtotal = mapping.subtotalCol >= 0 ? parseCurrencyNumber(row[mapping.subtotalCol]) : 0;
    const taxAmount = mapping.taxAmountCol >= 0 ? parseCurrencyNumber(row[mapping.taxAmountCol]) : 0;
    const totalAmount = mapping.totalAmountCol >= 0 ? parseCurrencyNumber(row[mapping.totalAmountCol]) : 0;
    const rawDriveFileUrl = mapping.driveUrlCol >= 0 ? String(row[mapping.driveUrlCol] || '').trim() : '';
    // Only accept as driveFileUrl if it's an actual URL, drive link, or identifiable drive file ID
    const driveFileUrl =
      rawDriveFileUrl && (/^(https?:\/\/|[a-zA-Z0-9_-]{20,})/i.test(rawDriveFileUrl) || extractDriveFileId(rawDriveFileUrl) !== null)
        ? rawDriveFileUrl
        : '';
    const fileName = mapping.fileNameCol >= 0 ? String(row[mapping.fileNameCol] || '') : '';
    const quantity = mapping.quantityCol >= 0 ? parseCurrencyNumber(row[mapping.quantityCol]) : undefined;
    const unitPrice = mapping.unitPriceCol >= 0 ? parseCurrencyNumber(row[mapping.unitPriceCol]) : undefined;

    records.push({
      id: `${sheetTitle || 'sheet'}_r${rowIndex}_${invoiceNumber || vendorName || index}`,
      rowIndex,
      sheetTitle: sheetTitle || 'Hoja1',
      registrationDate,
      issueDate,
      invoiceNumber,
      vendorName,
      vendorTaxId,
      concept,
      category,
      subtotal,
      taxAmount,
      totalAmount,
      driveFileUrl,
      fileName,
      quantity,
      unitPrice,
      rawRowData: row,
    });
  });

  return records;
}

/**
 * Extracts the Google Drive file ID from a webViewLink, open URL, formula, or raw ID.
 * Handles =HYPERLINK("..."), query parameters, decoded URLs, etc.
 */
export function extractDriveFileId(urlOrId?: string): string | null {
  if (!urlOrId) return null;
  let str = String(urlOrId).trim();
  if (!str) return null;

  // Unescape URL encoding if present
  if (str.includes('%2F') || str.includes('%3A') || str.includes('%3F')) {
    try {
      str = decodeURIComponent(str);
    } catch {
      // ignore
    }
  }

  // Extract from formulas like =HYPERLINK("https://...", "label")
  const hyperlinkMatch = str.match(/=HYPERLINK\(\s*["']([^"']+)["']/i);
  if (hyperlinkMatch && hyperlinkMatch[1]) {
    str = hyperlinkMatch[1].trim();
  }

  // Strip enclosing quotes, brackets, or angle brackets
  str = str.replace(/^["'<(\s]+|["'>)\s]+$/g, '').trim();

  // If text has an embedded URL (e.g. "Ver: https://drive.google.com/file/d/XYZ/view"):
  const embeddedUrlMatch = str.match(/https?:\/\/[^\s"'>]+/i);
  if (embeddedUrlMatch) {
    str = embeddedUrlMatch[0];
  }

  // Direct Drive file ID (alphanumeric, hyphens, underscores, between 20 and 64 chars without dots or slashes)
  if (/^[a-zA-Z0-9_-]{20,64}$/.test(str) && !str.includes('/') && !str.includes('.')) {
    return str;
  }

  // https://drive.google.com/file/d/{id}/view... or /file/d/{id} or /d/{id} or /folders/{id}
  const fileDMatch = str.match(/\/(?:file\/d|folders|document\/d|spreadsheets\/d|presentation\/d|d)\/([a-zA-Z0-9_-]{15,})/i);
  if (fileDMatch && fileDMatch[1]) {
    return fileDMatch[1];
  }

  // https://drive.google.com/open?id={id} or ?id={id} or &id={id}
  const idParamMatch = str.match(/[?&]id=([a-zA-Z0-9_-]{15,})/i);
  if (idParamMatch && idParamMatch[1]) {
    return idParamMatch[1];
  }

  return null;
}

/**
 * Renombra un archivo en Google Drive dado su ID.
 * Utiliza primero el endpoint seguro del servidor y fallback a llamada directa REST.
 */
export async function renameDriveFile(
  accessToken: string,
  fileId: string,
  newFileName: string
): Promise<boolean> {
  const trimmed = newFileName.trim();
  if (!fileId || !trimmed) return false;

  // 1. Probar vía endpoint backend
  try {
    const srvRes = await fetch('/api/rename-drive-file', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileId, newFileName: trimmed }),
    });
    if (srvRes.ok) {
      const data = await srvRes.json();
      if (data.success) return true;
    }
  } catch (e) {
    console.warn('Aviso en /api/rename-drive-file, probando llamada directa:', e);
  }

  // 2. Fallback a llamada directa a Google Drive API v3
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: trimmed }),
    });
    return res.ok;
  } catch (err) {
    console.warn('Error renombrando archivo en Google Drive:', err);
    return false;
  }
}

/**
 * Searches for files in Google Drive by filename or query string,
 * optionally prioritizing a specific folder (like the project's evidence folder).
 */
export async function searchDriveFilesByName(
  accessToken: string,
  searchName: string,
  folderId?: string
): Promise<{ id: string; name: string; mimeType: string; webViewLink?: string; sizeFormatted?: string }[]> {
  if (!accessToken || !searchName || !searchName.trim()) return [];

  // Remove extension and path for broader match
  const rawClean = searchName.trim().replace(/^.*[\\/]/, '');
  const nameWithoutExt = rawClean.replace(/\.[a-zA-Z0-9]{2,5}$/, '').trim();
  const queryTerm = nameWithoutExt.length >= 3 ? nameWithoutExt : rawClean;
  const escaped = queryTerm.replace(/'/g, "\\'");

  let q = `(name contains '${escaped}' or name = '${rawClean.replace(/'/g, "\\'")}') and trashed = false`;
  if (folderId && folderId !== 'root') {
    q = `(${q}) and ('${folderId}' in parents or trashed = false)`;
  }

  try {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,mimeType,webViewLink,size)&pageSize=15&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink,
      sizeFormatted: f.size ? `${(parseInt(f.size, 10) / 1024).toFixed(1)} KB` : undefined,
    }));
  } catch (e) {
    console.warn('Error al buscar archivos en Google Drive por nombre:', e);
    return [];
  }
}

/**
 * Deletes a file directly from Google Drive.
 */
export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (res.status === 204 || res.status === 200) {
      return { success: true, message: 'Archivo eliminado correctamente de Google Drive.' };
    }

    if (res.status === 404) {
      return {
        success: true,
        message: 'El archivo ya no existía en Google Drive o ya había sido eliminado.',
      };
    }

    const errText = await res.text();
    return {
      success: false,
      message: `Error al eliminar archivo de Drive (${res.status}): ${errText}`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Excepción al conectar con Google Drive: ${err.message || err}`,
    };
  }
}

/**
 * Deletes an invoice record:
 * 1. Permanently deletes the invoice image from Google Drive
 * 2. Removes the corresponding row in the Google Sheets document
 */
export async function deleteInvoiceRecord(
  accessToken: string,
  spreadsheetId: string,
  invoice: SheetInvoiceRecord,
  evidenceFolderId?: string
): Promise<{
  sheetSuccess: boolean;
  driveSuccess: boolean;
  details: string;
}> {
  const messages: string[] = [];
  let driveSuccess = false;
  let sheetSuccess = false;

  // 1. Delete image file in Google Drive
  let fileId = extractDriveFileId(invoice.driveFileUrl);

  // If file ID couldn't be extracted from URL, search by fileName in evidenceFolderId
  if (!fileId && invoice.fileName && evidenceFolderId) {
    try {
      const cleanName = invoice.fileName.replace(/'/g, "\\'");
      const q = encodeURIComponent(
        `'${evidenceFolderId}' in parents and name = '${cleanName}' and trashed = false`
      );
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          fileId = searchData.files[0].id;
        }
      }
    } catch (e) {
      console.warn('Error localizando archivo por nombre en Drive:', e);
    }
  }

  if (fileId) {
    const driveRes = await deleteDriveFile(accessToken, fileId);
    driveSuccess = driveRes.success;
    messages.push(driveRes.message);
  } else {
    // If no file ID was found, continue to sheet deletion without crashing
    messages.push('No se encontró archivo asociado en Drive.');
    driveSuccess = true;
  }

  // 2. Delete row from Google Sheets
  try {
    // A. Fetch tab sheetId
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    let sheetId = 0;
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (invoice.sheetTitle) {
        const matchedTab = meta.sheets?.find(
          (s: any) => s.properties?.title === invoice.sheetTitle
        );
        if (matchedTab?.properties?.sheetId !== undefined) {
          sheetId = matchedTab.properties.sheetId;
        } else {
          sheetId = meta.sheets?.[0]?.properties?.sheetId ?? 0;
        }
      } else {
        sheetId = meta.sheets?.[0]?.properties?.sheetId ?? 0;
      }
    }

    // B. Fetch rows from the specific tab
    const tabPrefix = invoice.sheetTitle ? `'${invoice.sheetTitle.replace(/'/g, "''")}'!` : '';
    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabPrefix + 'A:ZZ')}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!valuesRes.ok) {
      const errText = await valuesRes.text();
      throw new Error(`Error al leer las filas de la hoja: ${errText}`);
    }

    const valData = await valuesRes.json();
    const rows: any[][] = valData.values || [];

    // Rows: index 0 is header row (A1..L1). Data rows start at index 1 (A2..L2).
    let targetZeroBasedIndex = -1;

    const headers = rows[0] || [];
    const mapping = detectColumnMapping(headers);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowInvoiceNum = mapping.invoiceNumberCol >= 0 ? String(row[mapping.invoiceNumberCol] || '').trim() : String(row[2] || '').trim();
      const rowVendor = mapping.vendorNameCol >= 0 ? String(row[mapping.vendorNameCol] || '').trim() : String(row[3] || '').trim();
      const rowDriveUrl = mapping.driveUrlCol >= 0 ? String(row[mapping.driveUrlCol] || '').trim() : String(row[10] || '').trim();
      const rowFileName = mapping.fileNameCol >= 0 ? String(row[mapping.fileNameCol] || '').trim() : String(row[11] || '').trim();

      const matchesDriveUrl =
        Boolean(invoice.driveFileUrl) && rowDriveUrl === invoice.driveFileUrl.trim();
      const matchesFileName =
        Boolean(invoice.fileName) && rowFileName === invoice.fileName.trim();
      const matchesDoc =
        Boolean(invoice.invoiceNumber) &&
        rowInvoiceNum.toLowerCase() === invoice.invoiceNumber.trim().toLowerCase() &&
        rowVendor.toLowerCase() === (invoice.vendorName || '').trim().toLowerCase();

      if (matchesDriveUrl || (matchesFileName && matchesDoc) || matchesDoc) {
        targetZeroBasedIndex = i;
        break;
      }
    }

    // Fallback if not matched by content: use rowIndex if valid
    if (
      targetZeroBasedIndex === -1 &&
      invoice.rowIndex &&
      invoice.rowIndex >= 2 &&
      invoice.rowIndex - 1 < rows.length
    ) {
      targetZeroBasedIndex = invoice.rowIndex - 1;
    }

    if (targetZeroBasedIndex === -1) {
      throw new Error(
        'No se pudo encontrar la fila correspondiente a esta factura en Google Sheets.'
      );
    }

    // Execute deleteDimension batch update on the matched row
    const deleteRequest = {
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: targetZeroBasedIndex,
          endIndex: targetZeroBasedIndex + 1,
        },
      },
    };

    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: [deleteRequest] }),
      }
    );

    if (!batchRes.ok) {
      const errText = await batchRes.text();
      throw new Error(`Error al eliminar la fila en Sheets API: ${errText}`);
    }

    sheetSuccess = true;
    messages.push('Fila de la factura eliminada de Google Sheets.');
  } catch (sheetErr: any) {
    console.error('Error al eliminar fila en Google Sheets:', sheetErr);
    messages.push(`Error en Google Sheets: ${sheetErr.message}`);
  }

  return {
    sheetSuccess,
    driveSuccess,
    details: messages.join(' '),
  };
}

/**
 * Downloads the binary or text content of any Google Drive file.
 * If it is a Google Docs or Sheets file, exports it to text/plain or CSV.
 */
export async function downloadDriveFileContent(
  accessToken: string,
  fileId: string,
  mimeType?: string
): Promise<{ base64: string; mimeType: string; text?: string }> {
  // Google Docs export
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error('Error al exportar documento de Google Docs');
    const text = await res.text();
    const base64 = btoa(unescape(encodeURIComponent(text)));
    return { base64, mimeType: 'text/plain', text };
  }

  // Google Sheets export
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error('Error al exportar hoja de cálculo de Drive');
    const text = await res.text();
    const base64 = btoa(unescape(encodeURIComponent(text)));
    return { base64, mimeType: 'text/csv', text };
  }

  // Regular binary file (PDF, XLSX, DOCX, Images, etc.)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error descargando archivo de Google Drive (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const detectedMime = res.headers.get('content-type') || mimeType || 'application/octet-stream';

  return { base64, mimeType: detectedMime };
}

/**
 * PARSES AN EXCEL BUFFER (ArrayBuffer/Uint8Array) INTO A DYNAMIC SHEET ANALYSIS
 * Preserves 100% of real sheet names, headers, columns, values, and detected types.
 */
export function analyzeExcelBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string = 'Archivo Excel',
  requestedTabTitle?: string
): DynamicSheetAnalysis {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellFormula: true });
  const tabNames = workbook.SheetNames || ['Hoja 1'];
  const tabs: SheetTabInfo[] = tabNames.map((title, index) => ({
    sheetId: index,
    title,
    index,
  }));

  const activeTab = requestedTabTitle && tabNames.includes(requestedTabTitle)
    ? requestedTabTitle
    : tabNames[0];

  const sheet = workbook.Sheets[activeTab];
  const rawGrid: any[][] = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) : [];

  return buildDynamicSheetAnalysisFromGrid(
    'local_excel_' + encodeURIComponent(fileName),
    fileName,
    tabs,
    activeTab,
    rawGrid
  );
}

/**
 * CORE REFACTOR ENGINE:
 * Reads a connected Google Sheet (or Excel in Drive) and extracts the REAL STRUCTURE.
 * The file is the sole source of truth:
 * - Real spreadsheet title
 * - Real tab names from the sheet
 * - Real headers and columns exactly as named
 * - Real rows and values
 * - Automatic detection of numeric sums, currency, dates, URLs, and tags
 */
export async function analyzeAndFetchDynamicSheet(
  accessToken: string,
  spreadsheetId: string,
  requestedTabTitle?: string
): Promise<DynamicSheetAnalysis> {
  // 1. Fetch spreadsheet metadata (real title + real tabs)
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties(title),sheets(properties(sheetId,title,index,gridProperties))`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metaRes.ok) {
    if (metaRes.status === 401) {
      const authErr: any = new Error('Tu sesión con Google Drive y Google Sheets ha expirado (401). Pulsa en "Renovar Conexión Google" para actualizar tus credenciales.');
      authErr.status = 401;
      authErr.isAuthError = true;
      throw authErr;
    }
    const errText = await metaRes.text();
    throw new Error(`Error al leer estructura de Google Sheets (${metaRes.status}): ${errText}`);
  }

  const metaData = await metaRes.json();
  const spreadsheetName = metaData.properties?.title || 'Hoja de Cálculo';
  const sheetsList: any[] = metaData.sheets || [];

  const tabs: SheetTabInfo[] = sheetsList.map((s) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title || 'Hoja',
    index: s.properties?.index ?? 0,
    rowCount: s.properties?.gridProperties?.rowCount,
    columnCount: s.properties?.gridProperties?.columnCount,
  }));

  if (tabs.length === 0) {
    tabs.push({ sheetId: 0, title: 'Hoja 1', index: 0 });
  }

  // 2. Select active tab
  const activeTab =
    requestedTabTitle && tabs.some((t) => t.title === requestedTabTitle)
      ? requestedTabTitle
      : tabs[0].title;

  // 3. Fetch all cell values of the active tab (both formatted values and formulas to preserve hyperlinks)
  const tabPrefix = `'${activeTab.replace(/'/g, "''")}'!`;
  const range = `${tabPrefix}A1:ZZ`;

  let rawGrid: any[][] = [];
  let formulasGrid: any[][] = [];

  try {
    const [valuesRes, formulasRes] = await Promise.all([
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ),
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ).catch(() => null),
    ]);

    if (!valuesRes.ok) {
      const errText = await valuesRes.text();
      console.warn('Error al leer celdas de la pestaña activa:', errText);
      return {
        spreadsheetId,
        spreadsheetName,
        tabs,
        activeTab,
        headers: [],
        columns: [],
        rows: [],
        totalRows: 0,
        numericSummaries: [],
        detectedType: 'generic',
      };
    }

    const valuesData = await valuesRes.json();
    rawGrid = valuesData.values || [];

    if (formulasRes && formulasRes.ok) {
      const formulasData = await formulasRes.json().catch(() => null);
      formulasGrid = formulasData?.values || [];
    }
  } catch (err) {
    console.error('Error fetching sheet grid:', err);
  }

  return buildDynamicSheetAnalysisFromGrid(
    spreadsheetId,
    spreadsheetName,
    tabs,
    activeTab,
    rawGrid,
    formulasGrid
  );
}

/**
 * Restringe la sumarización y cálculo de métricas únicamente a columnas explícitamente monetarias
 * vinculadas a gastos (ej. columna COSTO, IMPORTE, PRECIO, SUBTOTAL, TOTAL).
 * Ignora identificadores numéricos, índices, folios de FACTURA o campos de texto como OBSERVACION.
 */
export function isExpenseCostColumn(header: string): boolean {
  if (!header) return false;
  const h = header.trim().toLowerCase();

  // 1. Ignorar explícitamente identificadores, folios, índices, observaciones, fechas o contactos
  const ignoredPatterns = [
    /\bfactura\b/i,
    /\bfolio\b/i,
    /\bn[oº]\b/i,
    /\bn[uú]mero\b/i,
    /\bid\b/i,
    /\bc[oó]digo\b/i,
    /\b[ií]ndice\b/i,
    /\bobservaci[oó]n\b/i,
    /\bobservaciones\b/i,
    /\bitem\b/i,
    /\bposici[oó]n\b/i,
    /\btel[eé]fono\b/i,
    /\bruc\b/i,
    /\brfc\b/i,
    /\bcif\b/i,
    /\bnif\b/i,
    /\bfecha\b/i,
    /\bdate\b/i,
    /\ba[nñ]o\b/i,
    /\bmes\b/i,
    /\bd[ií]a\b/i,
    /\bcantidad\b/i,
    /\bunidades\b/i,
    /\bhoras\b/i,
    /\bconcepto\b/i,
    /\bdescripci[oó]n\b/i,
    /\bnombre\b/i,
    /\bproveedor\b/i,
  ];

  if (ignoredPatterns.some((pattern) => pattern.test(h))) {
    return false;
  }

  // 2. Comprobar si es explícitamente monetaria vinculada a costo/gasto
  const expensePatterns = [
    /\bcosto\b/i,
    /\bcostos\b/i,
    /\bcoste\b/i,
    /\bcostes\b/i,
    /\bgasto\b/i,
    /\bgastos\b/i,
    /\bimporte\b/i,
    /\bimportes\b/i,
    /\bmonto\b/i,
    /\bmontos\b/i,
    /\bprecio\b/i,
    /\bprecios\b/i,
    /\bsubtotal\b/i,
    /\btotal\b/i,
    /\btotales\b/i,
    /\bneto\b/i,
    /\bpago\b/i,
    /\bpagos\b/i,
  ];

  const hasCostWord = expensePatterns.some((p) => p.test(h));
  const hasCurrencySymbol = h.includes('$') || h.includes('€') || h.includes('usd') || h.includes('eur');

  return hasCostWord || hasCurrencySymbol;
}

/**
 * Detecta si una celda contiene una etiqueta de SUBTOTAL intermedio.
 */
export function isSubtotalCell(cellStr: string): boolean {
  if (!cellStr) return false;
  const upper = String(cellStr).trim().toUpperCase();
  // Comprobar si contiene 'SUBTOTAL' o variantes como 'SUB-TOTAL', 'SUB TOTAL'
  if (/\bSUB[- ]?TOTAL(ES)?\b/i.test(upper)) {
    return true;
  }
  // Subtotales o totales parciales por concepto/sección
  if (/\bTOTAL\s+(PARCIAL|SECCI[OÓ]N|FASE|ETAPA|GRUPO)\b/i.test(upper)) {
    return true;
  }
  return false;
}

/**
 * Detecta todas las filas intermedias etiquetadas como 'SUBTOTAL' dentro de cada tabla,
 * abstrayendo a qué grupo de filas corresponde, el concepto y su monto exacto.
 */
export function findSubtotalsInGrid(
  rows: any[][],
  subHeaders: string[],
  costColIndices: number[],
  partitionStartCol: number,
  headerRowIndex: number,
  tableId: string
): {
  subtotals: IntermediateSubtotal[];
  subtotalRowIndices: Set<number>;
} {
  const subtotals: IntermediateSubtotal[] = [];
  const subtotalRowIndices = new Set<number>();
  if (!rows || rows.length === 0) return { subtotals, subtotalRowIndices };

  let lastGroupStartIndex = 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    let subtotalFound = false;
    let label = '';
    let cellCol = -1;

    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim();
      if (isSubtotalCell(cellVal)) {
        subtotalFound = true;
        label = cellVal;
        cellCol = c;
        break;
      }
    }

    if (subtotalFound) {
      subtotalRowIndices.add(r);

      // Determinar el monto del subtotal
      let amount = 0;
      let matchedColHeader = '';
      let matchedCostColIdx: number | undefined;

      // 1. Probar en las columnas de costo de esta partición
      for (const colIdx of costColIndices) {
        const val = row[colIdx];
        const parsed = parseLocaleAmount(val);
        if (parsed > 0) {
          amount = parsed;
          matchedCostColIdx = colIdx;
          const relIdx = colIdx - partitionStartCol;
          if (relIdx >= 0 && relIdx < subHeaders.length) {
            matchedColHeader = subHeaders[relIdx];
          }
          break;
        }
      }

      // 2. Si no se encontró en costColIndices, buscar en las columnas a la derecha de la celda de subtotal
      if (amount === 0) {
        for (let c = cellCol + 1; c < row.length; c++) {
          const parsed = parseLocaleAmount(row[c]);
          if (parsed > 0) {
            amount = parsed;
            matchedCostColIdx = c;
            const relIdx = c - partitionStartCol;
            if (relIdx >= 0 && relIdx < subHeaders.length) {
              matchedColHeader = subHeaders[relIdx];
            }
            break;
          }
        }
      }

      // 3. Si aún no, buscar cualquier número positivo en la fila
      if (amount === 0) {
        for (let c = 0; c < row.length; c++) {
          if (c === cellCol) continue;
          const parsed = parseLocaleAmount(row[c]);
          if (parsed > 0) {
            amount = parsed;
            matchedCostColIdx = c;
            break;
          }
        }
      }

      // Determinar el grupo de filas al que corresponde
      const count = Math.max(0, r - lastGroupStartIndex);
      const startSheetRow = headerRowIndex + 1 + lastGroupStartIndex + 1;
      const endSheetRow = headerRowIndex + 1 + Math.max(lastGroupStartIndex, r - 1) + 1;

      // Determinar el concepto limpio
      let concept = label
        .replace(/^SUB[- ]?TOTAL(ES)?\s*[:\-]?\s*/i, '')
        .replace(/^TOTAL\s+(PARCIAL|SECCI[OÓ]N|FASE|ETAPA|GRUPO)\s*[:\-]?\s*/i, '')
        .trim();

      if (!concept) {
        // Buscar si las filas de ese grupo tienen un concepto o detalle descriptivo
        const conceptsInGroup: string[] = [];
        for (let gr = lastGroupStartIndex; gr < r; gr++) {
          const gRow = rows[gr];
          if (Array.isArray(gRow)) {
            for (let gc = 0; gc < gRow.length; gc++) {
              const val = String(gRow[gc] || '').trim();
              if (val && !parseLocaleAmount(val) && val.length > 2 && val.length < 35 && !/^\d+$/.test(val)) {
                conceptsInGroup.push(val);
                break;
              }
            }
          }
        }
        if (conceptsInGroup.length > 0) {
          concept = conceptsInGroup[0];
        } else {
          concept = `Partidas ${startSheetRow} - ${endSheetRow}`;
        }
      }

      const rangeDescription =
        count > 0
          ? (startSheetRow === endSheetRow
              ? `Fila ${startSheetRow} (1 registro)`
              : `Filas ${startSheetRow} – ${endSheetRow} (${count} registros)`)
          : `Cierre parcial en fila ${headerRowIndex + 1 + r + 1}`;

      subtotals.push({
        id: `${tableId}_subtotal_${r}`,
        rowIndexInTable: r,
        actualSheetRowIndex: headerRowIndex + 1 + r + 1,
        label,
        concept,
        rangeDescription,
        startSheetRow,
        endSheetRow,
        rowCount: count,
        amount,
        formattedAmount: `$ ${amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`,
        costColIndex: matchedCostColIdx,
        costColHeader: matchedColHeader,
        tableId,
      });

      lastGroupStartIndex = r + 1;
    }
  }

  return { subtotals, subtotalRowIndices };
}

/**
 * Respetar filas de totales del archivo:
 * Si la hoja ya contiene una celda o fila final de 'TOTAL GENERAL', 'GRAN TOTAL' o 'TOTAL',
 * extrae ese valor exacto para el cierre definitivo de la hoja en lugar de inflar la suma.
 * Se asegura de NO confundir filas intermedias de SUBTOTAL con el cierre definitivo.
 */
export function findTotalsRowInGrid(
  rows: any[][],
  headers: string[],
  costColIndices: number[]
): {
  totalsRowIndex: number;
  totalsRowValues: any[];
  declaredTotalsByCol: Record<number, number>;
  primaryDeclaredTotal?: number;
} | null {
  if (!rows || rows.length === 0) return null;

  // Inspeccionar las filas desde el final hacia arriba
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = rows[r];
    if (!row) continue;

    let isTotalRow = false;
    let totalCellCol = -1;

    for (let c = 0; c < row.length; c++) {
      const cellStr = String(row[c] || '').trim().toUpperCase();
      // Omitir si es un subtotal intermedio (se procesa independientemente)
      if (isSubtotalCell(cellStr)) {
        continue;
      }

      if (
        cellStr === 'TOTAL GENERAL' ||
        cellStr === 'GRAN TOTAL' ||
        cellStr === 'TOTAL DEFINITIVO' ||
        cellStr === 'TOTAL FINAL' ||
        cellStr === 'TOTAL' ||
        cellStr === 'TOTALES' ||
        cellStr === 'SUMA TOTAL' ||
        cellStr === 'SUMA' ||
        cellStr.startsWith('TOTAL GENERAL') ||
        cellStr.startsWith('GRAN TOTAL') ||
        cellStr.startsWith('TOTAL:') ||
        cellStr.startsWith('TOTAL ')
      ) {
        isTotalRow = true;
        totalCellCol = c;
        break;
      }
    }

    if (isTotalRow) {
      const declaredTotalsByCol: Record<number, number> = {};
      let primaryDeclaredTotal: number | undefined;

      // Extraer los valores exactos en las columnas de costo
      for (const colIdx of costColIndices) {
        const val = row[colIdx];
        const parsed = parseLocaleAmount(val);
        if (parsed > 0) {
          declaredTotalsByCol[colIdx] = parsed;
          if (primaryDeclaredTotal === undefined) {
            primaryDeclaredTotal = parsed;
          }
        }
      }

      // Si la celda de costo no tenía valor directamente en su misma columna, buscar el número a la derecha de 'TOTAL'
      if (primaryDeclaredTotal === undefined) {
        for (let c = totalCellCol + 1; c < row.length; c++) {
          const parsed = parseLocaleAmount(row[c]);
          if (parsed > 0) {
            primaryDeclaredTotal = parsed;
            if (costColIndices.length > 0) {
              declaredTotalsByCol[costColIndices[0]] = parsed;
            }
            break;
          }
        }
      }

      return {
        totalsRowIndex: r,
        totalsRowValues: row,
        declaredTotalsByCol,
        primaryDeclaredTotal,
      };
    }
  }

  return null;
}

/**
 * Detecta si una fila entera de celdas es una fila de TOTAL o cierre de hoja.
 */
export function isAnyTotalsRow(row: any[]): boolean {
  if (!Array.isArray(row)) return false;
  return row.some((c) => {
    const s = String(c || '').trim().toUpperCase();
    if (isSubtotalCell(s)) return false;
    return (
      s === 'TOTAL' ||
      s === 'TOTAL GENERAL' ||
      s === 'GRAN TOTAL' ||
      s === 'TOTAL DEFINITIVO' ||
      s === 'TOTAL FINAL' ||
      s === 'TOTALES' ||
      s === 'SUMA TOTAL' ||
      s === 'SUMA' ||
      s.startsWith('TOTAL GENERAL') ||
      s.startsWith('GRAN TOTAL') ||
      s.startsWith('TOTAL:') ||
      s.startsWith('TOTAL ') ||
      s.startsWith('=SUM(')
    );
  });
}

export interface TablePartition {
  id: string;
  title: string;
  type: 'materials' | 'labor' | 'generic';
  startCol: number;
  endCol: number;
}

/**
 * Separar tablas adyacentes:
 * Identifica y procesa las tablas de forma independiente: la tabla principal de compras/materiales
 * (columnas A a E: CONCEPTO, COSTO, FECHA, FACTURA) y la tabla de mano de obra/EPP
 * (NOMBRE OBRERO, COSTO, etc.). No intenta combinarlas en un único registro plano si comparten la misma fila.
 */
export function detectTablePartitions(headers: string[], rawRows: any[][]): TablePartition[] {
  let splitColIndex = -1;
  let partition2Type: 'labor' | 'generic' = 'generic';
  let partition2Title = 'Mano de Obra y EPP';

  for (let c = 1; c < headers.length; c++) {
    const h = (headers[c] || '').trim().toLowerCase();

    // Palabras clave de inicio de tabla de Mano de Obra / EPP / Obrero
    if (
      /\b(nombre obrero|obrero|obreros|trabajador|trabajadores|personal|empleado|mano de obra|epp|cuadrilla|operario)\b/i.test(h)
    ) {
      splitColIndex = c;
      partition2Type = 'labor';
      partition2Title = 'Mano de Obra y EPP';
      break;
    }

    // Columna separadora en blanco seguida de nueva cabecera
    const isBlankHeader = !h || /^columna\s*\d+$/i.test(h);
    const isColumnMostlyEmpty = rawRows.slice(0, 15).every((r) => !r[c] || String(r[c]).trim() === '');
    if (isBlankHeader && isColumnMostlyEmpty && c + 1 < headers.length) {
      const nextH = (headers[c + 1] || '').trim().toLowerCase();
      if (nextH && !/^columna\s*\d+$/i.test(nextH)) {
        splitColIndex = c + 1;
        if (/\b(obrero|trabajador|personal|epp|mano de obra|empleado)\b/i.test(nextH)) {
          partition2Type = 'labor';
          partition2Title = 'Mano de Obra y EPP';
        } else {
          partition2Title = `Tabla Secundaria (${headers[c + 1]})`;
        }
        break;
      }
    }
  }

  // Si no se detectó por palabra clave pero hay un segundo encabezado COSTO a partir de la columna 3
  if (splitColIndex === -1) {
    let costCount = 0;
    for (let c = 0; c < headers.length; c++) {
      if (/\b(costo|coste|monto)\b/i.test(headers[c])) {
        costCount++;
        if (costCount >= 2 && c >= 3) {
          splitColIndex = c - 1;
          partition2Title = 'Mano de Obra y EPP';
          partition2Type = 'labor';
          break;
        }
      }
    }
  }

  if (splitColIndex > 0 && splitColIndex < headers.length) {
    return [
      {
        id: 'table_materials',
        title: 'Compras y Materiales',
        type: 'materials',
        startCol: 0,
        endCol: splitColIndex - 1,
      },
      {
        id: 'table_labor',
        title: partition2Title,
        type: partition2Type,
        startCol: splitColIndex,
        endCol: headers.length - 1,
      },
    ];
  }

  return [
    {
      id: 'table_main',
      title: 'Tabla Principal',
      type: 'generic',
      startCol: 0,
      endCol: headers.length - 1,
    },
  ];
}

/**
 * Construye un sub-objeto DynamicSubTable independiente para una partición de columnas específica.
 */
function buildSubTableFromPartition(
  partition: TablePartition,
  headers: string[],
  dataRows: any[][],
  headerRowIndex: number,
  activeTab: string,
  formulasGrid?: any[][]
): DynamicSubTable {
  const subHeaders = (headers || []).slice(partition.startCol, partition.endCol + 1);
  const costColIndices = subHeaders
    .map((h, i) => (isExpenseCostColumn(h) ? partition.startCol + i : -1))
    .filter((i) => i >= 0);

  // Filtrar filas que tengan datos reales en las columnas de esta partición
  const subRawRows = (dataRows || []).filter((r) =>
    Array.isArray(r) && r.slice(partition.startCol, partition.endCol + 1).some((c) => c !== undefined && String(c).trim() !== '')
  );

  // Comprobar si existe fila de 'TOTAL' de cierre definitivo en esta sub-tabla
  const totalRowResult = findTotalsRowInGrid(subRawRows, subHeaders, costColIndices);
  
  // Identificar todas las filas intermedias etiquetadas como 'SUBTOTAL'
  const { subtotals: intermediateSubtotals, subtotalRowIndices } = findSubtotalsInGrid(
    subRawRows,
    subHeaders,
    costColIndices,
    partition.startCol,
    headerRowIndex,
    partition.id
  );

  // Filas para la tabla excluyendo cualquier fila de TOTAL definitivo
  const itemRows = (subRawRows || []).filter((r, idx) => {
    if (totalRowResult && idx === totalRowResult.totalsRowIndex) return false;
    if (isAnyTotalsRow(r)) return false;
    return true;
  });

  // Filas puras de gastos unitarios: excluyen TOTAL definitivo Y excluyen filas de SUBTOTAL intermedio
  // Directiva: "No sumes los valores de estas filas al listado de gastos unitarios para no inflar el gran total"
  const unitExpenseRows = (subRawRows || []).filter((r, idx) => {
    if (totalRowResult && idx === totalRowResult.totalsRowIndex) return false;
    if (subtotalRowIndices.has(idx)) return false;
    if (isAnyTotalsRow(r)) return false;
    return true;
  });

  // Análisis de columnas para esta partición (calculado estrictamente con gastos unitarios puros)
  const columns: DynamicColumnMeta[] = subHeaders.map((header, relIdx) => {
    const absColIdx = partition.startCol + relIdx;
    const colValues = (unitExpenseRows || [])
      .map((r) => (Array.isArray(r) ? r[absColIdx] : undefined))
      .filter((v) => v !== undefined && String(v).trim() !== '');

    let numericCount = 0;
    let dateCount = 0;
    let urlCount = 0;
    let totalSum = 0;

    const sampleValues = colValues.slice(0, 5);

    colValues.forEach((val) => {
      const strVal = String(val).trim();
      if (/^https?:\/\//i.test(strVal) || strVal.includes('drive.google.com')) {
        urlCount++;
        return;
      }
      if (
        /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(strVal) ||
        /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/.test(strVal)
      ) {
        dateCount++;
        return;
      }
      // Interpreta comas como miles y puntos como decimales: valor.replace(/,/g, '')
      const num = parseLocaleAmount(strVal);
      if (num !== 0 || strVal === '0' || strVal === '0.00') {
        numericCount++;
        totalSum += num;
      }
    });

    const isMostlyNumeric = colValues.length > 0 && numericCount / colValues.length >= 0.6;
    const isMostlyDate = colValues.length > 0 && dateCount / colValues.length >= 0.5;
    const isMostlyUrl = colValues.length > 0 && urlCount / colValues.length >= 0.5;

    let colType: DynamicColumnMeta['type'] = 'text';
    const isExpense = isExpenseCostColumn(header);

    if (isMostlyUrl || /enlace|drive|url/i.test(header)) {
      colType = 'url';
    } else if (isMostlyDate || /fecha|date/i.test(header)) {
      colType = 'date';
    } else if (isExpense) {
      colType = 'currency';
    } else if (isMostlyNumeric) {
      colType = 'number';
    } else if (/categor|estado|status|fase|cargo/i.test(header)) {
      colType = 'tag';
    }

    // Determinar la métrica de TOTAL GENERAL:
    // Reservada únicamente para el cierre definitivo de la hoja o la suma de los subtotales por concepto
    let sumVal: number | undefined = undefined;
    if (isExpense) {
      if (totalRowResult && totalRowResult.declaredTotalsByCol[absColIdx] !== undefined) {
        // Cierre definitivo declarado en la fila TOTAL del archivo
        sumVal = totalRowResult.declaredTotalsByCol[absColIdx];
      } else if (intermediateSubtotals.length > 0) {
        // Suma de dichos subtotales por concepto
        sumVal = intermediateSubtotals.reduce((acc, s) => acc + s.amount, 0);
      } else {
        // Suma de gastos unitarios puros
        sumVal = totalSum;
      }
    }

    return {
      key: `${partition.id}_col_${relIdx}`,
      header,
      index: relIdx,
      type: colType,
      sampleValues,
      sum: sumVal,
      avg: isExpense && numericCount > 0 ? totalSum / numericCount : undefined,
      count: colValues.length,
      isNumeric: isExpense || isMostlyNumeric,
    };
  });

  // Construir filas dinámicas correspondientes a este bloque
  const rows: DynamicSheetRow[] = (itemRows || []).map((row, rIdx) => {
    const realRowIndex = headerRowIndex + 1 + rIdx + 1;
    const safeRow = Array.isArray(row) ? row : [];
    const values = safeRow.slice(partition.startCol, partition.endCol + 1);
    const cellsByHeader: Record<string, any> = {};
    let driveFileUrl = '';
    let fileName = '';

    // Check corresponding formula row if formulasGrid is present
    const formulaRow = (formulasGrid && formulasGrid[realRowIndex - 1]) ? formulasGrid[realRowIndex - 1] : [];

    subHeaders.forEach((h, cIdx) => {
      const cellVal = values[cIdx] !== undefined ? values[cIdx] : '';
      cellsByHeader[h] = cellVal;
      const strVal = String(cellVal);
      const isNotSpreadsheetUrl = (url: string) =>
        !url.includes('docs.google.com/spreadsheets') &&
        !url.includes('/spreadsheets/') &&
        !url.includes('google.com/spreadsheets');

      if (
        (strVal.includes('drive.google.com') || strVal.startsWith('http')) &&
        isNotSpreadsheetUrl(strVal)
      ) {
        driveFileUrl = strVal;
      }
      if (/\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/i.test(strVal)) {
        fileName = strVal;
      }

      // Check if formula cell contains a HYPERLINK formula
      const absCol = partition.startCol + cIdx;
      const formulaVal = formulaRow[absCol] !== undefined ? String(formulaRow[absCol]) : '';
      if (formulaVal.startsWith('=')) {
        const linkMatch =
          formulaVal.match(/=HYPERLINK\("([^"]+)"(?:,\s*"([^"]*)")?/i) ||
          formulaVal.match(/=HIPERVINCULO\("([^"]+)"(?:,\s*"([^"]*)")?/i);
        if (linkMatch && linkMatch[1] && isNotSpreadsheetUrl(linkMatch[1])) {
          driveFileUrl = linkMatch[1];
          if (linkMatch[2] && !fileName) {
            const candidate = linkMatch[2].trim();
            if (
              candidate &&
              !/^ver\s+(factura|foto|comprobante|archivo)/i.test(candidate) &&
              candidate !== 'Enlace Factura Drive'
            ) {
              fileName = candidate;
            }
          }
        }
      }
    });

    // If not yet found, scan entire row in safeRow and formulaRow for any Drive or web link
    if (!driveFileUrl) {
      const isNotSpreadsheetUrl = (url: string) =>
        !url.includes('docs.google.com/spreadsheets') &&
        !url.includes('/spreadsheets/') &&
        !url.includes('google.com/spreadsheets');

      const maxCol = Math.max(safeRow.length, formulaRow.length);
      for (let c = 0; c < maxCol; c++) {
        const cVal = safeRow[c] !== undefined ? String(safeRow[c]).trim() : '';
        const fVal = formulaRow[c] !== undefined ? String(formulaRow[c]).trim() : '';
        if (
          (cVal.includes('drive.google.com') || (cVal.startsWith('http') && !cVal.includes('sheets.google.com'))) &&
          isNotSpreadsheetUrl(cVal)
        ) {
          driveFileUrl = cVal;
          break;
        }
        if (fVal.startsWith('=')) {
          const m = fVal.match(/=HYPERLINK\("([^"]+)"/i) || fVal.match(/=HIPERVINCULO\("([^"]+)"/i);
          if (m && m[1] && isNotSpreadsheetUrl(m[1])) {
            driveFileUrl = m[1];
            break;
          }
        }
      }
    }

    const isSubtotal = subtotalRowIndices.has(rIdx);
    const subtotalInfo = isSubtotal
      ? intermediateSubtotals.find((s) => s.rowIndexInTable === rIdx)
      : undefined;

    const isTotal = isAnyTotalsRow(safeRow);

    // Mapeo de factura: NO generar registro de factura para filas de SUBTOTAL ni de TOTAL
    // para no computarlas como gasto individual ni duplicar facturas con el total del MVP
    const mapping = detectColumnMapping(subHeaders);
    let invoiceRecord: SheetInvoiceRecord | undefined;

    if (!isSubtotal && !isTotal && (mapping.totalAmountCol >= 0 || mapping.vendorNameCol >= 0 || mapping.invoiceNumberCol >= 0)) {
      const rawMappedDrive = mapping.driveUrlCol >= 0 ? String(values[mapping.driveUrlCol] || '').trim() : '';
      // Also check formula at driveUrlCol
      let formulaDrive = '';
      if (mapping.driveUrlCol >= 0) {
        const absDriveCol = partition.startCol + mapping.driveUrlCol;
        const fVal = formulaRow[absDriveCol] !== undefined ? String(formulaRow[absDriveCol]) : '';
        const fMatch = fVal.match(/=HYPERLINK\("([^"]+)"/i) || fVal.match(/=HIPERVINCULO\("([^"]+)"/i);
        if (fMatch && fMatch[1]) formulaDrive = fMatch[1];
      }

      const effectiveDriveUrl =
        formulaDrive ||
        (rawMappedDrive && (/^(https?:\/\/|[a-zA-Z0-9_-]{20,})/i.test(rawMappedDrive) || extractDriveFileId(rawMappedDrive) !== null)
          ? rawMappedDrive
          : driveFileUrl);

      invoiceRecord = {
        id: `${activeTab}_${partition.id}_${realRowIndex}`,
        rowIndex: realRowIndex,
        sheetTitle: activeTab,
        registrationDate: mapping.registrationDateCol >= 0 ? String(values[mapping.registrationDateCol] || '') : '',
        issueDate: mapping.issueDateCol >= 0 ? String(values[mapping.issueDateCol] || '') : '',
        invoiceNumber: mapping.invoiceNumberCol >= 0 ? String(values[mapping.invoiceNumberCol] || '') : '',
        vendorName: mapping.vendorNameCol >= 0 ? String(values[mapping.vendorNameCol] || '') : '',
        vendorTaxId: mapping.vendorTaxIdCol >= 0 ? String(values[mapping.vendorTaxIdCol] || '') : '',
        concept: mapping.conceptCol >= 0 ? String(values[mapping.conceptCol] || '') : '',
        category: mapping.categoryCol >= 0 ? String(values[mapping.categoryCol] || 'Varios') : 'Varios',
        subtotal: mapping.subtotalCol >= 0 ? parseLocaleAmount(values[mapping.subtotalCol]) : 0,
        taxAmount: mapping.taxAmountCol >= 0 ? parseLocaleAmount(values[mapping.taxAmountCol]) : 0,
        totalAmount: mapping.totalAmountCol >= 0 ? parseLocaleAmount(values[mapping.totalAmountCol]) : 0,
        driveFileUrl: effectiveDriveUrl,
        fileName: mapping.fileNameCol >= 0 ? String(values[mapping.fileNameCol] || '') : fileName,
        quantity: mapping.quantityCol >= 0 ? parseLocaleAmount(values[mapping.quantityCol]) : undefined,
        unitPrice: mapping.unitPriceCol >= 0 ? parseLocaleAmount(values[mapping.unitPriceCol]) : undefined,
        rawRowData: row,
      };

      if (effectiveDriveUrl) {
        driveFileUrl = effectiveDriveUrl;
      }
    }

    return {
      id: `${activeTab}_${partition.id}_${realRowIndex}`,
      rowIndex: realRowIndex,
      tableId: partition.id,
      values,
      cellsByHeader,
      driveFileUrl: invoiceRecord?.driveFileUrl || driveFileUrl,
      fileName: invoiceRecord?.fileName || fileName,
      rawRowData: row,
      invoiceRecord,
      isSubtotalRow: isSubtotal,
      subtotalInfo,
      isTotalRow: isTotal,
    };
  });

  // Fila de totales etiquetada si existe en el archivo
  let totalsRow: DynamicSheetRow | undefined;
  if (totalRowResult) {
    const totalsValues = totalRowResult.totalsRowValues.slice(partition.startCol, partition.endCol + 1);
    const totalsCells: Record<string, any> = {};
    subHeaders.forEach((h, cIdx) => {
      totalsCells[h] = totalsValues[cIdx] !== undefined ? totalsValues[cIdx] : '';
    });
    totalsRow = {
      id: `${activeTab}_${partition.id}_total`,
      rowIndex: headerRowIndex + 1 + totalRowResult.totalsRowIndex + 1,
      tableId: partition.id,
      values: totalsValues,
      cellsByHeader: totalsCells,
      rawRowData: totalRowResult.totalsRowValues,
      isTotalRow: true,
    };
  }

  // TOTAL GENERAL definitivo:
  // 1. Cierre definitivo de la hoja si existe fila TOTAL
  // 2. O la suma de los subtotales por concepto detectados
  // 3. O la suma de gastos unitarios puros
  let grandTotal: number | undefined = undefined;
  let isDeclaredTotal = false;

  if (totalRowResult && totalRowResult.primaryDeclaredTotal !== undefined) {
    grandTotal = totalRowResult.primaryDeclaredTotal;
    isDeclaredTotal = true;
  } else if (intermediateSubtotals.length > 0) {
    grandTotal = intermediateSubtotals.reduce((acc, s) => acc + s.amount, 0);
    isDeclaredTotal = true;
  } else {
    const primaryExpenseCol = columns.find((c) => isExpenseCostColumn(c.header));
    grandTotal = primaryExpenseCol?.sum;
  }

  // Resumen numérico restringido estrictamente a columnas explícitamente monetarias vinculadas a gastos (COSTO)
  const numericSummaries = columns
    .filter((c) => isExpenseCostColumn(c.header) && c.sum !== undefined)
    .map((c) => {
      const absColIdx = partition.startCol + c.index;
      const isDeclared =
        totalRowResult?.declaredTotalsByCol[absColIdx] !== undefined || intermediateSubtotals.length > 0;
      return {
        header: c.header,
        sum: c.sum!,
        avg: c.avg,
        isDeclaredTotal: isDeclared,
      };
    });

  return {
    id: partition.id,
    title: partition.title,
    type: partition.type,
    startCol: partition.startCol,
    endCol: partition.endCol,
    headers: subHeaders,
    columns,
    rows,
    totalRows: rows.length,
    numericSummaries,
    declaredTotal: grandTotal,
    totalsRow,
    intermediateSubtotals,
  };
}

/**
 * Common grid parser that turns any 2D row array into a complete DynamicSheetAnalysis,
 * respecting all Source-of-Truth directives:
 * 1. Locale: Comas como miles y puntos como decimales, sin truncar moneda.
 * 2. Columnas a sumarizar: Solo columnas explícitamente monetarias vinculadas a gastos (COSTO).
 * 3. Separación de tablas adyacentes: Procesa compras/materiales y mano de obra/EPP de forma independiente.
 * 4. Respetar fila de TOTAL: Extrae el valor exacto declarado en el archivo si existe.
 */
function buildDynamicSheetAnalysisFromGrid(
  spreadsheetId: string,
  spreadsheetName: string,
  tabs: SheetTabInfo[],
  activeTab: string,
  rawGrid: any[][],
  formulasGrid?: any[][]
): DynamicSheetAnalysis {
  if (!rawGrid || rawGrid.length === 0) {
    return {
      spreadsheetId,
      spreadsheetName,
      tabs,
      activeTab,
      headers: [],
      columns: [],
      rows: [],
      totalRows: 0,
      numericSummaries: [],
      detectedType: 'generic',
    };
  }

  // 1. Detect header row: scan first 4 rows to find the row with the most non-empty text cells
  let headerRowIndex = 0;
  let maxNonEmptyCells = 0;

  for (let r = 0; r < Math.min(rawGrid.length, 5); r++) {
    const row = rawGrid[r] || [];
    const nonEmptyCount = row.filter((c) => c !== undefined && String(c).trim() !== '').length;
    if (nonEmptyCount > maxNonEmptyCells) {
      maxNonEmptyCells = nonEmptyCount;
      headerRowIndex = r;
    }
  }

  const rawHeaderRow = rawGrid[headerRowIndex] || [];
  const maxCols = Math.max(
    rawHeaderRow.length,
    ...rawGrid.slice(headerRowIndex + 1).map((r) => (r ? r.length : 0)),
    1
  );

  // Extract real headers
  const headers: string[] = [];
  for (let c = 0; c < maxCols; c++) {
    const rawVal = rawHeaderRow[c];
    const headerStr = rawVal !== undefined && String(rawVal).trim() !== ''
      ? String(rawVal).trim()
      : `Columna ${c + 1}`;
    headers.push(headerStr);
  }

  const dataRows = rawGrid.slice(headerRowIndex + 1).filter((r) =>
    r && r.some((c) => c !== undefined && String(c).trim() !== '')
  );

  // 2. Detectar particiones de tablas adyacentes (Compras vs Mano de Obra)
  const partitions = detectTablePartitions(headers, dataRows);
  const subTables: DynamicSubTable[] = (partitions || []).map((p) =>
    buildSubTableFromPartition(p, headers, dataRows, headerRowIndex, activeTab, formulasGrid)
  );

  const defaultSubTable: DynamicSubTable = {
    id: 'table_main',
    title: 'Tabla Principal',
    type: 'generic',
    startCol: 0,
    endCol: Math.max((headers || []).length - 1, 0),
    headers: headers || [],
    columns: [],
    rows: [],
    totalRows: 0,
    numericSummaries: [],
  };

  // La tabla principal por defecto es la primera partición (ej. Compras y Materiales)
  const primarySubTable = subTables[0] || defaultSubTable;

  // Determinar tipo detectado
  let detectedType: DynamicSheetAnalysis['detectedType'] = 'generic';
  const allHeadersStr = (headers || []).join(' ').toLowerCase();

  if (allHeadersStr.includes('factura') || allHeadersStr.includes('invoice') || (allHeadersStr.includes('proveedor') && allHeadersStr.includes('total'))) {
    detectedType = 'invoices';
  } else if (allHeadersStr.includes('presupuesto') || allHeadersStr.includes('partida') || allHeadersStr.includes('coste')) {
    detectedType = 'budget';
  } else if (allHeadersStr.includes('material') || allHeadersStr.includes('cantidad') || allHeadersStr.includes('unidad')) {
    detectedType = 'materials';
  }

  return {
    spreadsheetId,
    spreadsheetName,
    tabs: tabs || [],
    activeTab,
    headers: primarySubTable.headers || headers || [],
    columns: primarySubTable.columns || [],
    rows: primarySubTable.rows || [],
    totalRows: primarySubTable.totalRows || 0,
    numericSummaries: primarySubTable.numericSummaries || [],
    declaredTotal: primarySubTable.declaredTotal,
    grandTotal: primarySubTable.declaredTotal,
    intermediateSubtotals: primarySubTable.intermediateSubtotals || [],
    subTables: subTables.length > 0 ? subTables : [defaultSubTable],
    detectedType,
  };
}

/**
 * Deletes any row in a Google Sheet by its sheetTitle and rowIndex.
 */
export async function deleteDynamicSheetRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rowIndex: number
): Promise<boolean> {
  const tabs = await getSpreadsheetTabs(accessToken, spreadsheetId);
  const targetTab = tabs.find((t) => t.title.toLowerCase() === sheetTitle.toLowerCase()) || tabs[0];
  const targetSheetId = targetTab ? targetTab.sheetId : 0;

  const deleteRequest = {
    deleteDimension: {
      range: {
        sheetId: targetSheetId,
        dimension: 'ROWS',
        startIndex: rowIndex - 1,
        endIndex: rowIndex,
      },
    },
  };

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: [deleteRequest] }),
    }
  );

  return res.ok;
}


export interface SyncDriveLinksResult {
  success: boolean;
  totalInvoices: number;
  updatedLinksCount: number;
  alreadyLinkedCount: number;
  unlinkedCount: number;
  scannedFilesCount: number;
  poorlyProcessedInvoices: SheetInvoiceRecord[];
  details: string[];
}

/**
 * Analyzes the project's Drive folder for uploaded invoice photos / files,
 * cross-references with Google Sheets rows, fixes missing Drive photo hyperlinks,
 * and identifies invoices that may have been poorly processed (missing amounts, vendors, or concepts).
 */
export async function syncProjectDriveLinksAndFixInvoices(
  accessToken: string,
  project: ProjectFolder,
  sheetTitle?: string
): Promise<SyncDriveLinksResult> {
  const details: string[] = [];
  let updatedLinksCount = 0;
  let alreadyLinkedCount = 0;
  let unlinkedCount = 0;
  const poorlyProcessedInvoices: SheetInvoiceRecord[] = [];

  // 1. Get evidence / project folder files in Google Drive (scanning both evidence folder and project folder + subfolders)
  const targetFolders = [project.evidenceFolderId, project.id].filter(Boolean) as string[];
  let driveFiles: DriveHierarchicalItem[] = [];
  const visitedFolders = new Set<string>();
  const folderQueue = [...targetFolders];

  while (folderQueue.length > 0 && visitedFolders.size < 12) {
    const curF = folderQueue.shift()!;
    if (visitedFolders.has(curF)) continue;
    visitedFolders.add(curF);

    try {
      const contents = await fetchFolderDirectContents(accessToken, curF);
      for (const item of contents.items || []) {
        if (item.itemType === 'folder') {
          if (!visitedFolders.has(item.id)) folderQueue.push(item.id);
        } else {
          if (!driveFiles.some((df) => df.id === item.id)) {
            driveFiles.push(item);
          }
        }
      }
    } catch (err: any) {
      details.push(`Aviso al listar carpeta de Drive (${curF}): ${err.message}`);
    }
  }

  // Broad search if no files were found in target folders
  if (driveFiles.length === 0) {
    try {
      const q = encodeURIComponent("trashed = false and (mimeType contains 'image/' or mimeType = 'application/pdf')");
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink,createdTime)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res.ok) {
        const d = await res.json();
        for (const f of d.files || []) {
          driveFiles.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            itemType: f.mimeType === 'application/pdf' ? 'pdf' : 'image',
            webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          });
        }
      }
    } catch (e) {
      console.warn('Error en búsqueda de archivos de Drive:', e);
    }
  }

  details.push(`Total archivos de fotos/documentos escaneados en Google Drive: ${driveFiles.length}.`);

  // 2. Fetch current invoices from the Google Sheet
  const activeTab = sheetTitle || project.activeSheetTab || 'Facturas';
  const spreadsheetId = project.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error('El proyecto no tiene una hoja de cálculo de Google Sheets asociada.');
  }

  const tabPrefix = activeTab ? `'${activeTab.replace(/'/g, "''")}'!` : '';
  const range = `${tabPrefix}A1:ZZ`;
  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!sheetRes.ok) {
    throw new Error('No se pudo acceder a la hoja de Google Sheets para sincronizar.');
  }

  const sheetData = await sheetRes.json();
  const rawRows: any[][] = sheetData.values || [];
  if (rawRows.length < 2) {
    return {
      success: true,
      totalInvoices: 0,
      updatedLinksCount: 0,
      alreadyLinkedCount: 0,
      unlinkedCount: 0,
      scannedFilesCount: driveFiles.length,
      poorlyProcessedInvoices: [],
      details: ['La hoja de cálculo está vacía o solo contiene encabezados.'],
    };
  }

  // Detect real header row from first 5 rows
  let headerRowIndex = 0;
  let maxNonEmpty = 0;
  for (let r = 0; r < Math.min(rawRows.length, 5); r++) {
    const row = rawRows[r] || [];
    const count = row.filter((c) => c !== undefined && String(c).trim() !== '').length;
    if (count > maxNonEmpty) {
      maxNonEmpty = count;
      headerRowIndex = r;
    }
  }

  const headers = [...(rawRows[headerRowIndex] || [])];
  let mapping = detectColumnMapping(headers);

  // Ensure "Enlace Factura Drive" column exists
  if (mapping.driveUrlCol === -1) {
    const newColIdx = headers.length;
    headers.push('Enlace Factura Drive');
    mapping.driveUrlCol = newColIdx;
    try {
      const headerCell = `${tabPrefix}${colIndexToA1Notation(newColIdx)}${headerRowIndex + 1}`;
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(headerCell)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [['Enlace Factura Drive']] }),
        }
      );
      details.push('Se añadió la columna "Enlace Factura Drive" a la hoja de Google Sheets.');
    } catch (e) {
      console.warn('Error adding header column:', e);
    }
  }

  // Track assigned file IDs to avoid duplicated pairings when multiple unlinked files exist
  const assignedFileIds = new Set<string>();
  const updatesToApply: { rowIndex: number; colIndex: number; value: string }[] = [];
  const unlinkedRowIndices: { rowIndex: number; invNum: string; vendor: string; fileName: string }[] = [];

  for (let idx = headerRowIndex + 1; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const hasData = row && row.some((cell) => cell !== undefined && String(cell).trim() !== '');
    if (!hasData) continue;

    const rowIndex = idx + 1; // 1-indexed for Sheets

    let rawDriveVal = mapping.driveUrlCol >= 0 ? String(row[mapping.driveUrlCol] || '').trim() : '';
    let fileId = extractDriveFileId(rawDriveVal);

    // Extract link if formula =HYPERLINK("...", "...")
    if (rawDriveVal.startsWith('=')) {
      const fMatch = rawDriveVal.match(/=HYPERLINK\("([^"]+)"/i) || rawDriveVal.match(/=HIPERVINCULO\("([^"]+)"/i);
      if (fMatch && fMatch[1]) {
        fileId = extractDriveFileId(fMatch[1]) || fileId;
        rawDriveVal = fMatch[1];
      }
    }

    // If not found in driveUrlCol, scan all cells of the row for any Drive or web link
    if (!fileId && (!rawDriveVal || !rawDriveVal.startsWith('http'))) {
      for (let c = 0; c < row.length; c++) {
        const cVal = String(row[c] || '').trim();
        if (cVal.includes('drive.google.com') || (cVal.startsWith('http') && !cVal.includes('sheets.google.com'))) {
          rawDriveVal = cVal;
          fileId = extractDriveFileId(cVal);
          break;
        }
        if (cVal.startsWith('=')) {
          const fMatch = cVal.match(/=HYPERLINK\("([^"]+)"/i) || cVal.match(/=HIPERVINCULO\("([^"]+)"/i);
          if (fMatch && fMatch[1]) {
            rawDriveVal = fMatch[1];
            fileId = extractDriveFileId(fMatch[1]);
            break;
          }
        }
      }
    }

    const hasValidLink = rawDriveVal.length > 0 && (rawDriveVal.startsWith('http') || rawDriveVal.startsWith('=HYPERLINK') || rawDriveVal.startsWith('=HIPERVINCULO') || fileId !== null);

    const invNum = mapping.invoiceNumberCol >= 0 ? String(row[mapping.invoiceNumberCol] || '').trim() : '';
    const vendor = mapping.vendorNameCol >= 0 ? String(row[mapping.vendorNameCol] || '').trim() : '';
    const fileName = mapping.fileNameCol >= 0 ? String(row[mapping.fileNameCol] || '').trim() : '';
    const totalVal = mapping.totalAmountCol >= 0 ? parseCurrencyNumber(row[mapping.totalAmountCol]) : 0;
    const concept = mapping.conceptCol >= 0 ? String(row[mapping.conceptCol] || '').trim() : '';
    const issueDate = mapping.issueDateCol >= 0 ? String(row[mapping.issueDateCol] || '').trim() : '';

    // Check if invoice seems poorly processed
    const isPoorlyProcessed =
      totalVal === 0 ||
      !vendor ||
      vendor.toLowerCase() === 'sin proveedor' ||
      !concept ||
      !issueDate;

    if (isPoorlyProcessed) {
      poorlyProcessedInvoices.push({
        id: `${activeTab}_r${rowIndex}_${invNum || idx}`,
        rowIndex,
        sheetTitle: activeTab,
        registrationDate: mapping.registrationDateCol >= 0 ? String(row[mapping.registrationDateCol] || '') : '',
        issueDate,
        invoiceNumber: invNum,
        vendorName: vendor,
        vendorTaxId: mapping.vendorTaxIdCol >= 0 ? String(row[mapping.vendorTaxIdCol] || '') : '',
        concept,
        category: mapping.categoryCol >= 0 ? String(row[mapping.categoryCol] || 'Varios') : 'Varios',
        subtotal: mapping.subtotalCol >= 0 ? parseCurrencyNumber(row[mapping.subtotalCol]) : 0,
        taxAmount: mapping.taxAmountCol >= 0 ? parseCurrencyNumber(row[mapping.taxAmountCol]) : 0,
        totalAmount: totalVal,
        driveFileUrl: hasValidLink ? (rawDriveVal.startsWith('http') ? rawDriveVal : (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '')) : '',
        fileName,
        rawRowData: row,
      });
    }

    if (hasValidLink) {
      alreadyLinkedCount++;
      if (fileId) assignedFileIds.add(fileId);
      // If it's a raw URL without HYPERLINK formula, update it to HYPERLINK for Google Sheets interactivity
      if (rawDriveVal.startsWith('http') && !rawDriveVal.startsWith('=HYPERLINK') && !rawDriveVal.startsWith('=HIPERVINCULO')) {
        updatesToApply.push({
          rowIndex,
          colIndex: mapping.driveUrlCol,
          value: `=HYPERLINK("${rawDriveVal}", "Ver Factura en Drive")`,
        });
      }
    } else {
      // Find matching file in Drive
      let matchedFile: DriveHierarchicalItem | undefined;

      // Match 1: By exact or normalized fileName
      if (fileName) {
        const cleanF = fileName.toLowerCase().trim();
        matchedFile = driveFiles.find((f) => !assignedFileIds.has(f.id) && f.name.toLowerCase().trim() === cleanF);
      }
      // Match 2: By invoice number contained in file name
      if (!matchedFile && invNum && invNum !== 'S/N') {
        const cleanInv = invNum.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        matchedFile = driveFiles.find((f) => {
          if (assignedFileIds.has(f.id)) return false;
          const cleanName = f.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          return cleanName.includes(cleanInv);
        });
      }
      // Match 3: By vendor name contained in file name
      if (!matchedFile && vendor && vendor.toLowerCase() !== 'sin proveedor') {
        const cleanVen = vendor.toLowerCase().slice(0, 7);
        matchedFile = driveFiles.find((f) => !assignedFileIds.has(f.id) && f.name.toLowerCase().includes(cleanVen));
      }
      // Match 4: By numeric amount or row index
      if (!matchedFile && totalVal > 0) {
        const totalInt = Math.round(totalVal).toString();
        if (totalInt.length >= 4) {
          matchedFile = driveFiles.find((f) => !assignedFileIds.has(f.id) && f.name.includes(totalInt));
        }
      }

      if (matchedFile) {
        assignedFileIds.add(matchedFile.id);
        const fileUrl = matchedFile.webViewLink || `https://drive.google.com/file/d/${matchedFile.id}/view`;
        const formula = `=HYPERLINK("${fileUrl}", "Ver Factura en Drive")`;
        updatesToApply.push({
          rowIndex,
          colIndex: mapping.driveUrlCol,
          value: formula,
        });
        if (mapping.fileNameCol >= 0 && !fileName) {
          updatesToApply.push({
            rowIndex,
            colIndex: mapping.fileNameCol,
            value: matchedFile.name,
          });
        }
        updatedLinksCount++;
        details.push(`Fila ${rowIndex}: Se vinculó el archivo "${matchedFile.name}" a la factura "${invNum || vendor || 'S/N'}".`);
      } else {
        unlinkedRowIndices.push({ rowIndex, invNum, vendor, fileName });
      }
    }
  }

  // Sequential fallback: Pair any remaining unlinked rows with remaining unassigned Drive files
  const unassignedFiles = driveFiles.filter((df) => !assignedFileIds.has(df.id));
  for (let i = 0; i < Math.min(unlinkedRowIndices.length, unassignedFiles.length); i++) {
    const unRow = unlinkedRowIndices[i];
    const f = unassignedFiles[i];
    assignedFileIds.add(f.id);

    const fileUrl = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`;
    const formula = `=HYPERLINK("${fileUrl}", "Ver Factura en Drive")`;
    updatesToApply.push({
      rowIndex: unRow.rowIndex,
      colIndex: mapping.driveUrlCol,
      value: formula,
    });
    if (mapping.fileNameCol >= 0 && !unRow.fileName) {
      updatesToApply.push({
        rowIndex: unRow.rowIndex,
        colIndex: mapping.fileNameCol,
        value: f.name,
      });
    }
    updatedLinksCount++;
    details.push(`Fila ${unRow.rowIndex}: Se asoció automáticamente la foto "${f.name}".`);
  }

  unlinkedCount = Math.max(0, unlinkedRowIndices.length - unassignedFiles.length);

  // Apply batch updates to Google Sheets
  if (updatesToApply.length > 0) {
    const dataUpdates = updatesToApply.map((u) => ({
      range: `${tabPrefix}${colIndexToA1Notation(u.colIndex)}${u.rowIndex}`,
      values: [[u.value]],
    }));

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: dataUpdates,
        }),
      }
    );
  }

  // Also invoke backend repair endpoint to ensure deep sync
  try {
    await fetch('/api/repair-invoice-links', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        spreadsheetId,
        sheetTitle: activeTab,
        folderId: project.evidenceFolderId || project.id,
      }),
    });
  } catch (backendErr) {
    console.warn('Backend repair aviso:', backendErr);
  }

  return {
    success: true,
    totalInvoices: rawRows.length - 1,
    updatedLinksCount,
    alreadyLinkedCount,
    unlinkedCount,
    scannedFilesCount: driveFiles.length,
    poorlyProcessedInvoices,
    details,
  };
}

/**
 * Re-analiza en lote con IA todas las facturas con errores de lectura o datos incompletos.
 */
export async function reprocessAllInvoicesWithAi(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  folderId?: string,
  evidenceFolderId?: string,
  invoicesToReprocess?: any[],
  reprocessAllMode?: boolean
): Promise<{
  success: boolean;
  reprocessedCount: number;
  totalRequested: number;
  message: string;
  results?: any[];
}> {
  const fetchRes = await safeJsonFetch<{
    success: boolean;
    reprocessedCount: number;
    totalRequested: number;
    message: string;
    results?: any[];
    error?: string;
  }>('/api/reprocess-all-invoices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      spreadsheetId,
      sheetTitle,
      folderId,
      evidenceFolderId,
      invoicesToReprocess,
      reprocessAllMode: Boolean(reprocessAllMode),
    }),
  });

  if (!fetchRes.ok || !fetchRes.data?.success) {
    throw new Error(fetchRes.error || fetchRes.data?.error || `Error al reprocesar facturas con IA (${fetchRes.status})`);
  }

  return fetchRes.data;
}
