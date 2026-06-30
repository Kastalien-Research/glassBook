import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
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

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export function isShellSandboxAvailable(): boolean {
  if (!existsSync(SANDBOX_EXEC)) return false;
  const probeDir = mkdtempSync(Path.join(os.tmpdir(), 'glassbook-sandbox-probe-'));
  try {
    const probe = spawnSync(
      SANDBOX_EXEC,
      ['-p', shellSandboxProfile(probeDir), 'bash', '-lc', 'true'],
      {
        cwd: probeDir,
        env: defaultShellEnv(),
        stdio: 'ignore',
      },
    );
    return probe.status === 0;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function defaultShellEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    CI: process.env.CI,
    NODE_ENV: process.env.NODE_ENV,
  };
}

/**
 * Run a shell command. The single primitive every other tool and the git
 * layer build on. Always scoped to a cwd; never inherits a TTY.
 */
export function sh(
  command: string,
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; sandbox?: boolean },
): Promise<ShResult> {
  return new Promise((resolve) => {
    if (opts.sandbox === true && !isShellSandboxAvailable()) {
      resolve({
        code: 126,
        stdout: '',
        stderr: 'shell sandbox is not available on this host',
        combined: 'shell sandbox is not available on this host',
      });
      return;
    }

    const sandboxed = opts.sandbox === true;
    const child = spawn(
      sandboxed ? SANDBOX_EXEC : 'bash',
      shellArgs(command, opts.cwd, sandboxed),
      {
        cwd: opts.cwd,
        env: { ...defaultShellEnv(), ...(opts.env ?? {}) },
      },
    );

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

function shellArgs(command: string, cwd: string, sandboxed: boolean): string[] {
  if (!sandboxed) return ['-lc', command];
  return ['-p', shellSandboxProfile(cwd), 'bash', '-lc', command];
}

function shellSandboxProfile(repoDir: string): string {
  const repo = realpathSync(repoDir);
  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    systemReadRule('/bin'),
    systemReadRule('/usr'),
    systemReadRule('/System'),
    systemReadRule('/Library'),
    `(allow file-read* (subpath ${profileString(repo)}))`,
    `(allow file-write* (subpath ${profileString(repo)}))`,
    '(allow file-read* (literal "/dev/null"))',
    '(allow file-write* (literal "/dev/null"))',
  ].join('\n');
}

function systemReadRule(path: string): string {
  return `(allow file-read* (subpath ${profileString(path)}))`;
}

function profileString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function resolveInRepo(repoDir: string, p: string): string {
  const root = Path.resolve(repoDir);
  const resolved = Path.resolve(root, p);
  const relative = Path.relative(root, resolved);

  if (relative === '' || (!relative.startsWith('..') && !Path.isAbsolute(relative))) {
    return resolved;
  }

  throw new Error(`Path escapes repository: ${p}`);
}

function repoRelativePath(repoDir: string, p: string): string {
  const relative = Path.relative(Path.resolve(repoDir), p);
  return relative === '' ? '.' : relative;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

export function isAllowedWebFetchUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]') return false;
  if (host.startsWith('127.')) return false;
  if (host.startsWith('10.')) return false;
  if (host.startsWith('192.168.')) return false;

  const parts = host.split('.');
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  if (first === 172 && Number.isInteger(second) && second >= 16 && second <= 31) return false;

  return true;
}

/**
 * Build the tool set exposed to tool-using subagents. All tools are scoped to
 * the target repository directory.
 */
export function makeTools(repoDir: string, sessionEnv: Readonly<Record<string, string>> = {}) {
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
        try {
          const target = dir ? resolveInRepo(repoDir, dir) : Path.resolve(repoDir);
          const pathspec = shellQuote(repoRelativePath(repoDir, target));
          const fallback = shellQuote(target);
          const res = await sh(`git ls-files -- ${pathspec} || ls -la ${fallback}`, {
            cwd: repoDir,
            timeoutMs: 15_000,
          });
          return truncate(res.combined || '(empty)');
        } catch (e) {
          return `ERROR listing ${dir ?? '.'}: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    searchCode: tool({
      description: 'Search file contents with a regex (ripgrep, falls back to grep).',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for.'),
        path: z.string().optional().describe('Path to limit the search to.'),
      }),
      execute: async ({ pattern, path }) => {
        try {
          const where = path ? shellQuote(resolveInRepo(repoDir, path)) : '.';
          const escaped = shellQuote(pattern);
          const res = await sh(
            `rg -n --no-heading -- ${escaped} ${where} 2>/dev/null || ` +
              `grep -rn -- ${escaped} ${where}`,
            { cwd: repoDir, timeoutMs: 20_000 },
          );
          return truncate(res.combined || '(no matches)');
        } catch (e) {
          return `ERROR searching ${path ?? '.'}: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    runShell: tool({
      description:
        'Run a shell command in the repo (tests, typecheck, git, gh, build, etc). Returns exit code and combined output.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute.'),
      }),
      execute: async ({ command }) => {
        const res = await sh(command, {
          cwd: repoDir,
          timeoutMs: 300_000,
          env: sessionEnv,
          sandbox: true,
        });
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
        if (!isAllowedWebFetchUrl(url)) {
          return `ERROR fetching ${url}: URL is blocked by the webFetch sandbox policy`;
        }
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
