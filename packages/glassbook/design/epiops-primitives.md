# EpiOps Kernel — Conceptual Primitives (design sketch)

**Status:** non-binding design sketch. Feeds **Phase 4** of `../ROADMAP.md`. Not wired to the build;
types here are illustrative, not final signatures.

Derived from a cross-protocol review of `workflows/ulysses.md` + `workflows/epiops_protocols/*`
(8 protocols). The thesis: all protocols are one fixed state machine (the **kernel**) parameterized
by a **`ProtocolDefinition`**. Everything that differs between protocols is a parameter; everything
that's identical is the kernel.

---

## 1. Kernel primitives (protocol-agnostic)

```ts
// ── The state machine: identical in all 8 protocols ───────────────────────────
export type StateStep = 0 | 1 | 2 | -1; // -1 = CONSIDERATION
export const CONSIDERATION: StateStep = -1;

// ── Evaluation: graded, not boolean ───────────────────────────────────────────
// Binary protocols (Ulysses/Theseus/Hephaestus/Ariadne) use success|failure|invalid.
// Graded protocols map onto the richer set:
//   Hermes  strong|medium → success/partial ; weak|negative → inconclusive/failure
//   Cassandra confirm/falsify → success ; inconclusive → inconclusive
//   Minos   admissible & verdict-changing → success ; else inconclusive
//   Janus   continue → success ; rollback/contain/pause → failure (triggers backup)
export type EvaluationOutcome =
  | 'success' // desired outcome achieved      → checkpoint + reset to 0
  | 'partial' // good-enough to bank a turn     → checkpoint + reset to 0
  | 'inconclusive' // no decisive movement           → escalate / consider
  | 'failure' // explicit negative outcome
  | 'invalid'; // the evaluator itself broke (oracle invalidated, failure vanished)

export interface EvaluationResult {
  readonly outcome: EvaluationOutcome;
  readonly evidence: string; // audit-readable justification (rendered into the notebook)
  readonly data?: unknown; // protocol-specific structured payload
}

// ── Behavior = (action, evaluator), immutable once plotted ────────────────────
export interface WorldObservation {
  readonly summary: string;
  readonly exitCode?: number; // codebase world
  readonly payload?: Record<string, unknown>;
}

export interface Action {
  readonly intent: string; // NL description of the move (the "what")
  run(world: World): Promise<WorldObservation>;
}

export interface Evaluator {
  readonly description: string; // what success means for THIS behavior (per-cell gate)
  evaluate(obs: WorldObservation, world: World): Promise<EvaluationResult>;
}

export interface Behavior {
  readonly id: string;
  readonly position: 1 | 2; // primary (hypothesis) | backup (fallback)
  readonly action: Action;
  readonly evaluator: Evaluator;
  readonly signature: string; // stable hash → positional forbidding
}

// ── Checkpoints & the world the actions act on ────────────────────────────────
export type WorldKind = 'codebase-git' | 'conversation' | 'decision' | 'dispute' | 'action-plan';

export interface Checkpoint {
  readonly ref: string; // commit hash (codebase) | snapshot token (otherwise)
  readonly at: string; // ISO timestamp
  readonly entities: unknown; // frozen domain-entity snapshot
}

export interface World {
  readonly kind: WorldKind;
  checkpoint(): Promise<Checkpoint>; // git commit | snapshot
  restore(c: Checkpoint): Promise<void>; // git reset --hard + clean | snapshot restore
}

// ── CONSIDERATION: what makes a behavior pair forbidden, positionally ─────────
export interface ForbiddenBehavior {
  readonly fromCheckpoint: string; // Checkpoint.ref this applies from
  readonly position: 1 | 2;
  readonly signature: string; // Behavior.signature
  readonly reason: string; // the CONSIDERATION hypothesis
}

export interface ConsiderationMove {
  readonly id: string;
  readonly description: string;
}
export interface ConsiderationChoice {
  readonly move: ConsiderationMove;
  readonly hypothesis: string;
}

// ── The gamespace: the full mutable state of a run ────────────────────────────
export interface Objective {
  readonly statement: string;
  readonly successCondition: string; // what banks a turn
  readonly stopCondition: string; // what ends the whole protocol
}

export interface TurnRecord {
  readonly fromCheckpoint: string;
  readonly tried: Behavior[]; // the pair attempted this turn
  readonly results: EvaluationResult[];
  readonly transition: TurnTransition;
}

export type TurnTransition = 'checkpoint-reset' | 'escalate-to-backup' | 'consideration';

export interface Gamespace<Entities, Pkt> {
  stateStep: StateStep;
  readonly objective: Objective;
  checkpoints: Checkpoint[];
  plotted: { primary: Behavior; backup: Behavior } | null;
  history: TurnRecord[];
  forbidden: ForbiddenBehavior[];
  entities: Entities; // protocol-specific domain model
  packet?: Pkt; // set on emit
}
```

## 2. The parameter: `ProtocolDefinition`

Everything that varies between protocols lives here. The kernel never branches on protocol id.

```ts
export interface FramingContext {
  /* prompt, tools, prior research, world */
}
export interface PlotContext {
  /* tools, forbidden set, prior turn results */
}
export interface RunContext {
  /* budgets, model handles, emitter */
}

export interface ProtocolDefinition<Entities, Pkt> {
  readonly id: string; // 'ulysses' | 'theseus' | 'hephaestus' | 'ariadne' | …
  readonly worldKind: WorldKind;
  readonly usesBranch: boolean; // Ulysses/Theseus true; Ariadne optional; others false

  /** Steps 1–2: declare objective + seed domain entities. (Janus/Minos have two framing steps.) */
  frame(ctx: FramingContext): Promise<{ objective: Objective; entities: Entities }>;

  /** Plot the primary + backup behaviors for the current turn, honoring `forbidden`. */
  plot(
    state: Gamespace<Entities, Pkt>,
    ctx: PlotContext,
  ): Promise<{ primary: Behavior; backup: Behavior }>;

  /** Map a graded result at a given position onto a turn transition (kernel provides a default). */
  classify(result: EvaluationResult, position: 1 | 2): TurnTransition;

  /** The recovery menu offered in CONSIDERATION, and the chooser. */
  readonly considerationMoves: readonly ConsiderationMove[];
  consider(state: Gamespace<Entities, Pkt>, ctx: PlotContext): Promise<ConsiderationChoice>;

  /** Whole-protocol stop check. */
  isComplete(state: Gamespace<Entities, Pkt>): boolean;

  /** Emit the typed packet on exit (PR, ledger, transformation packet, …). */
  emit(state: Gamespace<Entities, Pkt>): Promise<Pkt>;
}

/** The single shared engine. Drives the loop; never knows which protocol it runs. */
export declare function runProtocol<E, P>(
  def: ProtocolDefinition<E, P>,
  world: World,
  ctx: RunContext,
): Promise<Result<P>>;
```

### Kernel loop (pseudocode — the invariant skeleton)

```
state.entities, state.objective = def.frame(ctx)
while !def.isComplete(state):
    cp = world.checkpoint(); state.checkpoints.push(cp)
    {primary, backup} = def.plot(state, ctx)        // excludes forbidden@cp
    for behavior in [primary (1), backup (2)]:
        state.stateStep = behavior.position
        obs = behavior.action.run(world)
        res = behavior.evaluator.evaluate(obs, world)
        t   = def.classify(res, behavior.position)
        if t == 'checkpoint-reset':
            world.checkpoint(); state.stateStep = 0; record; break
        // else fall through to backup
    else:                                            // both positions failed
        state.stateStep = CONSIDERATION              // -1
        choice = def.consider(state, ctx)
        state.forbidden.push({fromCheckpoint: cp.ref, position:1, sig: primary.signature, …},
                             {…position:2, sig: backup.signature})
        apply(choice); state.stateStep = 0
state.packet = def.emit(state)
```

## 3. Worked instantiations (proof the parameterization holds)

### Ulysses (codebase-git, binary eval, forward backup)

```ts
interface UlyssesEntities { problem: string; }        // behaviors/checkpoints live in the kernel
type UlyssesPacket = { prUrl: string };

const ulysses: ProtocolDefinition<UlyssesEntities, UlyssesPacket> = {
  id: 'ulysses', worldKind: 'codebase-git', usesBranch: true,
  frame: async (ctx) => ({ objective: /* root-cause + fix; gate = finalGates */ …, entities: … }),
  plot:  async (state, ctx) => /* hypothesis (1) + backup hypothesis (2) */ …,
  classify: (r) => r.outcome === 'success' ? 'checkpoint-reset'
                 : 'escalate-to-backup',                 // kernel default
  considerationMoves: [
    { id: 'reframe',   description: 'reframe the hypothesis space' },
    { id: 'decompose', description: 'split the problem into a smaller turn' },
  ],
  consider: async (state) => …,
  isComplete: (state) => /* final gates pass */ …,
  emit: async (state) => ({ prUrl: /* gh pr create */ … }),
};
```

### Janus (action-plan world, graded eval, **backup must be rollback**)

```ts
interface JanusEntities {
  surfaces: string[]; reversibilityClasses: string[];
  tripwires: string[]; rollbackBehaviors: string[];
}
type JanusPacket = { finalState: 'completed'|'rolledBack'|'contained'|'aborted'|'escalated'; … };

const janus: ProtocolDefinition<JanusEntities, JanusPacket> = {
  id: 'janus', worldKind: 'action-plan', usesBranch: false,
  frame: async (ctx) => /* classify reversibility → define checkpoints & tripwires (2 steps) */ …,
  plot: async (state, ctx) => {
    const primary = /* safest forward slice */;
    const backup  = /* MUST be rollback/containment/smaller-probe, not another forward move */;
    return { primary, backup };
  },
  classify: (r) => r.outcome === 'success' ? 'checkpoint-reset' : 'escalate-to-backup',
  considerationMoves: [
    { id: 'escalate', description: 'escalate / seek authorization' },
    { id: 'freeze',   description: 'freeze forward action, widen containment' },
    { id: 'abort',    description: 'abort the action plan' },
  ],
  consider: async (state) => …,
  isComplete: (state) => /* slices done OR aborted/escalated */ …,
  emit: async (state) => ({ finalState: …, … }),
};
```

The only Janus-specific logic is `frame` (two steps), the **rollback-biased `plot`**, its entities,
its consideration menu, and its packet. The loop, state machine, checkpointing, and positional
forbidding are unchanged kernel code.

## 4. Open design questions (resolve in the Phase 4 spec)

1. **Evaluator substrate.** `Evaluator.evaluate` must cover both an executable shell gate
   (exit-code → outcome) and a model-judged gate (LLM grades the observation). The
   `EvaluationResult` abstraction supports both; the kernel shouldn't care which.
2. **Action authoring.** `Action.run` for codebase protocols is itself a tool-using agent loop.
   How much of "the action" is LLM-planned vs. fixed shell? Likely: planner emits intent +
   constraints; `run` is the bounded agent loop.
3. **Signature stability.** `Behavior.signature` must be stable enough that "the same behavior in
   the same position" is reliably detected for positional forbidding, but not so brittle that
   trivial rewording defeats it. Candidate: normalized intent + evaluator description hash.
4. **Backup-role constraint.** Janus needs `plot` to _guarantee_ the backup is rollback-biased.
   Express as a per-protocol invariant the kernel can assert, or trust the protocol's `plot`.
5. **Two-step framing.** Janus/Minos have two framing steps; model `frame` as an ordered list of
   framing sub-steps rather than a single call.
6. **Mapping to existing code.** Today's global `plan.finalGates` becomes the `isComplete`
   evaluator; `ExecutionResult` becomes the Ulysses packet; the in-memory forbidden-strings list
   becomes `Gamespace.forbidden`.

## How this lands in the roadmap

This sketch is the conceptual input to **Phase 4 (EpiOps kernel)**. When we brainstorm Phase 4 into
a plan, these primitives + the open questions above are the starting point; the codebase-family
protocols (Theseus/Hephaestus/Ariadne) get wired in **Phase 6** as additional `ProtocolDefinition`s.
