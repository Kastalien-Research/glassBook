# glassBook — Unfinished Work (every phase)

Consolidated list of everything **not finished**, including items explicitly **deferred**,
**dropped**, or **out of scope**, across every phase of the roadmap.

- **Date:** 2026-06-29
- **Branch:** `feat/glassbook-green`
- **Sources:** `ROADMAP.md` (Phases 0–9), `plans/2026-06-28-roadmap-execution.md` (Phase 0–4 tasks), `V0-STATUS.md` (gaps)
- **Method:** the per-phase progress log in `ROADMAP.md` is optimistic; the statuses below were **re-verified against the actual code on 2026-06-29**. Discrepancies are called out in §A.

---

## Status at a glance

| Phase                     | Roadmap claim | Verified status |
| ------------------------- | ------------- | --------------- |
| 0 — Papercuts             | ⏳ deferred   | ✅ done         |
| 1 — Test & CI net         | ✅            | ✅ done         |
| 2 — AI layer hardening    | ✅            | ✅ done         |
| 3 — Smarter sections      | ✅            | ✅ done         |
| 4 — EpiOps kernel         | 🟡            | ✅ done         |
| 5 — Executable + replay   | ⏳            | ✅ done         |
| 6 — Protocol library      | ⏳            | ✅ done         |
| 7 — Git/GitHub robustness | ⏳            | ✅ done         |
| 8 — Sandbox / security    | ⏳            | ✅ done         |
| 9 — Effect-TS refactor    | ⏳ deferred   | ✅ done         |

---

## A. Known discrepancies (claimed done, but unfinished)

- [x] **Phase 2 marked ✅ but `generateObject → Output.object` (Task 2.4) is NOT done.** Fixed: `src/subagent.mts` now uses `generateText` + `Output.object`, covered by `src/subagent.test.mts`.
- [x] **Phase 4 marked 🟡 "foundation" — but the kernel is not imported anywhere.** Fixed at the live-loop boundary: `src/epiops/ulysses.mts` now drives execution through `runGamespace`, covered by `src/epiops/ulysses.test.mts`.
- [x] **Phase 6 marked ✅ but Theseus/Hephaestus/Ariadne were still routed through Ulysses.** Fixed on `feat/complete-codebase-protocols`: `src/sections/work-execution.mts` now dispatches through `src/epiops/codebase-runner.mts`, non-Ulysses protocols emit protocol-specific packets, and `src/sections/work-execution.test.mts` covers dispatch and packet metadata.
- [x] **Phase 6 live verification for the latest non-Ulysses code is complete.** Current-code
      Ulysses, Theseus, Hephaestus, and Ariadne live `--skip-pr` runs have produced notebooks,
      sidecars, protocol packet data, gate/evaluator evidence, and evaluator approval.

---

## B. Per-phase unfinished items

### Phase 0 — Papercuts ❌ (deferred per progress log)

- [x] Refresh stale model defaults for OpenAI/others in `packages/shared/src/ai.mts` (only Anthropic `claude-haiku-4-5` updated).
- [x] Auto-load `.env` in the web/dev server (`packages/api/dev-server.mts`), not just the glassbook CLI.
- [x] Quiet/headless mode for `@srcbook/api` to silence the `~/.srcbook/srcbooks` session-scan noise (e.g. `SRCBOOK_QUIET`).
- [x] Make `@srcbook/api` a declared turbo build dependency so glassBook typechecks without a manual pre-build.
- [x] Reconcile `.nvmrc` (22.7.0, not installed) vs. runtime (ran on 22.22.3).
- [x] Document SQLite-fallback / env-override precedence (doc only).
- _Reason deferred (per ROADMAP): touches the web/api server and needs manual validation._

### Phase 1 — Test & CI net ✅

- [x] **CI verified by an actual GitHub Actions run.** PR #1 (`feat/glassbook-green` → `main`) merged after the `CI` workflow completed successfully on head SHA `f07a727790470960897ef9749255f95c27c84ece`: `Build and Test (18.x)` and `Build and Test (22.x)` both passed in run `28406443165` on 2026-06-29.

### Phase 2 — AI layer hardening 🟡

- [x] **Task 2.4 — migrate `generateObject` → `generateText` + `Output.object`** (see §A). _Done in this phase: `retry.mts`, `cost.mts`/`UsageMeter`, per-role model selection (`resolveModelId`), centralized `MAX_STEPS`._

### Phase 3 — Smarter sections ✅ (one open item)

- [x] Resolve `loadPackages`: either actually load notebook/target dependencies, or formally ratify the "game-board setup" reinterpretation in the design (ROADMAP Phase 3 bullet; not in the executed task list). _Done: Initialize gate discovery via read-only tools; Research fan-out._

### Phase 4 — EpiOps kernel 🟡 (keystone — foundation only)

- [x] Wire the kernel into the live engine (replace the old `epiops/ulysses.mts` path in `work-execution.mts`).
- [x] Re-express Ulysses as a `ProtocolDefinition` on the kernel (`epiops/protocols/ulysses.mts` does not exist).
- [x] Per-behavior evaluators = the per-cell gate condition (live path still uses one global gate).
- [x] Persisted, positionally-enforced `forbiddenBehaviors` in the live path (kernel has `ForbiddenStore`; live Ulysses still uses in-memory strings).
- [x] Explicit `stateStep [0,1,2,-1]` state machine in the live path (kernel has it; live path expresses it via control flow).
- [x] Typed template-as-type with gates; the `[input → processing → output]` typed glassBook cell unit.
- [x] Real per-section cell budgets that create cells up to a limit across all sections (today only Research and Ulysses turns consume budget).

### Phase 5 — Executable + replay ✅

- [x] Re-runnable gate/code cells executed by the Srcbook engine, not emitted as evidence text. _Done: Ulysses emits gate code cells, executes them through the notebook-local TypeScript runner, and records cell output as evidence._
- [x] Replay tooling consuming `glassbook.json` (re-run notebook / re-run evaluation).
- [x] Install/use the notebook's own `package.json`/`tsconfig` so its cells actually execute. _Done: the notebook runtime checks package.json/tsconfig, installs notebook deps when `tsx` is missing, and runs cells with cwd set to the notebook._

### Phase 6 — Protocol library integration 🟡

- [x] Load `workflows/epiops_protocols/*` (+ `ulysses.md`) as typed protocol definitions (entities, behavior/evaluator schema, transitions, emit-packet schema). _Done: `epiops/protocols/source.mts` parses the four executable codebase markdown protocols, and `work-plan.mts` includes the source-derived schema in planner prompts._
- [x] `workPlan` really chooses among ≥4 protocols (today fixed to `ulysses`).
- [x] Wire Theseus, Hephaestus, Ariadne as runnable codebase-family protocol paths, each emitting its packet. _Done: `codebase-runner.mts` gives Theseus an equivalence/transformation packet, Hephaestus a reproduction packet, and Ariadne a read-only topology packet; `ExecutionResult.packet` persists and PR rendering includes packet details._
- [x] Complete current-code live `--skip-pr` verification for Hephaestus and Ariadne. _Done:
      throwaway runs now approve with persisted notebook/sidecar packet evidence._
- [x] Destructive-reset hardening for CONSIDERATION (`git reset --hard` / `git clean -fd`).

### Phase 7 — Git/GitHub robustness ✅

- [x] Branch-per-loop + per-turn merge-to-main where the protocol calls for it (currently single working branch, one PR at end). _Done: each Ulysses turn now runs on `<working-branch>-turn-N` and successful turns merge back into the glassBook working PR branch. The implementation intentionally does not merge into the user's base branch directly._
- [x] Handle push conflicts, pre-existing branches, rebases. _Done: pre-existing branch names suffix automatically; stale remote pushes fetch/rebase/retry, with a clear error if the rebase conflicts._
- [x] Dynamic PR body generated from the run (currently a fixed template via `pr.mts`).
- [x] Clear errors for non-`github.com` remotes.

### Phase 8 — Sandbox / security ✅

- [x] Sandbox `runShell` and `webFetch` (candidate: container-use). _Done: tool-exposed `runShell` uses the macOS `sandbox-exec` repo filesystem sandbox when available and fails closed when the OS sandbox cannot be applied; `webFetch` blocks localhost/private-network URLs._
- [x] Per-session secret management instead of inheriting the CLI's `process.env`. _Done: shell tools receive only the minimal shell environment plus explicit `RunConfig.sessionEnv`; arbitrary CLI environment variables are not inherited._

### Phase 9 — Effect-TS refactor ✅

- [x] Convert the failure model + section signatures to Effect; `GlassbookError` becomes the error channel; structured retry/recovery strategies. _Done: `effect@3.21.4` is installed, `effect-runtime.mts` defines the `GlassbookEffect` error channel and recovery policies, and the orchestrator runs each section through the Effect boundary._

---

## C. Explicitly deferred / dropped / out of scope

- **Deferred:** none remaining from the phase checklist.
- **Dropped:** live human UI streaming (glassBook is an agent-native tool; replay/re-run stays, human live UI does not).
- **Out of scope (for now):**
  - Non-codebase protocols: Hermes, Minos, Cassandra, Janus (need new input/output worlds).
  - Forges other than GitHub.
  - Multi-protocol scope is assumed to be the **codebase family** (Ulysses, Theseus, Hephaestus, Ariadne); the kernel is built generically so the others can be added later. _(Assumption — override if all eight should be in-scope now.)_

---

## D. Outstanding verification gaps (independent of phases)

- [x] The refactored engine on `feat/glassbook-green` has been exercised end-to-end against real throwaway repos. _Done: two Node 22 live runs against throwaway git repos passed with `--skip-pr`; both resolved in one Ulysses turn, merged a per-turn branch back into the working branch, passed executable gate cells, passed final gates, and received evaluator approval._
- [x] CI has been confirmed green on PR #1 (see Phase 1).
- [x] Per-role model env wiring (`SRCBOOK_AI_MODEL_<ROLE>`) is live-validated. _Done: a live run with `SRCBOOK_AI_MODEL_PLANNER`, `SRCBOOK_AI_MODEL_WORKER`, `SRCBOOK_AI_MODEL_REVIEWER`, and `SRCBOOK_AI_MODEL_HYPOTHESIS` explicitly set completed successfully and recorded planner/worker/reviewer usage. This validated per-role wiring with the configured model; it was intentionally not a mixed-provider cost test._
