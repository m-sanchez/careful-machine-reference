// The chapter-1 machine, deliberately ordinary. Every component below works
// as documented; the confident wrong answers come from the empty space
// between them: a pagination default nobody owns, a ranking narrated as the
// quarter, novelty answered from the window because nothing owns the
// question. The tests demonstrate the failure, not correctness.
import type { PaymentRow } from "../records.ts";
import { inWindow, QUARTER } from "../store.ts";

export const PAGE_CAP = 500; // documented client default

export function cappedRead(store: PaymentRow[], account: string): PaymentRow[] {
  return store
    .filter((r) => r.account === account && inWindow(r, QUARTER))
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(0, PAGE_CAP); // page one; nobody asked for page two
}

export function rank(rows: PaymentRow[]): { counterparty: string; payments: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.counterparty, (counts.get(r.counterparty) ?? 0) + 1);
  return [...counts.entries()]
    .map(([counterparty, payments]) => ({ counterparty, payments }))
    .sort((a, b) => b.payments - a.payments);
}

export function answer(store: PaymentRow[], account: string): string {
  // ranking from the capped read; nobody asked for page two
  const ranked = rank(cappedRead(store, account));
  const top = ranked[0]!;
  // "new" computed from the window, because no component owns history: the
  // full quarter is read, and first-seen-in-window stands in for first-seen
  const windowRows = store.filter((r) => r.account === account && inWindow(r, QUARTER));
  const firstSeen = new Map<string, string>();
  for (const r of windowRows.sort((a, b) => (a.at < b.at ? -1 : 1)))
    if (!firstSeen.has(r.counterparty)) firstSeen.set(r.counterparty, r.at);
  const newOnes = [...firstSeen.entries()].filter(([, at]) => at >= "2025-05-01").map(([c]) => c);
  return (
    `Most frequent payee this quarter: ${top.counterparty} (${top.payments} payments). ` +
    `New counterparties this quarter: ${newOnes.length ? newOnes.join(", ") : "none"}.`
  );
}
