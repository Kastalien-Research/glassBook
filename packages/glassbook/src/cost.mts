/**
 * Token usage accounting across all subagent calls in a run.
 *
 * The AI SDK returns a `usage` object per call. We accumulate it here, tagged by
 * subagent role, so a run can report how many tokens each role consumed. Dollar
 * cost requires per-model pricing that changes frequently, so it is left as an
 * optional pricing hook rather than hard-coded; token totals are the contract.
 */

/** Loose shape accepted from the AI SDK (v4 used prompt/completion; v5+ uses input/output). */
export interface TokenUsageLike {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

export interface UsageRecord {
  readonly role: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface UsageTotals {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

function normalize(usage: TokenUsageLike): { input: number; output: number; total: number } {
  const input = usage.inputTokens ?? usage.promptTokens ?? 0;
  const output = usage.outputTokens ?? usage.completionTokens ?? 0;
  const total = usage.totalTokens ?? input + output;
  return { input, output, total };
}

export class UsageMeter {
  private readonly records: UsageRecord[] = [];

  /** Record one call's usage. Tolerates `undefined` (logs nothing). */
  record(role: string, usage: TokenUsageLike | undefined | null): void {
    if (!usage) return;
    const { input, output, total } = normalize(usage);
    this.records.push({ role, inputTokens: input, outputTokens: output, totalTokens: total });
  }

  get entries(): readonly UsageRecord[] {
    return this.records;
  }

  totals(): UsageTotals {
    return this.records.reduce<UsageTotals>(
      (acc, r) => ({
        calls: acc.calls + 1,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        totalTokens: acc.totalTokens + r.totalTokens,
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
  }

  byRole(): Record<string, UsageTotals> {
    const out: Record<string, UsageTotals> = {};
    for (const r of this.records) {
      const prev = out[r.role] ?? { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      out[r.role] = {
        calls: prev.calls + 1,
        inputTokens: prev.inputTokens + r.inputTokens,
        outputTokens: prev.outputTokens + r.outputTokens,
        totalTokens: prev.totalTokens + r.totalTokens,
      };
    }
    return out;
  }

  /** Markdown summary for the notebook. */
  format(): string {
    const t = this.totals();
    if (t.calls === 0) return 'No model calls were recorded.';
    const byRole = this.byRole();
    const lines = Object.entries(byRole).map(
      ([role, u]) =>
        `- **${role}**: ${u.calls} call(s), ${u.totalTokens} tokens (in ${u.inputTokens} / out ${u.outputTokens})`,
    );
    return [
      `**Total:** ${t.calls} call(s), ${t.totalTokens} tokens (in ${t.inputTokens} / out ${t.outputTokens})`,
      '',
      ...lines,
    ].join('\n');
  }

  toJSON(): { totals: UsageTotals; byRole: Record<string, UsageTotals> } {
    return { totals: this.totals(), byRole: this.byRole() };
  }
}
