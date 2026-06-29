# glassBook v0 — Status, Simplifications & Stubs

Snapshot of what is and isn't operational after the v0 build pass.

- **Date:** 2026-06-28
- **Branch:** `feat/glassbook-v0`
- **Package:** `@kastalien-research/glassbook` (`packages/glassbook`)
- **Validated by:** one full live run (root-cause-and-fix on a throwaway repo, real GitHub PR). The pipeline produced a correct minimal fix, an adversarial approval, and an opened PR.

**Legend:** ✅ operational · 🟡 partial / simplified · 🟥 stub / not implemented

---

## 1. What is operational (verified end-to-end)

- ✅ Headless CLI `glassbook run` driving all six sections in order.
- ✅ Structured planning via the Vercel AI SDK (`generateObject`) and tool-using agent loops (`generateText` + `tools` + `stopWhen: stepCountIs`).
- ✅ Real repo-scoped tools: `readFile`, `listFiles`, `searchCode`, `runShell`, `writeFile`, `webFetch` (`src/tools.mts`).
- ✅ Executable gates: shell commands whose exit code determines pass/fail, run against the target repo.
- ✅ `--gate` to pin verification commands; `--allow-install` to install deps + permit installs during execution.
- ✅ Ulysses execution loop with primary/backup hypotheses, CONSIDERATION on double-failure, and **commit-on-verified-state** safety net.
- ✅ Adversarial evaluation (reward-hacking check) gating the PR.
- ✅ Real git + GitHub: working branch, checkpoint commits, push, `gh pr create`.
- ✅ Auditable `.src.md` notebook + `glassbook.json` state sidecar, flushed incrementally (survives crashes).
- ✅ Typed failure model (`GlassbookError` tagged union + `Result<A>`) — no exceptions cross section boundaries.
- ✅ `.env` support: env vars override SQLite config in `getModel()`; CLI auto-loads `.env` / `--env-file`.

---

## 2. Simplifications vs. the design

### 2.1 Ulysses protocol fidelity (`src/epiops/ulysses.mts`)

The conceptual core is implemented; several spec details from `workflows/ulysses.md` are simplified:

- 🟡 **Single working branch, not branch-per-loop.** The spec opens a new branch from the checkpoint each loop and merges into main on each successful turn. We operate on one working branch, accumulate checkpoint commits, and open **one** PR at the end. No per-turn merge-to-main; no "protocol offshoot" branch distinct from the working branch.
- 🟡 **`workExecution` budget = max turns**, not max cells. (Documented in `src/templates/codebase-update.mts`.)
- 🟡 **Behaviors are not pre-plotted immutable `{action, eval-code}` pairs.** Primary/backup hypotheses come from the Work Plan (turn 1) or a hypothesis sub-call (later turns). There is no separate per-behavior evaluation code.
- 🟡 **Gate is global, not per-behavior.** Every step is checked against the same `plan.finalGates`, rather than behavior-specific success code.
- 🟡 **Forbidden behaviors** are tracked in-memory as strings passed to the next hypothesis prompt. They are not persisted and not enforced positionally/structurally as the spec describes.
- 🟡 **CONSIDERATION reset is destructive:** `git reset --hard <checkpoint> && git clean -fd` in the target repo. Safe only because of the clean-tree precondition + repo isolation.
- 🟥 **No explicit `stateStep` enum counter** `[0,1,2,-1]`; the semantics are expressed via control flow, not a modeled counter.

### 2.2 Sections

- 🟡 **loadPackages** (`src/sections/load-packages.mts`): reinterpreted as "game board setup" — validates git repo / GitHub remote / clean tree and cuts the working branch. It does **not** load notebook/target dependencies here (install happens in workExecution under `--allow-install`).
- 🟡 **initialize** (`src/sections/initialize.mts`): single structured call with **no tools**, so gates are _guessed_ from conventions unless pinned with `--gate`. Unpinned gate quality is the biggest reliability risk.
- 🟡 **research** (`src/sections/research.mts`): **single pass** (read-only tools), emitting an investigation cell + a findings cell. Does **not** fan out into up-to-X independent research cells; the per-section budget mostly scales `maxSteps` rather than spawning cells.
- 🟡 **workPlan** (`src/sections/work-plan.mts`): "chooses" a process but the enum has only `ulysses`, so the choice is fixed. No real EpiOps library yet.
- 🟡 **evaluation** (`src/sections/evaluation.mts`): real adversarial review, but uses the **same model** as the worker (no stronger reviewer model) and is not sandboxed.

### 2.3 Gate conditions (design component #1)

- 🟡 Gates exist as executable shell commands validating the **final** output.
- 🟥 **No per-cell gate conditions.** The design's "executable code validating each cell + the template represented as a type with gates" is not implemented.
- 🟥 **Gates are not re-runnable notebook cells.** They run against the target repo via `sh` and are emitted as **evidence text**, not as Srcbook code cells executed by the notebook engine.

### 2.4 Cell budgets (design component #2)

- 🟡 Per-section budgets exist (`RunConfig.budgets`, `--budget-research`, `--budget-exec`) and are enforced via `consumeBudget`.
- 🟡 Only **workExecution** (Ulysses turns) and **research** (1) actually consume/loop. `loadPackages`, `initialize`, `workPlan` are single-shot regardless of budget — they don't "create additional cells up to a limit."

### 2.5 Failure types (design component #3)

- ✅ Implemented as a vanilla-TS tagged union + `Result<A>`.
- 🟡 Tags are coarse; no retry/backoff/recovery strategies. Not yet Effect-TS (planned refactor).

### 2.6 Notebook / cell model & audit

- 🟡 **glassBook "cells" are not a new srcmd cell type.** We reuse existing `markdown`/`code` cells; structured input/processing/output + gate results are rendered as **markdown narration + evidence**, not as the typed `[input → processing → output]` units from the design.
- 🟥 **Notebook cells are not executable/re-runnable** in Srcbook (evidence only). "Click back through the notebook" works; "re-run cell N live" does not.
- 🟥 **No replay/retroactive-run tooling.** `glassbook.json` is written for replay, but nothing consumes it yet (no "re-run the notebook" / "re-run evaluation" commands).
- 🟥 **No live UI streaming.** Headless only; the notebook is written to `~/.srcbook/srcbooks/<id>/` and optionally exported via `--out`.
- 🟡 The notebook is a **separate** srcbook from the target repo; the notebook's own package.json/tsconfig (tsx/typescript/prettier) are created but never installed/used.

### 2.7 Subagent / AI layer (`src/subagent.mts`)

- 🟡 Uses `generateObject`, which is **deprecated in AI SDK v6** (still functional). Did not migrate to `generateText` + `Output.object`.
- 🟡 **One model for every role** (planner, worker, reviewer, hypothesis) — whatever provider/model is configured.
- 🟡 `maxSteps` heuristics are ad hoc.
- 🟥 No retry/backoff on transient LLM errors (a `SubagentError` fails the section).
- 🟥 No token/cost accounting or budget (only step-count limits).
- 🟥 No streaming; research uses a two-step gather-then-synthesize rather than structured-output-with-tools.

### 2.8 Git / GitHub (`src/git.mts`)

- 🟡 Requires `origin` to be a `github.com` remote (for the PR). No support for other forges.
- 🟥 No handling of push conflicts, pre-existing branches, rebases, or merge-to-main per turn.
- 🟡 Commit messages via temp file; PR body is a fixed template.

### 2.9 Config / env / models

- 🟡 `.env` is auto-loaded only by the **glassbook CLI** (and `getModel` reads `process.env` generally). The **web/dev server does not auto-load `.env`.**
- 🟡 Default model bumped to `claude-haiku-4-5` for Anthropic (and OpenRouter route); **OpenAI and other defaults remain stale** (intentional — OpenAI is a later step).
- 🟡 SQLite config (`~/.srcbook/srcbook.db`) still exists and is the fallback; env overrides it.

### 2.10 Tooling / security

- 🟥 **No sandbox.** `runShell` executes arbitrary bash in the target repo with full user permissions; `webFetch` can hit any URL. Safe only for **trusted** prompts/repos.
- 🟡 Output truncated at ~20k chars; shell commands time out at 300s; gate commands inherit the CLI's `process.env` (no per-session secret management like Srcbook's).

### 2.11 Build / dev environment

- 🟡 `.nvmrc` pins Node `22.7.0` (not installed locally); built/ran on `22.22.3`.
- 🟡 `@srcbook/api` must be **built** (`dist/`) before glassBook typechecks/runs — the `@srcbook/api/headless` subpath resolves to `dist`.
- 🟡 Importing `@srcbook/api` scans `~/.srcbook/srcbooks` and prints noisy `Skipping...` errors for unrelated invalid notebooks (cosmetic; not yet silenced — no headless/quiet flag on the API).

### 2.12 Tests / CI

- 🟥 **No automated tests** for the `glassbook` package (no vitest suite). Validated only via the manual live run.
- 🟥 No CI wiring for the new package.

---

## 3. Changes made to upstream `@srcbook/api` (our fork)

- Added `packages/api/headless.mts` + an `exports` map (`.` and `./headless`) — programmatic surface (encode/decode, session lifecycle, exec, `getModel`, config).
- `getModel()` now reads env vars first, then SQLite; added an exhaustive `default` to the provider switch.
- `packages/shared/src/ai.mts`: Anthropic default → `claude-haiku-4-5`; OpenRouter default → `anthropic/claude-haiku-4-5`.
- `turbo.json`: declared new AI env vars; `.gitignore`: added `.env`.

---

## 4. Highest-value next steps (suggested)

1. Pinning/justifying gates without `--gate`: give Initialize read-only tools so it can discover the real test/build command.
2. Per-cell / per-section gate conditions and a typed template (moves toward design component #1).
3. Replay tooling that consumes `glassbook.json` (re-run notebook / re-run evaluation).
4. Separate (stronger) reviewer model; per-role model selection.
5. Real fan-out research (multiple cells up to budget).
6. A vitest suite for the engine (gate runner, Ulysses loop, emitter) + CI.
7. Quiet/headless mode for `@srcbook/api` to silence the session-scan noise.
8. Effect-TS refactor of the failure model and section signatures.
