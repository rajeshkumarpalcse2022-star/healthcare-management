/**
 * Money helpers for the internal billing ledger (P1-2).
 *
 * The platform stores amounts as plain `Number` (accepted technical debt,
 * consistent with `LabBooking.totalAmount`). Every server-side total passes
 * through `money()` so binary floating-point representation error can never
 * silently change a stored value: the value is snapped to 15 significant
 * digits (which absorbs the sub-ULP error a cent boundary like 10.005
 * carries - adding `Number.EPSILON` is NOT enough there), then rounded to 2
 * decimal places half-up. Comparison always goes through `moneyEquals` -
 * never raw `===` on sums of floats.
 */

/** Rounds to 2 decimal places (cents), half-up. */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Number((value * 100).toPrecision(15))) / 100;
}

/** True when two amounts are equal within half a cent. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(money(a) - money(b)) < 0.005;
}

/** Clamped non-negative cent value used for payment arithmetic. */
export function moneyNonNegative(value: number): number {
  return Math.max(0, money(value));
}
