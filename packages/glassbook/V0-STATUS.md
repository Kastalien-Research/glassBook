# glassBook v0 — Status, Simplifications & Stubs

Snapshot of what is and isn't operational after the v0 build pass.

- **Date:** 2026-06-28
- **Branch:** `feat/glassbook-v0`
- **Package:** `@kastalien-research/glassbook` (`packages/glassbook`)
- **Validated by:** one full live run (root-cause-and-fix on a throwaway repo, real GitHub PR). The pipeline produced a correct minimal fix, an adversarial approval, and an opened PR.
- **Current follow-up:** `feat/complete-codebase-protocols` adds protocol-specific work-execution
  dispatch and packets for Theseus, Hephaestus, and Ariadne; see `UNFINISHED.md` for current
  verification status. Latest package checks are green, but current-code Hephaestus/Ariadne live
  proofs still require a usable provider credential.

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

- ✅ Each turn runs on `<working-branch>-turn-N` from the checkpoint and successful turns merge
  back into the glassBook working PR branch. The implementation intentionally does not merge
  directly into the user's base branch.
- 🟡 **`workExecution` budget = max turns**, not max cells. (Documented in `src/templates/codebase-update.mts`.)
- ✅ Behaviors are plotted as primary/backup commitments and carry behavior-specific evaluator
  gates; the generated evaluator code is emitted as notebook code cells.
- ✅ The live Ulysses path runs the behavior evaluator for each attempt and the final gate for
  completion.
- ✅ Forbidden behaviors are persisted in `glassbook.json` and enforced positionally by the
  kernel's `ForbiddenStore`.
- ✅ CONSIDERATION restore uses checkpoint restore instead of `git reset --hard` plus
  `git clean -fd`.
- ✅ The kernel models the explicit `stateStep` enum `[0,1,2,-1]`.

### 2.2 Sections

- 🟡 **loadPackages** (`src/sections/load-packages.mts`): reinterpreted as "game board setup" — validates git repo / GitHub remote / clean tree and cuts the working branch. It does **not** load notebook/target dependencies here (install happens in workExecution under `--allow-install`).
- 🟡 **initialize** (`src/sections/initialize.mts`): single structured call with **no tools**, so gates are _guessed_ from conventions unless pinned with `--gate`. Unpinned gate quality is the biggest reliability risk.
- 🟡 **research** (`src/sections/research.mts`): **single pass** (read-only tools), emitting an investigation cell + a findings cell. Does **not** fan out into up-to-X independent research cells; the per-section budget mostly scales `maxSteps` rather than spawning cells.
- ✅ **workPlan** (`src/sections/work-plan.mts`): chooses among the codebase protocol family
  (`ulysses`, `theseus`, `hephaestus`, `ariadne`) and includes markdown-derived entities,
  behavior/evaluator schema, transitions, and packet schema in the planner prompt.
- ✅ **workExecution** (`src/sections/work-execution.mts`): dispatches the chosen codebase-family
  protocol through `epiops/codebase-runner.mts`. Ulysses preserves its live root-cause-and-fix loop;
  Theseus emits transformation/equivalence packets, Hephaestus emits reproduction packets, and
  Ariadne runs read-only topology discovery with a topology packet.
- 🟡 **evaluation** (`src/sections/evaluation.mts`): real adversarial review, but uses the **same model** as the worker (no stronger reviewer model) and is not sandboxed.

### 2.3 Gate conditions (design component #1)

- ✅ Gates exist as executable shell commands validating the **final** output.
- ✅ Work-execution behaviors carry their own evaluator gate; the live Ulysses path runs the
  behavior gate for the attempt and the final gate for completion.
- ✅ Gates are emitted as Srcbook code cells and executed through the notebook-local TypeScript
  runner during the run; cell output is recorded as evidence alongside the direct shell gate.

### 2.4 Cell budgets (design component #2)

- 🟡 Per-section budgets exist (`RunConfig.budgets`, `--budget-research`, `--budget-exec`) and are enforced via `consumeBudget`.
- ✅ `loadPackages`, `initialize`, `research`, `workPlan`, `workExecution`, and `evaluation`
  all consume section budgets. Single-shot sections still consume one cell.

### 2.5 Failure types (design component #3)

- ✅ `GlassbookError` is the typed Effect error channel via `effect-runtime.mts`; existing
  `Result<A>` section returns are converted through the Effect boundary.
- ✅ Section recovery policies are explicit (`retryable`, `maxRetries`) and live next to the
  Effect bridge.

### 2.6 Notebook / cell model & audit

- ✅ glassBook now persists typed `[input → processing → output]` cell records with gates in
  `glassbook.json` while still rendering the notebook through existing Srcbook `markdown`/`code`
  cells.
- ✅ Gate notebook cells are executable/re-runnable through the notebook runtime, and their
  output is captured during Ulysses execution.
- ✅ Replay tooling consumes `glassbook.json` for saved final-gate replay via `glassbook replay`
  and `glassbook replay-evaluation`.
- 🟥 **No live UI streaming.** Headless only; the notebook is written to `~/.srcbook/srcbooks/<id>/` and optionally exported via `--out`.
- ✅ The notebook is a **separate** srcbook from the target repo; its own package.json/tsconfig
  are checked before execution, dependencies install when `tsx` is missing, and code cells run
  with the notebook as cwd.

### 2.7 Subagent / AI layer (`src/subagent.mts`)

- ✅ Planning subagents use AI SDK v6 `generateText` + `Output.object` for structured output.
- ✅ Per-role model overrides are supported via `SRCBOOK_AI_MODEL_<ROLE>` for planner, worker,
  reviewer, and hypothesis roles.
- 🟡 `maxSteps` heuristics are centralized but still heuristic.
- ✅ Transient LLM failures use retry/backoff before surfacing `SubagentError`.
- ✅ Token usage is recorded per role and persisted in the notebook sidecar.
- 🟥 No streaming; research uses a two-step gather-then-synthesize rather than structured-output-with-tools.

### 2.8 Git / GitHub (`src/git.mts`)

- 🟡 Requires `origin` to be a `github.com` remote (for the PR). No support for other forges.
- ✅ Pre-existing branch names are handled by suffixing. Stale remote pushes fetch/rebase/retry,
  and rebase conflicts return a clear GitError.
- ✅ PR body is generated from run state: gates, research, execution, evaluation, checkpoints,
  kernel turns, typed cells, protocol packet details, and usage.

### 2.9 Config / env / models

- ✅ `.env` is auto-loaded by the **glassbook CLI** and the **web/dev server**. Both load
  an explicit path when provided, then `./.env`, then `~/.srcbook/.env`.
- ✅ Hosted-provider defaults are refreshed for OpenAI (`gpt-5.5`), xAI (`grok-4.3`),
  Gemini (`gemini-3.5-flash`), Anthropic (`claude-haiku-4-5`), and OpenRouter
  (`anthropic/claude-haiku-4-5`).
- ✅ Config precedence is explicit: direct call options such as `getModel({ model })`
  win first, then environment variables, then SQLite config (`~/.srcbook/srcbook.db`),
  then provider defaults.
- ✅ Model calls are bounded per attempt by `GLASSBOOK_MODEL_TIMEOUT_MS` (default: 180000ms)
  so stalled provider requests surface as typed `SubagentError` failures instead of hanging
  the CLI indefinitely.

### 2.10 Tooling / security

- ✅ Tool-exposed `runShell` uses the macOS `sandbox-exec` repo filesystem sandbox when
  available and fails closed when the OS sandbox cannot be applied. Shell tools receive only the
  minimal shell environment plus explicit `RunConfig.sessionEnv`.
- ✅ `webFetch` blocks localhost and private-network URLs before making a request.
- 🟡 Output truncated at ~20k chars; shell commands time out at 300s.

### 2.11 Build / dev environment

- ✅ `.nvmrc` tracks the Node 22 line instead of pinning an unavailable patch release.
- ✅ glassBook package typecheck builds `@srcbook/api` first because the
  `@srcbook/api/headless` subpath resolves to `dist`.
- ✅ `SRCBOOK_QUIET=1` (or `true`) suppresses boot-time skipped-session scan noise for
  unrelated invalid notebooks.

### 2.12 Tests / CI

- ✅ Automated vitest coverage exists for gates, tools, git helpers, PR rendering, replay,
  notebook runtime, Effect boundary, Ulysses, protocol registry/source parsing, and work-execution
  dispatch.
- ✅ Root `pnpm test` is CI-safe: `@srcbook/api` uses `vitest run`, with watch mode preserved as
  `pnpm --filter @srcbook/api test:watch`.
- ✅ CI wiring exists for the package; see `UNFINISHED.md` for the latest CI verification notes.

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
6. Complete current-code live `--skip-pr` verification for Hephaestus and Ariadne once provider
   credentials are repaired.
7. Decide whether non-codebase protocols (Hermes, Minos, Cassandra, Janus) should enter scope.
8. Keep protocol packets evolving from deterministic summaries toward richer source-derived
   schemas as new workflows demand them.
