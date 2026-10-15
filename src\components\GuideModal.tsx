import React from 'react';
import {
  X,
  BookOpen,
  Camera,
  FolderOpen,
  CheckCircle2,
  HardHat,
  Receipt,
  FileSpreadsheet,
  ShieldCheck,
  Smartphone,
  ExternalLink,
} from 'lucide-react';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full md:max-w-2xl h-[85vh] md:h-auto md:max-h-[85vh] rounded-t-[20px] md:rounded-[18px] border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 md:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-[#F6F7F9] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-[#0F766E]/10 text-[#0F766E] flex items-center justify-center font-bold">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Guía de Uso del Sistema</h2>
              <p className="text-xs text-[#64748B]">Facturación en Obra, Servidor en Segundo Plano y Nóminas</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-[14px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs text-slate-700 leading-relaxed">
          {/* Paso 1: Selector de Obras */}
          <div className="p-4 rounded-[14px] bg-[#F6F7F9] border border-slate-200/80 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-sm text-[#0F766E]">
              <FolderOpen className="w-4 h-4" />
              <span>1. Selector de Obras (Carpetas de Drive)</span>
            </div>
            <p>
              Toca el chip con el nombre de la obra en el encabezado para desplegar el selector de obras.
              Puedes buscar obras al instante ignorando mayúsculas y tildes, marcar tus favoritas con la estrella (quedan arriba)
              o pulsar <strong>&ldquo;Nueva obra&rdquo;</strong> para crear automáticamente la carpeta en Google Drive y la hoja de cálculo en Sheets.
            </p>
          </div>

          {/* Paso 2: Subida y lectura en segundo plano */}
          <div className="p-4 rounded-[14px] bg-[#F6F7F9] border border-slate-200/80 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-sm text-[#0F766E]">
              <Camera className="w-4 h-4" />
              <span>2. Subida Rápida y Lectura en Segundo Plano</span>
            </div>
            <p>
              Usa <strong>&ldquo;Tomar foto&rdquo;</strong> para capturar directo con la cámara trasera de tu móvil o <strong>&ldquo;Elegir archivos&rdquo;</strong> para PDFs y fotos existentes.
              Las imágenes se comprimen a máximo 1600 px (JPEG 0.8) antes de subirse.
            </p>
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 font-medium">
              💡 <strong>Regla de oro:</strong> Espera únicamente a ver <span className="font-bold">✓ Recibida</span>. Después puedes cerrar la app, cambiar de pestaña o bloquear tu celular: el servidor seguirá leyendo las facturas con Gemini Flash en segundo plano.
            </div>
          </div>

          {/* Paso 3: Validación Contable en Código */}
          <div className="p-4 rounded-[14px] bg-[#F6F7F9] border border-slate-200/80 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-sm text-[#0F766E]">
              <ShieldCheck className="w-4 h-4" />
              <span>3. Estados y Validación Matemática Automática</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-slate-600">
              <li><strong>En cola:</strong> Recibida en el servidor, esperando turno en el worker (procesa hasta 4 facturas simultáneas).</li>
              <li><strong>Leyendo:</strong> Gemini Flash extrayendo proveedor, NIT, número, fecha, subtotal, IVA, total e ítems.</li>
              <li><strong>Leída (verde):</strong> Datos validados con confianza alta (subtotal + iva − retenciones − descuentos = total).</li>
              <li><strong>Revisar (ámbar):</strong> Descuadre matemático, fecha dudosa o posible duplicado contable (mismo proveedor, número y total).</li>
              <li><strong>Error (rojo):</strong> Fallo tras 3 reintentos exponenciales. Incluye motivo y botón para reintentar.</li>
            </ul>
          </div>

          {/* Paso 4: Mano de Obra y Nóminas */}
          <div className="p-4 rounded-[14px] bg-[#F6F7F9] border border-slate-200/80 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-sm text-[#0F766E]">
              <HardHat className="w-4 h-4" />
              <span>4. Mano de Obra y Planilla de Nómina</span>
            </div>
            <p>
              En la sección <strong>Personal</strong>, utiliza el control segmentado <em>&ldquo;Mano de obra | Nóminas&rdquo;</em> para alternar
              entre el registro diario de jornadas / horas extras y la liquidación consolidada por obrero.
              Los cierres de mes preservan los datos históricos y crean la nueva plantilla mensual sin borrar información.
            </p>
          </div>

          {/* Paso 5: Instalación como PWA */}
          <div className="p-4 rounded-[14px] bg-[#F6F7F9] border border-slate-200/80 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-sm text-[#0F766E]">
              <Smartphone className="w-4 h-4" />
              <span>5. App Instalable en Celular (PWA)</span>
            </div>
            <p>
              En Chrome o Safari de tu celular, pulsa el menú de opciones (tres puntos o botón compartir) y selecciona
              <strong> &ldquo;Agregar a la pantalla principal&rdquo;</strong> o <strong>&ldquo;Instalar aplicación&rdquo;</strong>.
              Tendrás acceso directo en tu móvil a pantalla completa.
            </p>
          </div>
        </div>

        {/* Pie */}
        <div className="p-4 border-t border-slate-100 bg-[#F6F7F9] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-5 bg-[#0F766E] hover:bg-[#0d655f] text-white rounded-[12px] text-xs font-bold transition-colors cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
