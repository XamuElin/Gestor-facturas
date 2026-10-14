import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db, auth } from './firebaseAuth';
import { ProjectFolder } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Clean undefined fields recursively before writing to Firestore
function removeUndefinedFields<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefinedFields(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = removeUndefinedFields(value);
      }
    }
    return result as T;
  }
  return obj;
}

// Convert Firestore document to ProjectFolder
function docToProject(data: any): ProjectFolder {
  return {
    id: data.id,
    name: data.name,
    baseFolderId: data.baseFolderId,
    baseFolderName: data.baseFolderName,
    baseLocationName: data.baseLocationName,
    webViewLink: data.webViewLink,
    evidenceFolderId: data.evidenceFolderId,
    evidenceFolderName: data.evidenceFolderName,
    evidenceFolderUrl: data.evidenceFolderUrl,
    evidenceParentId: data.evidenceParentId,
    evidenceParentName: data.evidenceParentName,
    spreadsheetId: data.spreadsheetId,
    spreadsheetName: data.spreadsheetName,
    spreadsheetUrl: data.spreadsheetUrl,
    spreadsheetParentId: data.spreadsheetParentId,
    spreadsheetParentName: data.spreadsheetParentName,
  };
}

// Clean undefined fields before writing to Firestore
function projectToFirestoreData(project: ProjectFolder, userId: string): Record<string, any> {
  const data: Record<string, any> = {
    id: project.id,
    name: project.name,
    userId: userId,
  };

  if (project.baseFolderId) data.baseFolderId = project.baseFolderId;
  if (project.baseFolderName) data.baseFolderName = project.baseFolderName;
  if (project.baseLocationName) data.baseLocationName = project.baseLocationName;
  if (project.webViewLink) data.webViewLink = project.webViewLink;
  if (project.evidenceFolderId) data.evidenceFolderId = project.evidenceFolderId;
  if (project.evidenceFolderName) data.evidenceFolderName = project.evidenceFolderName;
  if (project.evidenceFolderUrl) data.evidenceFolderUrl = project.evidenceFolderUrl;
  if (project.evidenceParentId) data.evidenceParentId = project.evidenceParentId;
  if (project.evidenceParentName) data.evidenceParentName = project.evidenceParentName;
  if (project.spreadsheetId) data.spreadsheetId = project.spreadsheetId;
  if (project.spreadsheetName) data.spreadsheetName = project.spreadsheetName;
  if (project.spreadsheetUrl) data.spreadsheetUrl = project.spreadsheetUrl;
  if (project.spreadsheetParentId) data.spreadsheetParentId = project.spreadsheetParentId;
  if (project.spreadsheetParentName) data.spreadsheetParentName = project.spreadsheetParentName;

  return removeUndefinedFields(data);
}

/**
 * Load all project folders for a user from Firestore.
 * Does NOT fallback to or create sample projects.
 */
export async function loadUserProjectsFromFirestore(userId: string): Promise<ProjectFolder[]> {
  const path = `users/${userId}/projects`;
  try {
    const colRef = collection(db, path);
    const snapshot = await getDocs(colRef);
    const projects: ProjectFolder[] = [];
    snapshot.forEach((d) => {
      const p = docToProject(d.data());
      // Filter out any stale dummy project if existed
      if (p.name !== 'Residencial Los Olivos') {
        projects.push(p);
      }
    });
    return projects;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Save a project folder to Firestore.
 */
export async function saveProjectToFirestore(userId: string, project: ProjectFolder): Promise<void> {
  const path = `users/${userId}/projects/${project.id}`;
  try {
    const docRef = doc(db, path);
    const data = projectToFirestoreData(project, userId);
    await setDoc(docRef, data, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Delete a project folder from Firestore.
 * IMPORTANT: This ONLY removes the project reference from the user's database / dropdown.
 * It NEVER touches or deletes anything in Google Drive or Google Sheets.
 */
export async function deleteProjectFromFirestore(userId: string, projectId: string): Promise<void> {
  const path = `users/${userId}/projects/${projectId}`;
  try {
    const docRef = doc(db, path);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Update project configuration details in Firestore.
 * Uses setDoc with merge: true to avoid 'No document to update' when the document
 * was not yet created or exists under a newly linked Drive folder.
 */
export async function updateProjectInFirestore(
  userId: string,
  projectId: string,
  updates: Partial<ProjectFolder>
): Promise<void> {
  const path = `users/${userId}/projects/${projectId}`;
  try {
    const docRef = doc(db, path);
    const cleanUpdates = removeUndefinedFields({
      ...updates,
      id: projectId,
      userId: userId,
    });
    // setDoc with { merge: true } creates the doc if missing, or updates if existing
    await setDoc(docRef, cleanUpdates, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
