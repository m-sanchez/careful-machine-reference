// Invented payment data, deterministic and labelled illustrative.
// Shaped so a capped read distorts the ranking: Alder Logistics front-loads
// the quarter, Marram Freight spreads through it and wins overall; and so a
// window-only view mislabels novelty: Quayside Marine first paid last year.
import type { PaymentRow } from "./records.ts";

function row(i: number, counterparty: string, month: number, day: number, kind: PaymentRow["kind"] = "external"): PaymentRow {
  return {
    paymentId: `pay-${String(i).padStart(4, "0")}`,
    account: "acct-1187",
    counterparty,
    amountMinor: 100_000 + (i % 7) * 12_500,
    at: `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    kind,
  };
}

export function buildStore(): PaymentRow[] {
  const rows: PaymentRow[] = [];
  let i = 0;
  // prior year: Quayside Marine already a counterparty (novelty ground truth)
  for (let d = 0; d < 6; d++) rows.push(row(i++, "Quayside Marine", 1, d + 3));
  // April: Alder Logistics heavy early (lands inside the cap)
  for (let d = 0; d < 260; d++) rows.push(row(i++, "Alder Logistics", 4, (d % 28) + 1));
  for (let d = 0; d < 130; d++) rows.push(row(i++, "Marram Freight", 4, (d % 28) + 1));
  for (let d = 0; d < 30; d++) rows.push(row(i++, "acct-1187-savings", 4, (d % 28) + 1, "internal-transfer"));
  // May + June: Marram Freight dominates (mostly beyond the cap)
  for (let d = 0; d < 170; d++) rows.push(row(i++, "Alder Logistics", 5 + (d % 2), (d % 28) + 1));
  for (let d = 0; d < 540; d++) rows.push(row(i++, "Marram Freight", 5 + (d % 2), (d % 28) + 1));
  // June only: Quayside returns (an OLD counterparty a window read calls new)
  for (let d = 0; d < 120; d++) rows.push(row(i++, "Quayside Marine", 6, (d % 28) + 1));
  // June only: Hollis Print (genuinely new; same shape as Quayside in-window)
  for (let d = 0; d < 60; d++) rows.push(row(i++, "Hollis Print", 6, (d % 28) + 1));
  return rows;
}

export const QUARTER = { from: "2025-04-01", to: "2025-06-30" } as const;

export function inWindow(r: PaymentRow, w: { from: string; to: string }): boolean {
  return r.at >= w.from && r.at <= w.to;
}
