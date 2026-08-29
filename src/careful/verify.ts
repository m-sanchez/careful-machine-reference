// The claim turnstile (ch. 11): the model proposes claims as data; a clerk
// with a rulebook certifies the ones whose references resolve, whose
// identifiers match, and whose kinds are supported at the coverage claimed.
import type { DerivedResult, EvidenceRecord, ProposedClaim, Verdict } from "../records.ts";

export interface Ledger {
  evidence: Map<string, EvidenceRecord>;
  results: Map<string, DerivedResult>;
}

export function checkClaim(claim: ProposedClaim, ledger: Ledger): Verdict {
  const struck = (failingCheck: string): Verdict => ({ claimId: claim.claimId, outcome: "struck", failingCheck });

  for (const id of claim.evidenceRefs) if (!ledger.evidence.has(id)) return struck(`evidence ${id} does not resolve`);
  for (const id of claim.resultRefs) if (!ledger.results.has(id)) return struck(`result ${id} does not resolve`);
  const evidence = claim.evidenceRefs.map((id) => ledger.evidence.get(id)!);
  const results = claim.resultRefs.map((id) => ledger.results.get(id)!);

  switch (claim.kind) {
    case "ranking": {
      const r = results[0];
      if (!r) return struck("a ranking claim needs a derived result");
      if (claim.coverageClaimed === "complete" && r.coverage !== "complete")
        return struck("unqualified ranking over a partial read; certify the qualified form instead");
      return { claimId: claim.claimId, outcome: "certified" };
    }
    case "no-occurrence": {
      const e = evidence[0];
      if (!e) return struck("a no-occurrence claim needs evidence");
      if (!e.coverage.complete) return struck("no-occurrence requires a source-certified complete read");
      if (e.coverage.populationCount === "unknown")
        return struck("no-occurrence requires a stated population; unknown is not zero");
      return { claimId: claim.claimId, outcome: "certified" };
    }
    case "presence": {
      const e = evidence[0];
      if (!e || e.coverage.itemsRead === 0) return struck("presence needs at least one supporting row read");
      return { claimId: claim.claimId, outcome: "certified" };
    }
    case "derived-value":
      return results.length ? { claimId: claim.claimId, outcome: "certified" } : struck("derived-value needs a result");
  }
}

export function verifyAll(claims: ProposedClaim[], ledger: Ledger): Verdict[] {
  return claims.map((c) => checkClaim(c, ledger));
}
