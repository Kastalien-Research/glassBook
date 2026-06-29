import type { Behavior } from './behavior.mjs';
import type { EvaluationResult } from './evaluation.mjs';
import type { ForbiddenStore } from './forbidden.mjs';
import type { TurnRecord } from './run.mjs';

/**
 * The world a protocol's behaviors act on. Codebase protocols use git
 * (commit-hash checkpoints); conversation/decision protocols use domain
 * snapshots. The kernel only needs checkpoint/restore.
 */
export type WorldKind = 'codebase-git' | 'conversation' | 'decision' | 'dispute' | 'action-plan';

export interface World {
  readonly kind: WorldKind;
  checkpoint(): Promise<string>;
  restore(ref: string): Promise<void>;
}

export interface Objective {
  readonly statement: string;
  /** What banks a turn. */
  readonly successCondition: string;
  /** What ends the whole protocol. */
  readonly stopCondition: string;
}

export interface FramingContext {
  readonly prompt: string;
  readonly repoDir: string;
}

export interface PlotContext {
  readonly turn: number;
  readonly fromCheckpoint: string;
  readonly forbidden: ForbiddenStore;
}

/**
 * A protocol is a parameterization of the kernel — see
 * ../../design/epiops-primitives.md. The kernel run loop never branches on
 * protocol id; everything that differs between Ulysses, Theseus, Hephaestus,
 * Ariadne, … lives behind this interface. Wired in roadmap Phase 6.
 *
 * `Entities` is the protocol's domain model (invariants/evaluators,
 * nodes/edges/contracts, …); `Packet` is the typed emit-on-exit (PR, ledger,
 * transformation packet, …).
 */
export interface ProtocolDefinition<Entities, Packet> {
  readonly id: string;
  readonly worldKind: WorldKind;
  readonly usesBranch: boolean;

  /** Steps 1–2: declare the objective and seed domain entities. */
  frame(ctx: FramingContext): Promise<{ objective: Objective; entities: Entities }>;

  /** Plot the primary + backup behaviors for the current turn. */
  plot(ctx: PlotContext, entities: Entities): Promise<{ primary: Behavior; backup: Behavior }>;

  /** Run a behavior's action and evaluate it (the per-behavior gate). */
  execute(behavior: Behavior, entities: Entities): Promise<EvaluationResult>;

  /** Reflect on a double failure; returns the CONSIDERATION hypothesis. */
  consider(record: TurnRecord, entities: Entities): Promise<{ hypothesis: string }>;

  /** Emit the typed packet on exit. */
  emit(entities: Entities): Promise<Packet>;
}
