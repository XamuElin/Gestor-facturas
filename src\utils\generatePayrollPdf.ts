import jsPDF from 'jspdf';
import { PayrollCalculation } from '../types';

export interface PayrollPdfOptions {
  calculation: PayrollCalculation;
  projectName: string;
  payPeriod: string; // e.g. "Semana 38 - Septiembre 2026" or "15 al 30 de Septiembre de 2026"
  startDate?: string; // Fecha exacta de inicio de pago registrado (ej. "01/09/2026")
  endDate?: string;   // Fecha exacta de fin de pago registrado (ej. "15/09/2026")
  voucherNumber?: string;
  architectName?: string;
  companyName?: string;
  currencySymbol?: string;
}

/**
 * Genera y descarga un Desprendible de Pago (PDF) profesional y limpio
 * para obreros de la construcción con membrete de SVH Arquitectos.
 */
export function generatePayrollReceiptPdf({
  calculation,
  projectName,
  payPeriod,
  startDate,
  endDate,
  voucherNumber = `REC-${Date.now().toString().slice(-6)}`,
  architectName = 'SVH Arquitectos & Asoc.',
  companyName = 'Control de Obra y Construcciones',
  currencySymbol = '$',
}: PayrollPdfOptions) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  // --- Paleta de colores ejecutiva SVH ---
  const primaryGreen = [28, 163, 48]; // #1ca330
  const darkSlate = [30, 41, 59]; // #1e293b
  const mutedSlate = [100, 116, 139]; // #64748b
  const lightBg = [248, 250, 252]; // #f8fafc
  const cardBorder = [226, 232, 240]; // #e2e8f0

  // 1. Membrete y Cabecera Superior
  doc.setFillColor(primaryGreen[0], primaryGreen[1], primaryGreen[2]);
  doc.rect(margin, 14, 4, 18, 'F'); // Barra acento lateral

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text(architectName, margin + 8, 21);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text(`${companyName} • Gestión Técnica y Nómina de Obra`, margin + 8, 27);

  // Recuadro del Folio del Comprobante (derecha)
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.setDrawColor(cardBorder[0], cardBorder[1], cardBorder[2]);
  doc.roundedRect(pageWidth - margin - 55, 14, 55, 18, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(primaryGreen[0], primaryGreen[1], primaryGreen[2]);
  doc.text('COMPROBANTE DE PAGO', pageWidth - margin - 52, 20);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text(voucherNumber, pageWidth - margin - 52, 28);

  // Línea divisoria
  doc.setDrawColor(cardBorder[0], cardBorder[1], cardBorder[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, 38, pageWidth - margin, 38);

  // 2. Información del Proyecto y Periodo
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(margin, 42, contentWidth, 18, 2, 2, 'FD');

  const colWidth = contentWidth / 3;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text('PROYECTO / OBRA:', margin + 4, 48);
  doc.text('PERIODO LIQUIDADO:', margin + colWidth + 4, 48);
  doc.text('FECHAS DE PAGO REGISTRADAS:', margin + colWidth * 2 + 4, 48);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text(projectName, margin + 4, 55);
  doc.text(payPeriod, margin + colWidth + 4, 55);

  // Fechas exactas de inicio y fin de pago registrado solicitadas por el usuario
  const startStr = startDate ? String(startDate).trim() : 'Inicio periodo';
  const endStr = endDate ? String(endDate).trim() : 'Fin periodo';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(primaryGreen[0], primaryGreen[1], primaryGreen[2]);
  doc.text(`Desde: ${startStr}   Hasta: ${endStr}`, margin + colWidth * 2 + 4, 55);

  // 3. Ficha de Datos del Trabajador
  const workerBoxY = 65;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(cardBorder[0], cardBorder[1], cardBorder[2]);
  doc.roundedRect(margin, workerBoxY, contentWidth, 31, 2, 2, 'FD');

  // Encabezado Ficha
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, workerBoxY, contentWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text('DATOS DEL TRABAJADOR DE OBRA', margin + 4, workerBoxY + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text(`Jornada registrada: ${startStr} al ${endStr}`, pageWidth - margin - 4, workerBoxY + 5, { align: 'right' });

  const col1 = margin + 4;
  const col2 = margin + 55;
  const col3 = margin + 115;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text('Nombre y Apellidos:', col1, workerBoxY + 13);
  doc.text('Documento / Cédula:', col2, workerBoxY + 13);
  doc.text('ID Obrero:', col3, workerBoxY + 13);

  doc.text('Rol / Cargo:', col1, workerBoxY + 22);
  doc.text('Frecuencia de Pago:', col2, workerBoxY + 22);
  doc.text('Tarifa Base Acordada:', col3, workerBoxY + 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text(calculation.workerName, col1, workerBoxY + 18);
  doc.text(calculation.dni || 'Sin registrar', col2, workerBoxY + 18);
  doc.text(calculation.workerId, col3, workerBoxY + 18);

  doc.text(calculation.role, col1, workerBoxY + 27);
  doc.text(calculation.paymentFrequency, col2, workerBoxY + 27);
  doc.text(
    `${currencySymbol} ${calculation.baseRate.toLocaleString()} / ${calculation.rateUnit}`,
    col3,
    workerBoxY + 27
  );

  // 4. Tabla Detallada de Liquidación (Devengados y Deducciones)
  const tableY = 100;
  const rowHeight = 7;

  // Header tabla
  doc.setFillColor(primaryGreen[0], primaryGreen[1], primaryGreen[2]);
  doc.roundedRect(margin, tableY, contentWidth, rowHeight + 1, 1.5, 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('CÓD.', margin + 4, tableY + 5.5);
  doc.text('CONCEPTO DE PAGO / RETENCIÓN', margin + 20, tableY + 5.5);
  doc.text('CANTIDAD', margin + 105, tableY + 5.5, { align: 'right' });
  doc.text('TARIFA / REF', margin + 140, tableY + 5.5, { align: 'right' });
  doc.text('SUBTOTAL', pageWidth - margin - 4, tableY + 5.5, { align: 'right' });

  // Filas de conceptos
  let currentY = tableY + rowHeight + 3;

  const lineItems = [
    {
      code: 'DEV-01',
      concept: `Jornada Laboral Ordinaria (${calculation.rateUnit === 'Dia' ? 'Días' : 'Horas'})`,
      quantity: `${calculation.rateUnit === 'Dia' ? calculation.totalDaysWorked : calculation.totalRegularHours} ${calculation.rateUnit.toLowerCase()}s`,
      rate: `${currencySymbol} ${calculation.baseRate.toLocaleString()}`,
      subtotal: `${currencySymbol} ${calculation.basePay.toLocaleString()}`,
      isDeduction: false,
    },
    {
      code: 'DEV-02',
      concept: 'Horas Extras de Obra (Trabajo Suplementario)',
      quantity: `${calculation.totalOvertimeHours} hrs`,
      rate: `${currencySymbol} ${calculation.overtimeRate.toLocaleString()}`,
      subtotal: `${currencySymbol} ${calculation.overtimePay.toLocaleString()}`,
      isDeduction: false,
    },
    {
      code: 'DED-01',
      concept: 'Deducciones (Anticipos, Préstamos o Seguridad Social)',
      quantity: calculation.deductions > 0 ? '1' : '-',
      rate: calculation.deductions > 0 ? `${currencySymbol} ${calculation.deductions.toLocaleString()}` : '-',
      subtotal: calculation.deductions > 0 ? `-${currencySymbol} ${calculation.deductions.toLocaleString()}` : `${currencySymbol} 0`,
      isDeduction: true,
    },
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  lineItems.forEach((item, index) => {
    // Fondo alternado
    if (index % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(margin, currentY - 1.5, contentWidth, rowHeight, 'F');
    }

    doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
    doc.text(item.code, margin + 4, currentY + 3.5);

    doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
    doc.text(item.concept, margin + 20, currentY + 3.5);

    doc.text(item.quantity, margin + 105, currentY + 3.5, { align: 'right' });
    doc.text(item.rate, margin + 140, currentY + 3.5, { align: 'right' });

    if (item.isDeduction && calculation.deductions > 0) {
      doc.setTextColor(220, 38, 38); // Rojo
    } else {
      doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
    }
    doc.text(item.subtotal, pageWidth - margin - 4, currentY + 3.5, { align: 'right' });

    currentY += rowHeight;
  });

  // Línea divisoria previa a totales
  currentY += 4;
  doc.setDrawColor(cardBorder[0], cardBorder[1], cardBorder[2]);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 4;

  // 5. Cuadro de Totales (Total Bruto, Deducciones, Neto a Pagar)
  const totalsBoxWidth = 85;
  const totalsBoxX = pageWidth - margin - totalsBoxWidth;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text('Total Devengado (Bruto):', totalsBoxX, currentY + 2);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text(`${currencySymbol} ${calculation.grossPay.toLocaleString()}`, pageWidth - margin - 4, currentY + 2, { align: 'right' });

  currentY += 6;
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text('Total Deducciones:', totalsBoxX, currentY + 2);
  doc.setTextColor(220, 38, 38);
  doc.text(`-${currencySymbol} ${calculation.deductions.toLocaleString()}`, pageWidth - margin - 4, currentY + 2, { align: 'right' });

  // Cuadro destacado NETO A PAGAR
  currentY += 8;
  doc.setFillColor(primaryGreen[0], primaryGreen[1], primaryGreen[2]);
  doc.roundedRect(totalsBoxX - 4, currentY, totalsBoxWidth + 4, 12, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('NETO A PAGAR:', totalsBoxX + 2, currentY + 7.5);

  doc.setFontSize(13);
  doc.text(
    `${currencySymbol} ${calculation.netPay.toLocaleString()}`,
    pageWidth - margin - 4,
    currentY + 8,
    { align: 'right' }
  );

  // Resumen en texto a la izquierda
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text(
    '* Liquidación de horas ordinarias y extras calculadas según registro de planilla de obra.',
    margin,
    currentY + 6
  );

  // 6. Sección de Firmas de Conformidad
  const signaturesY = 225;

  doc.setDrawColor(cardBorder[0], cardBorder[1], cardBorder[2]);
  doc.setLineWidth(0.5);

  // Línea firma trabajador
  const sigColWidth = 75;
  doc.line(margin + 5, signaturesY, margin + 5 + sigColWidth, signaturesY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text(calculation.workerName, margin + 5 + sigColWidth / 2, signaturesY + 5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text(`C.C./DNI: ${calculation.dni || '______________'}`, margin + 5 + sigColWidth / 2, signaturesY + 9, { align: 'center' });
  doc.text('Firma del Trabajador (Recibí Conforme)', margin + 5 + sigColWidth / 2, signaturesY + 13, { align: 'center' });

  // Línea firma dirección de obra
  const sigCol2X = pageWidth - margin - sigColWidth - 5;
  doc.line(sigCol2X, signaturesY, sigCol2X + sigColWidth, signaturesY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(darkSlate[0], darkSlate[1], darkSlate[2]);
  doc.text(architectName, sigCol2X + sigColWidth / 2, signaturesY + 5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text('Visto Bueno - Dirección de Obra', sigCol2X + sigColWidth / 2, signaturesY + 9, { align: 'center' });
  doc.text('SVH Arquitectos', sigCol2X + sigColWidth / 2, signaturesY + 13, { align: 'center' });

  // Pie de página con fecha de emisión y verificación
  const footerY = 275;
  doc.setDrawColor(cardBorder[0], cardBorder[1], cardBorder[2]);
  doc.line(margin, footerY, pageWidth - margin, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(mutedSlate[0], mutedSlate[1], mutedSlate[2]);
  doc.text(
    `Documento generado el ${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} • Sistema de Nómina de Obra SVH Arquitectos`,
    margin,
    footerY + 4
  );

  // Nombre de archivo limpio
  const cleanWorkerName = calculation.workerName.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Desprendible_${cleanWorkerName}_${voucherNumber}.pdf`;

  // Descargar automáticamente en el navegador
  doc.save(filename);
  return filename;
}
