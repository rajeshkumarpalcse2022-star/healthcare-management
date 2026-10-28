import { money, moneyNonNegative } from "@/lib/billing/money";

/**
 * Derived balance arithmetic for invoices (P1-2). Payments are the source of
 * truth - no balance is stored on the invoice itself, so a crash between any
 * two writes can never leave a permanently wrong outstanding amount: the
 * next read recomputes from the ledger.
 */

export interface PaymentLike {
  kind: "PAYMENT" | "REFUND";
  amount: number;
}

/** Sum of payments minus refunds (may be negative only transiently). */
export function netPaid(payments: PaymentLike[]): number {
  let net = 0;
  for (const payment of payments) {
    net += payment.kind === "REFUND" ? -payment.amount : payment.amount;
  }
  return money(net);
}

/** Amount still owed: total minus net paid, never below zero. */
export function outstandingBalance(
  totalAmount: number,
  payments: PaymentLike[],
): number {
  return moneyNonNegative(money(totalAmount) - netPaid(payments));
}

/** True when net payments equal the invoice total exactly (fully settled). */
export function isFullySettled(
  totalAmount: number,
  payments: PaymentLike[],
): boolean {
  return money(totalAmount) === netPaid(payments);
}

/**
 * True when a full refund has returned the ledger to zero net payments
 * against a non-zero total - the condition that automatically reverts a
 * PAID invoice back to ISSUED.
 */
export function isFullyRefunded(
  totalAmount: number,
  payments: PaymentLike[],
): boolean {
  return money(totalAmount) !== 0 && netPaid(payments) === 0;
}
