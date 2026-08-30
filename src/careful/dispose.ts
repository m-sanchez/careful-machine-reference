// The routed no (ch. 13): one projection over records, by fixed precedence.
// The input type is the point: nothing in it is model-produced text, so the
// disposition cannot be talked into anything.
import type { DispositionGrounds, ResponseDisposition, ScopeConflict, Verdict } from "../records.ts";

export interface DispositionInput {
  contractCertified: boolean;
  unresolvedAmbiguity: boolean;
  cannotExecuteGrounds: string[]; // registry refusals, by record
  scopeConflicts: ScopeConflict[];
  executed: boolean;
  coveragePartial: boolean;
  verdicts: Verdict[];
}

export function deriveDisposition(input: DispositionInput): DispositionGrounds {
  const certified = input.verdicts.filter((v) => v.outcome === "certified");
  const struck = input.verdicts.filter((v) => v.outcome === "struck");
  const records = [
    ...input.cannotExecuteGrounds,
    ...input.scopeConflicts.map((c) => `${c.element}: ${c.ground}`),
    ...struck.map((v) => `${v.claimId} struck: ${v.failingCheck}`),
  ];

  const answer = (d: ResponseDisposition, pathToYes: string): DispositionGrounds => ({
    disposition: d,
    records,
    pathToYes,
  });

  if (input.unresolvedAmbiguity) return answer("clarification-needed", "answer the clarifying question");
  if (!input.contractCertified) return answer("clarification-needed", "confirm or correct the reading");
  if (!input.executed && input.cannotExecuteGrounds.length)
    return answer("cannot-execute", "ask for the nearest thing this build CAN check");
  if (!input.executed && input.scopeConflicts.length)
    return answer("outside-authority", "ask the scope owner to extend the grant");
  if (!input.executed) return answer("cannot-execute", "none");
  if (certified.length === 0 && struck.length > 0)
    return answer("unsupported", "widen the read or weaken the claim");
  if (input.coveragePartial) return answer("degraded", "run the full read");
  if (certified.length) {
    const routes = [
      ...(input.cannotExecuteGrounds.length ? ["ask for the nearest thing this build CAN check"] : []),
      ...(input.scopeConflicts.length ? ["ask the scope owner to extend the grant"] : []),
    ];
    return answer("answered", routes.length ? routes.join("; ") : "none");
  }
  return answer("unsupported", "none");
}
