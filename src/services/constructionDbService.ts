import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from './firebaseAuth';
import {
  WorkerCatalogItem,
  BitacoraRecord,
  NominaRecord,
  NominaParametros,
  DEFAULT_NOMINA_PARAMETROS,
  FacturaSismoItem,
  InventarioRecord,
  AbonoRecordItem,
} from '../utils/constructionCalculations';

function getUserId(): string {
  return auth.currentUser?.uid || 'local_user';
}

function isFirebaseAuthReady(): boolean {
  return Boolean(auth.currentUser && auth.currentUser.uid);
}

function getCollectionRef(projectId: string, subcollection: string) {
  const uid = getUserId();
  return collection(db, 'users', uid, 'projects', projectId, subcollection);
}

function getDocRef(projectId: string, subcollection: string, docId: string) {
  const uid = getUserId();
  return doc(db, 'users', uid, 'projects', projectId, subcollection, docId);
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

// ---------------------------------------------------------------------------
// 1. CATÁLOGO DE TRABAJADORES (Sin datos semilla)
// ---------------------------------------------------------------------------

export async function fetchWorkersFromDb(projectId: string): Promise<WorkerCatalogItem[]> {
  if (isFirebaseAuthReady()) {
    try {
      const colRef = getCollectionRef(projectId, 'workers');
      const snapshot = await getDocs(colRef);
      if (!snapshot.empty) {
        const list = snapshot.docs.map((d) => d.data() as WorkerCatalogItem);
        localStorage.setItem(`svh_workers_${projectId}`, JSON.stringify(list));
        return list;
      }
    } catch (err) {
      console.warn('[Firestore] Error fetching workers, checking local mirror:', err);
    }
  }

  // Fallback a localStorage
  try {
    const local = localStorage.getItem(`svh_workers_${projectId}`);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Inicio completamente vacío por defecto (Cero datos semilla)
  return [];
}

export async function saveWorkerToDb(projectId: string, worker: WorkerCatalogItem): Promise<void> {
  const payload: WorkerCatalogItem = {
    ...worker,
    obraId: projectId,
    origen: worker.origen || 'manual',
    creadoEn: worker.creadoEn || Date.now(),
    actualizadoEn: Date.now(),
  };

  // 1. Guardar localmente
  try {
    const local = JSON.parse(localStorage.getItem(`svh_workers_${projectId}`) || '[]');
    const next = [payload, ...local.filter((w: WorkerCatalogItem) => w.id !== payload.id)];
    localStorage.setItem(`svh_workers_${projectId}`, JSON.stringify(next));
  } catch {}

  // 2. Persistir en Firestore
  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'workers', payload.id);
      await setDoc(docRef, removeUndefinedFields(payload), { merge: true });
    } catch (err: any) {
      console.error('[Firestore] Error saving worker:', err);
      throw new Error(`Error al guardar en base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteWorkerFromDb(projectId: string, workerId: string): Promise<void> {
  try {
    const local = JSON.parse(localStorage.getItem(`svh_workers_${projectId}`) || '[]');
    const next = local.filter((w: WorkerCatalogItem) => w.id !== workerId);
    localStorage.setItem(`svh_workers_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'workers', workerId);
      await deleteDoc(docRef);
    } catch (err: any) {
      console.error('[Firestore] Error deleting worker:', err);
      throw new Error(`Error al eliminar de base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteMultipleWorkersFromDb(projectId: string, ids: string[]): Promise<void> {
  const idSet = new Set(ids);
  try {
    const local = JSON.parse(localStorage.getItem(`svh_workers_${projectId}`) || '[]');
    const next = local.filter((w: WorkerCatalogItem) => !idSet.has(w.id));
    localStorage.setItem(`svh_workers_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    for (const id of ids) {
      try {
        const docRef = getDocRef(projectId, 'workers', id);
        await deleteDoc(docRef);
      } catch (err) {
        console.warn(`[Firestore] Error deleting worker ${id}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. FACTURAS ("ADECUACIONES SISMO") (Sin datos semilla)
// ---------------------------------------------------------------------------

export async function fetchFacturasSismoFromDb(projectId: string): Promise<FacturaSismoItem[]> {
  if (isFirebaseAuthReady()) {
    try {
      const colRef = getCollectionRef(projectId, 'facturas');
      const snapshot = await getDocs(colRef);
      if (!snapshot.empty) {
        const list = snapshot.docs.map((d) => d.data() as FacturaSismoItem);
        list.sort((a, b) => a.consecutivo - b.consecutivo);
        localStorage.setItem(`svh_facturas_sismo_${projectId}`, JSON.stringify(list));
        return list;
      }
    } catch (err) {
      console.warn('[Firestore] Error fetching facturas sismo:', err);
    }
  }

  try {
    const local = localStorage.getItem(`svh_facturas_sismo_${projectId}`);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Inicio completamente vacío
  return [];
}

export async function saveFacturaSismoToDb(projectId: string, factura: FacturaSismoItem): Promise<void> {
  const payload: FacturaSismoItem = {
    ...factura,
    obraId: projectId,
    origen: factura.origen || 'manual',
    creadoEn: factura.creadoEn || Date.now(),
    actualizadoEn: Date.now(),
  };

  try {
    const local = JSON.parse(localStorage.getItem(`svh_facturas_sismo_${projectId}`) || '[]');
    const next = [payload, ...local.filter((f: FacturaSismoItem) => f.id !== payload.id)].sort(
      (a, b) => a.consecutivo - b.consecutivo
    );
    localStorage.setItem(`svh_facturas_sismo_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'facturas', payload.id);
      await setDoc(docRef, removeUndefinedFields(payload), { merge: true });
    } catch (err: any) {
      console.error('[Firestore] Error saving factura sismo:', err);
      throw new Error(`Error al guardar en base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteFacturaSismoFromDb(projectId: string, facturaId: string): Promise<void> {
  try {
    const local = JSON.parse(localStorage.getItem(`svh_facturas_sismo_${projectId}`) || '[]');
    const next = local.filter((f: FacturaSismoItem) => f.id !== facturaId);
    localStorage.setItem(`svh_facturas_sismo_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'facturas', facturaId);
      await deleteDoc(docRef);
    } catch (err: any) {
      console.error('[Firestore] Error deleting factura sismo:', err);
      throw new Error(`Error al eliminar de base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteMultipleFacturasSismoFromDb(projectId: string, ids: string[]): Promise<void> {
  const idSet = new Set(ids);
  try {
    const local = JSON.parse(localStorage.getItem(`svh_facturas_sismo_${projectId}`) || '[]');
    const next = local.filter((f: FacturaSismoItem) => !idSet.has(f.id));
    localStorage.setItem(`svh_facturas_sismo_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    for (const id of ids) {
      try {
        const docRef = getDocRef(projectId, 'facturas', id);
        await deleteDoc(docRef);
      } catch (err) {
        console.warn(`[Firestore] Error deleting factura ${id}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. MANO DE OBRA (BITÁCORAS) (Sin datos semilla)
// ---------------------------------------------------------------------------

export async function fetchBitacorasFromDb(projectId: string): Promise<BitacoraRecord[]> {
  if (isFirebaseAuthReady()) {
    try {
      const colRef = getCollectionRef(projectId, 'bitacoras');
      const snapshot = await getDocs(colRef);
      if (!snapshot.empty) {
        const list = snapshot.docs.map((d) => d.data() as BitacoraRecord);
        list.sort((a, b) => b.fechaFin.localeCompare(a.fechaFin));
        localStorage.setItem(`svh_bitacoras_${projectId}`, JSON.stringify(list));
        return list;
      }
    } catch (err) {
      console.warn('[Firestore] Error fetching bitacoras:', err);
    }
  }

  try {
    const local = localStorage.getItem(`svh_bitacoras_${projectId}`);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Inicio completamente vacío
  return [];
}

export async function saveBitacoraToDb(projectId: string, bitacora: BitacoraRecord): Promise<void> {
  const payload: BitacoraRecord = {
    ...bitacora,
    obraId: projectId,
    origen: bitacora.origen || 'manual',
    creadoEn: bitacora.creadoEn || Date.now(),
    actualizadoEn: Date.now(),
  };

  try {
    const local = JSON.parse(localStorage.getItem(`svh_bitacoras_${projectId}`) || '[]');
    const next = [payload, ...local.filter((b: BitacoraRecord) => b.id !== payload.id)].sort(
      (a, b) => b.fechaFin.localeCompare(a.fechaFin)
    );
    localStorage.setItem(`svh_bitacoras_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'bitacoras', payload.id);
      await setDoc(docRef, removeUndefinedFields(payload), { merge: true });
    } catch (err: any) {
      console.error('[Firestore] Error saving bitacora:', err);
      throw new Error(`Error al guardar en base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteBitacoraFromDb(projectId: string, bitacoraId: string): Promise<void> {
  try {
    const local = JSON.parse(localStorage.getItem(`svh_bitacoras_${projectId}`) || '[]');
    const next = local.filter((b: BitacoraRecord) => b.id !== bitacoraId);
    localStorage.setItem(`svh_bitacoras_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'bitacoras', bitacoraId);
      await deleteDoc(docRef);
    } catch (err: any) {
      console.error('[Firestore] Error deleting bitacora:', err);
      throw new Error(`Error al eliminar de base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteMultipleBitacorasFromDb(projectId: string, ids: string[]): Promise<void> {
  const idSet = new Set(ids);
  try {
    const local = JSON.parse(localStorage.getItem(`svh_bitacoras_${projectId}`) || '[]');
    const next = local.filter((b: BitacoraRecord) => !idSet.has(b.id));
    localStorage.setItem(`svh_bitacoras_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    for (const id of ids) {
      try {
        const docRef = getDocRef(projectId, 'bitacoras', id);
        await deleteDoc(docRef);
      } catch (err) {
        console.warn(`[Firestore] Error deleting bitacora ${id}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. NÓMINAS (QUINCENALES) Y AJUSTES (Sin datos semilla)
// ---------------------------------------------------------------------------

export async function fetchPayrollSettingsFromDb(projectId: string): Promise<NominaParametros> {
  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'payrollSettings', 'global');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as NominaParametros;
      }
    } catch {}
  }

  try {
    const local = localStorage.getItem(`svh_payroll_settings_${projectId}`);
    if (local) return JSON.parse(local);
  } catch {}

  return DEFAULT_NOMINA_PARAMETROS;
}

export async function savePayrollSettingsToDb(projectId: string, settings: NominaParametros): Promise<void> {
  localStorage.setItem(`svh_payroll_settings_${projectId}`, JSON.stringify(settings));
  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'payrollSettings', 'global');
      await setDoc(docRef, removeUndefinedFields(settings), { merge: true });
    } catch (err: any) {
      console.error('[Firestore] Error saving payroll settings:', err);
      throw new Error(`Error al guardar configuración de nómina: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function fetchNominasFromDb(projectId: string): Promise<NominaRecord[]> {
  if (isFirebaseAuthReady()) {
    try {
      const colRef = getCollectionRef(projectId, 'nominas');
      const snapshot = await getDocs(colRef);
      if (!snapshot.empty) {
        const list = snapshot.docs.map((d) => d.data() as NominaRecord);
        list.sort((a, b) => b.titulo.localeCompare(a.titulo));
        localStorage.setItem(`svh_nominas_${projectId}`, JSON.stringify(list));
        return list;
      }
    } catch (err) {
      console.warn('[Firestore] Error fetching nominas:', err);
    }
  }

  try {
    const local = localStorage.getItem(`svh_nominas_${projectId}`);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Inicio completamente vacío
  return [];
}

export async function saveNominaToDb(projectId: string, nomina: NominaRecord): Promise<void> {
  const payload: NominaRecord = {
    ...nomina,
    obraId: projectId,
    origen: nomina.origen || 'manual',
    creadoEn: nomina.creadoEn || Date.now(),
    actualizadoEn: Date.now(),
  };

  try {
    const local = JSON.parse(localStorage.getItem(`svh_nominas_${projectId}`) || '[]');
    const next = [payload, ...local.filter((n: NominaRecord) => n.id !== payload.id)].sort(
      (a, b) => b.titulo.localeCompare(a.titulo)
    );
    localStorage.setItem(`svh_nominas_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'nominas', payload.id);
      await setDoc(docRef, removeUndefinedFields(payload), { merge: true });
    } catch (err: any) {
      console.error('[Firestore] Error saving nomina:', err);
      throw new Error(`Error al guardar en base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteNominaFromDb(projectId: string, nominaId: string): Promise<void> {
  try {
    const local = JSON.parse(localStorage.getItem(`svh_nominas_${projectId}`) || '[]');
    const next = local.filter((n: NominaRecord) => n.id !== nominaId);
    localStorage.setItem(`svh_nominas_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'nominas', nominaId);
      await deleteDoc(docRef);
    } catch (err: any) {
      console.error('[Firestore] Error deleting nomina:', err);
      throw new Error(`Error al eliminar de base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteMultipleNominasFromDb(projectId: string, ids: string[]): Promise<void> {
  const idSet = new Set(ids);
  try {
    const local = JSON.parse(localStorage.getItem(`svh_nominas_${projectId}`) || '[]');
    const next = local.filter((n: NominaRecord) => !idSet.has(n.id));
    localStorage.setItem(`svh_nominas_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    for (const id of ids) {
      try {
        const docRef = getDocRef(projectId, 'nominas', id);
        await deleteDoc(docRef);
      } catch (err) {
        console.warn(`[Firestore] Error deleting nomina ${id}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. INVENTARIO (Sin datos semilla)
// ---------------------------------------------------------------------------

export async function fetchInventarioFromDb(projectId: string): Promise<InventarioRecord[]> {
  if (isFirebaseAuthReady()) {
    try {
      const colRef = getCollectionRef(projectId, 'inventario');
      const snapshot = await getDocs(colRef);
      if (!snapshot.empty) {
        const list = snapshot.docs.map((d) => d.data() as InventarioRecord);
        list.sort((a, b) => a.nombre.localeCompare(b.nombre));
        localStorage.setItem(`svh_inventario_${projectId}`, JSON.stringify(list));
        return list;
      }
    } catch (err) {
      console.warn('[Firestore] Error fetching inventario:', err);
    }
  }

  try {
    const local = localStorage.getItem(`svh_inventario_${projectId}`);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Inicio completamente vacío
  return [];
}

export async function saveInventarioItemToDb(projectId: string, item: InventarioRecord): Promise<void> {
  const payload: InventarioRecord = {
    ...item,
    obraId: projectId,
    origen: item.origen || 'manual',
    creadoEn: item.creadoEn || Date.now(),
    actualizadoEn: Date.now(),
  };

  try {
    const local = JSON.parse(localStorage.getItem(`svh_inventario_${projectId}`) || '[]');
    const next = [payload, ...local.filter((i: InventarioRecord) => i.id !== payload.id)].sort(
      (a, b) => a.nombre.localeCompare(b.nombre)
    );
    localStorage.setItem(`svh_inventario_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'inventario', payload.id);
      await setDoc(docRef, removeUndefinedFields(payload), { merge: true });
    } catch (err: any) {
      console.error('[Firestore] Error saving inventario item:', err);
      throw new Error(`Error al guardar en base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteInventarioItemFromDb(projectId: string, itemId: string): Promise<void> {
  try {
    const local = JSON.parse(localStorage.getItem(`svh_inventario_${projectId}`) || '[]');
    const next = local.filter((i: InventarioRecord) => i.id !== itemId);
    localStorage.setItem(`svh_inventario_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'inventario', itemId);
      await deleteDoc(docRef);
    } catch (err: any) {
      console.error('[Firestore] Error deleting inventario item:', err);
      throw new Error(`Error al eliminar de base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteMultipleInventarioFromDb(projectId: string, ids: string[]): Promise<void> {
  const idSet = new Set(ids);
  try {
    const local = JSON.parse(localStorage.getItem(`svh_inventario_${projectId}`) || '[]');
    const next = local.filter((i: InventarioRecord) => !idSet.has(i.id));
    localStorage.setItem(`svh_inventario_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    for (const id of ids) {
      try {
        const docRef = getDocRef(projectId, 'inventario', id);
        await deleteDoc(docRef);
      } catch (err) {
        console.warn(`[Firestore] Error deleting inventario ${id}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6. ABONOS (Sin datos semilla)
// ---------------------------------------------------------------------------

export async function fetchAbonosFromDb(projectId: string): Promise<AbonoRecordItem[]> {
  if (isFirebaseAuthReady()) {
    try {
      const colRef = getCollectionRef(projectId, 'abonos');
      const snapshot = await getDocs(colRef);
      if (!snapshot.empty) {
        const list = snapshot.docs.map((d) => d.data() as AbonoRecordItem);
        list.sort((a, b) => a.consecutivo - b.consecutivo);
        localStorage.setItem(`svh_abonos_items_${projectId}`, JSON.stringify(list));
        return list;
      }
    } catch (err) {
      console.warn('[Firestore] Error fetching abonos:', err);
    }
  }

  try {
    const local = localStorage.getItem(`svh_abonos_items_${projectId}`);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Inicio completamente vacío
  return [];
}

export async function saveAbonoToDb(projectId: string, abono: AbonoRecordItem): Promise<void> {
  const payload: AbonoRecordItem = {
    ...abono,
    obraId: projectId,
    origen: abono.origen || 'manual',
    creadoEn: abono.creadoEn || Date.now(),
    actualizadoEn: Date.now(),
  };

  try {
    const local = JSON.parse(localStorage.getItem(`svh_abonos_items_${projectId}`) || '[]');
    const next = [payload, ...local.filter((a: AbonoRecordItem) => a.id !== payload.id)].sort(
      (a, b) => a.consecutivo - b.consecutivo
    );
    localStorage.setItem(`svh_abonos_items_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'abonos', payload.id);
      await setDoc(docRef, removeUndefinedFields(payload), { merge: true });
    } catch (err: any) {
      console.error('[Firestore] Error saving abono:', err);
      throw new Error(`Error al guardar en base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteAbonoFromDb(projectId: string, abonoId: string): Promise<void> {
  try {
    const local = JSON.parse(localStorage.getItem(`svh_abonos_items_${projectId}`) || '[]');
    const next = local.filter((a: AbonoRecordItem) => a.id !== abonoId);
    localStorage.setItem(`svh_abonos_items_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    try {
      const docRef = getDocRef(projectId, 'abonos', abonoId);
      await deleteDoc(docRef);
    } catch (err: any) {
      console.error('[Firestore] Error deleting abono:', err);
      throw new Error(`Error al eliminar de base de datos: ${err?.message || 'Error de permisos'}`);
    }
  }
}

export async function deleteMultipleAbonosFromDb(projectId: string, ids: string[]): Promise<void> {
  const idSet = new Set(ids);
  try {
    const local = JSON.parse(localStorage.getItem(`svh_abonos_items_${projectId}`) || '[]');
    const next = local.filter((a: AbonoRecordItem) => !idSet.has(a.id));
    localStorage.setItem(`svh_abonos_items_${projectId}`, JSON.stringify(next));
  } catch {}

  if (isFirebaseAuthReady()) {
    for (const id of ids) {
      try {
        const docRef = getDocRef(projectId, 'abonos', id);
        await deleteDoc(docRef);
      } catch (err) {
        console.warn(`[Firestore] Error deleting abono ${id}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. ZONA DE PELIGRO: VACIAR OBRA Y ELIMINAR OBRA EN BASE DE DATOS
// ---------------------------------------------------------------------------

export async function getObraRecordCounts(projectId: string): Promise<{
  totalRecords: number;
  facturas: number;
  bitacoras: number;
  nominas: number;
  workers: number;
  inventario: number;
  abonos: number;
}> {
  const [f, b, n, w, inv, ab] = await Promise.all([
    fetchFacturasSismoFromDb(projectId),
    fetchBitacorasFromDb(projectId),
    fetchNominasFromDb(projectId),
    fetchWorkersFromDb(projectId),
    fetchInventarioFromDb(projectId),
    fetchAbonosFromDb(projectId),
  ]);

  return {
    totalRecords: f.length + b.length + n.length + w.length + inv.length + ab.length,
    facturas: f.length,
    bitacoras: b.length,
    nominas: n.length,
    workers: w.length,
    inventario: inv.length,
    abonos: ab.length,
  };
}

export async function vaciarObraDb(projectId: string): Promise<void> {
  const subcollections = ['workers', 'facturas', 'bitacoras', 'nominas', 'inventario', 'abonos'];

  if (isFirebaseAuthReady()) {
    for (const sub of subcollections) {
      try {
        const colRef = getCollectionRef(projectId, sub);
        const snapshot = await getDocs(colRef);
        for (const d of snapshot.docs) {
          await deleteDoc(d.ref).catch(() => {});
        }
      } catch (err) {
        console.warn(`[Firestore] Error vaciando subcolección ${sub}:`, err);
      }
    }
  }

  // Limpiar localStorage
  localStorage.removeItem(`svh_workers_${projectId}`);
  localStorage.removeItem(`svh_facturas_sismo_${projectId}`);
  localStorage.removeItem(`svh_bitacoras_${projectId}`);
  localStorage.removeItem(`svh_nominas_${projectId}`);
  localStorage.removeItem(`svh_inventario_${projectId}`);
  localStorage.removeItem(`svh_abonos_items_${projectId}`);
  localStorage.removeItem(`svh_payroll_settings_${projectId}`);
}

// ---------------------------------------------------------------------------
// 8. DETECCIÓN Y REVISIÓN DE REGISTROS LEGACY SIN ORIGEN REGISTRADO
// ---------------------------------------------------------------------------

export interface UnassignedRecordItem {
  id: string;
  subcollection: 'facturas' | 'bitacoras' | 'nominas' | 'workers' | 'inventario' | 'abonos';
  title: string;
  details: string;
}

export async function scanRecordsWithoutOrigin(projectId: string): Promise<UnassignedRecordItem[]> {
  const unassigned: UnassignedRecordItem[] = [];

  const [f, b, n, w, inv, ab] = await Promise.all([
    fetchFacturasSismoFromDb(projectId),
    fetchBitacorasFromDb(projectId),
    fetchNominasFromDb(projectId),
    fetchWorkersFromDb(projectId),
    fetchInventarioFromDb(projectId),
    fetchAbonosFromDb(projectId),
  ]);

  for (const item of f) {
    if (!item.origen) {
      unassigned.push({
        id: item.id,
        subcollection: 'facturas',
        title: `Factura #${item.consecutivo}: ${item.concepto}`,
        details: `$${Number(item.costo).toLocaleString('es-CO')} - ${item.fecha}`,
      });
    }
  }

  for (const item of b) {
    if (!item.origen) {
      unassigned.push({
        id: item.id,
        subcollection: 'bitacoras',
        title: `Bitácora: ${item.titulo}`,
        details: `${item.filas?.length || 0} trabajadores - Total: $${Number(item.total).toLocaleString('es-CO')}`,
      });
    }
  }

  for (const item of n) {
    if (!item.origen) {
      unassigned.push({
        id: item.id,
        subcollection: 'nominas',
        title: `Nómina: ${item.titulo}`,
        details: `${item.filas?.length || 0} trabajadores - Total: $${Number(item.total).toLocaleString('es-CO')}`,
      });
    }
  }

  for (const item of w) {
    if (!item.origen) {
      unassigned.push({
        id: item.id,
        subcollection: 'workers',
        title: `Trabajador: ${item.nombre}`,
        details: `${item.rol.toUpperCase()} - ${item.tipo}`,
      });
    }
  }

  for (const item of inv) {
    if (!item.origen) {
      unassigned.push({
        id: item.id,
        subcollection: 'inventario',
        title: `Material: ${item.nombre}`,
        details: `${item.cantidad} ${item.unidad}`,
      });
    }
  }

  for (const item of ab) {
    if (!item.origen) {
      unassigned.push({
        id: item.id,
        subcollection: 'abonos',
        title: `Abono #${item.consecutivo}: ${item.item}`,
        details: `$${Number(item.costo).toLocaleString('es-CO')} - ${item.fecha}`,
      });
    }
  }

  return unassigned;
}

export async function deleteUnassignedRecords(
  projectId: string,
  records: UnassignedRecordItem[]
): Promise<void> {
  for (const r of records) {
    try {
      if (r.subcollection === 'facturas') await deleteFacturaSismoFromDb(projectId, r.id);
      else if (r.subcollection === 'bitacoras') await deleteBitacoraFromDb(projectId, r.id);
      else if (r.subcollection === 'nominas') await deleteNominaFromDb(projectId, r.id);
      else if (r.subcollection === 'workers') await deleteWorkerFromDb(projectId, r.id);
      else if (r.subcollection === 'inventario') await deleteInventarioItemFromDb(projectId, r.id);
      else if (r.subcollection === 'abonos') await deleteAbonoFromDb(projectId, r.id);
    } catch (err) {
      console.warn(`Error deleting unassigned record ${r.id}:`, err);
    }
  }
}

export async function markRecordsAsManual(
  projectId: string,
  records: UnassignedRecordItem[]
): Promise<void> {
  const [f, b, n, w, inv, ab] = await Promise.all([
    fetchFacturasSismoFromDb(projectId),
    fetchBitacorasFromDb(projectId),
    fetchNominasFromDb(projectId),
    fetchWorkersFromDb(projectId),
    fetchInventarioFromDb(projectId),
    fetchAbonosFromDb(projectId),
  ]);

  const targetIds = new Set(records.map((r) => r.id));

  for (const item of f) {
    if (targetIds.has(item.id)) {
      await saveFacturaSismoToDb(projectId, { ...item, origen: 'manual' });
    }
  }
  for (const item of b) {
    if (targetIds.has(item.id)) {
      await saveBitacoraToDb(projectId, { ...item, origen: 'manual' });
    }
  }
  for (const item of n) {
    if (targetIds.has(item.id)) {
      await saveNominaToDb(projectId, { ...item, origen: 'manual' });
    }
  }
  for (const item of w) {
    if (targetIds.has(item.id)) {
      await saveWorkerToDb(projectId, { ...item, origen: 'manual' });
    }
  }
  for (const item of inv) {
    if (targetIds.has(item.id)) {
      await saveInventarioItemToDb(projectId, { ...item, origen: 'manual' });
    }
  }
  for (const item of ab) {
    if (targetIds.has(item.id)) {
      await saveAbonoToDb(projectId, { ...item, origen: 'manual' });
    }
  }
}
