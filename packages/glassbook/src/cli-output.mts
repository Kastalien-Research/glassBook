import type { RunResult } from './orchestrator.mjs';

export function formatRunSummary(result: RunResult): string {
  const lines = [`Status: ${result.ok ? 'approved' : 'failed'}`, `Notebook: ${result.notebookDir}`];
  if (result.srcmdPath) lines.push(`Exported: ${result.srcmdPath}`);
  if (result.pullRequestUrl) lines.push(`PR: ${result.pullRequestUrl}`);

  const failure = result.state.failures.at(-1);
  if (failure) lines.push(`Failure: ${failure._tag}: ${failure.message}`);

  return lines.join('\n');
}
