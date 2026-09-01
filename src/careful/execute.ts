// Action policy + execution + evidence + derived results (ch. 12, 2, 7, 9).
// What the registry SELECTED is what runs: every operation is classified and
// intercepted against the certification it runs under, every read stamps
// coverage at the moment of reading, and code computes every number.
import type {
  CertId,
  Certification,
  DerivedResult,
  EvidenceRecord,
  ExecutionRecord,
  OperationSpec,
  PaymentRow,
} from "../records.ts";
import { inWindow } from "../store.ts";
import type { Selection } from "./registry.ts";
import type { EffectiveScope } from "./scope.ts";

export type ActionClass = "read" | "consequential";
export function classify(opIds: string[]): ActionClass {
  return opIds.every((o) => o.startsWith("payments-")) ? "read" : "consequential";
}

// the interception log is the record of what the classifier let through and
// what it stopped, each line naming the certification it ran under
export interface InterceptionEntry {
  at: string;
  op: string;
  certId: CertId;
  actionClass: ActionClass;
  decision: "allowed" | "refused";
}
export interface InterceptionLog {
  entries: InterceptionEntry[];
}

let n = 0;
const nextId = (p: string) => `${p}-${++n}`;

export interface RunOptions {
  cap?: number; // present to demonstrate honest PARTIAL coverage
  populationUnknown?: boolean; // an archive that cannot state its population
}

export interface RunOutcome {
  executed: boolean; // did anything read under this certification?
  exec: ExecutionRecord | null;
  evidence: EvidenceRecord | null;
  ranking: DerivedResult | null; // only when the registry selected payments-ranking
  cannotExecuteGrounds: string[]; // selected operations this build produced no result for
}

export function run(
  scopeCert: Certification<EffectiveScope>,
  store: PaymentRow[],
  window: { from: string; to: string },
  interception: InterceptionLog,
  selections: Selection[],
  opts: RunOptions = {},
): RunOutcome {
  const nothingRan = (cannotExecuteGrounds: string[] = []): RunOutcome => ({
    executed: false,
    exec: null,
    evidence: null,
    ranking: null,
    cannotExecuteGrounds,
  });
  const label = (o: OperationSpec) => `${o.opId} v${o.version}`;

  // what runs is what the registry selected for the asks, and nothing else
  const ops: OperationSpec[] = [];
  for (const s of selections)
    if (s.op && !ops.some((o) => o.opId === s.op!.opId && o.version === s.op!.version))
      ops.push(s.op);
  // every ask was refused upstream; the refusal grounds are on the selections
  if (!ops.length) return nothingRan();

  const actionClass = classify(ops.map((o) => o.opId));
  if (actionClass !== "read") {
    for (const o of ops)
      interception.entries.push({
        at: window.to,
        op: label(o),
        certId: scopeCert.certId,
        actionClass,
        decision: "refused",
      });
    return nothingRan(
      ops.map((o) => `${label(o)} is a consequential action and this run carries no approval for it`),
    );
  }

  const account = scopeCert.content.inScope.subjects[0];
  // nothing survived the scope intersection: no read happens, and the
  // conflicts already on the certification are what routes the no (ch. 13)
  if (!account) return nothingRan();

  const ranOperations = ["payments-read v1", ...ops.map(label)];
  for (const op of ranOperations)
    interception.entries.push({
      at: window.to,
      op,
      certId: scopeCert.certId,
      actionClass,
      decision: "allowed",
    });

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

  // payments-ranking v1 is the one operation this build computes; a selected
  // operation it cannot compute yields no result and says so by name
  const rankingOp = ops.find((o) => o.opId === "payments-ranking");
  let ranking: DerivedResult | null = null;
  if (rankingOp) {
    const external = rows.filter((r) => r.kind === "external");
    const counts = new Map<string, number>();
    for (const r of external) counts.set(r.counterparty, (counts.get(r.counterparty) ?? 0) + 1);
    const ranked = [...counts.entries()]
      .map(([counterparty, payments]) => ({ counterparty, payments }))
      .sort((a, b) => b.payments - a.payments);
    ranking = {
      resultId: nextId("dr"),
      opId: rankingOp.opId,
      opVersion: rankingOp.version,
      inputs: [evidence.evidenceId],
      // the subject and window travel with the result, so a claim built from
      // it cannot name a subject or period that was not read
      parameters: {
        subject: account,
        window: `${window.from}..${window.to}`,
        population: "external payments",
      },
      value: ranked,
      coverage: evidence.coverage.complete ? "complete" : "partial",
      limits: evidence.coverage.complete ? [] : ["computed over a partial read"],
    };
  }

  const exec: ExecutionRecord = {
    execId: nextId("x"),
    certId: scopeCert.certId,
    ranOperations,
    produced: [evidence.evidenceId, ...(ranking ? [ranking.resultId] : [])],
  };
  return {
    executed: true,
    exec,
    evidence,
    ranking,
    cannotExecuteGrounds: ops
      .filter((o) => o.opId !== "payments-ranking")
      .map((o) => `${label(o)} is registered, but this build computes no ${o.establishes[0]} result for it`),
  };
}
