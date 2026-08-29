// The narrator's constraint (ch. 11): render certified claims and unmet
// asks; a final check confirms nothing else crept in. The "model" is a stub;
// what matters is that the renderer's input vocabulary is the certified set.
import type { DerivedResult, DispositionGrounds, ProposedClaim, Verdict } from "../records.ts";

let n = 0;
export function proposeClaims(ranking: DerivedResult): ProposedClaim[] {
  // The stub behaves like an eager model: it proposes the strong, unqualified
  // ranking claim EVEN when the result's coverage is partial (hedging beside
  // it). The clerk, not the stub, decides what survives.
  const ranked = ranking.value as { counterparty: string; payments: number }[];
  const top = ranked[0]!;
  const mk = (kind: ProposedClaim["kind"], assertion: string, coverageClaimed: "complete" | "partial"): ProposedClaim => ({
    claimId: `pc-${++n}`,
    kind,
    subject: ["acct-1187"],
    assertion,
    evidenceRefs: [...ranking.inputs],
    resultRefs: [ranking.resultId],
    coverageClaimed,
  });
  const claims = [
    mk("ranking", `most frequent payee this quarter: ${top.counterparty} (${top.payments} payments)`, "complete"),
  ];
  if (ranking.coverage === "partial")
    claims.push(
      mk(
        "ranking",
        `most frequent payee within the examined rows: ${top.counterparty} (${top.payments} of the rows read)`,
        "partial",
      ),
    );
  return claims;
}

export function render(
  claims: ProposedClaim[],
  verdicts: Verdict[],
  disposition: DispositionGrounds,
): string {
  const certified = new Set(verdicts.filter((v) => v.outcome === "certified").map((v) => v.claimId));
  const lines = claims.filter((c) => certified.has(c.claimId)).map((c) => c.assertion);
  if (disposition.records.length) lines.push(`not established: ${disposition.records.join("; ")}`);
  lines.push(`path to yes: ${disposition.pathToYes}`);
  const out = lines.join(". ");
  // constraint check: the rendering may not contain an assertion that was
  // proposed but not certified
  for (const c of claims)
    if (!certified.has(c.claimId) && out.includes(c.assertion))
      throw new Error(`renderer leaked a struck claim: ${c.claimId}`);
  return out;
}
