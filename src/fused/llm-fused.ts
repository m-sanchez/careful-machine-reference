// The fused machine, live: the SAME model the careful machine uses as its
// interpreter, but unharnessed; it is handed the question and page one of
// the data, and one generation produces the reading, the counting, and the
// narration. Nothing it does is validated, recorded, or replayable; the
// forced tool exists only because the app's UI needs fields to render.
const API_URL =
  (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(
    /\/$/,
    "",
  ) + "/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

const FUSED_TOOL = {
  name: "answer",
  description:
    "Return your answer to the user's question about the payment data.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["answerText"],
    properties: {
      answerText: {
        type: "string",
        description: "your full answer to the user, one short paragraph",
      },
      rankedPayeeNamed: {
        type: "string",
        description:
          "the single counterparty your answer names as the winner of whatever ranking the user asked for (omit if none)",
      },
      rankedCountNamed: {
        type: "number",
        description: "the payment count your answer states for that payee",
      },
      newCounterpartiesNamed: {
        type: "array",
        items: { type: "string" },
        description:
          "the counterparties your answer calls new, if the user asked about new ones",
      },
    },
  },
} as const;

const SYSTEM_FUSED =
  "You are the analytics assistant inside a payments app. Answer the user's " +
  "question directly and confidently from the payment data provided in their " +
  "message. Today is 2025-07-04; 'this quarter' is 2025-04-01 to 2025-06-30. " +
  "Rows are CSV: date,counterparty[,internal-transfer]. Count internal " +
  "transfers separately from external payments.";

export interface FusedFields {
  answerText: string;
  rankedPayeeNamed: string | null;
  rankedCountNamed: number | null;
  newCounterpartiesNamed: string[] | null;
}

export interface FusedExchange {
  model: string;
  request: {
    url: string;
    system: string;
    userMessage: string;
    toolChoice: string;
    toolSchema: string;
  };
  rawReply: string; // verbatim tool input; model output, untrusted text
}

export async function callFusedLive(
  question: string,
  pageOneText: string,
): Promise<{ fields: FusedFields; exchange: FusedExchange }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const userMessage = `${question}\n\nPAYMENT DATA:\n${pageOneText}`;
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
      system: SYSTEM_FUSED,
      tools: [FUSED_TOOL],
      tool_choice: { type: "tool", name: "answer" },
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok)
    throw new Error(
      `fused call failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  const body = (await res.json()) as {
    model?: string;
    content?: { type: string; input?: unknown }[];
  };
  const toolUse = body.content?.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("fused call returned no tool_use block");
  // no validation, no retry: whatever came back is what ships; that is the
  // machine being demonstrated. Missing fields become "no checkable claim".
  const raw = (toolUse.input ?? {}) as Record<string, unknown>;
  const fields: FusedFields = {
    answerText:
      typeof raw.answerText === "string" && raw.answerText
        ? raw.answerText
        : JSON.stringify(toolUse.input),
    rankedPayeeNamed:
      typeof raw.rankedPayeeNamed === "string" ? raw.rankedPayeeNamed : null,
    rankedCountNamed:
      typeof raw.rankedCountNamed === "number" ? raw.rankedCountNamed : null,
    newCounterpartiesNamed: Array.isArray(raw.newCounterpartiesNamed)
      ? raw.newCounterpartiesNamed.filter(
          (x): x is string => typeof x === "string",
        )
      : null,
  };
  return {
    fields,
    exchange: {
      model: body.model || model,
      request: {
        // userinfo stripped: a credentialled ANTHROPIC_BASE_URL must not reach the page
        url: API_URL.replace(/\/\/[^@/]*@/, "//"),
        system: SYSTEM_FUSED,
        userMessage,
        toolChoice: 'forced: { type: "tool", name: "answer" }',
        toolSchema: JSON.stringify(FUSED_TOOL, null, 2),
      },
      rawReply: JSON.stringify(toolUse.input, null, 2),
    },
  };
}
