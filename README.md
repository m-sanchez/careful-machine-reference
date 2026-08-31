# The Careful Machine: reference implementation

![TypeScript](https://img.shields.io/badge/TypeScript-erasable_syntax-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D22.6-5FA04E?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-B45309)
![Tests](https://img.shields.io/badge/book_claims_tested-13-2F6F44)
![License](https://img.shields.io/badge/license-MIT-6E6E6E)

[Recorded runs and live tamper bench](https://miguelsanchez.co.uk/careful-machine) ·
[Working rules](https://miguelsanchez.co.uk/ethics) ·
[More tools](https://github.com/m-sanchez)

Companion code for *The Careful Machine: Engineering AI Systems That Cannot
Certify Themselves* (Miguel Sanchez, 2026). One question is answered twice:

> Who has this account paid most often this quarter, and are any of those
> counterparties new?

- `src/fused/` is the chapter-1 machine, deliberately ordinary: a capped read
  nobody owns, a ranking narrated as the quarter, novelty answered from the
  window. **Its tests demonstrate the failure**: the confident wrong answers
  being produced while every component works as documented.
- `src/careful/` is the same question through the book's spine: contract and
  gate with the two standings (ch. 3-4), capability registry (ch. 5), scope
  intersection (ch. 6), action classifier and interception (ch. 12),
  evidence with coverage (ch. 7-8), derived results (ch. 9), the claim
  turnstile (ch. 11), the routed no (ch. 13), and replay (ch. 17).

This is a demonstration, not a framework: hold the whole repo in your head in
an afternoon. The "model" is a deterministic stub that emits proposals,
including hostile and over-confident ones; the architecture is what decides.

## Run

```bash
npm install        # dev-only: typescript + @types/node
npm run demo       # both machines answer the question; ground truth printed first
npm run serve      # local web UI at http://127.0.0.1:8787 (see below for the live model)
npm test           # node's built-in runner; no runtime dependencies
npm run typecheck  # the compile-time gates live here too
```

Node 22.6+ (uses `--experimental-strip-types`; the source is erasable-syntax
TypeScript, so node runs it directly).

## The tests are the point

Each core test is a book claim made executable:

| Test | Book claim |
| :-- | :-- |
| capped read truncates; narrated top payee wrong | ch. 1: the failure is in the empty space between working components |
| window read calls an old counterparty new | ch. 1/5: nothing owns the question being answered |
| type gate: `ExecutionRecord` takes a `CertId`, never a `ProposalId` | ch. 2: executions execute certifications |
| `requester-confirmed` unmintable except via the requester record | ch. 3: standing integrity; policy never certifies meaning |
| partial-read ranking struck unqualified; qualified form certified with subset named | ch. 8/11: claims carry the coverage they can support |
| `no-occurrence` fails on incomplete read and on unknown population | ch. 8: unknown is not zero |
| novelty ask lands `cannot-execute` with nearest-serviceable facts | ch. 5: capability is a record; honest refusal beats invented ability |
| hostile "search every account" widens the proposal, not the scope | ch. 6: authority is an intersection the proposal cannot move |
| disposition derives from records only, by fixed precedence | ch. 13: the no is routed, not narrated |
| renderer cannot leak a struck claim | ch. 11: narration is constrained to the certified set |
| the answer record replays with every reference resolving | ch. 17: an answer is a join over records |

All identifiers and numbers are invented and illustrative.

## Running with a real model (opt-in)

The core repo makes zero model calls; `demo:live` swaps the interpreter stub
for a real one. The model drafts the `RequestContract` through a forced tool
schema, the draft is validated mechanically (malformed drafts are rejected,
never repaired), ids are minted locally, and the actual model identity lands
in `proposedBy` and the AnswerRecord. Every other station is byte-for-byte
the same code the stub runs through, which is the demonstration: the proposer
got smarter and less predictable; the guarantees did not move.

```bash
ANTHROPIC_API_KEY=sk-... npm run demo:live                 # hostile question, policy-admitted
ANTHROPIC_API_KEY=sk-... npm run demo:live -- --confirmed  # same, requester-confirmed
ANTHROPIC_API_KEY=sk-... npm run demo:live -- "your own question"
```

`ANTHROPIC_MODEL` overrides the default (`claude-sonnet-5`);
`ANTHROPIC_BASE_URL` is honoured. The key is read from the environment for
the one request and never stored or printed. `npm test` stays fully offline.

The web UI defaults to live mode when the key is set (an "Offline stub"
toggle sits next to Run). In live mode the SAME model runs on both sides:
as the fused machine it is handed the question plus page one of the data
and one unvalidated generation ships as the answer; as the careful
machine's interpreter it drafts the reading only, and plain code does the
rest. Nothing is sent on page load; a run happens only when you press Run
or pick a scenario, and each live run makes two small API calls (one per
machine). The "Model exchange" panel on every result shows both calls
verbatim: what was sent (system prompts, question, data, tool schemas),
what came back, and what each side was allowed to do with it. The key
stays in the server process; the browser only ever sees the model's
output. With no key, both machines run offline: the fused side is the
original no-AI pipeline and the interpreter is the deterministic stub.

## Non-goals

No LLM calls outside the one opt-in interpreter above, no persistence beyond
in-memory records, no config system, no CLI polish, no framework extraction.
If a change makes this less readable in one sitting, it is the wrong change.
