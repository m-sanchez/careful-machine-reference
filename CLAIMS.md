# Claims, and what enforces them

Every externally checkable claim in `README.md` and in the package
description, mapped to the test that enforces it. A claim no test can reach
is listed at the bottom, with what does check it and why a test would not.
This file is maintained by hand; if you add a claim to the README, add its
row here or narrow the claim.

Run everything below with `npm test` (fully offline) and `npm run typecheck`.

## Behavioural claims

| Claim | Where it is made | Enforced by |
| :-- | :-- | :-- |
| One question, answered by the chapter-1 machine and by the careful architecture, over the same data | package description; README intro | `test/fused.test.ts::the narrated 'most frequent payee' is wrong about the quarter` + `test/careful.test.ts::a complete read certifies the unqualified ranking, and it names Marram Freight` |
| Plain code checks the answer and verifies the citations | README "In plain English" | `test/careful.test.ts::a struck claim is recorded with the failing check named, and the renderer cannot leak it` |
| If the check fails it refuses instead of guessing | README "In plain English" | `test/careful.test.ts::a least-frequent ask certifies nothing end to end and disposes cannot-execute` |
| The fused machine's read is capped and nobody owns the cap | README `src/fused` bullet | `test/fused.test.ts::the capped read silently truncates the quarter` |
| The fused machine narrates a page-one ranking as the quarter's | README `src/fused` bullet | `test/fused.test.ts::the narrated 'most frequent payee' is wrong about the quarter` |
| The fused machine answers novelty from the window, so an old counterparty is called new | README `src/fused` bullet | `test/fused.test.ts::the narrated 'new counterparties' calls an old counterparty new` |
| Contract and gate carry two standings, and policy never mints the confirmed one (ch. 3-4) | README `src/careful` bullet | `test/careful.test.ts::standing integrity: only the requester record mints requester-confirmed` |
| The capability registry decides what can be established, and refuses the rest by name (ch. 5) | README `src/careful` bullet | `test/careful.test.ts::the novelty ask yields cannot-execute grounded in the registry, with nearest-serviceable facts attached`; `test/careful.test.ts::a least-frequent ranking ask is refused by the registry and disposes as cannot-execute` |
| What the registry selected is what executes | README table; ch. 5/12 | `test/careful.test.ts::a presence ask certifies no ranking claim: nothing answers a question nobody asked` |
| Scope is an intersection a proposal cannot widen (ch. 6) | README `src/careful` bullet | `test/careful.test.ts::hostile scope escalation widens the proposal and cannot widen effectiveScope` |
| Reads are classified and intercepted, each logged under the certification it ran under (ch. 12) | README `src/careful` bullet | `test/careful.test.ts::every read is intercepted and logged against the certification it ran under` |
| Evidence carries coverage, and a claim may only lean on the coverage it has (ch. 7-8) | README `src/careful` bullet | `test/careful.test.ts::a partial-read ranking cannot certify unqualified; the qualified form survives with the subset named`; `test/careful.test.ts::no-occurrence fails on an incomplete read AND on an unknown population` |
| Derived results are computed by code, and a claim names the window and subject actually read (ch. 9) | README `src/careful` bullet | `test/careful.test.ts::the certified ranking claim names the window that was actually read`; `test/careful.test.ts::the certified claim names the subject the scope certification actually put in scope` |
| The claim turnstile certifies or strikes, and narration cannot leak a struck claim (ch. 11) | README `src/careful` bullet | `test/careful.test.ts::a struck claim is recorded with the failing check named, and the renderer cannot leak it` |
| The no is routed from records by fixed precedence, never narrated (ch. 13) | README `src/careful` bullet | `test/careful.test.ts::disposition derives from records only, by fixed precedence` |
| An ask outside the grant is answered `outside-authority` with the scope owner named, not a crash | README table; ch. 13 | `test/careful.test.ts::a subject no grant covers routes outside-authority; it does not throw` |
| An answer replays: every reference it names resolves (ch. 17) | README `src/careful` bullet | `test/careful.test.ts::an answer replays: every reference the record names resolves` |
| The offline "model" is a stub that emits hostile and over-confident proposals | README intro paragraph | `test/careful.test.ts::hostile scope escalation widens the proposal and cannot widen effectiveScope` (hostile); `test/careful.test.ts::a partial-read ranking cannot certify unqualified; the qualified form survives with the subset named` (over-confident) |
| The live draft is validated mechanically: malformed drafts are rejected, never repaired | README "Running with a real model"; "Decisions" | `test/interpreter.test.ts::the validator rejects ${name}, with the ground named` (one test per row of the hostile-draft table: missing direction, non-ISO window, invented window origin, ask kind outside the enum, missing sourceSpan, non-string qualifiers, resolution state outside the enum, empty subjects, non-string subjects, empty sources, empty asks, missing unclaimedText, a draft that is not an object); `test/interpreter.test.ts::normalize invents nothing: an envelope carrying a spoiled draft is still rejected` |
| Ids are minted locally; nothing the draft supplies becomes a record field | README "Running with a real model" | `test/interpreter.test.ts::the validator never carries a field the draft invented, and mints ask ids itself` |
| Every station after the interpreter is the same code the stub runs through; the guarantees did not move | README "Running with a real model" | The pipeline tests are driven with live-shaped drafts (asks, window, subject, grants the stub never emits): `test/careful.test.ts::a presence ask certifies no ranking claim: nothing answers a question nobody asked`, `::the certified ranking claim names the window that was actually read`, `::the certified claim names the subject the scope certification actually put in scope`, `::a subject no grant covers routes outside-authority; it does not throw` |
| `npm test` stays fully offline | README "Running with a real model" | `test/interpreter.test.ts::validate and normalize never touch the network` (the suite's only network-capable import; `fetch` is trapped for that file) |
| The model never runs inside the verifier: drafts are input, plain code decides | README "Decisions" | `test/careful.test.ts::disposition derives from records only, by fixed precedence` (the disposition input type carries no model-produced text; `deriveDisposition` and `checkClaim` take records only) |
| Zero runtime dependencies | README badge and "Decisions" | `test/types.test.ts::the package declares no runtime dependencies` |
| An execution takes a certification id, never a proposal id (ch. 2) | README table | `test/types.test.ts::compile-time gates are declared (enforced by tsc, see @ts-expect-error above)` (`@ts-expect-error`, enforced by `npm run typecheck`) |
| `requester-confirmed` cannot be forged as a literal (ch. 3) | README table | `test/types.test.ts::compile-time gates are declared (enforced by tsc, see @ts-expect-error above)` (`@ts-expect-error`, enforced by `npm run typecheck`) |

## Claims no test enforces, and what does check them

| Claim | Where it is made | What checks it |
| :-- | :-- | :-- |
| A live run makes two API calls, or three when a draft is rejected | README "Running with a real model"; the page's controls note | Structural, one place each: the interpreter's retry loop is bounded at two attempts (`src/careful/llm-interpreter.ts`, `for (let attempt = 1; attempt <= 2; attempt++)`), the fused side makes exactly one call and never retries (`src/fused/llm-fused.ts`). A test would have to reach the network, which `npm test` may not do. |
| In live mode the fused machine is handed every row for the account, and the cap re-imposes page one on BOTH machines | README "Running with a real model" | `src/serve.ts` (`req.cap ? cappedRead(...) : store.filter(...)`), and the row count it was handed is reported back to the page on every run (`fused.handed.rowsHanded`). The cap's semantics for the offline machine are tested: `test/fused.test.ts::the capped read silently truncates the quarter`. `src/serve.ts` starts a listener on import, so it is not importable by the suite as it stands. |
| The key stays in the server process; the browser only ever sees the model's output | `src/serve.ts` header; README | Structural: the key is read from `process.env` at the moment of the request and never enters `InterpreterExchange` / `FusedExchange`, which are the only objects serialised to the page. A credentialled `ANTHROPIC_BASE_URL` has its userinfo stripped before the url is recorded. |
| The model's identity lands in `proposedBy` and the AnswerRecord | README "Running with a real model" | Structural: `proposedBy: got.model` comes from the response body, and `buildAnswerRecord` carries it through. Observing it needs a live call. |
| The forced tool schema is what the model must answer through | README "Running with a real model" | Structural: one request body, `tool_choice: { type: "tool", name: "draft_contract" }`, and the whole schema is echoed verbatim into the recorded exchange for inspection. |
| Node 22.6+ runs the source directly | README "Run" | CI runs the suite, the typecheck and the demo on Node 22 and 24 (`.github/workflows/test.yml`). |
| `src/fused` and `src/careful` can be held in your head in an afternoon | README intro | Not mechanically falsifiable. For scale: the two directories plus `records.ts` and `store.ts` are about 1,400 lines including comments, of which the live-model files are about 470. `src/serve.ts` and `src/web` are deliberately outside the claim. |
| Demonstration, not framework; no persistence, no config system, no framework extraction | package description; README "Non-goals" | Structural: the package is `private`, exports nothing, has no `bin`, no config file is read, and no record outlives the process. |
