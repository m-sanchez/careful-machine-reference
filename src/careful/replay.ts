// Replay (ch. 17): the answer record is a join over the records; replay is
// resolving every reference it names and finding each one present.
import type { AnswerRecord, Certification, DispositionGrounds, ExecutionRecord, Verdict } from "../records.ts";
import type { GateContent } from "./gate.ts";
import type { EffectiveScope } from "./scope.ts";
import type { Ledger } from "./verify.ts";
import { REGISTRY_VERSION } from "./registry.ts";

let n = 0;

export function buildAnswerRecord(
  gateCert: Certification<GateContent>,
  scopeCert: Certification<EffectiveScope>,
  exec: ExecutionRecord,
  ledger: Ledger,
  verdicts: Verdict[],
  disposition: DispositionGrounds,
): AnswerRecord {
  return {
    answerId: `ans-${++n}`,
    contractRef: gateCert.content.contract.contractId,
    standing: gateCert.content.standing.kind,
    scopeCertRef: scopeCert.certId,
    registryVersion: REGISTRY_VERSION,
    executionRefs: [exec.execId],
    evidenceRefs: [...ledger.evidence.keys()],
    resultRefs: [...ledger.results.keys()],
    certified: verdicts.filter((v) => v.outcome === "certified").map((v) => v.claimId),
    struck: verdicts.filter((v) => v.outcome === "struck").map((v) => v.claimId),
    disposition,
  };
}

export function replay(
  ans: AnswerRecord,
  world: {
    contracts: Set<string>;
    certs: Set<string>;
    executions: Set<string>;
    ledger: Ledger;
    claims: Set<string>;
  },
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!world.contracts.has(ans.contractRef)) missing.push(ans.contractRef);
  if (!world.certs.has(ans.scopeCertRef)) missing.push(ans.scopeCertRef);
  for (const x of ans.executionRefs) if (!world.executions.has(x)) missing.push(x);
  for (const e of ans.evidenceRefs) if (!world.ledger.evidence.has(e)) missing.push(e);
  for (const r of ans.resultRefs) if (!world.ledger.results.has(r)) missing.push(r);
  for (const c of [...ans.certified, ...ans.struck]) if (!world.claims.has(c)) missing.push(c);
  return { ok: missing.length === 0, missing };
}
