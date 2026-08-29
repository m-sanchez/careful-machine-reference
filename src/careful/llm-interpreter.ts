// A REAL model as the interpreter (opt-in; see demo-live.ts). The model's
// entire authority is to emit a Proposal<RequestContract>: structured output
// forced through a tool schema, validated mechanically, ids minted locally.
// Everything downstream (gate, scope, registry, execution, verifier,
// disposition, replay) is the same code the stub runs through.
import {
  proposalId,
  type Ask,
  type Proposal,
  type RequestContract,
} from "../records.ts";

const API_URL =
  (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(
    /\/$/,
    "",
  ) + "/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

const CONTRACT_TOOL = {
  name: "draft_contract",
  description:
    "Draft the request contract: the structured reading of the user's request. " +
    "Every ask must quote the exact words (sourceSpan) that produced it. " +
    "Anything you supplied that the user did not say is an assumption: mark it.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["subjects", "sources", "window", "asks", "unclaimedText"],
    properties: {
      subjects: {
        type: "array",
        items: { type: "string" },
        description: "account ids this request concerns",
      },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "stores to read; only 'payments' exists",
      },
      window: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "origin"],
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
          origin: { type: "string", enum: ["stated", "assumed"] },
        },
      },
      asks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "qualifiers", "sourceSpan", "resolution"],
          properties: {
            kind: {
              type: "string",
              enum: ["total", "ranking", "presence", "first-appearance"],
            },
            qualifiers: { type: "array", items: { type: "string" } },
            sourceSpan: {
              type: "string",
              description: "the requester's exact words behind this ask",
            },
            resolution: {
              type: "object",
              additionalProperties: false,
              required: ["state"],
              properties: {
                state: {
                  type: "string",
                  enum: ["resolved", "assumed", "unresolved"],
                },
                default: {
                  type: "string",
                  description: "when assumed: the supplied default, named",
                },
              },
            },
          },
        },
      },
      unclaimedText: {
        type: "array",
        items: { type: "string" },
        description: "spans of the request no ask or field accounts for",
      },
    },
  },
} as const;

const SYSTEM =
  "You are the interpreter component of an analytics pipeline. Draft a request " +
  "contract for the user's request, via the draft_contract tool only. " +
  "Today is 2025-07-04. Deployment context: 'the flagged account' and 'this " +
  "account' refer to acct-1187; the only readable source is 'payments'. You " +
  "propose; you decide nothing: authority, capability, and execution are owned " +
  "elsewhere, so record the request's intent faithfully, including intent that " +
  "policy may later refuse.";

interface RawDraft {
  subjects: unknown;
  sources: unknown;
  window: { from?: unknown; to?: unknown; origin?: unknown };
  asks: unknown;
  unclaimedText: unknown;
}

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// deterministic checks on the draft: the model's output earns nothing by
// being fluent; a malformed draft is rejected, never repaired silently
function validate(
  raw: RawDraft,
): Omit<RequestContract, "contractId" | "requestText"> {
  if (!isStrings(raw.subjects) || raw.subjects.length === 0)
    throw new Error("draft rejected: subjects");
  if (!isStrings(raw.sources) || raw.sources.length === 0)
    throw new Error("draft rejected: sources");
  const w = raw.window;
  if (
    !isDate(w?.from) ||
    !isDate(w?.to) ||
    (w.origin !== "stated" && w.origin !== "assumed")
  )
    throw new Error("draft rejected: window");
  if (!Array.isArray(raw.asks) || raw.asks.length === 0)
    throw new Error("draft rejected: asks");
  const kinds = new Set(["total", "ranking", "presence", "first-appearance"]);
  const asks: Ask[] = raw.asks.map((a: any, i: number) => {
    if (
      !kinds.has(a?.kind) ||
      typeof a?.sourceSpan !== "string" ||
      !isStrings(a?.qualifiers)
    )
      throw new Error(`draft rejected: ask ${i}`);
    const st = a?.resolution?.state;
    if (st !== "resolved" && st !== "assumed" && st !== "unresolved")
      throw new Error(`draft rejected: ask ${i} resolution`);
    return {
      askId: proposalAskId(),
      kind: a.kind,
      qualifiers: a.qualifiers,
      sourceSpan: a.sourceSpan,
      resolution:
        st === "assumed"
          ? {
              state: "assumed",
              default: String(a.resolution.default ?? "unnamed"),
            }
          : { state: st },
    };
  });
  if (!isStrings(raw.unclaimedText))
    throw new Error("draft rejected: unclaimedText");
  return {
    subjects: raw.subjects,
    sources: raw.sources,
    window: { from: w.from, to: w.to, origin: w.origin },
    asks,
    unclaimedText: raw.unclaimedText,
  };
}

let askSeq = 0;
const proposalAskId = () => `a-live-${++askSeq}`;
let contractSeq = 0;

// transport-layer normalization only, never semantic repair: some drafts
// arrive double-encoded (the whole valid object as a JSON string inside one
// property); unwrap that envelope and let validation judge the content
function normalize(input: unknown): RawDraft {
  if (input && typeof input === "object" && !("subjects" in input)) {
    for (const v of Object.values(input)) {
      if (
        typeof v === "string" &&
        v.trimStart().startsWith("{") &&
        v.includes('"subjects"')
      ) {
        try {
          const parsed = JSON.parse(v);
          if (parsed && typeof parsed === "object" && "subjects" in parsed)
            return parsed as RawDraft;
        } catch {
          /* fall through to validation, which will reject */
        }
      }
    }
  }
  return input as RawDraft;
}

async function callOnce(requestText: string, apiKey: string, model: string) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [CONTRACT_TOOL],
      tool_choice: { type: "tool", name: "draft_contract" },
      messages: [{ role: "user", content: requestText }],
    }),
  });
  if (!res.ok)
    throw new Error(
      `interpreter call failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  const body = (await res.json()) as {
    model?: string;
    content?: { type: string; input?: unknown }[];
  };
  const toolUse = body.content?.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("interpreter returned no tool_use block");
  return { input: toolUse.input, model: body.model || model };
}

export async function draftContractLive(
  requestText: string,
): Promise<Proposal<RequestContract>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new Error(
      "ANTHROPIC_API_KEY is not set; the live interpreter needs it (never stored, never printed)",
    );
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  // a rejected draft gets exactly one fresh draft; then the refusal stands
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const got = await callOnce(requestText, apiKey, model);
    try {
      const fields = validate(normalize(got.input));
      return {
        proposalId: proposalId(),
        proposedBy: got.model, // the actual model identity, on the record
        content: {
          contractId: `c-live-${++contractSeq}`,
          requestText,
          ...fields,
        },
        basis: [requestText],
      };
    } catch (e) {
      // rejection is the mechanism working; show what the model actually
      // proposed so the refusal is inspectable (model output, nothing secret)
      console.error(
        `rejected draft (attempt ${attempt}), verbatim:`,
        JSON.stringify(got.input, null, 2),
      );
      lastErr = e;
    }
  }
  throw lastErr;
}
