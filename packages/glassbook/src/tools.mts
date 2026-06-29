import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

const MAX_OUTPUT_CHARS = 20_000;

export function truncate(text: string, max: number = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  return `${head}\n... [truncated ${text.length - max} chars]`;
}

export interface ShResult {
  code: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

/**
 * Run a shell command. The single primitive every other tool and the git
 * layer build on. Always scoped to a cwd; never inherits a TTY.
 */
export function sh(
  command: string,
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<ShResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
    });

    let stdout = '';
    let stderr = '';
    let combined = '';

    const timeout =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
        : null;

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      stdout += s;
      combined += s;
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      stderr += s;
      combined += s;
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr, combined });
    });
    child.on('error', (e) => {
      if (timeout) clearTimeout(timeout);
      const msg = e instanceof Error ? e.message : String(e);
      resolve({ code: null, stdout, stderr: stderr + msg, combined: combined + msg });
    });
  });
}

function resolveInRepo(repoDir: string, p: string): string {
  return Path.isAbsolute(p) ? p : Path.resolve(repoDir, p);
}

/**
 * Pick a dependency-install command for a repo based on its lockfile. Returns
 * null if there's nothing to install (no package.json).
 */
export function detectInstallCommand(repoDir: string): string | null {
  if (existsSync(Path.join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm install';
  if (existsSync(Path.join(repoDir, 'yarn.lock'))) return 'yarn install';
  if (existsSync(Path.join(repoDir, 'package-lock.json'))) return 'npm install';
  if (existsSync(Path.join(repoDir, 'package.json'))) return 'npm install';
  return null;
}

/**
 * Build the tool set exposed to tool-using subagents. All tools are scoped to
 * the target repository directory.
 */
export function makeTools(repoDir: string) {
  return {
    readFile: tool({
      description: 'Read a UTF-8 text file from the repository.',
      inputSchema: z.object({
        path: z.string().describe('Path relative to the repo root (or absolute).'),
      }),
      execute: async ({ path }) => {
        try {
          const content = await fs.readFile(resolveInRepo(repoDir, path), 'utf8');
          return truncate(content);
        } catch (e) {
          return `ERROR reading ${path}: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    listFiles: tool({
      description: 'List tracked files in the repo, optionally filtered by a subdirectory.',
      inputSchema: z.object({
        dir: z.string().optional().describe('Subdirectory to list (default: repo root).'),
      }),
      execute: async ({ dir }) => {
        const target = dir ? resolveInRepo(repoDir, dir) : repoDir;
        const res = await sh(`git ls-files -- "${target}" || ls -la "${target}"`, {
          cwd: repoDir,
          timeoutMs: 15_000,
        });
        return truncate(res.combined || '(empty)');
      },
    }),

    searchCode: tool({
      description: 'Search file contents with a regex (ripgrep, falls back to grep).',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for.'),
        path: z.string().optional().describe('Path to limit the search to.'),
      }),
      execute: async ({ pattern, path }) => {
        const where = path ? `"${resolveInRepo(repoDir, path)}"` : '.';
        const escaped = pattern.replace(/"/g, '\\"');
        const res = await sh(
          `rg -n --no-heading "${escaped}" ${where} 2>/dev/null || grep -rn "${escaped}" ${where}`,
          { cwd: repoDir, timeoutMs: 20_000 },
        );
        return truncate(res.combined || '(no matches)');
      },
    }),

    runShell: tool({
      description:
        'Run a shell command in the repo (tests, typecheck, git, gh, build, etc). Returns exit code and combined output.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute.'),
      }),
      execute: async ({ command }) => {
        const res = await sh(command, { cwd: repoDir, timeoutMs: 300_000 });
        return `exit_code: ${res.code}\n${truncate(res.combined)}`;
      },
    }),

    writeFile: tool({
      description: 'Create or overwrite a UTF-8 text file in the repo.',
      inputSchema: z.object({
        path: z.string().describe('Path relative to the repo root (or absolute).'),
        content: z.string().describe('Full file contents to write.'),
      }),
      execute: async ({ path, content }) => {
        try {
          const abs = resolveInRepo(repoDir, path);
          await fs.mkdir(Path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content, 'utf8');
          return `wrote ${path} (${content.length} bytes)`;
        } catch (e) {
          return `ERROR writing ${path}: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    webFetch: tool({
      description: 'Fetch a URL and return its text content (for research).',
      inputSchema: z.object({
        url: z.string().url().describe('The URL to fetch.'),
      }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url);
          const text = await res.text();
          return `status: ${res.status}\n${truncate(text)}`;
        } catch (e) {
          return `ERROR fetching ${url}: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
  };
}

export type GlassbookToolSet = ReturnType<typeof makeTools>;

/**
 * Read-only tool set for investigation cells (e.g. Research) that must not
 * mutate the repository. Omits writeFile; runShell is kept for read-only
 * commands like listing how to run tests.
 */
export function makeReadOnlyTools(repoDir: string) {
  const { readFile, listFiles, searchCode, runShell, webFetch } = makeTools(repoDir);
  return { readFile, listFiles, searchCode, runShell, webFetch };
}
