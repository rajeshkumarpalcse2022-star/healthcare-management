import "server-only";

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  COLORS,
  CONTENT_WIDTH,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PdfWriter,
  drawFooters,
  formatDate,
  formatDateTime,
  formatMoney,
  safeText,
} from "@/lib/documents/pdf-kit";

export interface LabReportPdfData {
  report: {
    code: string;
    title: string;
    summary: string | null;
    findings: string;
    conclusion: string | null;
    reportDate: string;
    createdAt: string;
  };
  collection: {
    code: string;
    scheduledDate: string;
    timeSlot: string;
    timezone: string;
    appliedAt: string;
    collectedAt: string | null;
    notes: string | null;
  };
  laboratory: {
    name: string;
    code: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    accreditation: string | null;
  };
  patient: {
    name: string;
    uniqueId: string | null;
    phone: string | null;
  };
  createdBy: string | null;
  tests: {
    testCode: string;
    testName: string;
    specimenType: string | null;
  }[];
  invoice: {
    invoiceCode: string;
    status: string;
    totalAmount: number;
  } | null;
  attachments: {
    fileName: string;
  }[];
}

function laboratoryAddress(data: LabReportPdfData["laboratory"]): string {
  return [
    data.address,
    data.city,
    data.state,
    data.pincode,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
}

export async function buildLabReportPdf(
  data: LabReportPdfData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new PdfWriter(doc, regular, bold);

  doc.setTitle(`Lab report ${data.report.code}`);
  doc.setAuthor(data.laboratory.name);
  doc.setSubject("Home collection laboratory report");
  doc.setCreator("HealthCare OS");

  writer.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 108,
    width: PAGE_WIDTH,
    height: 108,
    color: COLORS.primaryDark,
  });
  writer.page.drawText("LABORATORY REPORT", {
    x: MARGIN,
    y: PAGE_HEIGHT - 46,
    size: 10,
    font: bold,
    color: COLORS.white,
  });
  writer.page.drawText(safeText(data.laboratory.name), {
    x: MARGIN,
    y: PAGE_HEIGHT - 68,
    size: 17,
    font: bold,
    color: COLORS.white,
  });
  const labMeta = [
    data.laboratory.code ? `Lab code: ${data.laboratory.code}` : null,
    data.laboratory.accreditation
      ? `Accreditation: ${data.laboratory.accreditation}`
      : null,
  ]
    .filter(Boolean)
    .join("  |  ");
  if (labMeta) {
    writer.page.drawText(safeText(labMeta), {
      x: MARGIN,
      y: PAGE_HEIGHT - 85,
      size: 8,
      font: regular,
      color: COLORS.white,
    });
  }
  writer.page.drawText(safeText(data.report.code), {
    x: MARGIN,
    y: PAGE_HEIGHT - 132,
    size: 14,
    font: bold,
    color: COLORS.ink,
  });
  writer.page.drawText(
    safeText(`Report date: ${formatDate(data.report.reportDate)}`),
    {
      x: PAGE_WIDTH - MARGIN - 190,
      y: PAGE_HEIGHT - 132,
      size: 9,
      font: regular,
      color: COLORS.muted,
    },
  );

  writer.y = PAGE_HEIGHT - 148;
  writer.text(data.report.title, { size: 14, bold: true, after: 4 });

  const contact = laboratoryAddress(data.laboratory);
  const labContact = [data.laboratory.phone, data.laboratory.email]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
  if (contact || labContact) {
    writer.text([contact, labContact].filter(Boolean).join(" · "), {
      size: 8,
      color: COLORS.muted,
      after: 8,
    });
  }

  writer.sectionTitle("Patient & collection details");
  const details = [
    ["Patient", data.patient.name],
    ["Patient ID", data.patient.uniqueId ?? "—"],
    ["Phone", data.patient.phone ?? "—"],
    ["Collection", data.collection.code],
    ["Scheduled", `${formatDate(data.collection.scheduledDate)} at ${data.collection.timeSlot}`],
    ["Applied on", formatDateTime(data.collection.appliedAt, data.collection.timezone)],
    ["Collected on", formatDateTime(data.collection.collectedAt, data.collection.timezone)],
    ["Report date", formatDate(data.report.reportDate)],
  ];
  for (let index = 0; index < details.length; index += 2) {
    const left = details[index];
    const right = details[index + 1];
    const half = CONTENT_WIDTH / 2;
    writer.ensure(30);
    writer.page.drawText(safeText(left[0]), {
      x: MARGIN,
      y: writer.y,
      size: 7.5,
      font: bold,
      color: COLORS.muted,
    });
    writer.page.drawText(safeText(left[1]), {
      x: MARGIN,
      y: writer.y - 12,
      size: 9.5,
      font: regular,
      color: COLORS.ink,
    });
    if (right) {
      writer.page.drawText(safeText(right[0]), {
        x: MARGIN + half,
        y: writer.y,
        size: 7.5,
        font: bold,
        color: COLORS.muted,
      });
      writer.page.drawText(safeText(right[1]), {
        x: MARGIN + half,
        y: writer.y - 12,
        size: 9.5,
        font: regular,
        color: COLORS.ink,
      });
    }
    writer.y -= 30;
  }

  writer.sectionTitle("Tests performed");
  writer.table(
    [
      { header: "Test", width: 320 },
      { header: "Code", width: 120 },
      { header: "Specimen", width: 120 },
    ],
    data.tests.map((test) => [
      test.testName,
      test.testCode,
      test.specimenType ?? "—",
    ]),
  );

  if (data.report.summary) {
    writer.sectionTitle("Summary");
    writer.text(data.report.summary, { size: 9.5, after: 6 });
  }

  writer.sectionTitle("Findings / observations");
  writer.text(data.report.findings, { size: 9.5, after: 6 });

  if (data.report.conclusion) {
    writer.sectionTitle("Conclusion / advice");
    writer.text(data.report.conclusion, { size: 9.5, after: 6 });
  }

  if (data.collection.notes) {
    writer.sectionTitle("Collection notes");
    writer.text(data.collection.notes, { size: 9, color: COLORS.muted });
  }

  if (data.attachments.length > 0) {
    writer.sectionTitle("Attached documents");
    for (const attachment of data.attachments) {
      writer.text(`- ${attachment.fileName}`, {
        size: 9,
        color: COLORS.muted,
        after: 1,
      });
    }
    writer.y -= 6;
  }

  if (data.invoice) {
    writer.sectionTitle("Billing reference");
    writer.text(
      `${data.invoice.invoiceCode} · ${data.invoice.status} · ${formatMoney(data.invoice.totalAmount)}`,
      { size: 9.5, after: 4 },
    );
  }

  writer.ensure(90);
  writer.y -= 18;
  writer.page.drawLine({
    start: { x: PAGE_WIDTH - MARGIN - 190, y: writer.y },
    end: { x: PAGE_WIDTH - MARGIN, y: writer.y },
    thickness: 0.8,
    color: COLORS.ink,
  });
  writer.y -= 14;
  writer.page.drawText(
    safeText(data.createdBy ? data.createdBy : "Laboratory team"),
    {
      x: PAGE_WIDTH - MARGIN - 190,
      y: writer.y,
      size: 9,
      font: bold,
      color: COLORS.ink,
    },
  );
  writer.page.drawText("Report prepared by", {
    x: PAGE_WIDTH - MARGIN - 190,
    y: writer.y - 12,
    size: 7.5,
    font: regular,
    color: COLORS.muted,
  });
  writer.y -= 34;

  writer.text(
    "This report is for information and should be interpreted by a qualified medical professional. Please consult your doctor before making any health decision.",
    { size: 7.5, color: COLORS.muted },
  );

  drawFooters(doc, regular);
  return doc.save();
}
