import type { BehaviorPosition } from './state-machine.mjs';

/**
 * A behavior forbidden positionally from a checkpoint after CONSIDERATION. The
 * spec forbids the failed behavior pair "in the same position in future turns
 * from this checkpoint" — so a signature is forbidden for a (checkpoint,
 * position) pair, not globally.
 */
export interface ForbiddenBehavior {
  readonly fromCheckpoint: string;
  readonly position: BehaviorPosition;
  readonly signature: string;
  readonly reason: string;
}

function key(fromCheckpoint: string, position: BehaviorPosition, signature: string): string {
  return `${fromCheckpoint}|${position}|${signature}`;
}

/**
 * Persistable, positional store of forbidden behaviors. Replaces v0's in-memory
 * list of strings with a structured, queryable record (roadmap §2.1).
 */
export class ForbiddenStore {
  private readonly items = new Map<string, ForbiddenBehavior>();

  forbid(entry: ForbiddenBehavior): void {
    this.items.set(key(entry.fromCheckpoint, entry.position, entry.signature), entry);
  }

  isForbidden(fromCheckpoint: string, position: BehaviorPosition, signature: string): boolean {
    return this.items.has(key(fromCheckpoint, position, signature));
  }

  forCheckpoint(fromCheckpoint: string): ForbiddenBehavior[] {
    return [...this.items.values()].filter((f) => f.fromCheckpoint === fromCheckpoint);
  }

  all(): ForbiddenBehavior[] {
    return [...this.items.values()];
  }

  get size(): number {
    return this.items.size;
  }

  toJSON(): ForbiddenBehavior[] {
    return this.all();
  }
}
