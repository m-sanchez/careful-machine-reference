// Capability is a record, not a vibe (ch. 5). first-appearance is
// deliberately absent: the honest system knows what it cannot establish.
import type { Ask, ClaimKind, OperationSpec, SourceSpec } from "../records.ts";

export const REGISTRY_VERSION = 3;

export const OPERATIONS: OperationSpec[] = [
  {
    opId: "payments-ranking",
    version: 1,
    establishes: ["ranking", "derived-value"],
    requires: ["payments read with coverage"],
    coverageContract: "reports itemsRead against populationCount",
  },
  {
    opId: "payments-presence",
    version: 1,
    establishes: ["presence", "no-occurrence"],
    requires: ["payments read with coverage"],
    coverageContract: "no-occurrence only over a source-certified complete read",
  },
];

export const SOURCES: SourceSpec[] = [
  { sourceId: "payments", supports: ["ranking", "derived-value", "presence", "no-occurrence"] },
];

export interface Selection {
  askId: string;
  op?: OperationSpec;
  cannotExecute?: { ground: string; nearestServiceable: string[] };
}

const ASK_TO_CLAIM: Record<Ask["kind"], ClaimKind | null> = {
  total: "derived-value",
  ranking: "ranking",
  presence: "presence",
  "first-appearance": null, // nothing registered can establish it
};

export function selectOperations(asks: Ask[]): Selection[] {
  return asks.map((ask) => {
    const claimKind = ASK_TO_CLAIM[ask.kind];
    const op = claimKind ? OPERATIONS.find((o) => o.establishes.includes(claimKind)) : undefined;
    if (op) return { askId: ask.askId, op };
    return {
      askId: ask.askId,
      cannotExecute: {
        ground:
          claimKind === null
            ? "no registered operation establishes first-appearance"
            : `no registered operation establishes ${claimKind}`,
        nearestServiceable: [
          "payments-ranking v1 (window-bounded activity)",
          "payments-presence v1 (window-bounded presence)",
        ],
      },
    };
  });
}
