// The live interpreter's mechanical validator, offline. This is the only
// boundary between untrusted model output and the record, so the drafts here
// are hostile: malformed, over-helpful, and self-widening. No network: only
// validate() and normalize() are exercised, never callOnce.
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize, validate } from "../src/careful/llm-interpreter.ts";

// README promises `npm test` stays fully offline, and this is the only test
// file that loads the network-capable module: any call is a failure here
let networkCalls = 0;
globalThis.fetch = (() => {
  networkCalls += 1;
  throw new Error("the suite must not touch the network");
}) as typeof fetch;

// a draft that passes, so each case below can spoil exactly one thing
const wellFormed = () => ({
  subjects: ["acct-1187"],
  sources: ["payments"],
  window: { from: "2025-04-01", to: "2025-06-30", origin: "assumed" },
  asks: [
    {
      kind: "ranking",
      direction: "most",
      qualifiers: ["external payments only"],
      sourceSpan: "paid most often this quarter",
      resolution: { state: "resolved" },
    },
  ],
  unclaimedText: [],
});

const spoil = (mut: (d: ReturnType<typeof wellFormed>) => void) => {
  const d = wellFormed();
  mut(d);
  return d;
};

// every rejection names its ground; none of these drafts is repaired
const REJECTED: [string, unknown, RegExp][] = [
  ["a ranking ask with no direction", spoil((d) => delete (d.asks[0] as { direction?: string }).direction), /ask 0 direction/],
  ["a ranking ask whose direction is neither end", spoil((d) => (d.asks[0]!.direction = "middle")), /ask 0 direction/],
  ["a window that is not ISO dates", spoil((d) => (d.window.from = "Q2 2025")), /window/],
  ["a window with no from", spoil((d) => delete (d.window as { from?: string }).from), /window/],
  ["a window whose origin is invented", spoil((d) => (d.window.origin = "inferred")), /window/],
  ["an ask kind outside the enum", spoil((d) => (d.asks[0]!.kind = "trend")), /ask 0$/],
  ["an ask with no sourceSpan", spoil((d) => delete (d.asks[0] as { sourceSpan?: string }).sourceSpan), /ask 0$/],
  ["an ask whose qualifiers are not strings", spoil((d) => ((d.asks[0] as { qualifiers: unknown }).qualifiers = [{ note: "x" }])), /ask 0$/],
  ["a resolution state outside the enum", spoil((d) => (d.asks[0]!.resolution.state = "probably")), /ask 0 resolution/],
  ["no subjects at all", spoil((d) => (d.subjects = [])), /subjects/],
  ["subjects that are not strings", spoil((d) => ((d as { subjects: unknown }).subjects = [{ account: "acct-1187" }])), /subjects/],
  ["no sources at all", spoil((d) => (d.sources = [])), /sources/],
  ["no asks at all", spoil((d) => (d.asks = [])), /asks/],
  ["unclaimedText missing", spoil((d) => delete (d as { unclaimedText?: string[] }).unclaimedText), /unclaimedText/],
  ["a draft that is not an object at all", null, /draft rejected/],
];

for (const [name, draft, reason] of REJECTED)
  test(`the validator rejects ${name}, with the ground named`, () => {
    assert.throws(
      () => validate(normalize(draft)),
      (e: Error) => {
        assert.match(e.message, /^draft rejected/);
        assert.match(e.message, reason);
        return true;
      },
    );
  });

test("a well-formed draft is accepted, and carries only the fields the contract declares", () => {
  const fields = validate(normalize(wellFormed()));
  assert.deepEqual(fields.subjects, ["acct-1187"]);
  assert.deepEqual(fields.window, { from: "2025-04-01", to: "2025-06-30", origin: "assumed" });
  assert.equal(fields.asks.length, 1);
  assert.deepEqual(Object.keys(fields.asks[0]!).sort(), [
    "askId",
    "direction",
    "kind",
    "qualifiers",
    "resolution",
    "sourceSpan",
  ]);
});

test("the validator never carries a field the draft invented, and mints ask ids itself", () => {
  const draft = wellFormed() as Record<string, unknown>;
  draft.contractId = "c-supplied-by-the-model";
  draft.standing = "requester-confirmed";
  (draft.asks as Record<string, unknown>[])[0]!.askId = "a-supplied-by-the-model";
  (draft.asks as Record<string, unknown>[])[0]!.certified = true;
  const fields = validate(normalize(draft)) as Record<string, unknown>;
  assert.equal(fields.contractId, undefined);
  assert.equal(fields.standing, undefined);
  const ask = (fields.asks as Record<string, unknown>[])[0]!;
  assert.equal(ask.certified, undefined);
  assert.notEqual(ask.askId, "a-supplied-by-the-model");
  assert.match(String(ask.askId), /^a-live-\d+$/);
});

test("an assumed resolution keeps the default the draft named, and never invents one", () => {
  const named = validate(
    normalize(spoil((d) => (d.asks[0]!.resolution = { state: "assumed", default: "the preceding calendar quarter" } as never))),
  );
  assert.deepEqual(named.asks[0]!.resolution, {
    state: "assumed",
    default: "the preceding calendar quarter",
  });
  // a draft that assumed something without saying what is recorded as
  // unnamed; the validator does not guess what the model meant
  const unnamed = validate(normalize(spoil((d) => (d.asks[0]!.resolution = { state: "assumed" } as never))));
  assert.deepEqual(unnamed.asks[0]!.resolution, { state: "assumed", default: "unnamed" });
});

test("normalize unwraps a double-encoded envelope and changes nothing else", () => {
  const inner = wellFormed();
  const envelope = { input: JSON.stringify(inner) };
  assert.deepEqual(normalize(envelope), inner);
  const plain = wellFormed();
  assert.equal(normalize(plain), plain); // untouched, not rebuilt
  // an envelope whose payload is not JSON is left for validation to reject
  assert.throws(() => validate(normalize({ input: '{"subjects": broken' })), /draft rejected/);
});

test("normalize invents nothing: an envelope carrying a spoiled draft is still rejected", () => {
  const spoiled = spoil((d) => delete (d.asks[0] as { direction?: string }).direction);
  assert.throws(() => validate(normalize({ input: JSON.stringify(spoiled) })), /ask 0 direction/);
});

test("validate and normalize never touch the network", () => {
  validate(normalize(wellFormed()));
  assert.throws(() => validate(normalize(null)));
  assert.equal(networkCalls, 0);
});
