import "server-only";

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  COLORS,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PdfWriter,
  drawFooters,
  formatDate,
  formatMoney,
  safeText,
} from "@/lib/documents/pdf-kit";

export interface InvoicePdfData {
  invoice: {
    code: string;
    status: string;
    createdAt: string;
    notes: string | null;
  };
  patient: {
    name: string;
    uniqueId: string | null;
    phone: string | null;
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
    registrationNumber: string | null;
  };
  source: {
    type: string;
    code: string | null;
  };
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  subtotal: number;
  totalAmount: number;
  netPaid: number;
  balance: number;
  payments: {
    code: string;
    kind: string;
    method: string;
    amount: number;
    reference: string | null;
    createdAt: string;
  }[];
}

function laboratoryAddress(data: InvoicePdfData["laboratory"]): string {
  return [data.address, data.city, data.state, data.pincode]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
}

export async function buildInvoicePdf(
  data: InvoicePdfData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new PdfWriter(doc, regular, bold);

  doc.setTitle(`Invoice ${data.invoice.code}`);
  doc.setAuthor(data.laboratory.name);
  doc.setSubject("Laboratory invoice");
  doc.setCreator("HealthCare OS");

  writer.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 108,
    width: PAGE_WIDTH,
    height: 108,
    color: COLORS.primaryDark,
  });
  writer.page.drawText("INVOICE", {
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
    data.laboratory.registrationNumber
      ? `Reg. no: ${data.laboratory.registrationNumber}`
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
  writer.page.drawText(safeText(data.invoice.code), {
    x: MARGIN,
    y: PAGE_HEIGHT - 132,
    size: 14,
    font: bold,
    color: COLORS.ink,
  });
  writer.page.drawText(
    safeText(`Status: ${data.invoice.status}  |  Date: ${formatDate(data.invoice.createdAt)}`),
    {
      x: PAGE_WIDTH - MARGIN - 240,
      y: PAGE_HEIGHT - 132,
      size: 9,
      font: regular,
      color: COLORS.muted,
    },
  );

  writer.y = PAGE_HEIGHT - 152;
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

  writer.sectionTitle("Billed to");
  writer.text(data.patient.name, { size: 11, bold: true, after: 2 });
  const patientMeta = [
    data.patient.uniqueId ? `Patient ID: ${data.patient.uniqueId}` : null,
    data.patient.phone ? `Phone: ${data.patient.phone}` : null,
    data.source.code ? `Reference: ${data.source.code}` : null,
    `Source: ${data.source.type.replace(/_/g, " ")}`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  writer.text(patientMeta, { size: 8.5, color: COLORS.muted, after: 6 });

  writer.sectionTitle("Line items");
  writer.table(
    [
      { header: "Description", width: 300 },
      { header: "Qty", width: 60, align: "right" },
      { header: "Unit price", width: 110, align: "right" },
      { header: "Amount", width: 110, align: "right" },
    ],
    data.items.map((item) => [
      item.description,
      String(item.quantity),
      formatMoney(item.unitPrice),
      formatMoney(item.lineTotal),
    ]),
  );

  const totals: [string, string][] = [
    ["Subtotal", formatMoney(data.subtotal)],
    ["Total", formatMoney(data.totalAmount)],
    ["Net paid", formatMoney(data.netPaid)],
    ["Balance due", formatMoney(data.balance)],
  ];
  writer.ensure(totals.length * 18 + 12);
  const totalsX = PAGE_WIDTH - MARGIN - 220;
  for (const [label, value] of totals) {
    const isBalance = label === "Balance due";
    writer.page.drawText(label, {
      x: totalsX,
      y: writer.y,
      size: 9,
      font: isBalance ? bold : regular,
      color: isBalance ? COLORS.ink : COLORS.muted,
    });
    const valueWidth = (isBalance ? bold : regular).widthOfTextAtSize(
      value,
      9,
    );
    writer.page.drawText(value, {
      x: PAGE_WIDTH - MARGIN - valueWidth,
      y: writer.y,
      size: 9,
      font: isBalance ? bold : regular,
      color: isBalance ? COLORS.ink : COLORS.muted,
    });
    writer.y -= 16;
  }
  writer.y -= 6;

  if (data.payments.length > 0) {
    writer.sectionTitle("Payments & refunds");
    writer.table(
      [
        { header: "Reference", width: 140 },
        { header: "Kind", width: 90 },
        { header: "Method", width: 110 },
        { header: "Amount", width: 100, align: "right" },
        { header: "Recorded", width: 100 },
      ],
      data.payments.map((payment) => [
        payment.code + (payment.reference ? `\n${payment.reference}` : ""),
        payment.kind,
        payment.method.replace(/_/g, " "),
        formatMoney(payment.amount),
        formatDate(payment.createdAt),
      ]),
    );
  }

  if (data.invoice.notes) {
    writer.sectionTitle("Notes");
    writer.text(data.invoice.notes, { size: 9, color: COLORS.muted });
  }

  writer.ensure(60);
  writer.y -= 18;
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y },
    end: { x: PAGE_WIDTH - MARGIN, y: writer.y },
    thickness: 0.6,
    color: COLORS.border,
  });
  writer.y -= 14;
  writer.text(
    "This is a computer-generated invoice. Amounts are recorded in the platform ledger and no online payment gateway is integrated.",
    { size: 7.5, color: COLORS.muted },
  );

  drawFooters(doc, regular);
  return doc.save();
}
