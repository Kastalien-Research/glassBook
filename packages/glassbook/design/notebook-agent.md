# The Notebook-Agent Concept

**Status:** conceptual charter for glassBook. Explains _what_ glassBook is and _why_, and maps the
concept onto what the code does today. Companion to `epiops-primitives.md` (the kernel) and
`../V0-STATUS.md` / `../UNFINISHED.md` (current reality).

---

## Thesis

A **notebook agent** is a bounded agent runtime in which the notebook is simultaneously the
**executable control surface**, the **durable trace**, and the **inspection artifact**. The notebook
is not a UI, a scratchpad, or a post-hoc transcript bolted onto an agent — it _is_ the operational
recipe the agent executes, and the record of that execution.

The bet behind glassBook: many of the most valuable AI workflows are **not** fully autonomous
agents. They are **repeatable expert-judgment workflows** where the user wants speed _and_
traceability, source grounding, controlled delegation, and auditability. The notebook form is
valuable precisely because it preserves sequence, evidence, intermediate artifacts, execution
outputs, and review points.

So a notebook agent must produce **not only an answer or artifact, but a legible record of how that
artifact was produced.**

## Definition

A notebook agent is an agent that operates inside a typed, executable notebook. The notebook serves
five roles at once:

1. The **workflow specification** — what to do and what "done" means.
2. The **execution environment** — where actions actually run.
3. The **audit trail** — what happened, with evidence.
4. The **resumable state container** — enough state to replay or re-evaluate.
5. The **final review artifact** — the thing a human signs off on.

The agent may execute cells, create cells, revise cells, call tools, run verifiers, and generate
artifacts — but it does so **inside the explicit structure and constraints of the notebook**, rather
than disappearing into opaque tool calls.

## Core principle

**Prefer executable operational judgment over opaque autonomy.**

The system should not merely perform a task; it should operationalize a _judgment procedure_: what to
check, what counts as evidence, which transformations are allowed, what must be verified, when to
escalate to a human, and what artifact should result.

A reviewer reading the trace should be able to answer: What was the objective? What information was
used? What actions were taken? What changed? What checks ran? What failed and what passed? What
assumptions remain? Where was human judgment required? Why is the final artifact trustworthy enough
to use?

## How glassBook realizes this today

glassBook is the **codebase-change / PR-repair** instantiation of the notebook agent (initial wedge
#1, below). The mapping is concrete:

- **The notebook is the execution.** `NotebookEmitter` _is_ the notebook: every orchestrator step is
  appended as a srcmd cell and flushed to disk immediately, so even a crashed or rejected run leaves
  a fully auditable notebook (`emitter.mts`).
- **Durable + structured trace.** Each run emits a readable `.src.md` notebook **and** a
  machine-readable `glassbook.json` sidecar (`persistState`) — i.e. the "trace.md + trace.json" pair
  the concept calls for.
- **Typed cell unit.** `GlassbookCell` is a typed `[input → processing → output]` record carrying
  its own `gates`, tagged by `section` (`cell.mts`).
- **Execution in order, with adaptation.** The orchestrator runs the six sections in order;
  Research fans out into per-question cells and Ulysses adds a cell per turn — cells created when the
  workflow requires adaptation, within budgets.
- **Tools through inspectable steps.** Repo-scoped tools (`readFile`, `listFiles`, `searchCode`,
  `runShell`, `writeFile`, `webFetch`) are explicit and their outputs are rendered as evidence.
- **Verification before completion.** Gates are executable shell-exit-code cells; the EpiOps
  evaluator grades each behavior; a final adversarial reward-hacking review gates the PR.
- **State + replay.** `GlassbookState` tracks the run; `glassbook replay` / `replay-evaluation`
  re-run saved gates from the sidecar.
- **Artifact + provenance.** The artifact is a real GitHub PR whose body is generated from the run
  (gates, research, execution, evaluation, checkpoints, kernel turns, usage).
- **Protocol-specific codebase workflows.** Ulysses, Theseus, Hephaestus, and Ariadne are selected
  by `workPlan` and dispatched through codebase-family execution paths. The run persists the
  selected protocol, verification summary, and protocol packet (`fix`, `transformation`,
  `reproduction`, or `topology`) into `glassbook.json` and the PR body. Current live verification for
  the latest non-Ulysses paths is tracked separately in `UNFINISHED.md`.

### Where glassBook diverges (be honest about this)

- **No rich cell-type taxonomy yet.** The concept proposes typed cells like `instruction`,
  `tool_call`, `verification`, `decision`, `final`. glassBook types cells _by section_ and by the
  `[input → processing → output] + gates` shape, not by a discriminated union of cell kinds. A
  future schema (Effect Schema / Zod) could promote these to first-class cell types.
- **No `human_judgment` cell.** The concept treats human review points as a _feature_. glassBook
  deliberately **dropped live human-UI streaming** and is headless/agent-native; its only human
  judgment point today is **the PR itself** (a human reviews/merges). The in-run analog is the
  adversarial `evaluation` section, not a human. If we ever take on judgment-heavy wedges (research,
  recruiting), an explicit `human_judgment` cell type is the most likely re-introduction.

## Cell model (target)

Cells should be typed, with clear inputs, outputs, side effects, and success criteria where
practical. Useful types:

| Cell type        | Purpose                                          | glassBook analog today                   |
| ---------------- | ------------------------------------------------ | ---------------------------------------- |
| `instruction`    | task, constraints, success criteria              | `initialize` (plan + gates)              |
| `context`        | background, assumptions, prior state             | `research` context                       |
| `plan`           | bounded decomposition                            | `initialize` / `workPlan`                |
| `tool_call`      | external action (search, GitHub, shell, DB, MCP) | `tools.mts` calls (rendered as evidence) |
| `data`           | retrieved/generated data                         | research findings                        |
| `transform`      | data → data                                      | (implicit in execution)                  |
| `analysis`       | intermediate interpretation                      | research synthesis                       |
| `verification`   | tests, checks, assertions, acceptance criteria   | gate cells + EpiOps evaluators           |
| `artifact`       | generated output (patch, memo, chart, report)    | the code change + PR                     |
| `human_judgment` | a point to ask for review/approval               | **none in-run** (human reviews the PR)   |
| `failure`        | failed step, error, blocked path                 | `GlassbookError` records + CONSIDERATION |
| `decision`       | a consequential choice + reason                  | `workPlan` protocol choice; kernel turns |
| `final`          | outcome, remaining risks, next actions           | PR body + Outcome section                |

## Runtime expectations

A notebook-agent runtime should: execute cells in order; add cells when the workflow needs
adaptation; preserve a durable trace of actions/outputs/errors; track state across the run; call
tools through explicit inspectable cells; run verification before declaring completion; record
artifacts and their provenance; mark human review points clearly; resume/replay where possible; and
export a readable trace (`trace.md`) plus an optional structured trace (`trace.json`).

**The runtime must make hidden work visible.** If the agent calls a tool, changes a file, runs a
command, edits a row, fetches a source, or applies a patch, that action must be visible in the trace.

## Verification standard

The agent must not report success merely because it produced plausible output. A run should include
explicit verification: automated tests, type checks, lints, snapshot tests, source validation, diff
inspection, data-consistency checks, acceptance-criteria review, and/or human approval for
judgment-heavy steps.

- **Coding workflows:** "done" usually requires passing the relevant tests — or explaining exactly
  why they could not be run. (This is glassBook's gate model.)
- **Research workflows:** "done" usually requires cited sources, explicit assumptions, transformation
  receipts, and a stated level of uncertainty.

## Relationship to scripts, agents, and ordinary notebooks

A notebook agent is **more adaptive than a script** (it can branch, inspect intermediate results, add
cells, and adapt within bounds), **more inspectable than a typical autonomous agent** (the process is
visible, reviewable, governable), and **more operational than a normal notebook** (it is an active
operator that executes, modifies, verifies, and produces artifacts while preserving a durable trace).

## Initial wedges

Do not build this as a generic substrate first. Prove it through narrow, valuable recipes.

1. **Codebase change & PR-repair runbooks — _this is glassBook's current wedge._** Take a bug
   report / issue / PR-review thread → acceptance criteria → relevant files & checks → patch →
   verification → emit both the code change and an auditable trace (what was asked, what changed,
   what checks ran, what failed/passed, residual risk).
2. **Hedge-fund / asset-management research workflows.** Earnings updates, thesis monitors, KPI
   refreshes, competitor scans, event-driven memos → pulled sources, transformations, charts/tables,
   analyst summary, assumptions, judgment calls, verification, remaining uncertainty. _(Future; needs
   a non-codebase "world" — cf. the dormant EpiOps protocols.)_
3. **Recruiting / sourcing verification workflows.** Source candidates, verify fit, record evidence,
   flag uncertainty → recruiter-facing shortlist _with receipts_ that reduces manual verification.
   _(Future.)_

## Product rule

Do not sell "agentic notebooks" as an abstract category. Sell a specific workflow **outcome** that
happens to be delivered through a notebook agent. The loop: pick one repeated, expensive workflow →
encode it as a notebook recipe → run it on a real case → produce a useful artifact → show the trace →
get feedback → tighten the recipe → repeat. **The notebook agent is the substrate; the user buys the
outcome.**

## Design constraints

- Inspectability over magic.
- Bounded delegation over open-ended autonomy.
- Durable traces over ephemeral chat.
- Verification over confident prose.
- Concrete recipes over general platforms.
- User-recognizable workflows over abstract agent architecture.
- Artifacts a real user can evaluate without understanding the system's philosophy.

## Failure modes to avoid

- Building a beautiful general substrate before proving one narrow workflow.
- Treating the notebook as a decorative transcript rather than the execution contract.
- Hiding agent actions outside the trace.
- Claiming success without verification.
- Impressive prose unbacked by receipts.
- Overfitting to demos instead of repeated user pain.
- Selling the category before the outcome is commercially legible.
- Pretending every step can or should be automated — **human-judgment points are a feature, not a
  failure.**

## Working definition

A notebook agent turns a repeatable expert workflow into an inspectable, executable runbook. Its job
is to **produce the artifact, preserve the evidence, expose the judgment, run the checks, and make
the work easier to trust.**
