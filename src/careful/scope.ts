// Authority and the intersection (ch. 6). Pure over records: the input is
// the gate's certification, never the raw proposal, and a hostile proposal
// can widen only itself; the grant table is not its to move.
import type { Certification, ScopeConflict, ScopeGrant } from "../records.ts";
import { certId } from "../records.ts";
import type { GateContent } from "./gate.ts";

export const GRANTS: ScopeGrant[] = [
  {
    grantId: "HR-2214",
    grantedTo: "northstar-risk",
    subjects: ["acct-1187"],
    sources: ["payments"],
    expiresAt: "2026-01-01",
  },
];

export interface EffectiveScope {
  inScope: { subjects: string[]; sources: string[] };
  conflicts: ScopeConflict[];
}

export function effectiveScope(
  gateCert: Certification<GateContent>,
  grants: ScopeGrant[],
  today: string,
): Certification<EffectiveScope> {
  const contract = gateCert.content.contract;
  const live = grants.filter((g) => g.expiresAt > today);
  const grantedSubjects = new Set(live.flatMap((g) => g.subjects));
  const grantedSources = new Set(live.flatMap((g) => g.sources));
  const conflicts: ScopeConflict[] = [];
  const subjects = contract.subjects.filter((s) => {
    if (grantedSubjects.has(s)) return true;
    conflicts.push({ element: s, ground: "no grant in force covers this subject" });
    return false;
  });
  const sources = contract.sources.filter((s) => {
    if (grantedSources.has(s)) return true;
    conflicts.push({ element: s, ground: "no grant in force covers this source" });
    return false;
  });
  return {
    certId: certId(),
    proposalId: gateCert.proposalId, // same lineage the gate certified
    decidedBy: "authority-service",
    decision: conflicts.length ? "narrowed" : "accepted",
    content: { inScope: { subjects, sources }, conflicts },
    grounds: live.map((g) => `grant ${g.grantId}`).concat(`gate ${gateCert.certId}`),
  };
}
