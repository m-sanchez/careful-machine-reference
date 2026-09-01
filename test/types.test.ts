// Structural gates. The compile-time ones are checked by `npm run typecheck`:
// each @ts-expect-error line FAILS the build if the forbidden construction
// ever becomes possible. The runtime tests pin what the package itself claims.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { proposalId, type ExecutionRecord, type Standing } from "../src/records.ts";

const _badExec: ExecutionRecord = {
  execId: "x-1",
  // @ts-expect-error an ExecutionRecord takes a certification id, never a proposal id (ch. 2)
  certId: proposalId(),
  ranOperations: [],
  produced: [],
};

// @ts-expect-error requester-confirmed cannot be forged as a literal; only confirmStanding mints it (ch. 3)
const _forgedStanding: Standing = {
  kind: "requester-confirmed",
  record: { requesterId: "attacker", confirmedAssumptions: [], at: "2025-07-04" },
};

test("compile-time gates are declared (enforced by tsc, see @ts-expect-error above)", () => {
  assert.ok(true);
});

test("the package declares no runtime dependencies", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dependencies?: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});
