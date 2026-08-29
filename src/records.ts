// The book's record types, as code. Chapter references in comments.
// Demonstration, not framework: plain types, no persistence, no config.

// ---- branded ids (ch. 2: an execution takes a certification, never a proposal) ----
declare const proposalIdBrand: unique symbol;
declare const certIdBrand: unique symbol;
export type ProposalId = string & { readonly [proposalIdBrand]: true };
export type CertId = string & { readonly [certIdBrand]: true };

let seq = 0;
export function proposalId(): ProposalId {
  seq += 1;
  return `p-${seq}` as ProposalId;
}
export function certId(): CertId {
  seq += 1;
  return `cert-${seq}` as CertId;
}

// ---- proposal / certification / execution (ch. 2) ----
export interface Proposal<T> {
  proposalId: ProposalId;
  proposedBy: string; // model id + prompt release
  content: T;
  basis: string[]; // what the proposer was shown
}

export type Decision =
  | "accepted"
  | "narrowed"
  | "rejected"
  | "cannot-execute"
  | "approval-required";

export interface Certification<T> {
  certId: CertId;
  proposalId: ProposalId;
  decidedBy: string;
  decision: Decision;
  content: T; // what was certified (possibly narrowed)
  grounds: string[];
}

export interface ExecutionRecord {
  execId: string;
  certId: CertId; // executes only certifications, never proposals
  ranOperations: string[];
  produced: string[]; // evidence and derived-result ids
}

// ---- contract standings (ch. 3) ----
// requester-confirmed is mintable ONLY through confirmStanding below: the
// brand symbol never leaves this module, so no other code can forge the shape.
const confirmedBrand: unique symbol = Symbol("requester-confirmed");

export interface RequesterRecord {
  requesterId: string; // attributable person or delegate
  confirmedAssumptions: string[];
  at: string;
}

export type Standing =
  | {
      readonly kind: "requester-confirmed";
      readonly record: RequesterRecord;
      readonly [confirmedBrand]: true;
    }
  | { readonly kind: "policy-admitted"; readonly policyRow: string };

export function confirmStanding(record: RequesterRecord): Standing {
  if (!record.requesterId) throw new Error("confirmation requires an attributable requester");
  return { kind: "requester-confirmed", record, [confirmedBrand]: true };
}

export function admitStanding(policyRow: string): Standing {
  return { kind: "policy-admitted", policyRow };
}

// ---- the contract (ch. 4) ----
export type AskKind = "total" | "ranking" | "presence" | "first-appearance";
export type Resolution =
  | { state: "resolved" }
  | { state: "assumed"; default: string }
  | { state: "unresolved" };

export interface Ask {
  askId: string;
  kind: AskKind;
  qualifiers: string[];
  sourceSpan: string; // the words in requestText that produced this ask
  resolution: Resolution;
}

export interface RequestContract {
  contractId: string;
  requestText: string; // verbatim, immutable
  subjects: string[];
  sources: string[];
  window: { from: string; to: string; origin: "stated" | "assumed" };
  asks: Ask[];
  unclaimedText: string[]; // rendered even when empty
}

// ---- capability (ch. 5) ----
export interface OperationSpec {
  opId: string;
  version: number;
  establishes: ClaimKind[];
  requires: string[];
  coverageContract: string;
}

export interface SourceSpec {
  sourceId: string;
  supports: ClaimKind[];
}

// ---- authority (ch. 6) ----
export interface ScopeGrant {
  grantId: string;
  grantedTo: string;
  subjects: string[];
  sources: string[];
  expiresAt: string; // enforced, not commemorative
}

export interface ScopeConflict {
  element: string;
  ground: string;
}

// ---- evidence (ch. 7 and 8) ----
export interface Coverage {
  itemsRead: number;
  populationCount: number | "unknown"; // never omitted, never defaulted to 0
  complete: boolean; // true only for a source-certified bounded read
  exclusions: string[];
}

export interface EvidenceRecord {
  evidenceId: string;
  producedBy: string;
  sourceId: string;
  window: { from: string; to: string };
  coverage: Coverage;
  payload: PaymentRow[];
}

export interface PaymentRow {
  paymentId: string;
  account: string;
  counterparty: string;
  amountMinor: number;
  at: string;
  kind: "external" | "internal-transfer";
}

// ---- derived results (ch. 9) ----
export interface DerivedResult {
  resultId: string;
  opId: string;
  opVersion: number;
  inputs: string[]; // evidence + prior result ids, exhaustively
  parameters: Record<string, string | number>;
  value: unknown; // units inside the value where money is involved
  coverage: "complete" | "partial";
  limits: string[];
}

// ---- claims (ch. 11) ----
export type ClaimKind = "derived-value" | "ranking" | "no-occurrence" | "presence";

export interface ProposedClaim {
  claimId: string;
  kind: ClaimKind;
  subject: string[];
  assertion: string;
  evidenceRefs: string[];
  resultRefs: string[];
  coverageClaimed: "complete" | "partial";
}

export interface Verdict {
  claimId: string;
  outcome: "certified" | "struck";
  failingCheck?: string;
}

// ---- disposition (ch. 13) ----
export type ResponseDisposition =
  | "clarification-needed"
  | "cannot-execute"
  | "outside-authority"
  | "prohibited"
  | "approval-pending"
  | "degraded"
  | "answered"
  | "established-negative"
  | "unsupported";

export interface DispositionGrounds {
  disposition: ResponseDisposition;
  records: string[];
  pathToYes: string; // "none" is stated, never absent
}

// ---- replay (ch. 17) ----
export interface AnswerRecord {
  answerId: string;
  contractRef: string;
  standing: Standing["kind"];
  scopeCertRef: CertId;
  registryVersion: number;
  executionRefs: string[];
  evidenceRefs: string[];
  resultRefs: string[];
  certified: string[];
  struck: string[];
  disposition: DispositionGrounds;
}
