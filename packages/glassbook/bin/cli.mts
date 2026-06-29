#!/usr/bin/env node
import Path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Command } from 'commander';
import { runGlassbook } from '../src/orchestrator.mjs';
import { createLogger } from '../src/logger.mjs';
import { getTemplate, codebaseUpdateTemplate } from '../src/templates/codebase-update.mjs';
import { replayRun } from '../src/replay.mjs';
import type { RunConfig } from '../src/types.mjs';

interface RunOptions {
  prompt?: string;
  promptFile?: string;
  repo: string;
  template: string;
  base: string;
  skipPr?: boolean;
  out?: string;
  budgetResearch?: number;
  budgetExec?: number;
  gate: string[];
  allowInstall?: boolean;
  envFile?: string;
  quiet?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Load environment variables (API keys, provider/model overrides) from a .env
 * file so headless runs don't require the web settings UI. Checks an explicit
 * path first, then ./.env, then ~/.srcbook/.env. Returns the path used.
 */
function loadEnv(explicit?: string): string | undefined {
  const candidates = explicit
    ? [Path.resolve(explicit)]
    : [Path.resolve(process.cwd(), '.env'), Path.join(os.homedir(), '.srcbook', '.env')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
  }
  return undefined;
}

const program = new Command();

program
  .name('glassbook')
  .description('Run a glassBook notebook-agent: an agent that is an auditable notebook.')
  .version('0.0.0');

program
  .command('run')
  .description('Run the full glassBook pipeline against a git repo')
  .option('-p, --prompt <text>', 'the objective for the run')
  .option('--prompt-file <path>', 'read the prompt from a file')
  .option('-r, --repo <path>', 'path to the target git repo', process.cwd())
  .option('-t, --template <id>', 'notebook template', 'codebase-update')
  .option('--base <branch>', 'base branch for the PR', 'main')
  .option('--skip-pr', 'do not push or open a PR (local dry run)', false)
  .option('-o, --out <file>', 'also write the exported .src.md to this path')
  .option('--budget-research <n>', 'max research cells', (v) => parseInt(v, 10))
  .option('--budget-exec <n>', 'max Ulysses turns', (v) => parseInt(v, 10))
  .option(
    '--gate <command>',
    'pin a verification gate command (exit 0 == pass); repeatable',
    collect,
    [],
  )
  .option('--allow-install', 'allow installing dependencies in the target repo', false)
  .option('--env-file <path>', 'load API keys / provider / model from a .env file')
  .option('-q, --quiet', 'reduce logging', false)
  .action(async (opts: RunOptions) => {
    const envPath = loadEnv(opts.envFile);

    const prompt =
      opts.prompt ??
      (opts.promptFile ? fs.readFileSync(opts.promptFile, 'utf8').trim() : undefined);

    if (!prompt) {
      process.stderr.write('Error: provide --prompt or --prompt-file\n');
      process.exit(1);
    }

    const template = getTemplate(opts.template) ?? codebaseUpdateTemplate;
    const budgets = template.defaultBudgets();
    if (typeof opts.budgetResearch === 'number' && Number.isFinite(opts.budgetResearch)) {
      budgets.research.limit = opts.budgetResearch;
    }
    if (typeof opts.budgetExec === 'number' && Number.isFinite(opts.budgetExec)) {
      budgets.workExecution.limit = opts.budgetExec;
    }

    const config: RunConfig = {
      prompt,
      repoDir: Path.resolve(opts.repo),
      template: template.id,
      budgets,
      baseBranch: opts.base,
      skipPullRequest: Boolean(opts.skipPr),
      gateCommands: opts.gate.length > 0 ? opts.gate : undefined,
      allowInstall: Boolean(opts.allowInstall),
      outFile: opts.out ? Path.resolve(opts.out) : undefined,
    };

    const logger = createLogger(!opts.quiet);
    if (envPath) logger.info(`env: ${envPath}`);
    try {
      const result = await runGlassbook(config, logger);
      logger.info(`\nNotebook: ${result.notebookDir}`);
      if (result.srcmdPath) logger.info(`Exported: ${result.srcmdPath}`);
      if (result.pullRequestUrl) logger.info(`PR: ${result.pullRequestUrl}`);
      process.exit(result.ok ? 0 : 1);
    } catch (e) {
      logger.error(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command('replay')
  .description('Replay the saved final gates from a glassBook glassbook.json sidecar')
  .argument('<glassbook-json>', 'path to glassbook.json')
  .action(async (sidecarPath: string) => {
    const result = await replayRun(Path.resolve(sidecarPath));
    process.stdout.write(`${result.output}\n`);
    process.exit(result.passed ? 0 : 1);
  });

program
  .command('replay-evaluation')
  .description('Replay the saved evaluation gates from a glassBook glassbook.json sidecar')
  .argument('<glassbook-json>', 'path to glassbook.json')
  .action(async (sidecarPath: string) => {
    const result = await replayRun(Path.resolve(sidecarPath));
    process.stdout.write(`${result.output}\n`);
    process.exit(result.passed ? 0 : 1);
  });

program.parseAsync(process.argv).catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
