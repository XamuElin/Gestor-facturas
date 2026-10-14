import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  FolderOpen,
  X,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  FileText,
  Clock,
  Sparkles,
  ShieldAlert,
  ChevronDown,
  Info,
} from 'lucide-react';
import { ProjectFolder } from '../types';
import {
  uploadAndEnqueueInvoice,
  fetchProjectJobs,
  retryInvoiceJob,
  BackendInvoiceJob,
  wakeLock,
} from '../services/invoiceQueueService';
import { formatCOP } from '../utils/formatters';

interface UploadInvoicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectFolder;
  accessToken?: string;
  onInvoiceCompleted?: () => void;
}

interface LocalFileQueueItem {
  id: string;
  file: File;
  fileName: string;
  status: 'comprimiendo' | 'subiendo' | 'recibida' | 'error';
  progress: number;
  message: string;
  error?: string;
  jobId?: string;
}

export const UploadInvoicesModal: React.FC<UploadInvoicesModalProps> = ({
  isOpen,
  onClose,
  project,
  accessToken,
  onInvoiceCompleted,
}) => {
  const [localQueue, setLocalQueue] = useState<LocalFileQueueItem[]>([]);
  const [backendJobs, setBackendJobs] = useState<BackendInvoiceJob[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'subir' | 'cola'>('subir');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Cargar trabajos de esta obra y configurar polling cada 3s (Requisito 2.e)
  const loadJobs = async () => {
    if (!project?.id) return;
    const jobs = await fetchProjectJobs(project.id);
    setBackendJobs(jobs);
  };

  useEffect(() => {
    if (isOpen && project?.id) {
      loadJobs();
      const interval = setInterval(loadJobs, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, project?.id]);

  // Manejar selección de archivos (fotos o PDFs)
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList: File[] = Array.from(files);
    // Limpiar input
    e.target.value = '';

    const newItems: LocalFileQueueItem[] = fileList.map((f, idx) => ({
      id: `local-${Date.now()}-${idx}`,
      file: f,
      fileName: f.name,
      status: 'comprimiendo',
      progress: 10,
      message: 'Preparando documento...',
    }));

    setLocalQueue((prev) => [...newItems, ...prev]);
    setActiveTab('subir');
    setIsUploading(true);

    // Activar Screen Wake Lock para que el móvil no apague la pantalla durante la subida (Requisito 6)
    await wakeLock.request();

    // Procesar subidas de forma secuencial / paralela controlada
    for (const item of newItems) {
      try {
        setLocalQueue((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: 'subiendo',
                  progress: 45,
                  message: 'Subiendo… no cierres hasta ver ✓ Recibida. Después puedes cerrar la app: seguiremos leyendo.',
                }
              : it
          )
        );

        const targetFolder = project.evidenceFolderId || project.id;
        const res = await uploadAndEnqueueInvoice({
          file: item.file,
          projectId: project.id,
          projectName: project.name,
          targetFolderId: targetFolder,
          spreadsheetId: project.spreadsheetId,
          sheetTab: project.activeSheetTab || 'Control Facturas',
          accessToken,
          onProgress: (pct, msg) => {
            setLocalQueue((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, progress: pct, message: msg } : it))
            );
          },
        });

        if (res.success) {
          setLocalQueue((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    status: 'recibida',
                    progress: 100,
                    message: res.isDuplicate
                      ? `✓ Recibida (${res.duplicateReason || 'Aviso duplicado'})`
                      : '✓ Recibida. Ya puedes cerrar la app: seguiremos leyendo en segundo plano.',
                    jobId: res.jobId,
                  }
              : it
            )
          );
          // Refrescar trabajos del backend de inmediato
          loadJobs();
        } else {
          setLocalQueue((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    status: 'error',
                    progress: 100,
                    error: res.error || 'Error en subida',
                    message: 'Error al subir comprobante',
                  }
              : it
            )
          );
        }
      } catch (err: any) {
        setLocalQueue((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: 'error',
                  progress: 100,
                  error: err?.message || 'Error de conexión',
                  message: 'Error en la subida',
                }
              : it
          )
        );
      }
    }

    // Liberar Wake Lock al terminar
    await wakeLock.release();
    setIsUploading(false);
  };

  const handleRetryJob = async (jobId: string) => {
    await retryInvoiceJob(jobId);
    await loadJobs();
  };

  if (!isOpen) return null;

  const pendingJobsCount = backendJobs.filter((j) => j.status === 'en_cola' || j.status === 'leyendo').length;
  const reviewJobsCount = backendJobs.filter((j) => j.status === 'revisar').length;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full md:max-w-2xl h-[88vh] md:h-auto md:max-h-[85vh] rounded-t-[20px] md:rounded-[18px] border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 md:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-[#F6F7F9] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Subir Facturas</h2>
              <p className="text-xs text-[#64748B]">Obra: <strong className="text-slate-800">{project.name}</strong></p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-[14px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inputs ocultos de archivo y cámara con capture="environment" (Requisito UI móvil) */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />

        {/* Botones de acción principales (Mínimo 48px de altura táctil) */}
        <div className="p-4 bg-white border-b border-slate-100 shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="h-14 rounded-[14px] bg-[#0F766E] hover:bg-[#0d655f] text-white font-bold text-sm shadow-xs flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] cursor-pointer"
            >
              <Camera className="w-5 h-5 shrink-0" />
              <span>Tomar foto</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-14 rounded-[14px] bg-[#F6F7F9] hover:bg-slate-200/80 text-[#0F172A] font-bold text-sm border border-slate-200/90 shadow-2xs flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] cursor-pointer"
            >
              <FolderOpen className="w-5 h-5 text-[#0F766E] shrink-0" />
              <span>Elegir archivos</span>
            </button>
          </div>

          {/* Mensaje informativo de tranquilidad */}
          <div className="mt-3 p-3 bg-teal-50/70 border border-teal-200/80 rounded-[12px] text-xs text-teal-900 flex items-start gap-2">
            <Info className="w-4 h-4 text-[#0F766E] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Lectura en segundo plano:</strong> Las imágenes se comprimen automáticamente. Tras ver <strong>✓ Recibida</strong>, puedes cerrar el navegador o bloquear tu celular: el servidor continuará leyendo las facturas con Gemini.
            </p>
          </div>
        </div>

        {/* Pestañas de estado (Subidas recientes / Trabajos en servidor) */}
        <div className="flex border-b border-slate-200 bg-[#F6F7F9] px-4 shrink-0 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('subir')}
            className={`py-3 px-4 border-b-2 transition-all ${
              activeTab === 'subir'
                ? 'border-[#0F766E] text-[#0F766E]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Subidas Recientes ({localQueue.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cola')}
            className={`py-3 px-4 border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'cola'
                ? 'border-[#0F766E] text-[#0F766E]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>Cola en Servidor ({backendJobs.length})</span>
            {pendingJobsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
            {reviewJobsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[10px]">
                {reviewJobsCount} por revisar
              </span>
            )}
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'subir' ? (
            localQueue.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <UploadCloud className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No hay archivos en subida</p>
                <p className="text-xs text-slate-400 mt-1">Usa los botones superiores para tomar fotos o elegir PDFs</p>
              </div>
            ) : (
              localQueue.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 bg-[#F6F7F9] rounded-[14px] border border-slate-200/80 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                      <span className="text-xs font-bold text-slate-800 truncate">{item.fileName}</span>
                    </div>
                    {item.status === 'recibida' ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1 shrink-0">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Recibida</span>
                      </span>
                    ) : item.status === 'error' ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800 shrink-0">
                        Error
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1 shrink-0">
                        <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                        <span>Subiendo</span>
                      </span>
                    )}
                  </div>

                  {/* Barra de progreso */}
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        item.status === 'recibida'
                          ? 'bg-[#16A34A]'
                          : item.status === 'error'
                          ? 'bg-[#DC2626]'
                          : 'bg-[#0F766E]'
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>

                  <p className="text-[11px] text-slate-600 leading-snug">{item.message}</p>
                </div>
              ))
            )
          ) : backendJobs.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <Clock className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Sin trabajos en el servidor</p>
              <p className="text-xs text-slate-400 mt-1">Los documentos subidos aparecerán aquí mientras el servidor los procesa</p>
            </div>
          ) : (
            backendJobs.map((job) => {
              const statusBadge = {
                en_cola: { label: 'En cola', bg: 'bg-slate-100 text-slate-700 border-slate-200' },
                leyendo: { label: 'Leyendo...', bg: 'bg-teal-100 text-[#0F766E] border-teal-200 animate-pulse' },
                leida: { label: 'Leída', bg: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
                revisar: { label: 'Revisar', bg: 'bg-amber-100 text-amber-900 border-amber-300' },
                error: { label: 'Error', bg: 'bg-rose-100 text-rose-800 border-rose-200' },
              }[job.status] || { label: job.status, bg: 'bg-slate-100 text-slate-700' };

              return (
                <div
                  key={job.id}
                  className="p-3.5 bg-white rounded-[14px] border border-slate-200 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-xs font-bold text-slate-900 truncate">{job.fileName}</span>
                      </div>
                      {job.extractedData && (
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {job.extractedData.proveedor} • {formatCOP(job.extractedData.total)}
                        </p>
                      )}
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${statusBadge.bg}`}
                    >
                      {statusBadge.label}
                    </span>
                  </div>

                  {/* Avisos de duplicado o campos dudosos */}
                  {job.duplicateReason && (
                    <div className="p-2 bg-amber-50 rounded-lg border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>{job.duplicateReason}</span>
                    </div>
                  )}

                  {job.status === 'error' && (
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                      <span className="text-[11px] text-rose-600 truncate">{job.errorMessage || 'Falló la lectura'}</span>
                      <button
                        type="button"
                        onClick={() => handleRetryJob(job.id)}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reintentar</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pie */}
        <div className="p-4 border-t border-slate-100 bg-[#F6F7F9] flex items-center justify-between shrink-0">
          <p className="text-[11px] text-[#64748B]">
            {isUploading ? 'Subiendo archivos… no cierres aún' : 'Listo. Puedes cerrar esta ventana con seguridad.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-[12px] text-xs font-bold transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
