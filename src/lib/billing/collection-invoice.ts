import "server-only";

import { isDuplicateKeyError } from "@/lib/api/response";
import { money } from "@/lib/billing/money";
import { appendPaymentEvent } from "@/lib/billing/events";
import { nextInvoiceCode } from "@/lib/billing/counter";
import { Invoice, type InvoiceDocument } from "@/models/Invoice";

interface CollectionInvoiceSource {
  _id: unknown;
  collectionCode: string;
  patientId: unknown;
  laboratoryId: unknown;
  items: {
    labTestId?: unknown;
    testName: string;
    price: number;
  }[];
}

async function issueDraft(
  invoice: InvoiceDocument,
  actorId: string,
): Promise<InvoiceDocument> {
  if (invoice.status !== "DRAFT") return invoice;

  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, status: "DRAFT" },
    { $set: { status: "ISSUED" } },
    { new: true },
  );
  if (!updated) {
    return (await Invoice.findById(invoice._id)) ?? invoice;
  }

  await appendPaymentEvent({
    invoiceId: String(updated._id),
    action: "INVOICE_ISSUED",
    fromStatus: "DRAFT",
    toStatus: "ISSUED",
    actorId,
    metadata: { total: updated.totalAmount },
  });

  return updated;
}

export async function ensureCollectionInvoice(
  source: CollectionInvoiceSource,
  actorId: string,
): Promise<InvoiceDocument> {
  const existing = await Invoice.findOne({
    sourceType: "HOME_COLLECTION",
    sourceId: source._id,
    status: { $ne: "VOID" },
  });
  if (existing) return issueDraft(existing, actorId);

  const lineTotals = source.items.map((item) =>
    money(Number(item.price) || 0),
  );
  const subtotal = money(
    lineTotals.reduce((sum, value) => sum + value, 0),
  );
  const invoiceCode = await nextInvoiceCode();

  try {
    const created = await Invoice.create({
      invoiceCode,
      patientId: source.patientId,
      laboratoryId: source.laboratoryId,
      sourceType: "HOME_COLLECTION",
      sourceId: source._id,
      sourceKey: source.collectionCode,
      activeSourceKey: source.collectionCode,
      items: source.items.map((item, index) => ({
        labTestId:
          item.labTestId === null || item.labTestId === undefined
            ? null
            : String(item.labTestId),
        description: item.testName,
        unitPrice: lineTotals[index],
        quantity: 1,
        lineTotal: lineTotals[index],
      })),
      subtotal,
      totalAmount: subtotal,
      status: "DRAFT",
      notes: null,
      voidReason: null,
      createdBy: actorId,
      idempotencyKey: null,
    });

    await appendPaymentEvent({
      invoiceId: String(created._id),
      action: "INVOICE_CREATED",
      fromStatus: null,
      toStatus: "DRAFT",
      actorId,
      metadata: { total: subtotal },
    });

    return await issueDraft(created, actorId);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const replay = await Invoice.findOne({
        sourceType: "HOME_COLLECTION",
        sourceId: source._id,
        status: { $ne: "VOID" },
      });
      if (replay) return issueDraft(replay, actorId);
    }
    throw error;
  }
}
