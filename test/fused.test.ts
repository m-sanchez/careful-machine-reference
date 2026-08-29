// These tests demonstrate the failure, not correctness: the fused machine
// produces confident wrong answers while every component works as documented.
import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, cappedRead, PAGE_CAP, rank } from "../src/fused/machine.ts";
import { buildStore, inWindow, QUARTER } from "../src/store.ts";

const store = buildStore();

function trueTopExternal(): string {
  const rows = store.filter((r) => r.account === "acct-1187" && inWindow(r, QUARTER) && r.kind === "external");
  return rank(rows)[0]!.counterparty;
}

test("the capped read silently truncates the quarter", () => {
  const rows = cappedRead(store, "acct-1187");
  assert.equal(rows.length, PAGE_CAP);
  const population = store.filter((r) => r.account === "acct-1187" && inWindow(r, QUARTER)).length;
  assert.ok(population > PAGE_CAP, "the quarter holds more rows than one page");
});

test("the narrated 'most frequent payee' is wrong about the quarter", () => {
  const out = answer(store, "acct-1187");
  assert.match(out, /Most frequent payee this quarter: Alder Logistics/);
  assert.equal(trueTopExternal(), "Marram Freight"); // the actual quarter disagrees
});

test("the narrated 'new counterparties' calls an old counterparty new", () => {
  const out = answer(store, "acct-1187");
  assert.match(out, /New counterparties this quarter: .*Quayside Marine/);
  const priorHistory = store.filter((r) => r.counterparty === "Quayside Marine" && r.at < QUARTER.from);
  assert.ok(priorHistory.length > 0, "Quayside Marine has prior-year history the window cannot see");
});
