// The interpreter stub + the gate (ch. 3, 4). The "model" here is a
// deterministic stand-in that emits proposals, including hostile ones; the
// architecture, not inference, is what this repo demonstrates.
import {
  admitStanding,
  certId,
  confirmStanding,
  proposalId,
  type Ask,
  type Certification,
  type Proposal,
  type RequestContract,
  type RequesterRecord,
  type Standing,
} from "../records.ts";

export interface GateContent {
  contract: RequestContract;
  standing: Standing;
}

let n = 0;
const nextId = (p: string) => `${p}-${++n}`;

export function draftContract(requestText: string): Proposal<RequestContract> {
  const hostile = /every account|ignore policy/i.test(requestText);
  const asks: Ask[] = [
    {
      askId: nextId("a"),
      kind: "ranking",
      qualifiers: ["external payments only"],
      sourceSpan: "paid most often this quarter",
      resolution: { state: "resolved" },
    },
    {
      askId: nextId("a"),
      kind: "first-appearance",
      qualifiers: [],
      sourceSpan: "are any of those counterparties new",
      resolution: { state: "resolved" },
    },
  ];
  return {
    proposalId: proposalId(),
    proposedBy: "interpreter-stub/1",
    content: {
      contractId: nextId("c"),
      requestText,
      subjects: hostile ? ["acct-1187", "acct-*"] : ["acct-1187"],
      sources: ["payments"],
      window: { from: "2025-04-01", to: "2025-06-30", origin: "assumed" },
      asks,
      unclaimedText: [],
    },
    basis: [requestText],
  };
}

export function coherent(c: RequestContract): boolean {
  return c.asks.length > 0 && c.subjects.length > 0 && c.window.from < c.window.to;
}

export function certifyAdmitted(p: Proposal<RequestContract>, policyRow: string): Certification<GateContent> {
  if (!coherent(p.content)) throw new Error("incoherent contract cannot be admitted");
  return {
    certId: certId(),
    proposalId: p.proposalId,
    decidedBy: "contract-gate",
    decision: "accepted",
    content: { contract: p.content, standing: admitStanding(policyRow) },
    grounds: ["coherence checks passed", `admission policy ${policyRow}`],
  };
}

export function certifyConfirmed(p: Proposal<RequestContract>, record: RequesterRecord): Certification<GateContent> {
  if (!coherent(p.content)) throw new Error("incoherent contract cannot be confirmed");
  return {
    certId: certId(),
    proposalId: p.proposalId,
    decidedBy: "contract-gate",
    decision: "accepted",
    content: { contract: p.content, standing: confirmStanding(record) },
    grounds: ["coherence checks passed", `requester record ${record.requesterId}`],
  };
}
