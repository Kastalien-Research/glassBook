# glassBook Roadmap Execution Plan — Phases 0–4

> Companion to `../ROADMAP.md` and `../design/epiops-primitives.md`. Task-level plan
> for the foundation phases. Phases 5–9 get their own plans once the kernel lands.

**Goal:** take the foundation gaps in `V0-STATUS.md` to green without breaking the
validated v0 pipeline, with a test net in place first.

**Architecture:** keep the six-section orchestrator; make subagent/model concerns
configurable and resilient; extract pure helpers (`pr.mts`, `gates.mts`,
`retry.mts`, `cost.mts`) so engine logic is unit-testable without importing the
heavy `@srcbook/api` layer (which triggers SQLite init on import).

**Tech stack:** TypeScript ESM (`.mts`), Vitest, AI SDK v6, Zod, turbo, pnpm.

**Verification per phase:** `pnpm --filter @kastalien-research/glassbook check-types && lint && test`
must stay green; commit only on green (Ulysses-style commit-on-verified-state).

**Testability note:** `types.mts`, `context.mts`, `schemas.mts`, and `tools.mts`
(`detectInstallCommand`, `truncate`) import no `@srcbook/api` side effects → directly
unit-testable. Logic currently buried in `orchestrator`/`ulysses` (PR body, gate
reduction) is extracted into api-free modules so it can be tested with fakes.

---

## Phase 1 — Test & CI net (do first)

### Task 1.1: Vitest setup

- Modify `packages/glassbook/package.json`: add `"test": "vitest run"`, `"test:watch": "vitest"`, devDep `"vitest": "^2.0.5"` (match `@srcbook/api`).
- Create `packages/glassbook/vitest.config.mts` (node environment, include `src/**/*.test.mts`).
- `pnpm install` to refresh the lockfile.
- Verify: `pnpm --filter @kastalien-research/glassbook test` runs (0 tests OK).

### Task 1.2: Pure unit tests (no api, no LLM)

- `src/types.test.mts`: `ok`/`err`/`isOk`/`makeError` shape; `initialState` copies config fields, empty checkpoints/failures.
- `src/context.test.mts`: `budgetRemaining`; `consumeBudget` decrements; over-limit → `BudgetExceeded` error (Result, not throw).
- `src/tools.test.mts`: `detectInstallCommand` for pnpm/yarn/npm/none via temp dirs; `truncate` (export it) caps length and appends the truncation marker.
- Verify: tests pass.

### Task 1.3: Extract + test `pr.mts` (pure PR-body builder)

- Create `src/pr.mts` exporting `buildPrBody(state): string` — move the body from `orchestrator.prBody`.
- Modify `orchestrator.mts` to import `buildPrBody`.
- `src/pr.test.mts`: includes objective/goal/verdict/checkpoint count; omits absent sections.
- Verify: typecheck + tests.

### Task 1.4: Extract + test `gates.mts` (pure gate reducer)

- Create `src/gates.mts`:
  - `type GateRun = { id; command; passed; exitCode; output }`
  - `type ShRunner = (command: string) => Promise<{ code: number|null; combined: string }>`
  - `async runGates(gates, run: ShRunner): Promise<{ passed; runs; output }>` — empty gates → `passed=false`; `passed` = all exit 0; formats evidence text.
- Refactor `epiops/ulysses.mts` `runGates` to delegate to `gates.runGates` (pass a `sh`-backed runner bound to `repoDir`).
- `src/gates.test.mts`: empty → not passed; all-zero → passed; any-nonzero → not passed; output contains PASS/FAIL + exit codes. Uses a fake `ShRunner` (no real shell).
- Verify: typecheck + tests + existing Ulysses still typechecks.

### Task 1.5: CI workflow

- Inspect `.github/workflows/` first (don't clobber existing srcbook CI).
- Add or extend a workflow running: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm check-types`, `pnpm test` (turbo fans out; `^build` ensures api dist exists for glassbook).
- Verify locally: `pnpm --filter @kastalien-research/glassbook test && check-types && lint` green.
- Commit Phase 1.

---

## Phase 0 — Papercuts (safe subset)

### Task 0.1: Dev/web server `.env` autoload (§2.9)

- The CLI loads `.env` (`bin/cli.mts loadEnv`); the web/dev server does not.
- Add an api-side `loadEnvFile`-based loader invoked by the dev entry (`packages/api/dev-server.mts` / server bootstrap) guarded by existence checks; document precedence (env > SQLite).
- Verify: typecheck api; manual note (no secret committed).

### Task 0.2: Quiet mode for `@srcbook/api` session scan (§2.11)

- Importing `@srcbook/api` scans `~/.srcbook/srcbooks` and logs `Skipping...` for invalid notebooks.
- Add an env flag (e.g. `SRCBOOK_QUIET=1`) honored where the scan logs, and have the glassbook CLI set it unless `--verbose`.
- Verify: `glassbook --help` path clean; typecheck.

### Task 0.3: Central, current model defaults (§2.9)

- `packages/shared/src/ai.mts`: keep Anthropic `claude-haiku-4-5`; refresh clearly-retired ids (e.g. XAI `grok-beta`). Only change ids verifiable as valid; leave alias-style ids (`chatgpt-4o-latest`) as-is. Add a comment that env overrides win.
- Verify: shared typecheck/build.

### Task 0.4: Build-order + node docs (§2.11)

- Document in `packages/glassbook/README` (or CONTRIBUTING) that `@srcbook/api` must be built before glassbook typechecks, and that turbo `^build` handles it in CI.
- Reconcile `.nvmrc`/engines note.
- Commit Phase 0.

---

## Phase 2 — AI layer hardening

### Task 2.1: `retry.mts` (pure, injectable clock)

- Create `src/retry.mts`: `withRetry(fn, { retries, baseMs, isRetryable, sleep? })` with exponential backoff; default `isRetryable` matches transient LLM/network errors (429/5xx/ECONNRESET/timeout).
- `src/retry.test.mts`: succeeds first try; retries then succeeds; exhausts and returns last error; non-retryable not retried. Inject a fake `sleep` (no real delay).

### Task 2.2: Per-role model selection

- Add `Role = 'planner' | 'worker' | 'reviewer' | 'hypothesis'`.
- `subagent.mts`: `runPlanSubagent`/`runToolSubagent` accept an optional `role`; resolve a model via a `resolveModel(role)` helper that reads `SRCBOOK_AI_MODEL_<ROLE>` / provider-specific env, falling back to `getModel()`.
- Reviewer (`evaluation.mts`) defaults to the `reviewer` role so a stronger model can be pinned.
- Wrap model calls in `withRetry`.
- Verify: typecheck; tests for `resolveModel` env precedence (pure).

### Task 2.3: Token/cost accounting

- Create `src/cost.mts`: `UsageMeter` accumulating prompt/completion tokens + estimated cost from AI SDK `usage`.
- Thread a meter through `SectionContext`; subagents record usage; orchestrator emits a "Usage" section + adds totals to `glassbook.json`.
- `src/cost.test.mts`: accumulation + formatting (pure).

### Task 2.4: `generateObject` → `Output.object`; principled maxSteps

- Migrate `runPlanSubagent` to `generateText` + `experimental_output: Output.object({ schema })` (AI SDK v6), keeping the `Result<T>` contract.
- Replace ad-hoc `maxSteps` with named constants per role in one place.
- Verify: typecheck; existing call sites unchanged in signature.
- Commit Phase 2.

---

## Phase 3 — Smarter sections

### Task 3.1: Initialize gate discovery (§2.2)

- Give Initialize a read-only tool pass (`makeReadOnlyTools`) to discover real test/build/lint commands before producing `finalGates` (two-step: investigate → structured Plan), so unpinned gates are discovered, not guessed.
- Preserve `--gate` override precedence in the orchestrator.
- Verify: typecheck; emitter narration includes discovered commands.

### Task 3.2: Research fan-out (§2.2, §2.4)

- Replace the single gather pass with up-to-`budget` independent research cells (each a read-only sub-investigation of a distinct question), then synthesize; consume budget per cell.
- Verify: typecheck; budget consumption test where possible.
- Commit Phase 3.

---

## Phase 4 — EpiOps kernel (keystone) — outline

Build per `../design/epiops-primitives.md`: `src/epiops/kernel/` with `state-machine.mts`
(StateStep transitions), `behavior.mts`, `evaluator.mts` (wraps `gates.mts`),
`forbidden.mts` (positional store), `gamespace.mts`, `protocol.mts`
(`ProtocolDefinition`), and `run.mts` (the loop). Re-express Ulysses as
`epiops/protocols/ulysses.mts` implementing `ProtocolDefinition`. Heavily unit-test
the state machine + forbidden store + evaluator with fakes (no LLM). This phase gets
its own detailed plan before execution.
