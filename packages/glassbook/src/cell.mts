import type { GateConditionSpec } from './schemas.mjs';
import type { SectionId } from './types.mjs';

export interface GlassbookCell<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Processing extends Record<string, unknown> = Record<string, unknown>,
  Output extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly section: SectionId;
  readonly input: Input;
  readonly processing: Processing;
  readonly output: Output;
  readonly gates: readonly GateConditionSpec[];
}

export function makeGlassbookCell<
  Input extends Record<string, unknown>,
  Processing extends Record<string, unknown>,
  Output extends Record<string, unknown>,
>(args: {
  section: SectionId;
  input: Input;
  processing: Processing;
  output: Output;
  gates: readonly GateConditionSpec[];
}): GlassbookCell<Input, Processing, Output> {
  return args;
}
