// Local UI for the demo: one page, one endpoint, zero dependencies.
//   npm run serve            (stub interpreter)
//   ANTHROPIC_API_KEY=... npm run serve   (real model available; never called unless chosen)
// Binds 127.0.0.1 only. The key never reaches the browser.
// Layout: evidence (editable rows) + controls up top; full-width results after.
// Every dynamic string, including live-model output, renders via textContent.
import { createServer } from "node:http";
import { buildStore } from "./store.ts";
import { answer as fusedAnswer, cappedRead, rank } from "./fused/machine.ts";
import {
  callFusedLive,
  type FusedExchange,
  type FusedFields,
} from "./fused/llm-fused.ts";
import {
  draftContract,
  certifyAdmitted,
  certifyConfirmed,
  coherent,
} from "./careful/gate.ts";
import {
  DraftRejectedError,
  draftContractLive,
  type InterpreterExchange,
} from "./careful/llm-interpreter.ts";
import { GRANTS, effectiveScope } from "./careful/scope.ts";
import { selectOperations } from "./careful/registry.ts";
import { run, type InterceptionLog } from "./careful/execute.ts";
import { verifyAll, type Ledger } from "./careful/verify.ts";
import { deriveDisposition } from "./careful/dispose.ts";
import { proposeClaims, render } from "./careful/narrate.ts";
import { buildAnswerRecord, replay } from "./careful/replay.ts";
import type {
  PaymentRow,
  Proposal,
  RequestContract,
  ScopeConflict,
} from "./records.ts";

const PORT = Number(process.env.PORT || 8787);
const LIVE = Boolean(process.env.ANTHROPIC_API_KEY);
const MODEL_LABEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const QUARTER = { from: "2025-04-01", to: "2025-06-30" };

// ---- evidence <-> text (one row per line: date,counterparty,kind?) ----
function storeToText(rows: PaymentRow[]): string {
  const header = "# YYYY-MM-DD,counterparty[,internal-transfer]\n";
  return (
    header +
    rows
      .map(
        (r) =>
          `${r.at},${r.counterparty}${r.kind === "internal-transfer" ? ",internal-transfer" : ""}`,
      )
      .join("\n")
  );
}

function parseStore(text: string): { rows: PaymentRow[]; skipped: number } {
  const rows: PaymentRow[] = [];
  let skipped = 0;
  let i = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [at, counterparty, kind] = t.split(",").map((s) => s?.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at || "") || !counterparty) {
      skipped++;
      continue;
    }
    rows.push({
      paymentId: `pay-${String(i++).padStart(4, "0")}`,
      account: "acct-1187",
      counterparty,
      amountMinor: 100_000,
      at: at!,
      kind: kind === "internal-transfer" ? "internal-transfer" : "external",
    });
  }
  return { rows, skipped };
}

const DEFAULT_STORE_TEXT = storeToText(buildStore());

// the code-computed answer key, as structure; the prose lines derive from it
export interface KeyFacts {
  rowsTotal: number;
  rowsInQuarter: number;
  top: { name: string; n: number } | null;
  least: { name: string; n: number } | null;
  genuinelyNew: string[];
  seenBefore: string[];
}

function keyFacts(rows: PaymentRow[]): KeyFacts {
  const inQ = rows.filter(
    (r) => r.at >= QUARTER.from && r.at <= QUARTER.to && r.kind === "external",
  );
  const ranked = rank(inQ);
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const quarterRows = rows.filter(
    (r) => r.at >= QUARTER.from && r.at <= QUARTER.to,
  );
  const prior = new Set(
    rows.filter((r) => r.at < QUARTER.from).map((r) => r.counterparty),
  );
  const inQNames = [...new Set(inQ.map((r) => r.counterparty))];
  return {
    rowsTotal: rows.length,
    rowsInQuarter: quarterRows.length,
    top: top ? { name: top.counterparty, n: top.payments } : null,
    least: bottom ? { name: bottom.counterparty, n: bottom.payments } : null,
    genuinelyNew: inQNames.filter((c) => !prior.has(c)),
    seenBefore: inQNames.filter((c) => prior.has(c)),
  };
}

function groundTruth(rows: PaymentRow[]): string[] {
  const k = keyFacts(rows);
  return [
    `GROUND TRUTH over these ${k.rowsTotal.toLocaleString("en-GB")} rows (${k.rowsInQuarter.toLocaleString("en-GB")} fall in the quarter); visible to you, hidden from both machines:`,
    `  genuinely new this quarter: ${k.genuinelyNew.join(", ") || "none"}`,
    `  seen before the quarter: ${k.seenBefore.join(", ") || "none"}`,
    `  true top payee, full quarter, external: ${k.top ? `${k.top.name} (${k.top.n})` : "none"}`,
    `  true least-frequent payee, full quarter, external: ${k.least ? `${k.least.name} (${k.least.n})` : "none"}`,
  ];
}

interface RunRequest {
  question?: string;
  standing?: "policy-admitted" | "requester-confirmed";
  cap?: boolean;
  live?: boolean;
  evidence?: string;
}

export interface Step {
  t: string; // station label
  d: string; // one-line detail, real values from this run
  tone: "ok" | "warn" | "bad" | "stop" | "info";
}

export interface Bar {
  name: string;
  n: number;
}
export interface Badge {
  tone: "ok" | "warn" | "stop" | "bad";
  label: string;
}
export interface MonthGrid {
  months: string[];
  parties: { name: string; counts: number[] }[];
}
export interface WhyBlock {
  fusedRead: { title: string; bars: Bar[] };
  carefulRead: { title: string; bars: Bar[] } | null;
  lines: string[];
  monthGrid: MonthGrid;
}

// one scorecard row: the machine's claim beside the code-computed key value
export interface GradeRow {
  claim: "ranked-payee" | "count" | "new-set";
  claimed: string | null; // display-ready; null = machine made no claim here
  expected: string;
  verdict:
    | "right"
    | "wrong"
    | "lucky"
    | "no-claim"
    | "declined"
    | "scoped-partial";
  note?: string;
}

// one careful-machine station, structured; a catch is a mechanism acting
export interface Checkpoint {
  station: string;
  status: "pass" | "warn" | "stop";
  detail: string;
  chapter?: string;
  catch?: { kind: string; artifactText: string; ground: string; gloss: string };
  climax?: boolean;
}

export interface ContractView {
  subjects: string[];
  sources: string[];
  window: { from: string; to: string; origin: string };
  asks: {
    kind: string;
    direction?: string;
    sourceSpan: string;
    resolution: string;
  }[];
  unclaimedText: string[];
}

interface RunResult {
  truth: string[];
  skipped: number;
  key: KeyFacts;
  why: WhyBlock;
  fused: {
    answer: string;
    verdict: string;
    steps: Step[];
    badge: Badge;
    note: string;
    exchange: FusedExchange | null;
    fields: FusedFields | null;
    grade: GradeRow[];
    handed: { rowsHanded: number; rowsTotal: number; suspectSpans: string[] };
  };
  careful: {
    answer: string;
    status: string;
    steps: Step[];
    badge: Badge;
    note: string;
    contract: ContractView | null;
    checkpoints: Checkpoint[];
    coverage: {
      itemsRead: number;
      populationCount: number | "unknown";
      complete: boolean;
      capApplied: boolean;
    } | null;
    claimsLedger: {
      assertion: string;
      coverageClaimed: string;
      outcome: string;
      failingCheck?: string;
    }[];
    grade: GradeRow[];
    disposition: { disposition: string; pathToYes: string } | null;
  };
  // the interpreter exchange plus the certified reading, so the page can show
  // what was sent, what came back, and which reading the answer serves
  interp: InterpreterExchange & {
    reading: string | null;
    standing: string | null;
  };
  transcript: string;
}

// one human sentence naming the reading a run certified; built from the
// contract, so it moves when a live draft moves
function readingLine(c: RequestContract): string {
  const asks = c.asks
    .map(
      (a) =>
        `${a.kind}${a.direction ? ` (${a.direction})` : ""} ← "${a.sourceSpan}"`,
    )
    .join("  +  ");
  const unclaimed = c.unclaimedText.length
    ? `  ·  quarantined, acted on by nothing: "${c.unclaimedText.join("; ")}"`
    : "";
  return `${asks}  ·  window ${c.window.from}..${c.window.to} (${c.window.origin})  ·  subjects [${c.subjects.join(", ")}]${unclaimed}`;
}

// the fused machine's flow, narrated with this run's actual numbers: every
// step works as documented, and no step owns the question being answered
function fusedSteps(store: PaymentRow[]): Step[] {
  const population = store.filter(
    (r) =>
      r.account === "acct-1187" && r.at >= QUARTER.from && r.at <= QUARTER.to,
  );
  const page = cappedRead(store, "acct-1187");
  const ranked = rank(page.filter((r) => r.kind === "external"));
  const top2 = ranked
    .slice(0, 2)
    .map((r) => `${r.counterparty} ${r.payments}`)
    .join(", ");
  const firstSeen = new Map<string, string>();
  for (const r of [...population].sort((a, b) => (a.at < b.at ? -1 : 1)))
    if (!firstSeen.has(r.counterparty)) firstSeen.set(r.counterparty, r.at);
  const newOnes = [...firstSeen.entries()]
    .filter(([, at]) => at >= "2025-05-01")
    .map(([c]) => c);
  return [
    {
      t: "READ",
      d: `page one: ${page.length} rows: its own pagination default`,
      tone: "info",
    },
    { t: "COUNT", d: `code ranks the page: ${top2}`, tone: "info" },
    {
      t: "NARRATE",
      d: `the page's winner is sold as the QUARTER's winner; no coverage stamp exists to stop it`,
      tone: "bad",
    },
    {
      t: "NOVELTY",
      d: newOnes.length
        ? `window-only "new": ${newOnes.join(", ")}; anything before ${QUARTER.from} is invisible`
        : `window-only "new": none found`,
      tone: "bad",
    },
    {
      t: "SHIP",
      d: `no record of what was read, no claim check, nobody owned "new"; every box worked`,
      tone: "bad",
    },
  ];
}

// the fused machine judged against the ground truth of THIS evidence: its
// code never changes, so whether it happens to be right is a fact about the
// data, and the verdict says which world we are in
function fusedJudgement(store: PaymentRow[]): {
  verdict: string;
  badge: Badge;
} {
  const truthRows = store.filter(
    (r) => r.at >= QUARTER.from && r.at <= QUARTER.to && r.kind === "external",
  );
  const truthTop = rank(truthRows)[0];
  const capTop = rank(
    cappedRead(store, "acct-1187").filter((r) => r.kind === "external"),
  )[0];
  const prior = new Set(
    store.filter((r) => r.at < QUARTER.from).map((r) => r.counterparty),
  );
  const win = store.filter(
    (r) =>
      r.account === "acct-1187" && r.at >= QUARTER.from && r.at <= QUARTER.to,
  );
  const firstSeen = new Map<string, string>();
  for (const r of [...win].sort((a, b) => (a.at < b.at ? -1 : 1)))
    if (!firstSeen.has(r.counterparty)) firstSeen.set(r.counterparty, r.at);
  const claimedNew = [...firstSeen.entries()]
    .filter(([, at]) => at >= "2025-05-01")
    .map(([c]) => c);
  if (!truthTop || !capTop)
    return {
      verdict: "no rows to rank.",
      badge: { tone: "bad", label: "✗ nothing to say" },
    };
  const topRight = capTop.counterparty === truthTop.counterparty;
  const countRight = capTop.payments === truthTop.payments;
  const falseNew = claimedNew.filter((c) => prior.has(c));
  const winNames = new Set(win.map((r) => r.counterparty));
  const genuinelyNew = [...winNames].filter((c) => !prior.has(c));
  const newExact = sameSet(claimedNew, genuinelyNew);
  const parts: string[] = [];
  parts.push(
    topRight
      ? `right about the top payee this time (${truthTop.counterparty}), by luck of the cap`
      : `names ${capTop.counterparty}; the quarter's real top is ${truthTop.counterparty} (${truthTop.payments})`,
  );
  if (topRight && !countRight)
    parts.push(
      `sells the page's count as the quarter's: says ${capTop.payments}, the key says ${truthTop.payments}`,
    );
  if (falseNew.length)
    parts.push(`calls ${falseNew.join(", ")} new despite prior history`);
  else if (!newExact) parts.push(`its "new" list does not match the key`);
  else if (claimedNew.length)
    parts.push(`its "new" list happens to be right on this data`);
  // the badge and the scorecard grade the same comparisons: top payee,
  // count, and the new-set as set equality
  const wrongBits = [
    ...(topRight && !countRight ? ["the count"] : []),
    ...(!newExact ? ['"new"'] : []),
  ];
  const badge: Badge = !topRight
    ? { tone: "bad", label: "✗ WRONG on this data" }
    : wrongBits.length
      ? {
          tone: "warn",
          label: `◐ right about the top by luck; still wrong about ${wrongBits.join(" and ")}`,
        }
      : { tone: "ok", label: "✓ right, by luck of the cap" };
  return { verdict: parts.join("; ") + ".", badge };
}

function topBars(rows: PaymentRow[], k = 3): Bar[] {
  return rank(rows.filter((r) => r.kind === "external"))
    .slice(0, k)
    .map((r) => ({ name: r.counterparty, n: r.payments }));
}

function monthGrid(store: PaymentRow[]): MonthGrid {
  const months = ["2025-04", "2025-05", "2025-06"];
  const inQ = store.filter(
    (r) => r.at >= QUARTER.from && r.at <= QUARTER.to && r.kind === "external",
  );
  const names = rank(inQ)
    .slice(0, 4)
    .map((r) => r.counterparty);
  return {
    months: ["April", "May", "June"],
    parties: names.map((name) => ({
      name,
      counts: months.map(
        (m) =>
          inQ.filter((r) => r.counterparty === name && r.at.startsWith(m))
            .length,
      ),
    })),
  };
}

// the one-glance causal story: what each machine actually read, and the
// sentence a non-reader can follow
function makeWhy(
  store: PaymentRow[],
  outcome:
    | { kind: "stopped"; reason: string }
    | {
        kind: "ran";
        readRows: PaymentRow[];
        complete: boolean;
        itemsRead: number;
        population: number | "unknown";
      },
  extras?: { conflicts?: ScopeConflict[]; unclaimed?: string[] },
): WhyBlock {
  const population = store.filter(
    (r) =>
      r.account === "acct-1187" && r.at >= QUARTER.from && r.at <= QUARTER.to,
  );
  const page = cappedRead(store, "acct-1187");
  const fusedBars = topBars(page);
  const fusedRead = {
    title: `FUSED read: its own page one: the first ${page.length} rows it happened to fetch (unrecorded)`,
    bars: fusedBars,
  };
  const fTop = fusedBars[0];
  const grid = monthGrid(store);
  const hostileLine =
    extras &&
    ((extras.unclaimed?.length ?? 0) > 0 || (extras.conflicts?.length ?? 0) > 0)
      ? `The question also said ${extras.unclaimed?.length ? `"${extras.unclaimed[0]}"` : "more than it was allowed to"}; ` +
        (extras.conflicts?.length
          ? `the SCOPE check dropped ${extras.conflicts.map((c) => c.element).join(", ")} by name; `
          : `the careful machine set it aside as words nobody acted on; `) +
        `it never touched the read.`
      : null;

  if (outcome.kind === "stopped") {
    const lines = [
      `The fused machine answered anyway, from ${page.length} silently truncated rows.`,
      `The careful machine has read NOTHING yet: ${outcome.reason}`,
      `That is the difference: one guesses through ambiguity, the other stops and asks.`,
    ];
    if (hostileLine) lines.push(hostileLine);
    return { fusedRead, carefulRead: null, lines, monthGrid: grid };
  }

  const carefulBars = topBars(outcome.readRows);
  const cTop = carefulBars[0];
  const carefulRead = {
    title: outcome.complete
      ? `CAREFUL read: all ${outcome.itemsRead} of ${outcome.population} rows, and it recorded that`
      : `CAREFUL read: ${outcome.itemsRead} of the quarter's ${outcome.population} rows: capped, and SAID so`,
    bars: carefulBars,
  };
  const lines: string[] = [];
  if (fTop && cTop && outcome.complete) {
    if (fTop.name === cTop.name) {
      lines.push(
        `Both name ${fTop.name} this time; on this evidence the truncation happens not to matter.`,
      );
      lines.push(
        `Same broken read on the fused side; today it got lucky. Only one machine can prove which day it is.`,
      );
    } else {
      lines.push(
        `In the first ${page.length} rows, ${fTop.name} leads. Over ALL ${outcome.itemsRead} rows, ${cTop.name} wins ${cTop.n} to ${carefulBars.find((b) => b.name === fTop.name)?.n ?? 0}.`,
      );
      const april = page.filter((r) => r.at.slice(5, 7) === "04").length;
      if (april > page.length / 2)
        lines.push(
          `The file is date-ordered and page one is mostly April, ${fTop.name}'s month. A machine that silently reads page one is really answering "who won April?".`,
        );
      lines.push(
        `Same data, same question. The only difference is what each machine read; the careful one wrote that down, the fused one could not even say.`,
      );
    }
  } else if (fTop && cTop) {
    lines.push(
      `This time BOTH machines read only part. The careful one said so, cut its claim down to "within the rows read", and pointed at the fuller read still available; the fused one sold its ${page.length} rows as the whole quarter.`,
    );
    lines.push(
      `And the two ${page.length}-row reads are not even the same rows; only one side can tell you which rows it read.`,
    );
  } else if (!cTop) {
    lines.push(
      `The certified window contained no rows at all; the careful machine read nothing and claimed nothing.`,
      `The fused machine answered anyway. An empty window is a recorded fact on one side and invisible on the other.`,
    );
  }
  if (hostileLine) lines.push(hostileLine);
  return { fusedRead, carefulRead, lines, monthGrid: grid };
}

const listOrNone = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
const sameSet = (a: string[], b: string[]) => {
  const norm = (xs: string[]) =>
    [...new Set(xs.map((x) => x.trim().toLowerCase()))].sort();
  const na = norm(a);
  const nb = norm(b);
  return na.length === nb.length && na.every((x, i) => x === nb[i]);
};

function contractView(c: RequestContract): ContractView {
  return {
    subjects: c.subjects,
    sources: c.sources,
    window: { from: c.window.from, to: c.window.to, origin: c.window.origin },
    asks: c.asks.map((a) => ({
      kind: a.kind,
      ...(a.direction ? { direction: a.direction } : {}),
      sourceSpan: a.sourceSpan,
      resolution:
        a.resolution.state === "assumed"
          ? `assumed (${a.resolution.default})`
          : a.resolution.state,
    })),
    unclaimedText: c.unclaimedText,
  };
}

// scorecard rows for the live fused machine, from its own asserted fields;
// a right value still grades "lucky"; nothing behind it can be verified
function fusedGradeLiveRows(
  k: KeyFacts,
  direction: "most" | "least",
  f: FusedFields,
): GradeRow[] {
  const expected = direction === "least" ? k.least : k.top;
  const expTxt = expected ? `${expected.name} (${expected.n})` : "none";
  const rows: GradeRow[] = [];
  if (f.rankedPayeeNamed == null)
    rows.push({
      claim: "ranked-payee",
      claimed: null,
      expected: expTxt,
      verdict: "no-claim",
    });
  else {
    const right =
      expected != null &&
      f.rankedPayeeNamed.trim().toLowerCase() === expected.name.toLowerCase();
    rows.push({
      claim: "ranked-payee",
      claimed: f.rankedPayeeNamed,
      expected: expTxt,
      verdict: right ? "lucky" : "wrong",
    });
  }
  if (f.rankedCountNamed == null)
    rows.push({
      claim: "count",
      claimed: null,
      expected: expected ? String(expected.n) : "none",
      verdict: "no-claim",
    });
  else
    rows.push({
      claim: "count",
      claimed: String(f.rankedCountNamed),
      expected: expected ? String(expected.n) : "none",
      verdict:
        expected != null && f.rankedCountNamed === expected.n
          ? "lucky"
          : "wrong",
    });
  if (f.newCounterpartiesNamed == null)
    rows.push({
      claim: "new-set",
      claimed: null,
      expected: listOrNone(k.genuinelyNew),
      verdict: "no-claim",
    });
  else
    rows.push({
      claim: "new-set",
      claimed: listOrNone(f.newCounterpartiesNamed),
      expected: listOrNone(k.genuinelyNew),
      verdict: sameSet(f.newCounterpartiesNamed, k.genuinelyNew)
        ? "lucky"
        : "wrong",
    });
  return rows;
}

// stub fused machine: the same comparisons fusedJudgement narrates, as rows
function fusedGradeStubRows(store: PaymentRow[], k: KeyFacts): GradeRow[] {
  const capTop = rank(
    cappedRead(store, "acct-1187").filter((r) => r.kind === "external"),
  )[0];
  const win = store.filter(
    (r) =>
      r.account === "acct-1187" && r.at >= QUARTER.from && r.at <= QUARTER.to,
  );
  const firstSeen = new Map<string, string>();
  for (const r of [...win].sort((a, b) => (a.at < b.at ? -1 : 1)))
    if (!firstSeen.has(r.counterparty)) firstSeen.set(r.counterparty, r.at);
  const claimedNew = [...firstSeen.entries()]
    .filter(([, at]) => at >= "2025-05-01")
    .map(([c]) => c);
  const expTxt = k.top ? `${k.top.name} (${k.top.n})` : "none";
  return [
    {
      claim: "ranked-payee",
      claimed: capTop ? capTop.counterparty : null,
      expected: expTxt,
      verdict:
        capTop && k.top && capTop.counterparty === k.top.name
          ? "lucky"
          : "wrong",
    },
    {
      claim: "count",
      claimed: capTop ? String(capTop.payments) : null,
      expected: k.top ? String(k.top.n) : "none",
      verdict:
        capTop && k.top && capTop.payments === k.top.n ? "lucky" : "wrong",
    },
    {
      claim: "new-set",
      claimed: listOrNone(claimedNew),
      expected: listOrNone(k.genuinelyNew),
      verdict: sameSet(claimedNew, k.genuinelyNew) ? "lucky" : "wrong",
    },
  ];
}

// scorecard rows for the careful machine: verdicts extend to declined /
// scoped-partial because an honest machine has more outcomes than right/wrong
function carefulGradeRows(
  k: KeyFacts,
  opts: {
    direction: "most" | "least";
    declinedAll?: string; // early stop: everything declined on this ground
    refusedGround?: string; // ranking ask refused by the registry
    partial?: { top: { name: string; n: number } | null; itemsRead: number };
    answeredTop?: { name: string; n: number } | null;
    noveltyGround: string | null;
  },
): GradeRow[] {
  const expected = opts.direction === "least" ? k.least : k.top;
  const expTxt = expected ? `${expected.name} (${expected.n})` : "none";
  const expNew = listOrNone(k.genuinelyNew);
  if (opts.declinedAll)
    return [
      {
        claim: "ranked-payee",
        claimed: null,
        expected: expTxt,
        verdict: "declined",
        note: opts.declinedAll,
      },
      {
        claim: "count",
        claimed: null,
        expected: expected ? String(expected.n) : "none",
        verdict: "declined",
        note: opts.declinedAll,
      },
      {
        claim: "new-set",
        claimed: null,
        expected: expNew,
        verdict: "declined",
        note: opts.declinedAll,
      },
    ];
  const newRow: GradeRow = {
    claim: "new-set",
    claimed: null,
    expected: expNew,
    verdict: "declined",
    note:
      opts.noveltyGround ??
      'nothing registered can certify "never paid before"; it stays silent instead of guessing',
  };
  if (opts.refusedGround)
    return [
      {
        claim: "ranked-payee",
        claimed: null,
        expected: expTxt,
        verdict: "declined",
        note: opts.refusedGround,
      },
      {
        claim: "count",
        claimed: null,
        expected: expected ? String(expected.n) : "none",
        verdict: "declined",
        note: opts.refusedGround,
      },
      newRow,
    ];
  if (opts.partial) {
    const t = opts.partial.top;
    return [
      {
        claim: "ranked-payee",
        claimed: t
          ? `${t.name}, within the ${opts.partial.itemsRead} rows read`
          : null,
        expected: expTxt,
        verdict: "scoped-partial",
        note: "claim cut to its coverage; unqualified form struck",
      },
      {
        claim: "count",
        claimed: t ? `${t.n} of the rows read` : null,
        expected: expected ? String(expected.n) : "none",
        verdict: "scoped-partial",
        note: "claim cut to its coverage",
      },
      newRow,
    ];
  }
  const t = opts.answeredTop;
  const right = t != null && expected != null && t.name === expected.name;
  return [
    {
      claim: "ranked-payee",
      claimed: t ? t.name : null,
      expected: expTxt,
      verdict: t == null ? "no-claim" : right ? "right" : "wrong",
    },
    {
      claim: "count",
      claimed: t ? String(t.n) : null,
      expected: expected ? String(expected.n) : "none",
      verdict: t == null ? "no-claim" : t.n === expected?.n ? "right" : "wrong",
    },
    newRow,
  ];
}

// exactly one catch per run gets the spotlight, by fixed precedence; the
// novelty refusal exists in every run, so it ranks last and never drowns a
// scenario-specific catch
const CLIMAX_ORDER = [
  "rejected-draft",
  "clarification",
  "incoherent-draft",
  "refusal",
  "struck-claim",
  "scope-conflict",
  "quarantine",
  "partial-coverage",
  "novelty-refusal",
];
function markClimax(checkpoints: Checkpoint[]): void {
  for (const kind of CLIMAX_ORDER) {
    const hit = checkpoints.find((c) => c.catch?.kind === kind);
    if (hit) {
      hit.climax = true;
      return;
    }
  }
}

const FUSED_NOTE_LIVE =
  "the same model, unharnessed: one generation reads, counts, and narrates; nothing checkable";
const FUSED_NOTE_STUB =
  "no AI: ships its one built-in report; never reads your question";
const CAREFUL_NOTE =
  "reads your question; claims only what its records support";

// grade the live fused machine's own asserted fields against ground truth;
// direction comes from the careful machine's drafted reading of the question
function gradeFusedLive(
  store: PaymentRow[],
  direction: "most" | "least",
  fields: FusedFields,
): { verdict: string; badge: Badge } {
  const inQ = store.filter(
    (r) => r.at >= QUARTER.from && r.at <= QUARTER.to && r.kind === "external",
  );
  const ranked = rank(inQ);
  const expected =
    direction === "least" ? ranked[ranked.length - 1] : ranked[0];
  const prior = new Set(
    store.filter((r) => r.at < QUARTER.from).map((r) => r.counterparty),
  );
  const inQNames = new Set(inQ.map((r) => r.counterparty));
  const genuinelyNew = [...inQNames].filter((c) => !prior.has(c));
  const parts: string[] = [];
  let wrong = false;
  if (fields.rankedPayeeNamed == null) {
    parts.push("named no payee the key can check");
  } else if (!expected) {
    parts.push("named a payee but the quarter holds no external payments");
    wrong = true;
  } else if (
    fields.rankedPayeeNamed.trim().toLowerCase() !==
    expected.counterparty.toLowerCase()
  ) {
    parts.push(
      `names ${fields.rankedPayeeNamed}; the ${direction === "least" ? "true least-frequent" : "quarter's real top"} is ${expected.counterparty} (${expected.payments})`,
    );
    wrong = true;
  } else if (fields.rankedCountNamed == null) {
    // a missing count is an unchecked claim, not a wrong one; matches the
    // scorecard's "no-claim" verdict for the same field
    parts.push(
      `right payee (${expected.counterparty}); named no count the key can check`,
    );
  } else if (fields.rankedCountNamed !== expected.payments) {
    parts.push(
      `right payee, wrong number: says ${fields.rankedCountNamed}, the key says ${expected.payments}`,
    );
    wrong = true;
  } else {
    parts.push(
      `matches the key on ${expected.counterparty} (${expected.payments})`,
    );
  }
  if (fields.newCounterpartiesNamed != null) {
    const falseNew = fields.newCounterpartiesNamed.filter((c) =>
      prior.has(c.trim()),
    );
    const missed = genuinelyNew.filter(
      (c) =>
        !fields.newCounterpartiesNamed!.some(
          (x) => x.trim().toLowerCase() === c.toLowerCase(),
        ),
    );
    // names the quarter never saw at all: invented parties are wrong too,
    // so this test is set equality, same as the scorecard's sameSet
    const invented = fields.newCounterpartiesNamed.filter(
      (c) =>
        ![...inQNames].some((n) => n.toLowerCase() === c.trim().toLowerCase()),
    );
    if (falseNew.length) {
      parts.push(`calls ${falseNew.join(", ")} new despite prior history`);
      wrong = true;
    }
    if (invented.length) {
      parts.push(
        `names ${invented.join(", ")} as new; the quarter never saw them`,
      );
      wrong = true;
    }
    if (missed.length) {
      parts.push(`misses genuinely new ${missed.join(", ")}`);
      wrong = true;
    }
    if (!falseNew.length && !invented.length && !missed.length)
      parts.push("gets the new counterparties right");
  }
  const verdict = parts.join("; ") + ".";
  const badge: Badge = wrong
    ? { tone: "bad", label: "✗ WRONG on this data" }
    : fields.rankedPayeeNamed == null
      ? { tone: "warn", label: "◐ made no checkable claim" }
      : {
          tone: "warn",
          label: "◐ right this time, unverifiable every time",
        };
  return { verdict, badge };
}

function fusedLiveSteps(pageLen: number, population: number): Step[] {
  const full = pageLen >= population;
  return [
    {
      t: "READ",
      d: full
        ? `handed everything: all ${population} rows, history included; no excuse lives in the data`
        : `handed page one: ${pageLen} of ${population} rows, the integration's default fetch; it was not told`,
      tone: full ? "info" : "warn",
    },
    {
      t: "MODEL",
      d: "one generation read the question, did the counting, and wrote the answer; no intermediate is recorded",
      tone: "bad",
    },
    {
      t: "SHIP",
      d: "shipped verbatim; nothing to replay, nothing to audit",
      tone: "bad",
    },
  ];
}

async function runPipeline(req: RunRequest): Promise<RunResult> {
  const question =
    (req.question || "").trim() ||
    "Who has this account paid most often this quarter, and are any of those counterparties new?";
  const parsed = parseStore(req.evidence || DEFAULT_STORE_TEXT);
  const store = parsed.rows;
  const useLive = Boolean(req.live) && LIVE;
  const out: string[] = [];
  const log = (s: string) => out.push(s);
  const truth = groundTruth(store);
  const key = keyFacts(store);
  const judged = fusedJudgement(store);
  const pageLen = cappedRead(store, "acct-1187").length;
  const fused: RunResult["fused"] = {
    answer: fusedAnswer(store, "acct-1187"),
    verdict: judged.verdict,
    badge: judged.badge,
    steps: fusedSteps(store),
    note: useLive ? FUSED_NOTE_LIVE : FUSED_NOTE_STUB,
    exchange: null,
    fields: null,
    grade: useLive ? [] : fusedGradeStubRows(store, key),
    handed: { rowsHanded: pageLen, rowsTotal: store.length, suspectSpans: [] },
  };
  // live mode: the fused machine is the same model, unharnessed. The fair
  // fight is the default: it is handed EVERY row, history included, so any
  // failure is the generation's own. The cap re-imposes the silent 500-row
  // page-one default on BOTH machines at once.
  let fusedLive: { fields: FusedFields; exchange: FusedExchange } | null = null;
  const fusedRows = req.cap
    ? cappedRead(store, "acct-1187")
    : store.filter((r) => r.account === "acct-1187");
  if (useLive) {
    const pageText = fusedRows
      .map(
        (r) =>
          `${r.at},${r.counterparty}${r.kind === "internal-transfer" ? ",internal-transfer" : ""}`,
      )
      .join("\n");
    try {
      fusedLive = await callFusedLive(question, pageText);
      fused.handed = {
        rowsHanded: fusedRows.length,
        rowsTotal: store.length,
        suspectSpans: [],
      };
      fused.answer = fusedLive.fields.answerText;
      fused.steps = fusedLiveSteps(fusedRows.length, store.length);
      fused.exchange = fusedLive.exchange;
      fused.fields = fusedLive.fields;
    } catch (e) {
      const msg = String((e as Error).message);
      fused.answer = `(the fused call failed: ${msg})`;
      fused.verdict = "no answer shipped this run.";
      fused.badge = { tone: "stop", label: "■ call failed" };
      fused.steps = [{ t: "MODEL", d: `call failed: ${msg}`, tone: "stop" }];
    }
  }
  const applyFusedGrade = (direction: "most" | "least") => {
    if (!fusedLive) return;
    const g = gradeFusedLive(store, direction, fusedLive.fields);
    fused.verdict = g.verdict;
    fused.badge = g.badge;
    fused.grade = fusedGradeLiveRows(key, direction, fusedLive.fields);
  };
  const steps: Step[] = [];
  const result: RunResult = {
    truth,
    skipped: parsed.skipped,
    key,
    why: makeWhy(store, { kind: "stopped", reason: "nothing has run yet." }),
    fused,
    careful: {
      note: CAREFUL_NOTE,
      answer: "",
      status: "",
      steps,
      badge: { tone: "stop", label: "■ not run" },
      contract: null,
      checkpoints: [],
      coverage: null,
      claimsLedger: [],
      grade: [],
      disposition: null,
    },
    interp: {
      mode: useLive ? "live" : "stub",
      model: useLive ? "" : "interpreter-stub/1",
      request: null,
      attempts: [],
      reading: null,
      standing: null,
    },
    transcript: "",
  };
  const done = () => ((result.transcript = out.join("\n")), result);

  log(
    `RUN: interpreter=${useLive ? "live model" : "stub"}, standing=${req.standing === "requester-confirmed" ? "requester-confirmed" : "policy-admitted"}, cap=${req.cap ? "500" : "off"}`,
  );
  log(`QUESTION: ${question}`);
  if (parsed.skipped)
    log(`EVIDENCE: ${parsed.skipped} malformed line(s) skipped`);

  let proposal: Proposal<RequestContract>;
  try {
    if (useLive) {
      const live = await draftContractLive(question);
      proposal = live.proposal;
      result.interp = { ...live.exchange, reading: null, standing: null };
    } else {
      proposal = draftContract(question);
      result.interp.attempts = [
        {
          rawDraft: JSON.stringify(
            {
              subjects: proposal.content.subjects,
              sources: proposal.content.sources,
              window: proposal.content.window,
              asks: proposal.content.asks.map((a) => ({
                kind: a.kind,
                direction: a.direction,
                qualifiers: a.qualifiers,
                sourceSpan: a.sourceSpan,
                resolution: a.resolution,
              })),
              unclaimedText: proposal.content.unclaimedText,
            },
            null,
            2,
          ),
          verdict: "accepted",
        },
      ];
    }
  } catch (e) {
    if (e instanceof DraftRejectedError)
      result.interp = { ...e.exchange, reading: null, standing: null };
    applyFusedGrade("most");
    log(`INTERPRETER: draft rejected before anything proceeded`);
    log(`  ${String((e as Error).message)}`);
    const lastRejected = result.interp.attempts
      .filter((a) => a.verdict === "rejected")
      .at(-1);
    Object.assign(result.careful, {
      answer:
        "No answer: the draft was rejected by mechanical validation, so nothing proceeded.",
      status: "draft rejected before anything ran",
      badge: {
        tone: "stop",
        label: "■ declined: draft rejected, nothing ran",
      },
      checkpoints: [
        {
          station: "VALIDATOR",
          status: "stop",
          detail: "every draft failed mechanical validation; nothing ran",
          chapter: "ch. 3-4",
          catch: {
            kind: "rejected-draft",
            artifactText: (lastRejected?.rawDraft ?? "").slice(0, 600),
            ground: lastRejected?.rejectReason ?? String((e as Error).message),
            gloss:
              "a malformed draft is rejected, never repaired; after one fresh try the refusal stands",
          },
          climax: true,
        },
      ] satisfies Checkpoint[],
      grade: carefulGradeRows(key, {
        direction: "most",
        declinedAll: "draft rejected; nothing ran",
        noveltyGround: null,
      }),
      disposition: {
        disposition: "declined",
        pathToYes: "re-ask; the interpreter drafts fresh",
      },
    });
    steps.push({
      t: "INTERPRETER",
      d: "draft rejected by mechanical validation; nothing proceeded",
      tone: "stop",
    });
    result.why = makeWhy(store, {
      kind: "stopped",
      reason:
        "the model's draft failed validation, so nothing was allowed to run.",
    });
    return done();
  }
  log(`PROPOSAL (drafted by ${proposal.proposedBy}):`);
  if (useLive)
    log(
      `  (the model's private reasoning is deliberately unrecorded: an interpreter\n` +
        `   explaining itself is more generated text lobbying the reviewer; the\n` +
        `   contract below is the artifact, and only it acquires standing)`,
    );
  log(`  subjects      [${proposal.content.subjects.join(", ")}]`);
  log(
    `  window        ${proposal.content.window.from} .. ${proposal.content.window.to}  origin: ${proposal.content.window.origin.toUpperCase()}`,
  );
  for (const a of proposal.content.asks) {
    const res =
      a.resolution.state === "assumed"
        ? `assumed (${a.resolution.default})`
        : a.resolution.state;
    log(`  ask ${a.askId}  ${a.kind}  <- "${a.sourceSpan}"  (${res})`);
  }
  log(`  unclaimedText [${proposal.content.unclaimedText.join(" | ")}]`);
  steps.push({
    t: "PROPOSAL",
    d:
      `${proposal.proposedBy} · subjects [${proposal.content.subjects.join(", ")}]` +
      (proposal.content.unclaimedText.length
        ? ` · unclaimed: "${proposal.content.unclaimedText.join("; ")}"`
        : ""),
    tone: "info",
  });
  result.interp.model = proposal.proposedBy;
  result.interp.reading = readingLine(proposal.content);
  result.careful.contract = contractView(proposal.content);
  fused.handed.suspectSpans = proposal.content.unclaimedText;
  const drawnDirection =
    proposal.content.asks.find((a) => a.kind === "ranking")?.direction ??
    "most";
  applyFusedGrade(drawnDirection);
  const validatorCheckpoint: Checkpoint = result.interp.attempts.some(
    (a) => a.verdict === "rejected",
  )
    ? {
        station: "VALIDATOR",
        status: "warn",
        detail: `draft ${result.interp.attempts.length} accepted after ${result.interp.attempts.length - 1} rejection(s), verbatim on the record`,
        chapter: "ch. 3-4",
        catch: {
          kind: "rejected-draft",
          artifactText: (
            result.interp.attempts.find((a) => a.verdict === "rejected")
              ?.rawDraft ?? ""
          ).slice(0, 600),
          ground:
            result.interp.attempts.find((a) => a.verdict === "rejected")
              ?.rejectReason ?? "invalid draft",
          gloss:
            "a malformed draft is rejected, never repaired; the model gets one fresh try",
        },
      }
    : {
        station: "VALIDATOR",
        status: "pass",
        detail:
          "draft accepted by mechanical validation (reject, never repair)",
        chapter: "ch. 3-4",
      };

  if (!coherent(proposal.content)) {
    log(`GATE: incoherent draft; nothing proceeds`);
    steps.push({
      t: "GATE",
      d: "incoherent draft; nothing proceeds",
      tone: "stop",
    });
    Object.assign(result.careful, {
      answer: "No answer: the draft failed coherence checks.",
      status: "incoherent draft, nothing ran",
      badge: {
        tone: "stop",
        label: "■ declined: incoherent draft, nothing ran",
      },
      checkpoints: [
        validatorCheckpoint,
        {
          station: "GATE",
          status: "stop",
          detail: "incoherent draft; nothing proceeds",
          chapter: "ch. 3 · gate.ts",
          catch: {
            kind: "incoherent-draft",
            artifactText: readingLine(proposal.content),
            ground: "coherence checks failed",
            gloss:
              "a contract that does not hold together certifies nothing and runs nothing",
          },
          climax: true,
        },
      ] satisfies Checkpoint[],
      grade: carefulGradeRows(key, {
        direction: drawnDirection,
        declinedAll: "incoherent draft; nothing ran",
        noveltyGround: null,
      }),
      disposition: { disposition: "declined", pathToYes: "re-ask" },
    });
    result.why = makeWhy(
      store,
      {
        kind: "stopped",
        reason: "the draft was incoherent, so nothing was allowed to run.",
      },
      { unclaimed: proposal.content.unclaimedText },
    );
    return done();
  }
  const unresolved = proposal.content.asks.filter(
    (a) => a.resolution.state === "unresolved",
  );
  if (unresolved.length) {
    log("");
    log(`GATE: clarification-needed; nothing executes.`);
    for (const a of unresolved)
      log(`  unresolved ask ${a.askId} ("${a.sourceSpan}")`);
    log(`  path to yes: answer the clarifying question, then re-run`);
    steps.push({
      t: "GATE",
      d: `clarification-needed: ${unresolved.map((a) => `"${a.sourceSpan}"`).join("; ")} routed back to the requester; nothing executes`,
      tone: "stop",
    });
    Object.assign(result.careful, {
      answer:
        `No answer yet: before reading a single row, the gate routes the ambiguity back to you. ` +
        unresolved
          .map((a) => `What did you mean by "${a.sourceSpan}"?`)
          .join(" "),
      status: "stopped at the gate to ask what you meant",
      badge: {
        tone: "stop",
        label: "■ declined: asked for clarification instead of guessing",
      },
      checkpoints: [
        validatorCheckpoint,
        {
          station: "GATE",
          status: "stop",
          detail: "clarification-needed; nothing executes",
          chapter: "ch. 3 · gate.ts",
          catch: {
            kind: "clarification",
            artifactText: unresolved.map((a) => `"${a.sourceSpan}"`).join("; "),
            ground: "unresolved ambiguity in the reading",
            gloss:
              "the gate routes the question back instead of letting a guess acquire standing",
          },
          climax: true,
        },
      ] satisfies Checkpoint[],
      grade: carefulGradeRows(key, {
        direction: drawnDirection,
        declinedAll: "stopped to ask what you meant",
        noveltyGround: null,
      }),
      disposition: {
        disposition: "clarification-needed",
        pathToYes: "answer the clarifying question, then re-run",
      },
    });
    result.why = makeWhy(
      store,
      {
        kind: "stopped",
        reason:
          "it stopped at the gate to ask what you meant, before reading a single row.",
      },
      { unclaimed: proposal.content.unclaimedText },
    );
    return done();
  }

  const gateCert =
    req.standing === "requester-confirmed"
      ? certifyConfirmed(proposal, {
          requesterId: "analyst-r-2093",
          confirmedAssumptions: proposal.content.asks
            .filter((a) => a.resolution.state === "assumed")
            .map((a) => a.sourceSpan),
          at: "2025-07-04",
        })
      : certifyAdmitted(proposal, "AP-9");
  log("");
  log(
    `GATE: decision=${gateCert.decision}, standing=${gateCert.content.standing.kind}`,
  );
  steps.push({
    t: "GATE",
    d: `${gateCert.decision} · standing ${gateCert.content.standing.kind}`,
    tone: "ok",
  });
  result.interp.standing = gateCert.content.standing.kind;

  const scopeCert = effectiveScope(gateCert, GRANTS, "2025-07-04");
  log(
    `SCOPE: decision=${scopeCert.decision}, inScope=[${scopeCert.content.inScope.subjects}]` +
      (scopeCert.content.conflicts.length
        ? `, conflicts: ${scopeCert.content.conflicts.map((c) => `${c.element} (${c.ground})`).join("; ")}`
        : ""),
  );
  steps.push(
    scopeCert.content.conflicts.length
      ? {
          t: "SCOPE",
          d: `narrowed to [${scopeCert.content.inScope.subjects.join(", ")}] · fell out: ${scopeCert.content.conflicts.map((c) => c.element).join(", ")}`,
          tone: "warn",
        }
      : {
          t: "SCOPE",
          d: `accepted · in scope [${scopeCert.content.inScope.subjects.join(", ")}]`,
          tone: "ok",
        },
  );
  const selections = selectOperations(gateCert.content.contract.asks);
  for (const s of selections.filter((x) => x.cannotExecute))
    log(`REGISTRY: ${s.askId} CANNOT-EXECUTE (${s.cannotExecute!.ground})`);
  {
    const refused = selections.filter((x) => x.cannotExecute);
    steps.push(
      refused.length
        ? {
            t: "REGISTRY",
            d: `cannot-execute: ${refused.map((s2) => s2.cannotExecute!.ground).join("; ")}`,
            tone: "warn",
          }
        : {
            t: "REGISTRY",
            d: "every ask has a registered operation",
            tone: "ok",
          },
    );
  }
  const rankingAsk = gateCert.content.contract.asks.find(
    (a) => a.kind === "ranking",
  );
  const rankingRefused =
    rankingAsk != null &&
    selections.find((s) => s.askId === rankingAsk.askId)?.cannotExecute != null;
  const refusedSel = selections.filter((s) => s.cannotExecute);
  const interception: InterceptionLog = { entries: [] };
  const w = gateCert.content.contract.window;
  // only the operations the registry selected run, and only under this
  // certification: an ask with no operation, or a subject no grant covers,
  // reads nothing at all
  const { executed, exec, evidence, ranking, cannotExecuteGrounds: runGrounds } = run(
    scopeCert,
    store,
    { from: w.from, to: w.to },
    interception,
    selections,
    req.cap ? { cap: 500 } : {},
  );
  const cannotExecuteGrounds = [
    ...refusedSel.map((s) => s.cannotExecute!.ground),
    ...runGrounds,
  ];
  const interceptionCheckpoint: Checkpoint = {
    station: "INTERCEPTION",
    status: interception.entries.some((e) => e.decision === "refused")
      ? "warn"
      : "pass",
    detail: interception.entries.length
      ? `${interception.entries.map((e) => `${e.op} (${e.actionClass}, ${e.decision})`).join(", ")} · logged under ${scopeCert.certId}`
      : "nothing reached the reader: no operation to intercept",
    chapter: "ch. 12 · execute.ts",
  };

  if (!executed || !evidence || !exec) {
    // nothing was read: every ask was refused, or nothing survived the scope
    // intersection. The no is routed from the records, not thrown as a 500.
    const disposition = deriveDisposition({
      contractCertified: true,
      unresolvedAmbiguity: false,
      cannotExecuteGrounds,
      scopeConflicts: scopeCert.content.conflicts,
      executed: false,
      coveragePartial: false,
      verdicts: [],
    });
    const ground =
      cannotExecuteGrounds[0] ??
      scopeCert.content.conflicts.map((c) => `${c.element}: ${c.ground}`)[0] ??
      "no operation ran";
    log("");
    log(`EXECUTION: nothing ran; ${ground}`);
    log(`ANSWER (${disposition.disposition}):`);
    log(`  "${render([], [], disposition)}"`);
    steps.push(
      { t: "EXECUTION", d: `nothing ran: ${ground}`, tone: "stop" },
      {
        t: "ANSWER",
        d: `${disposition.disposition} · to unlock it: ${disposition.pathToYes}`,
        tone: "warn",
      },
    );
    const outOfAuthority = disposition.disposition === "outside-authority";
    const declineCheckpoints: Checkpoint[] = [
      validatorCheckpoint,
      {
        station: "GATE",
        status: "pass",
        detail: `certified · standing ${gateCert.content.standing.kind}`,
        chapter: "ch. 3 · gate.ts",
      },
      scopeCert.content.conflicts.length
        ? {
            station: "SCOPE",
            status: "warn",
            detail: `narrowed to [${scopeCert.content.inScope.subjects.join(", ")}]`,
            chapter: "ch. 6 · scope.ts",
            catch: {
              kind: "scope-conflict",
              artifactText: scopeCert.content.conflicts
                .map((c) => c.element)
                .join(", "),
              ground: scopeCert.content.conflicts
                .map((c) => c.ground)
                .join("; "),
              gloss:
                "authority is an intersection the proposal cannot widen; what fell out is named",
            },
          }
        : {
            station: "SCOPE",
            status: "pass",
            detail: `accepted · in scope [${scopeCert.content.inScope.subjects.join(", ")}]`,
            chapter: "ch. 6 · scope.ts",
          },
      refusedSel.length
        ? {
            station: "REGISTRY",
            status: "warn",
            detail: `cannot-execute: ${refusedSel.length} ask(s) have no registered operation`,
            chapter: "ch. 5 · registry.ts",
            catch: {
              kind: rankingRefused ? "refusal" : "novelty-refusal",
              artifactText: refusedSel
                .map((sel) => {
                  const ask = gateCert.content.contract.asks.find(
                    (a) => a.askId === sel.askId,
                  );
                  return ask
                    ? `${ask.kind}${ask.direction ? ` (${ask.direction})` : ""} ← ${ask.sourceSpan}`
                    : sel.cannotExecute!.ground;
                })
                .join("; "),
              ground: refusedSel
                .map((sel) => sel.cannotExecute!.ground)
                .join("; "),
              gloss:
                "capability is a record; honest refusal beats invented ability",
            },
          }
        : {
            station: "REGISTRY",
            status: "pass",
            detail: "every ask has a registered operation",
            chapter: "ch. 5 · registry.ts",
          },
      interceptionCheckpoint,
      {
        station: "EXECUTION",
        status: "stop",
        detail: `nothing ran: ${ground}`,
        chapter: "ch. 2 · execute.ts",
      },
      {
        station: "ANSWER",
        status: "warn",
        detail: `${disposition.disposition} · to unlock the rest: ${disposition.pathToYes}`,
        chapter: "ch. 13 · dispose.ts",
      },
    ];
    markClimax(declineCheckpoints);
    Object.assign(result.careful, {
      answer: render([], [], disposition),
      status: `${disposition.disposition} · nothing was read, so nothing is claimed`,
      badge: {
        tone: "stop",
        label: outOfAuthority
          ? "■ declined: outside the authority it was granted"
          : "■ declined: no registered operation for that ask",
      },
      checkpoints: declineCheckpoints,
      coverage: null,
      claimsLedger: [],
      grade: carefulGradeRows(key, {
        direction: drawnDirection,
        declinedAll: ground,
        noveltyGround: null,
      }),
      disposition: {
        disposition: disposition.disposition,
        pathToYes: disposition.pathToYes,
      },
    });
    result.why = makeWhy(
      store,
      {
        kind: "stopped",
        reason: outOfAuthority
          ? "the subject you asked about is outside the authority it was granted, so it read nothing."
          : `nothing it is allowed to run can establish what you asked, so it read nothing (${ground}).`,
      },
      {
        conflicts: scopeCert.content.conflicts,
        unclaimed: proposal.content.unclaimedText,
      },
    );
    if (rankingRefused) {
      result.why.lines.unshift(
        "One machine declined this question; the other answered it anyway.",
        useLive
          ? "Same model on both sides. Unharnessed, it answered with nothing checkable; as the careful machine's interpreter, its reading was certified and then refused; nothing registered can establish it."
          : 'The fused machine cannot read your words; it ships its built-in "most frequent" report whatever you ask. The careful machine read the question and declined what nothing registered can establish.',
      );
      if (!useLive)
        result.fused.verdict = `it did not notice you asked something else; ${result.fused.verdict}`;
    }
    return done();
  }

  log(
    `EVIDENCE: read ${evidence.coverage.itemsRead} of ${evidence.coverage.populationCount}, complete=${evidence.coverage.complete}`,
  );
  steps.push(
    evidence.coverage.complete
      ? {
          t: "EVIDENCE",
          d: `read ${evidence.coverage.itemsRead} of ${evidence.coverage.populationCount} · complete, stamped`,
          tone: "ok",
        }
      : {
          t: "EVIDENCE",
          d: `read ${evidence.coverage.itemsRead} of ${evidence.coverage.populationCount} · PARTIAL, stamped honestly`,
          tone: "warn",
        },
  );

  const ledger: Ledger = {
    evidence: new Map([[evidence.evidenceId, evidence]]),
    results: new Map(ranking ? [[ranking.resultId, ranking]] : []),
  };
  // claims can only be built from a result that exists, and a result exists
  // only for an operation the registry selected: no glue required here
  const claims = proposeClaims(ranking);
  const verdicts = verifyAll(claims, ledger);
  for (const v of verdicts.filter((x) => x.outcome === "struck"))
    log(`CLERK: ${v.claimId} STRUCK (${v.failingCheck})`);
  {
    const struck = verdicts.filter((x) => x.outcome === "struck");
    steps.push(
      struck.length
        ? {
            t: "CLERK",
            d: `struck ${struck.map((v) => v.claimId).join(", ")}: ${struck[0]!.failingCheck}`,
            tone: "warn",
          }
        : { t: "CLERK", d: `all proposed claims certified`, tone: "ok" },
    );
  }
  const disposition = deriveDisposition({
    contractCertified: true,
    unresolvedAmbiguity: false,
    cannotExecuteGrounds,
    scopeConflicts: scopeCert.content.conflicts,
    executed,
    coveragePartial: !evidence.coverage.complete,
    verdicts,
  });
  log("");
  log(`ANSWER (${disposition.disposition}):`);
  log(`  "${render(claims, verdicts, disposition)}"`);
  steps.push({
    t: "ANSWER",
    d:
      disposition.disposition +
      (disposition.pathToYes && disposition.pathToYes !== "none"
        ? ` · to unlock the rest: ${disposition.pathToYes}`
        : ""),
    tone: disposition.disposition === "answered" ? "ok" : "warn",
  });

  const ans = buildAnswerRecord(
    gateCert,
    scopeCert,
    exec,
    ledger,
    verdicts,
    disposition,
  );
  const rep = replay(ans, {
    contracts: new Set([gateCert.content.contract.contractId]),
    certs: new Set([scopeCert.certId]),
    executions: new Set([exec.execId]),
    ledger,
    claims: new Set(claims.map((c) => c.claimId)),
  });
  log(`REPLAY: ${ans.answerId} every reference resolves = ${rep.ok}`);
  steps.push({
    t: "REPLAY",
    d: rep.ok
      ? "every reference resolves"
      : "BROKEN: " + rep.missing.join(", "),
    tone: rep.ok ? "ok" : "stop",
  });

  // the careful card's own badge: honest to its own semantics
  const truthTop = rank(
    store.filter(
      (r) =>
        r.at >= QUARTER.from && r.at <= QUARTER.to && r.kind === "external",
    ),
  )[0];
  const rankedValue = (ranking?.value ?? []) as {
    counterparty: string;
    payments: number;
  }[];
  const carefulTop = rankedValue[0];
  let badge: Badge;
  if (!rep.ok) badge = { tone: "bad", label: "✗ replay broken" };
  else if (disposition.disposition === "cannot-execute")
    badge = {
      tone: "stop",
      label: refusedSel.length
        ? "■ declined: no registered operation for that ask"
        : "■ declined: nothing it can run establishes that ask",
    };
  else if (disposition.disposition === "unsupported")
    badge = {
      tone: "stop",
      label: "■ declined: nothing certifiable in the certified window",
    };
  else if (!evidence.coverage.complete)
    badge = {
      tone: "warn",
      label: "◐ honest partial: claim scoped to the rows it read",
    };
  else if (
    disposition.disposition === "answered" &&
    truthTop &&
    carefulTop &&
    carefulTop.counterparty === truthTop.counterparty
  )
    badge = { tone: "ok", label: "✓ matches ground truth" };
  else badge = { tone: "ok", label: "✓ answered from its records" };

  result.why = makeWhy(
    store,
    {
      kind: "ran",
      readRows: evidence.payload,
      complete: evidence.coverage.complete,
      itemsRead: evidence.coverage.itemsRead,
      population: evidence.coverage.populationCount,
    },
    {
      conflicts: scopeCert.content.conflicts,
      unclaimed: proposal.content.unclaimedText,
    },
  );
  // the fair fight: fused was handed every row, so the page-one story does
  // not apply; the failure (or luck) is the generation itself
  if (useLive && fusedLive && !req.cap) {
    result.why.fusedRead = {
      title: `FUSED was handed: all ${store.length.toLocaleString("en-GB")} rows, history included, and it cannot say what it read`,
      bars: topBars(
        store.filter((r) => r.at >= QUARTER.from && r.at <= QUARTER.to),
      ),
    };
    if (!rankingRefused) {
      const anyWrong = fused.grade.some((g) => g.verdict === "wrong");
      result.why.lines = [
        anyWrong
          ? "The fused machine had everything and still got it wrong. Nothing was withheld; the failure is the generation itself."
          : "The fused machine had everything and happens to be right, and there is still no way to check it.",
        "A language model does not run a counter; it emits a number shaped like a count. The ordering often survives; the exact number is invention. The careful machine's numbers come from a loop, and the model there is never asked for a number.",
        ...result.why.lines,
      ];
    }
  }
  if (rankingRefused) {
    if (useLive) {
      result.why.lines.unshift(
        "One machine declined this question; the other answered it anyway.",
        "Same model on both sides. Unharnessed, it answered with nothing checkable; as the careful machine's interpreter, its reading was certified and then refused; nothing registered can establish it.",
      );
    } else {
      result.why.lines.unshift(
        "The two machines did not answer the same question.",
        `The fused machine cannot read your words; it ships its built-in "most frequent" report whatever you ask. The careful machine read the question and declined what nothing registered can establish.`,
      );
      result.fused.verdict = `it did not notice you asked something else; ${result.fused.verdict}`;
    }
  }
  // the structured station chain the page renders as checkpoints + stamps
  const struckV = verdicts.filter((v) => v.outcome === "struck");
  const noveltyGround =
    refusedSel
      .map((s) => s.cannotExecute!.ground)
      .find((g) => g.includes("first-appearance")) != null
      ? 'no approved way to check "first time ever paid"'
      : null;
  const rankingGround = rankingRefused
    ? (selections.find((s) => s.askId === rankingAsk!.askId)?.cannotExecute
        ?.ground ?? "no registered operation")
    : undefined;
  const checkpoints: Checkpoint[] = [
    validatorCheckpoint,
    {
      station: "GATE",
      status: "pass",
      detail: `certified · standing ${gateCert.content.standing.kind}`,
      chapter: "ch. 3 · gate.ts",
      ...(proposal.content.unclaimedText.length
        ? {
            catch: {
              kind: "quarantine",
              artifactText: proposal.content.unclaimedText.join(" | "),
              ground: "words no ask accounts for",
              gloss:
                "recorded on the contract, claimed by no ask, actionable by nothing downstream",
            },
          }
        : {}),
    },
    scopeCert.content.conflicts.length
      ? {
          station: "SCOPE",
          status: "warn",
          detail: `narrowed to [${scopeCert.content.inScope.subjects.join(", ")}]`,
          chapter: "ch. 6 · scope.ts",
          catch: {
            kind: "scope-conflict",
            artifactText: scopeCert.content.conflicts
              .map((c) => c.element)
              .join(", "),
            ground: scopeCert.content.conflicts.map((c) => c.ground).join("; "),
            gloss:
              "authority is an intersection the proposal cannot widen; what fell out is named",
          },
        }
      : {
          station: "SCOPE",
          status: "pass",
          detail: `accepted · in scope [${scopeCert.content.inScope.subjects.join(", ")}]`,
          chapter: "ch. 6 · scope.ts",
        },
    refusedSel.length
      ? {
          station: "REGISTRY",
          status: "warn",
          detail: `cannot-execute: ${refusedSel.length} ask(s) have no registered operation`,
          chapter: "ch. 5 · registry.ts",
          catch: {
            kind: rankingRefused ? "refusal" : "novelty-refusal",
            // the artifact is the refused ask itself, quoted from the contract
            artifactText: refusedSel
              .map((s) => {
                const ask = gateCert.content.contract.asks.find(
                  (a) => a.askId === s.askId,
                );
                return ask
                  ? `${ask.kind}${ask.direction ? ` (${ask.direction})` : ""} ← ${ask.sourceSpan}`
                  : s.cannotExecute!.ground;
              })
              .join("; "),
            ground: refusedSel.map((s) => s.cannotExecute!.ground).join("; "),
            gloss:
              "capability is a record; honest refusal beats invented ability",
          },
        }
      : {
          station: "REGISTRY",
          status: "pass",
          detail: "every ask has a registered operation",
          chapter: "ch. 5 · registry.ts",
        },
    interceptionCheckpoint,
    evidence.coverage.complete
      ? {
          station: "EVIDENCE",
          status: "pass",
          detail: `read ${evidence.coverage.itemsRead} of ${evidence.coverage.populationCount} · complete, stamped`,
          chapter: "ch. 7-8 · execute.ts",
        }
      : {
          station: "EVIDENCE",
          status: "warn",
          detail: `read ${evidence.coverage.itemsRead} of ${evidence.coverage.populationCount} · PARTIAL, stamped honestly`,
          chapter: "ch. 7-8 · execute.ts",
          catch: {
            kind: "partial-coverage",
            artifactText: `${evidence.coverage.itemsRead} of ${evidence.coverage.populationCount} rows`,
            ground: "read capped",
            gloss: "claims may only carry the coverage they can support",
          },
        },
    struckV.length
      ? {
          station: "CLERK",
          status: "warn",
          detail: `struck ${struckV.length} claim(s) at the turnstile`,
          chapter: "ch. 11 · verify.ts",
          catch: {
            kind: "struck-claim",
            artifactText:
              claims.find((c) => c.claimId === struckV[0]!.claimId)
                ?.assertion ?? "",
            ground: struckV[0]!.failingCheck ?? "",
            gloss:
              "the narrator can only speak certified claims; this one died here, in writing",
          },
        }
      : {
          station: "CLERK",
          status: "pass",
          detail: claims.length
            ? "all proposed claims certified"
            : "no claims proposed",
          chapter: "ch. 11 · verify.ts",
        },
    {
      station: "ANSWER",
      status: disposition.disposition === "answered" ? "pass" : "warn",
      detail:
        disposition.disposition +
        (disposition.pathToYes && disposition.pathToYes !== "none"
          ? ` · to unlock the rest: ${disposition.pathToYes}`
          : ""),
      chapter: "ch. 13 · dispose.ts",
    },
    {
      station: "REPLAY",
      status: rep.ok ? "pass" : "stop",
      detail: rep.ok
        ? "every reference resolves"
        : "BROKEN: " + rep.missing.join(", "),
      chapter: "ch. 17 · replay.ts",
    },
  ];
  markClimax(checkpoints);

  Object.assign(result.careful, {
    answer: render(claims, verdicts, disposition),
    status: `${disposition.disposition} · vouched for by ${gateCert.content.standing.kind === "requester-confirmed" ? "the requester's own record" : "admission policy (nobody confirmed the reading)"} · question read by ${useLive ? "a real model" : "the stub"} · re-checks from its records: ${rep.ok ? "yes" : "BROKEN"}`,
    badge,
    checkpoints,
    coverage: {
      itemsRead: evidence.coverage.itemsRead,
      populationCount: evidence.coverage.populationCount,
      complete: evidence.coverage.complete,
      capApplied: Boolean(req.cap),
    },
    claimsLedger: claims.map((c) => {
      const v = verdicts.find((x) => x.claimId === c.claimId);
      return {
        assertion: c.assertion,
        coverageClaimed: c.coverageClaimed,
        outcome: v?.outcome ?? "unknown",
        ...(v?.failingCheck ? { failingCheck: v.failingCheck } : {}),
      };
    }),
    grade: carefulGradeRows(key, {
      direction: drawnDirection,
      ...(rankingGround ? { refusedGround: rankingGround } : {}),
      ...(!rankingRefused && !evidence.coverage.complete
        ? {
            partial: {
              top: carefulTop
                ? { name: carefulTop.counterparty, n: carefulTop.payments }
                : null,
              itemsRead: evidence.coverage.itemsRead,
            },
          }
        : {}),
      ...(!rankingRefused && evidence.coverage.complete
        ? {
            answeredTop: carefulTop
              ? { name: carefulTop.counterparty, n: carefulTop.payments }
              : null,
          }
        : {}),
      noveltyGround,
    }),
    disposition: {
      disposition: disposition.disposition,
      pathToYes: disposition.pathToYes,
    },
  });
  return done();
}

import { renderPage } from "./web/page.ts";
const PAGE = renderPage({ live: LIVE, modelLabel: MODEL_LABEL, defaultStoreText: DEFAULT_STORE_TEXT });

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (req.method === "POST" && req.url === "/run") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const result = await runPipeline(JSON.parse(raw || "{}"));
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error((e as Error).stack);
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(String((e as Error).message));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(PORT, "127.0.0.1", () => {
  console.log(
    `careful-machine local: http://127.0.0.1:${PORT} (live model: ${LIVE ? "available" : "off"})`,
  );
});
