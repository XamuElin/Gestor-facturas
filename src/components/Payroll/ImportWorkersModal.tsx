import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Loader2,
  X,
  Users,
  Sparkles,
  Trash2,
  DollarSign,
  Briefcase,
  Plus,
} from 'lucide-react';
import { Worker } from '../../types';
import { payrollService } from '../../services/payrollService';

interface ImportWorkersModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  spreadsheetId: string;
  existingWorkers: Worker[];
  onWorkersImported: (imported: Worker[]) => void;
}

interface ParsedWorkerItem {
  id?: string;
  name: string;
  role: string;
  dni: string;
  baseRate: number;
  overtimeRate: number;
  rateUnit: 'Dia' | 'Hora';
  paymentFrequency: 'Semanal' | 'Quincenal' | 'Mensual';
  phone: string;
  selected: boolean;
  isDuplicate?: boolean;
}

export const ImportWorkersModal: React.FC<ImportWorkersModalProps> = ({
  isOpen,
  onClose,
  token,
  spreadsheetId,
  existingWorkers,
  onWorkersImported,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isReading, setIsReading] = useState<boolean>(false);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [documentSummary, setDocumentSummary] = useState<string>('');
  const [formatDetected, setFormatDetected] = useState<string>('');
  const [extractedWorkers, setExtractedWorkers] = useState<ParsedWorkerItem[]>([]);
  const [step, setStep] = useState<'upload' | 'review'>('upload');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processSelectedFile(selectedFile);
    }
  };

  const processSelectedFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsReading(true);
    setErrorMsg(null);

    try {
      // Leer a base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = reader.result as string;
          const commaIdx = res.indexOf(',');
          resolve(commaIdx !== -1 ? res.substring(commaIdx + 1) : res);
        };
        reader.onerror = (err) => reject(err);
      });
      reader.readAsDataURL(selectedFile);

      const base64 = await base64Promise;
      const res = await payrollService.parseWorkersDocument(
        token,
        base64,
        selectedFile.type,
        selectedFile.name
      );

      if (!res.workers || res.workers.length === 0) {
        throw new Error('No se encontraron registros de obreros con nombres o tarifas en este archivo.');
      }

      // Mapear y cotejar duplicados
      const existingNames = new Set(existingWorkers.map((w) => w.name.toLowerCase().trim()));
      const existingDnis = new Set(existingWorkers.map((w) => (w.dni || '').trim()).filter(Boolean));

      const items: ParsedWorkerItem[] = res.workers.map((w) => {
        const cleanName = (w.name || '').trim().toLowerCase();
        const cleanDni = (w.dni || '').trim();
        const isDuplicate = existingNames.has(cleanName) || (cleanDni && existingDnis.has(cleanDni));

        return {
          name: w.name || '',
          role: w.role || 'Oficial de Obra',
          dni: w.dni || '',
          baseRate: Number(w.baseRate) || 80000,
          overtimeRate: Number(w.overtimeRate) || (w.rateUnit === 'Hora' ? Math.round(Number(w.baseRate) * 1.5) : Math.round((Number(w.baseRate) / 8) * 1.5)) || 15000,
          rateUnit: (w.rateUnit as 'Dia' | 'Hora') || 'Dia',
          paymentFrequency: (w.paymentFrequency as 'Semanal' | 'Quincenal' | 'Mensual') || 'Semanal',
          phone: w.phone || '',
          selected: !isDuplicate, // Si es duplicado, no marcarlo por defecto
          isDuplicate: !!isDuplicate,
        };
      });

      setExtractedWorkers(items);
      setDocumentSummary(res.documentSummary || `Se detectaron ${items.length} obreros`);
      setFormatDetected(res.formatDetected || 'Documento analizado');
      setStep('review');
    } catch (err: any) {
      console.error('Error procesando archivo:', err);
      setErrorMsg(err.message || 'Error al leer el documento de obreros. Intenta con otro archivo.');
    } finally {
      setIsReading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleToggleSelectAll = (checked: boolean) => {
    setExtractedWorkers((prev) => prev.map((w) => ({ ...w, selected: checked })));
  };

  const handleUpdateWorker = (index: number, field: keyof ParsedWorkerItem, value: any) => {
    setExtractedWorkers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleDeleteWorker = (index: number) => {
    setExtractedWorkers((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleAddNewManualWorker = () => {
    setExtractedWorkers((prev) => [
      ...prev,
      {
        name: 'Nuevo Obrero',
        role: 'Ayudante de Obra',
        dni: '',
        baseRate: 70000,
        overtimeRate: 13000,
        rateUnit: 'Dia',
        paymentFrequency: 'Semanal',
        phone: '',
        selected: true,
      },
    ]);
  };

  const handleConfirmRegistration = async () => {
    const selected = extractedWorkers.filter((w) => w.selected);
    if (selected.length === 0) {
      setErrorMsg('Selecciona al menos un obrero para registrar.');
      return;
    }

    setIsRegistering(true);
    setErrorMsg(null);

    try {
      const payload: Partial<Worker>[] = selected.map((w) => ({
        name: w.name.trim(),
        role: w.role.trim() || 'Oficial de Obra',
        dni: w.dni.trim(),
        baseRate: Number(w.baseRate) || 80000,
        overtimeRate: Number(w.overtimeRate) || (w.rateUnit === 'Hora' ? Math.round(Number(w.baseRate) * 1.5) : Math.round((Number(w.baseRate) / 8) * 1.5)) || 15000,
        rateUnit: w.rateUnit,
        paymentFrequency: w.paymentFrequency,
        phone: w.phone.trim(),
        active: true,
      }));

      const res = await payrollService.addWorkersBatch(token, spreadsheetId, payload);
      if (res.addedWorkers && res.addedWorkers.length > 0) {
        onWorkersImported(res.addedWorkers);
        onClose();
      } else {
        throw new Error('No se confirmaron obreros guardados en Google Sheets.');
      }
    } catch (err: any) {
      console.error('Error registrando obreros:', err);
      setErrorMsg(err.message || 'Error al guardar los obreros en Google Sheets.');
    } finally {
      setIsRegistering(false);
    }
  };

  const selectedCount = extractedWorkers.filter((w) => w.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#1ca330] to-[#98d52c] text-white flex items-center justify-center shadow-xs">
              <Users className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-1.5">
                <span>Importar Obreros y Precios desde Documento</span>
                <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Excel / PDF / Imagen
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Carga un archivo con tu lista de cuadrilla, cotización o nómina y la IA/Excel extraerá automáticamente nombres, tarifas y cargos.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isReading || isRegistering}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong>Error:</strong> {errorMsg}
              </div>
            </div>
          )}

          {step === 'upload' ? (
            <div className="space-y-4">
              {/* Zona de Drop */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => !isReading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center cursor-pointer transition-all ${
                  isReading
                    ? 'border-emerald-300 bg-emerald-50/50 cursor-wait'
                    : 'border-slate-300 hover:border-[#1ca330] hover:bg-slate-50/80'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {isReading ? (
                  <div className="space-y-3 flex flex-col items-center">
                    <Loader2 className="w-10 h-10 text-[#1ca330] animate-spin" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-slate-800">
                        Analizando documento y extrayendo obreros...
                      </p>
                      <p className="text-xs text-slate-500">
                        Leyendo nombres, oficios, tarifas pactadas y números de contacto...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-[#1ca330] border border-emerald-200/80 flex items-center justify-center shadow-2xs">
                      <Upload className="w-7 h-7" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-slate-800">
                        Arrastra aquí tu documento o <span className="text-[#1ca330] underline">haz clic para examinar</span>
                      </p>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Formatos admitidos: <strong>Excel (.xlsx, .xls)</strong>, <strong>CSV</strong>, <strong>PDF</strong>, o <strong>Fotos / Escaneos (.png, .jpg)</strong> de planillas de cuadrilla.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Ejemplos de formatos soportados */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 flex items-start gap-2.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800 block font-bold">Hojas de Cálculo Excel</strong>
                    <span className="text-slate-500 text-[11px]">Tablas con columnas: Nombre, Cargo, Cédula, Precio / Día.</span>
                  </div>
                </div>

                <div className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 flex items-start gap-2.5">
                  <FileText className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800 block font-bold">Documentos PDF</strong>
                    <span className="text-slate-500 text-[11px]">Contratos, cotizaciones o listas de personal en PDF.</span>
                  </div>
                </div>

                <div className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 flex items-start gap-2.5">
                  <ImageIcon className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800 block font-bold">Fotos y Escaneos</strong>
                    <span className="text-slate-500 text-[11px]">Fotos de planillas firmadas en obra extraídas con IA.</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* PASO 2: REVISIÓN DE OBREROS DETECTADOS */
            <div className="space-y-4">
              {/* Barra superior de información */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-emerald-50 rounded-2xl border border-emerald-200">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#1ca330] shrink-0" />
                  <span className="text-xs font-semibold text-emerald-950">
                    {documentSummary} ({formatDetected})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('upload');
                      setFile(null);
                    }}
                    className="text-xs text-slate-600 hover:text-slate-900 underline font-medium cursor-pointer"
                  >
                    Subir otro archivo
                  </button>
                  <button
                    type="button"
                    onClick={handleAddNewManualWorker}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-white text-emerald-800 rounded-lg border border-emerald-300 shadow-2xs hover:bg-emerald-100 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Añadir Fila</span>
                  </button>
                </div>
              </div>

              {/* Tabla de revisión editable */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedCount === extractedWorkers.length && extractedWorkers.length > 0}
                          onChange={(e) => handleToggleSelectAll(e.target.checked)}
                          className="rounded text-[#1ca330] focus:ring-[#1ca330]"
                          title="Seleccionar / deseleccionar todos"
                        />
                      </th>
                      <th className="p-3">Nombre del Obrero</th>
                      <th className="p-3">Oficio / Cargo</th>
                      <th className="p-3">Cédula / DNI</th>
                      <th className="p-3">Tarifa Base ($)</th>
                      <th className="p-3">Unidad</th>
                      <th className="p-3">Hora Extra ($)</th>
                      <th className="p-3">Frecuencia</th>
                      <th className="p-3">Teléfono</th>
                      <th className="p-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {extractedWorkers.map((w, idx) => (
                      <tr
                        key={idx}
                        className={`hover:bg-slate-50/70 transition-colors ${
                          w.selected ? 'bg-emerald-50/20' : 'opacity-60 bg-slate-50/40'
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={w.selected}
                            onChange={(e) => handleUpdateWorker(idx, 'selected', e.target.checked)}
                            className="rounded text-[#1ca330] focus:ring-[#1ca330]"
                          />
                        </td>

                        {/* Nombre */}
                        <td className="p-2 min-w-[150px]">
                          <input
                            type="text"
                            value={w.name}
                            onChange={(e) => handleUpdateWorker(idx, 'name', e.target.value)}
                            className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-[#1ca330] focus:bg-white rounded px-2 py-1 font-bold text-slate-800"
                          />
                          {w.isDuplicate && (
                            <span className="text-[10px] text-amber-700 block font-medium">
                              ⚠️ Ya existe en la lista
                            </span>
                          )}
                        </td>

                        {/* Cargo / Rol */}
                        <td className="p-2 min-w-[130px]">
                          <input
                            type="text"
                            value={w.role}
                            onChange={(e) => handleUpdateWorker(idx, 'role', e.target.value)}
                            className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-[#1ca330] focus:bg-white rounded px-2 py-1 text-slate-700"
                          />
                        </td>

                        {/* DNI */}
                        <td className="p-2 min-w-[100px]">
                          <input
                            type="text"
                            value={w.dni}
                            placeholder="Cédula..."
                            onChange={(e) => handleUpdateWorker(idx, 'dni', e.target.value)}
                            className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-[#1ca330] focus:bg-white rounded px-2 py-1 text-slate-600 font-mono"
                          />
                        </td>

                        {/* Tarifa Base */}
                        <td className="p-2 min-w-[100px]">
                          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1">
                            <span className="text-slate-400 font-bold">$</span>
                            <input
                              type="number"
                              value={w.baseRate}
                              onChange={(e) => handleUpdateWorker(idx, 'baseRate', parseFloat(e.target.value) || 0)}
                              className="w-full text-slate-900 font-bold focus:outline-none"
                            />
                          </div>
                        </td>

                        {/* Unidad */}
                        <td className="p-2 min-w-[80px]">
                          <select
                            value={w.rateUnit}
                            onChange={(e) => handleUpdateWorker(idx, 'rateUnit', e.target.value)}
                            className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 font-medium"
                          >
                            <option value="Dia">Día</option>
                            <option value="Hora">Hora</option>
                          </select>
                        </td>

                        {/* Hora Extra */}
                        <td className="p-2 min-w-[90px]">
                          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1">
                            <span className="text-slate-400 font-bold">$</span>
                            <input
                              type="number"
                              value={w.overtimeRate}
                              onChange={(e) => handleUpdateWorker(idx, 'overtimeRate', parseFloat(e.target.value) || 0)}
                              className="w-full text-slate-700 focus:outline-none"
                            />
                          </div>
                        </td>

                        {/* Frecuencia */}
                        <td className="p-2 min-w-[100px]">
                          <select
                            value={w.paymentFrequency}
                            onChange={(e) => handleUpdateWorker(idx, 'paymentFrequency', e.target.value)}
                            className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-700"
                          >
                            <option value="Semanal">Semanal</option>
                            <option value="Quincenal">Quincenal</option>
                            <option value="Mensual">Mensual</option>
                          </select>
                        </td>

                        {/* Teléfono */}
                        <td className="p-2 min-w-[100px]">
                          <input
                            type="text"
                            value={w.phone}
                            placeholder="Opcional..."
                            onChange={(e) => handleUpdateWorker(idx, 'phone', e.target.value)}
                            className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-[#1ca330] focus:bg-white rounded px-2 py-1 text-slate-600 text-[11px]"
                          />
                        </td>

                        {/* Eliminar fila */}
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteWorker(idx)}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                            title="Quitar de la lista"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Pie de página */}
        <div className="p-4 sm:p-5 border-t border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="text-xs text-slate-600">
            {step === 'review' ? (
              <span>
                <strong>{selectedCount}</strong> de <strong>{extractedWorkers.length}</strong> obreros seleccionados para registrar
              </span>
            ) : (
              <span>Elige o arrastra tu archivo para empezar</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isRegistering}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            {step === 'review' && (
              <button
                type="button"
                onClick={handleConfirmRegistration}
                disabled={isRegistering || selectedCount === 0}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#1ca330] hover:bg-[#168826] text-white shadow-xs hover:shadow-md transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando en Google Sheets...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Registrar {selectedCount} Obreros en Sheets</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
