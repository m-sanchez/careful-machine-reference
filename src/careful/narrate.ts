// The narrator's constraint (ch. 11): render certified claims and unmet
// asks; a final check confirms nothing else crept in. The "model" is a stub;
// what matters is that the renderer's input vocabulary is the certified set.
import type { DerivedResult, DispositionGrounds, ProposedClaim, Verdict } from "../records.ts";

let n = 0;
export function proposeClaims(ranking: DerivedResult | null): ProposedClaim[] {
  // The stub behaves like an eager model: it proposes the strong, unqualified
  // ranking claim EVEN when the result's coverage is partial (hedging beside
  // it). The clerk, not the stub, decides what survives.
  // No result, no claims: the narrator can only speak about what executed, so
  // an ask whose operation never ran cannot acquire a sentence here.
  if (!ranking) return [];
  const ranked = ranking.value as { counterparty: string; payments: number }[];
  // an empty read yields no claims at all; the disposition, not the narrator,
  // says what that means
  if (!ranked.length) return [];
  const top = ranked[0]!;
  // subject and period come from the result's own parameters, never from a
  // literal: a claim cannot name a period or an account that was not read
  const subject = String(ranking.parameters.subject);
  const window = String(ranking.parameters.window);
  const mk = (kind: ProposedClaim["kind"], assertion: string, coverageClaimed: "complete" | "partial"): ProposedClaim => ({
    claimId: `pc-${++n}`,
    kind,
    subject: [subject],
    assertion,
    evidenceRefs: [...ranking.inputs],
    resultRefs: [ranking.resultId],
    coverageClaimed,
  });
  const claims = [
    mk("ranking", `most frequent payee in ${window}: ${top.counterparty} (${top.payments} payments)`, "complete"),
  ];
  if (ranking.coverage === "partial")
    claims.push(
      mk(
        "ranking",
        `most frequent payee within the examined rows of ${window}: ${top.counterparty} (${top.payments} of the rows read)`,
        "partial",
      ),
    );
  return claims;
}

// registry-speak stays exact in the records; the rendered sentence gets the
// plain-language equivalent so a cold reader is never handed jargon
const GLOSSES: [string, string][] = [
  [
    "no registered operation establishes first-appearance",
    'this build has no approved way to check "first time ever paid", so it declines that part instead of guessing',
  ],
  [
    "no registered operation establishes least-frequent ranking",
    'this build can rank most-frequent only; it has no approved way to establish "least often", so it declines instead of answering a different question',
  ],
];
const gloss = (s: string) => GLOSSES.reduce((acc, [from, to]) => acc.split(from).join(to), s);

export function render(
  claims: ProposedClaim[],
  verdicts: Verdict[],
  disposition: DispositionGrounds,
): string {
  const certified = new Set(verdicts.filter((v) => v.outcome === "certified").map((v) => v.claimId));
  const lines = claims.filter((c) => certified.has(c.claimId)).map((c) => c.assertion);
  if (disposition.records.length)
    lines.push(`declined, not guessed: ${disposition.records.map(gloss).join("; ")}`);
  if (
    disposition.pathToYes &&
    disposition.pathToYes !== "none" &&
    disposition.disposition !== "answered"
  )
    lines.push(`to unlock it: ${disposition.pathToYes}`);
  const out = lines.join(". ");
  // constraint check: the rendering may not contain an assertion that was
  // proposed but not certified
  for (const c of claims)
    if (!certified.has(c.claimId) && out.includes(c.assertion))
      throw new Error(`renderer leaked a struck claim: ${c.claimId}`);
  return out;
}
