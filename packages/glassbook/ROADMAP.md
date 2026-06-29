# glassBook — Roadmap to Green

Companion to `V0-STATUS.md`. This is the decomposition that takes every 🟡 (partial) and
🟥 (stub) item in the v0 status to ✅, plus the multi-protocol generalization unlocked by the
EpiOps library in `workflows/epiops_protocols/`.

- **Date:** 2026-06-28
- **Source of truth:** `V0-STATUS.md` (gaps), `workflows/ulysses.md` + `workflows/epiops_protocols/*` (protocol specs)
- **Goal:** full realization of the original design — not a v1 cut.

---

## Sequencing philosophy

**Reliability-first → foundation → fidelity.** Ship value on the current architecture first
(model routing, retries, gate discovery, tests/CI), *then* build the typed EpiOps kernel, *then*
layer full protocol fidelity, git robustness, and sandboxing on top. The big architectural rework
(the kernel) is hit only after a test suite exists and the AI layer is hardened.

## Key decisions (locked)

1. **Effect-TS refactor is deferred** to the final phase (Phase 9). The current tagged-union
   `Result<A>` model stays until then.
2. **Live UI streaming is dropped.** glassBook is an agent-native tool; replay/re-run tooling
   (agent-usable) stays, a human live UI does not.
3. **The EpiOps library is the source of truth** for the protocol model. glassBook conforms to the
   markdown specs; it does not invent its own protocol semantics.
4. **Multi-protocol scope = codebase-family** (Ulysses, Theseus, Hephaestus, Ariadne) fully wired
   and runnable. The kernel is built generically so the conversation/decision protocols
   (Hermes, Minos, Cassandra, Janus) can be added later without rework. *(Assumption — override if
   you want all eight in-scope now.)*

---

## The central architectural insight: an EpiOps kernel

All eight protocols share one skeleton:

- a **gamespace**: `stateStep ∈ [0,1,2,-1]`, `checkpoints`, `behaviors`, `forbiddenBehaviors`
- each **behavior = (action, evaluator)**, plotted as a primary (step 1) + backup (step 2)
- a **run loop**: execute → evaluate → checkpoint-on-success/reset-to-0, else step 2, else
  **CONSIDERATION** (-1) which forbids the failed behavior pair *positionally* from this checkpoint
- protocol-specific **game-board entities** (actors/claims/signals, surfaces/tripwires,
  invariants/evaluators, nodes/edges/contracts, …) and a protocol-specific **emit packet**

This means several V0 gaps are not Ulysses quirks but the kernel itself:

| V0 gap | Resolved by |
|---|---|
| §2.1 no explicit `stateStep` counter | kernel state machine |
| §2.1 behaviors not immutable `{action, eval}` pairs | kernel behavior type |
| §2.1 gate is global, not per-behavior | kernel per-behavior evaluators |
| §2.1 forbidden behaviors not persisted/positional | kernel forbidden-behavior store |
| §2.3 no per-cell gate conditions | per-behavior evaluator == per-cell gate |
| §2.2 workPlan choice is fixed (`ulysses` only) | kernel + protocol registry |

So **Phase 4 (the kernel)** is the keystone that unifies §2.1, §2.2, §2.3, §2.4, and §2.6.

---

## Phases

Each phase is its own spec→plan→implementation cycle when reached. "Exit criteria" is the
definition of green for that phase.

### Phase 0 — Papercuts
Remove day-to-day friction. Low risk, no architectural impact.
- Refresh stale OpenAI/other model defaults (§2.9).
- Auto-load `.env` in the web/dev server, not just the CLI (§2.9).
- Quiet/headless mode for `@srcbook/api` to silence session-scan noise (§2.11).
- Reconcile Node version pin vs. runtime; make `@srcbook/api` build a declared turbo dependency so
  glassBook typechecks without a manual pre-build (§2.11).
- Document the SQLite-fallback/env-override precedence (§2.9 — no code change, just clarity).

**Exit:** clean `glassbook run` with no noise, no manual build step, all providers' defaults current.

### Phase 1 — Test & CI net
A safety net before any refactor.
- vitest suite for the gate runner, the Ulysses loop, and the emitter (§2.12).
- CI wiring for the `glassbook` package (§2.12).

**Exit:** `pnpm test` green in CI on every push; core engine paths covered.

### Phase 2 — AI layer hardening
De-risk every later phase; independent of the kernel.
- Per-role model selection — a stronger reviewer model distinct from the worker (§2.2, §2.7).
- Retry/backoff on transient LLM errors instead of failing the section (§2.7, §2.5).
- Token/cost accounting + budget alongside step-count limits (§2.7).
- Migrate `generateObject` → `generateText` + `Output.object` (AI SDK v6) (§2.7).
- Principled `maxSteps` instead of ad-hoc heuristics (§2.7).

**Exit:** subagents are configurable per role, survive transient failures, and report token/cost.

### Phase 3 — Smarter sections
Better inputs to the kernel.
- Give Initialize read-only tools so it discovers the real test/build/gate commands instead of
  guessing from conventions (§2.2 — the biggest unpinned-gate reliability risk).
- Research fans out into multiple independent cells up to budget, replacing the single
  gather-then-synthesize pass (§2.2, §2.7).
- Resolve loadPackages: either actually load notebook/target dependencies, or formally ratify the
  "game-board setup" reinterpretation in the design (§2.2).

**Exit:** gates are discovered (not guessed) when `--gate` is absent; research scales with budget.

### Phase 4 — EpiOps kernel + typed behavior/evaluator/packet model ⭐
The keystone. Build the generic gamespace engine and the typed cell model on top of it.
- Explicit `stateStep` state machine `[0,1,2,-1]` with CONSIDERATION (§2.1).
- Immutable `behavior = (action, evaluator)` pairs; primary + backup plotting (§2.1).
- Per-behavior evaluators — the per-cell gate condition (§2.1, §2.3).
- Persisted, positionally-enforced `forbiddenBehaviors` (§2.1).
- Typed template-as-type with gates; the `[input → processing → output]` glassBook cell unit (§2.6).
- Real per-section cell budgets that create cells up to a limit across all sections (§2.4).

**Exit:** Ulysses runs as a spec-exact instantiation of the kernel; gates are per-behavior; the
notebook is built from typed cells.

### Phase 5 — Executable + replay
Make cells real, re-runnable, and replayable (agent-usable, no human UI).
- Re-runnable gate/code cells executed by the Srcbook engine, not emitted as evidence text
  (§2.3, §2.6).
- Replay tooling that consumes `glassbook.json` (re-run notebook / re-run evaluation) (§2.6).
- Install/use the notebook's own package.json/tsconfig so its cells actually execute (§2.6).

**Exit:** "re-run cell N" and "re-run evaluation" work from a persisted notebook.

### Phase 6 — Protocol library integration
workPlan really chooses a process; the codebase-family protocols become runnable.
- Load `workflows/epiops_protocols/*` (+ `ulysses.md`) as typed protocol definitions: setup
  entities, behavior/evaluator schema, transition semantics, emit-packet schema (§2.2).
- Wire Theseus, Hephaestus, and Ariadne as kernel instantiations, each emitting its own packet
  (equivalence gate, reproduction packet, topology packet).
- Fold in the destructive-reset hardening for CONSIDERATION (§2.1).
- *(Out of scope this phase: Hermes/Minos/Cassandra/Janus non-codebase worlds.)*

**Exit:** `workPlan` selects among ≥4 real protocols; each runs end-to-end and emits its packet.

### Phase 7 — Git/GitHub robustness
Survive real repositories; enables branch-per-loop fidelity.
- Branch-per-loop + per-turn merge-to-main where the protocol calls for it (Ulysses/Theseus)
  (§2.1, §2.8).
- Handle push conflicts, pre-existing branches, and rebases (§2.8).
- Dynamic PR body generated from the run, not a fixed template (§2.8).
- Clear errors for non-github.com remotes (other forges remain YAGNI) (§2.8).

**Exit:** runs against repos with pre-existing branches/remotes without manual cleanup.

### Phase 8 — Sandbox / security
Run untrusted prompts/repos safely.
- Sandbox `runShell` and `webFetch` (candidate: container-use) (§2.10).
- Per-session secret management instead of inheriting the CLI's `process.env` (§2.10).

**Exit:** a malicious prompt/repo cannot exfiltrate host secrets or escape the sandbox.

### Phase 9 — Effect-TS refactor *(deferred)*
- Convert the failure model and section signatures to Effect; `GlassbookError` becomes the error
  channel; add structured retry/recovery strategies (§2.5).

**Exit:** sections are `Effect`s; the tagged-union shim is removed.

---

## Completeness map (every V0 gap → phase)

| V0-STATUS item | Phase |
|---|---|
| §2.1 single working branch, not branch-per-loop | 7 (+4 kernel) |
| §2.1 budget = max turns, not cells | 4 |
| §2.1 behaviors not immutable {action, eval} pairs | 4 |
| §2.1 gate global, not per-behavior | 4 |
| §2.1 forbidden behaviors in-memory only | 4 |
| §2.1 CONSIDERATION reset destructive | 6 |
| §2.1 no explicit `stateStep` counter | 4 |
| §2.2 loadPackages doesn't load deps | 3 |
| §2.2 initialize guesses gates (no tools) | 3 |
| §2.2 research single pass, no fan-out | 3 |
| §2.2 workPlan choice fixed (no EpiOps library) | 6 |
| §2.2 evaluation same model / not sandboxed | 2 (model) + 8 (sandbox) |
| §2.3 gates only validate final output | 4 |
| §2.3 no per-cell gate conditions | 4 |
| §2.3 gates not re-runnable cells | 5 |
| §2.4 budgets don't create cells (most sections) | 4 |
| §2.5 coarse tags, no retry/recovery | 2 (retry) + 9 (Effect) |
| §2.5 not Effect-TS | 9 |
| §2.6 cells not a typed srcmd unit | 4 |
| §2.6 cells not executable/re-runnable | 5 |
| §2.6 no replay tooling | 5 |
| §2.6 no live UI streaming | dropped |
| §2.6 notebook pkg never installed | 5 |
| §2.7 `generateObject` deprecated | 2 |
| §2.7 one model for every role | 2 |
| §2.7 `maxSteps` ad hoc | 2 |
| §2.7 no retry/backoff | 2 |
| §2.7 no token/cost accounting | 2 |
| §2.7 no streaming / two-step research | 2 + 3 |
| §2.8 requires github.com remote | 7 |
| §2.8 no push/branch/rebase/merge handling | 7 |
| §2.8 fixed PR body | 7 |
| §2.9 `.env` not loaded by web/dev server | 0 |
| §2.9 OpenAI/other defaults stale | 0 |
| §2.9 SQLite fallback (document only) | 0 |
| §2.10 no sandbox | 8 |
| §2.10 env inheritance / no per-session secrets | 8 |
| §2.11 `.nvmrc` vs runtime mismatch | 0 |
| §2.11 `@srcbook/api` manual build dependency | 0 |
| §2.11 noisy session-scan errors | 0 |
| §2.12 no tests | 1 |
| §2.12 no CI | 1 |

---

## Dependency graph

```
0 ──┐
1 ──┼──> 2 ──> 3 ──┐
     │              ├──> 4 ──> 5
     │              │     └──> 6 ──> 7
     │                              
                    └────────────> 8   (independent; any time after 2)
                    └────────────> 9   (deferred; after most phases)
```

## Out of scope (for now)
- Live human UI streaming (agent-native tool).
- Non-codebase protocols: Hermes, Minos, Cassandra, Janus (need new input/output worlds).
- Forges other than GitHub.

## Suggested next step
Brainstorm **Phase 0** (or Phase 1 if you'd rather lay the test net first) into a detailed
implementation plan.
