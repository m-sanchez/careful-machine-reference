// Action policy + execution + evidence + derived results (ch. 12, 2, 7, 9).
// Reads proceed behind an interception stub; every read stamps coverage at
// the moment of reading; code computes every number.
import type {
  Certification,
  DerivedResult,
  EvidenceRecord,
  ExecutionRecord,
  PaymentRow,
} from "../records.ts";
import { inWindow } from "../store.ts";
import type { EffectiveScope } from "./scope.ts";

export type ActionClass = "read" | "consequential";
export function classify(opIds: string[]): ActionClass {
  return opIds.every((o) => o.startsWith("payments-")) ? "read" : "consequential";
}

export interface InterceptionLog {
  entries: { at: string; op: string }[];
}

let n = 0;
const nextId = (p: string) => `${p}-${++n}`;

export interface RunOptions {
  cap?: number; // present to demonstrate honest PARTIAL coverage
  populationUnknown?: boolean; // an archive that cannot state its population
}

export function run(
  scopeCert: Certification<EffectiveScope>,
  store: PaymentRow[],
  window: { from: string; to: string },
  interception: InterceptionLog,
  opts: RunOptions = {},
): { exec: ExecutionRecord; evidence: EvidenceRecord; ranking: DerivedResult } {
  if (classify(["payments-ranking"]) !== "read") throw new Error("consequential ops need approval");
  interception.entries.push({ at: window.to, op: "payments-ranking v1" });

  const account = scopeCert.content.inScope.subjects[0];
  if (!account) throw new Error("nothing in scope");
  const population = store.filter((r) => r.account === account && inWindow(r, window));
  const rows = opts.cap ? population.slice(0, opts.cap) : population;

  const evidence: EvidenceRecord = {
    evidenceId: nextId("ev"),
    producedBy: "payments-read v1",
    sourceId: "payments",
    window,
    coverage: {
      itemsRead: rows.length,
      populationCount: opts.populationUnknown ? "unknown" : population.length,
      complete: !opts.cap && !opts.populationUnknown,
      exclusions: opts.cap ? [`rows beyond the ${opts.cap}-row cap`] : [],
    },
    payload: rows,
  };

  const external = rows.filter((r) => r.kind === "external");
  const counts = new Map<string, number>();
  for (const r of external) counts.set(r.counterparty, (counts.get(r.counterparty) ?? 0) + 1);
  const ranked = [...counts.entries()]
    .map(([counterparty, payments]) => ({ counterparty, payments }))
    .sort((a, b) => b.payments - a.payments);

  const ranking: DerivedResult = {
    resultId: nextId("dr"),
    opId: "payments-ranking",
    opVersion: 1,
    inputs: [evidence.evidenceId],
    parameters: { window: `${window.from}..${window.to}`, population: "external payments" },
    value: ranked,
    coverage: evidence.coverage.complete ? "complete" : "partial",
    limits: evidence.coverage.complete ? [] : ["computed over a partial read"],
  };

  const exec: ExecutionRecord = {
    execId: nextId("x"),
    certId: scopeCert.certId,
    ranOperations: ["payments-read v1", "payments-ranking v1"],
    produced: [evidence.evidenceId, ranking.resultId],
  };
  return { exec, evidence, ranking };
}
