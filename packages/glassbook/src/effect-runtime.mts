import { Cause, Effect, Exit, Option } from 'effect';
import { err, makeError, ok, type GlassbookError, type Result, type SectionId } from './types.mjs';

export type GlassbookEffect<A> = Effect.Effect<A, GlassbookError>;

export interface SectionRecoveryPolicy {
  readonly section: SectionId;
  readonly retryable: boolean;
  readonly maxRetries: number;
}

const SECTION_RECOVERY: Record<SectionId, SectionRecoveryPolicy> = {
  loadPackages: { section: 'loadPackages', retryable: false, maxRetries: 0 },
  initialize: { section: 'initialize', retryable: true, maxRetries: 1 },
  research: { section: 'research', retryable: true, maxRetries: 1 },
  workPlan: { section: 'workPlan', retryable: true, maxRetries: 1 },
  workExecution: { section: 'workExecution', retryable: false, maxRetries: 0 },
  evaluation: { section: 'evaluation', retryable: true, maxRetries: 1 },
};

export function recoveryPolicy(section: SectionId): SectionRecoveryPolicy {
  return SECTION_RECOVERY[section];
}

export function resultToEffect<A>(result: Result<A>): GlassbookEffect<A> {
  return result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
}

export async function effectToResult<A>(effect: GlassbookEffect<A>): Promise<Result<A>> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return ok(exit.value);

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) return err(failure.value);
  return err(makeError('ExecutionError', String(Cause.squash(exit.cause))));
}

export function resultSectionEffect<A>(
  section: SectionId,
  run: () => Promise<Result<A>>,
): GlassbookEffect<A> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      makeError(
        'ExecutionError',
        `${section} threw instead of returning a Result: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      ),
  }).pipe(Effect.flatMap(resultToEffect));
}

export function runResultSection<A>(
  section: SectionId,
  run: () => Promise<Result<A>>,
): Promise<Result<A>> {
  return effectToResult(resultSectionEffect(section, run));
}
