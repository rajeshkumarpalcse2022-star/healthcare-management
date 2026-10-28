import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import type { ConsultationAttachment, PrescriptionItem } from "@/types/appointment";

export type ConsultationDocumentType = "invoice" | "prescription";

export interface ConsultationDocumentData {
  appointment: {
    code: string;
    date: string;
    timeSlot: string;
    endTime: string;
    type: string;
  };
  clinic: {
    name: string;
    code: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  doctor: {
    name: string;
    specialization: string;
    qualification: string | null;
    registrationNumber: string | null;
    consultationFee: number | null;
  };
  patient: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  record: {
    diagnosis: string | null;
    notes: string | null;
    treatmentAdvice: string | null;
    followUp: string | null;
    prescriptionItems: PrescriptionItem[];
    attachments: ConsultationAttachment[];
    updatedAt: string;
  };
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PRIMARY = rgb(0.02, 0.55, 0.48);
const PRIMARY_DARK = rgb(0.02, 0.35, 0.31);
const INK = rgb(0.08, 0.12, 0.16);
const MUTED = rgb(0.38, 0.44, 0.49);
const BORDER = rgb(0.84, 0.88, 0.9);
const SOFT = rgb(0.95, 0.98, 0.97);

function safeText(value: string): string {
  return value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u20B9/g, "INR ")
    .replace(/\u00A0/g, " ")
    .replace(/[^\t\n\r -~\u00A0-\u00FF]/g, "?");
}

function money(value: number): string {
  return `INR ${value.toFixed(2)}`;
}

function clinicAddress(clinic: ConsultationDocumentData["clinic"]): string {
  return [clinic.address, clinic.city, clinic.state, clinic.pincode]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
}

function splitLongWord(word: string, font: PDFFont, size: number, width: number) {
  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    const next = current + char;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      pieces.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of safeText(value).split(/\r?\n/)) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
      } else {
        const pieces = splitLongWord(word, font, size, maxWidth);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] ?? "";
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

class DocumentWriter {
  readonly page = { current: this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]) };
  y = PAGE_HEIGHT - MARGIN;

  constructor(
    private readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {}

  get pdfPage() {
    return this.page.current;
  }

  addPage() {
    this.page.current = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 28) this.addPage();
  }

  paragraph(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      width?: number;
      x?: number;
      lineHeight?: number;
      after?: number;
    } = {},
  ) {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.regular;
    const width = options.width ?? CONTENT_WIDTH;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const lines = wrapText(value, font, size, width);
    this.ensure(lines.length * lineHeight);
    for (const line of lines) {
      this.pdfPage.drawText(line, {
        x: options.x ?? MARGIN,
        y: this.y,
        size,
        font,
        color: options.color ?? INK,
      });
      this.y -= lineHeight;
    }
    this.y -= options.after ?? 0;
  }

  label(value: string, x = MARGIN) {
    this.pdfPage.drawText(safeText(value.toUpperCase()), {
      x,
      y: this.y,
      size: 7.5,
      font: this.bold,
      color: MUTED,
    });
  }

  rule(color = BORDER) {
    this.pdfPage.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.8,
      color,
    });
  }
}

function drawHeader(
  writer: DocumentWriter,
  data: ConsultationDocumentData,
  type: ConsultationDocumentType,
) {
  const { pdfPage, bold, regular } = writer;
  pdfPage.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 116,
    width: PAGE_WIDTH,
    height: 116,
    color: PRIMARY,
  });
  pdfPage.drawText(safeText(data.clinic.name), {
    x: MARGIN,
    y: PAGE_HEIGHT - 48,
    size: 20,
    font: bold,
    color: rgb(1, 1, 1),
  });
  const address = clinicAddress(data.clinic);
  const contact = [data.clinic.phone, data.clinic.email].filter(Boolean).join("  |  ");
  if (address) {
    pdfPage.drawText(safeText(address), {
      x: MARGIN,
      y: PAGE_HEIGHT - 69,
      size: 8.5,
      font: regular,
      color: rgb(0.9, 0.98, 0.96),
    });
  }
  if (contact) {
    pdfPage.drawText(safeText(contact), {
      x: MARGIN,
      y: PAGE_HEIGHT - 82,
      size: 8.5,
      font: regular,
      color: rgb(0.9, 0.98, 0.96),
    });
  }
  pdfPage.drawText(safeText(`Clinic code: ${data.clinic.code}`), {
    x: MARGIN,
    y: PAGE_HEIGHT - 95,
    size: 8,
    font: regular,
    color: rgb(0.86, 0.96, 0.94),
  });

  const title = type === "invoice" ? "CONSULTATION INVOICE" : "PRESCRIPTION";
  const titleWidth = bold.widthOfTextAtSize(title, 13);
  pdfPage.drawText(title, {
    x: PAGE_WIDTH - MARGIN - titleWidth,
    y: PAGE_HEIGHT - 48,
    size: 13,
    font: bold,
    color: rgb(1, 1, 1),
  });
  const documentNo =
    type === "invoice"
      ? `INV-${data.appointment.code}`
      : `RX-${data.appointment.code}`;
  const docWidth = regular.widthOfTextAtSize(documentNo, 9);
  pdfPage.drawText(safeText(documentNo), {
    x: PAGE_WIDTH - MARGIN - docWidth,
    y: PAGE_HEIGHT - 69,
    size: 9,
    font: regular,
    color: rgb(0.9, 0.98, 0.96),
  });
  const dateLabel = `Date: ${data.appointment.date}`;
  const dateWidth = regular.widthOfTextAtSize(dateLabel, 8.5);
  pdfPage.drawText(dateLabel, {
    x: PAGE_WIDTH - MARGIN - dateWidth,
    y: PAGE_HEIGHT - 82,
    size: 8.5,
    font: regular,
    color: rgb(0.9, 0.98, 0.96),
  });
  writer.y = PAGE_HEIGHT - 142;
}

function drawParties(writer: DocumentWriter, data: ConsultationDocumentData) {
  const leftWidth = 260;
  const rightX = MARGIN + 290;
  const startY = writer.y;

  writer.label("Patient");
  writer.y -= 14;
  writer.paragraph(data.patient.name, {
    size: 11,
    bold: true,
    width: leftWidth,
    after: 2,
  });
  const patientContact = [data.patient.phone, data.patient.email]
    .filter(Boolean)
    .join("  |  ");
  if (patientContact) {
    writer.paragraph(patientContact, {
      size: 8.5,
      color: MUTED,
      width: leftWidth,
    });
  }

  const afterLeft = writer.y;
  writer.y = startY;
  writer.label("Consultation", rightX);
  writer.y -= 14;
  writer.paragraph(`Appointment: ${data.appointment.code}`, {
    size: 9,
    bold: true,
    x: rightX,
    width: PAGE_WIDTH - MARGIN - rightX,
    after: 1,
  });
  writer.paragraph(
    `${data.appointment.date}  |  ${data.appointment.timeSlot} - ${data.appointment.endTime}`,
    {
      size: 8.5,
      color: MUTED,
      x: rightX,
      width: PAGE_WIDTH - MARGIN - rightX,
      after: 1,
    },
  );
  writer.paragraph(`Type: ${data.appointment.type}`, {
    size: 8.5,
    color: MUTED,
    x: rightX,
    width: PAGE_WIDTH - MARGIN - rightX,
  });

  writer.y = Math.min(writer.y, afterLeft) - 12;
}

function drawDoctor(writer: DocumentWriter, data: ConsultationDocumentData) {
  writer.ensure(58);
  writer.pdfPage.drawRectangle({
    x: MARGIN,
    y: writer.y - 48,
    width: CONTENT_WIDTH,
    height: 56,
    color: SOFT,
    borderColor: BORDER,
    borderWidth: 0.7,
  });
  writer.y -= 13;
  writer.label("Consulting doctor", MARGIN + 12);
  writer.y -= 13;
  writer.paragraph(data.doctor.name, {
    size: 10.5,
    bold: true,
    x: MARGIN + 12,
    width: 215,
    after: 1,
  });
  const credentials = [
    data.doctor.specialization,
    data.doctor.qualification,
    data.doctor.registrationNumber
      ? `Reg. ${data.doctor.registrationNumber}`
      : null,
  ]
    .filter(Boolean)
    .join("  |  ");
  writer.paragraph(credentials, {
    size: 8,
    color: MUTED,
    x: MARGIN + 12,
    width: CONTENT_WIDTH - 24,
  });
  writer.y -= 8;
}

function drawInvoiceBody(writer: DocumentWriter, data: ConsultationDocumentData) {
  drawParties(writer, data);
  drawDoctor(writer, data);
  writer.y -= 2;

  const fee =
    typeof data.doctor.consultationFee === "number"
      ? data.doctor.consultationFee
      : 0;

  writer.ensure(92);
  writer.pdfPage.drawRectangle({
    x: MARGIN,
    y: writer.y - 24,
    width: CONTENT_WIDTH,
    height: 24,
    color: PRIMARY_DARK,
  });
  writer.pdfPage.drawText("DESCRIPTION", {
    x: MARGIN + 10,
    y: writer.y - 16,
    size: 8,
    font: writer.bold,
    color: rgb(1, 1, 1),
  });
  writer.pdfPage.drawText("QTY", {
    x: MARGIN + 330,
    y: writer.y - 16,
    size: 8,
    font: writer.bold,
    color: rgb(1, 1, 1),
  });
  writer.pdfPage.drawText("AMOUNT", {
    x: MARGIN + 402,
    y: writer.y - 16,
    size: 8,
    font: writer.bold,
    color: rgb(1, 1, 1),
  });
  writer.y -= 38;
  writer.paragraph(
    `Consultation fee - ${data.doctor.specialization || "General consultation"}`,
    { size: 10, bold: true, width: 300, after: 2 },
  );
  writer.paragraph(
    `Appointment ${data.appointment.code} with ${data.doctor.name}`,
    { size: 8, color: MUTED, width: 320 },
  );
  writer.pdfPage.drawText("1", {
    x: MARGIN + 336,
    y: writer.y + 28,
    size: 9,
    font: writer.regular,
    color: INK,
  });
  const feeText = money(fee);
  const feeWidth = writer.regular.widthOfTextAtSize(feeText, 9);
  writer.pdfPage.drawText(feeText, {
    x: PAGE_WIDTH - MARGIN - feeWidth,
    y: writer.y + 28,
    size: 9,
    font: writer.regular,
    color: INK,
  });

  writer.y -= 4;
  writer.rule();
  writer.y -= 18;

  const totalsX = PAGE_WIDTH - MARGIN - 190;
  const subtotal = fee;
  const totalLabel = "TOTAL PAYABLE";
  writer.pdfPage.drawText("Subtotal", {
    x: totalsX,
    y: writer.y,
    size: 9,
    font: writer.regular,
    color: MUTED,
  });
  const subtotalText = money(subtotal);
  writer.pdfPage.drawText(subtotalText, {
    x: PAGE_WIDTH - MARGIN - writer.regular.widthOfTextAtSize(subtotalText, 9),
    y: writer.y,
    size: 9,
    font: writer.regular,
    color: INK,
  });
  writer.y -= 20;
  writer.pdfPage.drawRectangle({
    x: totalsX - 10,
    y: writer.y - 8,
    width: PAGE_WIDTH - MARGIN - totalsX + 10,
    height: 26,
    color: SOFT,
    borderColor: BORDER,
    borderWidth: 0.6,
  });
  writer.pdfPage.drawText(totalLabel, {
    x: totalsX,
    y: writer.y + 1,
    size: 9,
    font: writer.bold,
    color: PRIMARY_DARK,
  });
  const totalText = money(subtotal);
  writer.pdfPage.drawText(totalText, {
    x: PAGE_WIDTH - MARGIN - writer.bold.widthOfTextAtSize(totalText, 12),
    y: writer.y - 1,
    size: 12,
    font: writer.bold,
    color: PRIMARY_DARK,
  });
  writer.y -= 38;

  writer.paragraph(
    "Payment is collected by the clinic as per its billing policy. This computer-generated invoice is valid without a physical seal.",
    { size: 8, color: MUTED, width: CONTENT_WIDTH },
  );
}

function drawPrescriptionBody(
  writer: DocumentWriter,
  data: ConsultationDocumentData,
) {
  drawParties(writer, data);
  drawDoctor(writer, data);

  writer.paragraph("Diagnosis / assessment", {
    size: 8,
    bold: true,
    color: MUTED,
    after: 2,
  });
  writer.paragraph(data.record.diagnosis || "Not recorded", {
    size: 10,
    after: 8,
  });

  writer.paragraph("Rx", {
    size: 15,
    bold: true,
    color: PRIMARY_DARK,
    after: 5,
  });

  const columns = [
    { title: "MEDICINE", width: 142 },
    { title: "DOSAGE", width: 68 },
    { title: "FREQUENCY", width: 86 },
    { title: "DURATION", width: 74 },
    { title: "INSTRUCTIONS", width: 133 },
  ];

  function drawTableHeader() {
    writer.ensure(26);
    writer.pdfPage.drawRectangle({
      x: MARGIN,
      y: writer.y - 18,
      width: CONTENT_WIDTH,
      height: 24,
      color: PRIMARY_DARK,
    });
    let x = MARGIN + 7;
    for (const column of columns) {
      writer.pdfPage.drawText(column.title, {
        x,
        y: writer.y - 11,
        size: 7,
        font: writer.bold,
        color: rgb(1, 1, 1),
      });
      x += column.width;
    }
    writer.y -= 30;
  }

  drawTableHeader();

  if (data.record.prescriptionItems.length === 0) {
    writer.paragraph("No medicines were prescribed in this consultation.", {
      size: 9,
      color: MUTED,
      after: 8,
    });
  } else {
    for (const [index, item] of data.record.prescriptionItems.entries()) {
      const cells = [
        item.medicine,
        item.dosage,
        item.frequency,
        item.duration,
        item.instructions ?? "-",
      ];
      const wrapped = cells.map((cell, cellIndex) =>
        wrapText(cell, writer.regular, 8.5, columns[cellIndex].width - 14),
      );
      const rowHeight =
        Math.max(...wrapped.map((lines) => lines.length)) * 12 + 12;
      writer.ensure(rowHeight + 4);
      if (index % 2 === 1) {
        writer.pdfPage.drawRectangle({
          x: MARGIN,
          y: writer.y - rowHeight + 9,
          width: CONTENT_WIDTH,
          height: rowHeight,
          color: rgb(0.98, 0.99, 0.99),
        });
      }
      let x = MARGIN + 7;
      for (const [cellIndex, lines] of wrapped.entries()) {
        let lineY = writer.y;
        for (const line of lines) {
          writer.pdfPage.drawText(line, {
            x,
            y: lineY,
            size: 8.5,
            font: writer.regular,
            color: INK,
          });
          lineY -= 12;
        }
        x += columns[cellIndex].width;
      }
      writer.pdfPage.drawLine({
        start: { x: MARGIN, y: writer.y - rowHeight + 8 },
        end: { x: PAGE_WIDTH - MARGIN, y: writer.y - rowHeight + 8 },
        thickness: 0.5,
        color: BORDER,
      });
      writer.y -= rowHeight;
      if (writer.y < MARGIN + 70) {
        writer.addPage();
        drawTableHeader();
      }
    }
  }

  writer.y -= 4;
  if (data.record.treatmentAdvice) {
    writer.paragraph("Treatment advice", {
      size: 8,
      bold: true,
      color: MUTED,
      after: 2,
    });
    writer.paragraph(data.record.treatmentAdvice, { size: 9.5, after: 8 });
  }
  if (data.record.followUp) {
    writer.paragraph("Follow-up", {
      size: 8,
      bold: true,
      color: MUTED,
      after: 2,
    });
    writer.paragraph(data.record.followUp, { size: 9.5, after: 8 });
  }
  if (data.record.notes) {
    writer.paragraph("Consultation notes", {
      size: 8,
      bold: true,
      color: MUTED,
      after: 2,
    });
    writer.paragraph(data.record.notes, { size: 9, color: MUTED, after: 8 });
  }
  if (data.record.attachments.length > 0) {
    writer.paragraph("Attached reports & scans", {
      size: 8,
      bold: true,
      color: MUTED,
      after: 2,
    });
    for (const attachment of data.record.attachments) {
      writer.paragraph(`- ${attachment.fileName}`, {
        size: 8.5,
        color: MUTED,
        after: 1,
      });
    }
    writer.y -= 6;
  }

  writer.ensure(58);
  writer.y -= 20;
  writer.pdfPage.drawLine({
    start: { x: PAGE_WIDTH - MARGIN - 170, y: writer.y },
    end: { x: PAGE_WIDTH - MARGIN, y: writer.y },
    thickness: 0.8,
    color: INK,
  });
  writer.y -= 13;
  writer.paragraph(data.doctor.name, {
    size: 9,
    bold: true,
    x: PAGE_WIDTH - MARGIN - 170,
    width: 170,
    after: 1,
  });
  writer.paragraph("Doctor's signature", {
    size: 8,
    color: MUTED,
    x: PAGE_WIDTH - MARGIN - 170,
    width: 170,
  });
}

function drawFooters(doc: PDFDocument, font: PDFFont) {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const text = `Computer-generated document  |  Page ${index + 1} of ${pages.length}`;
    const width = font.widthOfTextAtSize(text, 7.5);
    page.drawText(text, {
      x: (PAGE_WIDTH - width) / 2,
      y: 24,
      size: 7.5,
      font,
      color: MUTED,
    });
  });
}

export async function buildConsultationDocumentPdf(
  type: ConsultationDocumentType,
  data: ConsultationDocumentData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new DocumentWriter(doc, regular, bold);

  doc.setTitle(
    `${type === "invoice" ? "Consultation invoice" : "Prescription"} - ${data.appointment.code}`,
  );
  doc.setAuthor(data.clinic.name);
  doc.setSubject(
    type === "invoice" ? "Consultation invoice" : "Doctor prescription",
  );
  doc.setCreator("HealthCare OS");

  drawHeader(writer, data, type);
  if (type === "invoice") {
    drawInvoiceBody(writer, data);
  } else {
    drawPrescriptionBody(writer, data);
  }
  drawFooters(doc, regular);

  return doc.save();
}
