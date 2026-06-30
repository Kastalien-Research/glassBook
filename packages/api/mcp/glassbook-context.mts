import fs from 'node:fs/promises';
import Path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { SRCBOOKS_DIR } from '../constants.mjs';
import { createSrcbook, removeSrcbook } from '../srcbook/index.mjs';
import { createSession, deleteSessionByDirname, addCell } from '../session.mjs';
import { pathToCodeFile, pathToReadme } from '../srcbook/path.mjs';
import { getModel } from '../ai/config.mjs';
import {
  askContext,
  makeNotebookContextRef,
  selectContextSpans,
  type ContextCitation,
  type ContextDocument,
  type ContextSelector,
  type ContextSpan,
  type RecursiveContextCall,
  type RecursiveContextResponder,
} from '@kastalien-research/glassbook-context';
import type { CodeCellType, CodeLanguageType } from '@srcbook/shared';

const GLASSBOOK_SIDECAR = 'glassbook.json';
const MAX_EXEC_OUTPUT_CHARS = 12_000;
const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

const ContextAnswerSchema = z.object({
  answer: z.string().describe('Answer grounded only in the provided glassBook context spans.'),
  citationSpanIds: z
    .array(z.string())
    .min(1)
    .describe('Span IDs that directly support the answer.'),
});

export interface GlassbookContextSummary {
  readonly id: string;
  readonly notebookDir: string;
  readonly prompt?: string;
  readonly sidecarHash: string;
  readonly recursiveContextCallCount: number;
  readonly executionStatus?: unknown;
  readonly evaluationStatus?: unknown;
}

export interface GlassbookContextRead {
  readonly summary: GlassbookContextSummary;
  readonly refs: readonly ContextDocument[];
}

export async function listGlassbookContexts(): Promise<GlassbookContextSummary[]> {
  const entries = await fs.readdir(SRCBOOKS_DIR, { withFileTypes: true }).catch(() => []);
  const summaries: GlassbookContextSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      summaries.push(await readGlassbookSummary(entry.name));
    } catch {
      // Non-glassBook srcbooks are expected in the same store.
    }
  }
  return summaries.sort((a, b) => a.id.localeCompare(b.id));
}

export async function readGlassbookContext(args: {
  readonly id: string;
  readonly includeSidecar?: boolean;
  readonly includeNotebook?: boolean;
}): Promise<GlassbookContextRead> {
  const includeSidecar = args.includeSidecar ?? true;
  const includeNotebook = args.includeNotebook ?? true;
  const notebookDir = resolveGlassbookNotebookDir(args.id);
  const sidecarPath = Path.join(notebookDir, GLASSBOOK_SIDECAR);
  const sidecarContent = await fs.readFile(sidecarPath, 'utf8');
  const sidecar = JSON.parse(sidecarContent) as any;
  const refs: ContextDocument[] = [];

  if (includeSidecar) {
    const ref = makeNotebookContextRef({
      id: `glassbook:${args.id}:sidecar`,
      kind: 'sidecar',
      sourcePath: sidecarPath,
      content: sidecarContent,
      metadata: { notebookId: args.id },
    });
    refs.push({ ref, content: sidecarContent });
  }

  if (includeNotebook) {
    const readmePath = pathToReadme(notebookDir);
    const readmeContent = await fs.readFile(readmePath, 'utf8').catch(() => '');
    if (readmeContent.trim()) {
      const ref = makeNotebookContextRef({
        id: `glassbook:${args.id}:notebook`,
        kind: 'notebook',
        sourcePath: readmePath,
        content: readmeContent,
        metadata: { notebookId: args.id, sidecarPath },
      });
      refs.push({ ref, content: readmeContent });
    }
  }

  return {
    summary: summaryFromSidecar(args.id, notebookDir, sidecarContent, sidecar),
    refs,
  };
}

export async function askGlassbookContext(args: {
  readonly id: string;
  readonly question: string;
  readonly selectors?: readonly ContextSelector[];
  readonly maxTokens?: number;
}): Promise<{
  readonly answer?: string;
  readonly citations: readonly ContextCitation[];
  readonly selectedSpans: readonly ContextSpan[];
  readonly call?: RecursiveContextCall;
  readonly status: 'ok' | 'failed';
  readonly error?: string;
}> {
  const context = await readGlassbookContext({ id: args.id });
  let recordedCall: RecursiveContextCall | undefined;
  const result = await askContext({
    parentCellId: `mcp:${args.id}`,
    question: args.question,
    refs: context.refs,
    selectors: args.selectors,
    maxCalls: 1,
    maxTokens: args.maxTokens,
    depth: 1,
    responder: makeApiRecursiveContextResponder(),
    onCall: (call) => {
      recordedCall = call;
    },
  });

  if (!result.ok) {
    return {
      status: 'failed',
      citations: recordedCall?.citations ?? [],
      selectedSpans: recordedCall?.selectedSpans ?? [],
      call: recordedCall,
      error: result.error.message,
    };
  }

  return {
    status: 'ok',
    answer: result.value.answer,
    citations: result.value.citations,
    selectedSpans: result.value.selectedSpans,
    call: result.value.call,
  };
}

export async function executeGlassbookContext(args: {
  readonly id: string;
  readonly code: string;
  readonly language?: CodeLanguageType;
  readonly selectors?: readonly ContextSelector[];
  readonly timeoutMs?: number;
}): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly selectedSpans: readonly ContextSpan[];
  readonly audit: {
    readonly notebookId: string;
    readonly scratchpadDir: string;
    readonly language: CodeLanguageType;
    readonly contextFiles: readonly string[];
    readonly sandboxed: boolean;
  };
}> {
  const context = await readGlassbookContext({ id: args.id });
  const selectedSpans = selectContextDocumentsForExecution(context.refs, args.selectors);
  const language = args.language ?? 'typescript';
  const srcbookDir = await createSrcbook(
    `glassbook-context-${args.id}-${randomUUID().slice(0, 8)}`,
    language,
  );
  const session = await createSession(srcbookDir);
  const contextJson = Path.join(srcbookDir, 'glassbook-context.json');
  const contextMd = Path.join(srcbookDir, 'glassbook-context.md');
  const filename = language === 'javascript' ? 'index.js' : 'index.ts';
  const cell: CodeCellType = {
    id: randomUUID().slice(0, 10),
    type: 'code',
    source: args.code,
    filename,
    language,
    status: 'idle',
  };

  try {
    await fs.writeFile(
      contextJson,
      JSON.stringify({ summary: context.summary, selectedSpans }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      contextMd,
      selectedSpans.map((span) => span.text).join('\n\n---\n\n'),
      'utf8',
    );
    await addCell(session, cell, 1);

    const result = await runContextCode({
      cwd: srcbookDir,
      entry: pathToCodeFile(srcbookDir, filename),
      language,
      timeoutMs: args.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
    });

    return {
      ...result,
      selectedSpans,
      audit: {
        notebookId: args.id,
        scratchpadDir: srcbookDir,
        language,
        contextFiles: [contextJson, contextMd],
        sandboxed: true,
      },
    };
  } finally {
    await deleteSessionByDirname(srcbookDir).catch(() => undefined);
    await removeSrcbook(srcbookDir).catch(() => undefined);
  }
}

export function resolveGlassbookNotebookDir(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('glassBook context id must be a notebook directory id, not a path');
  }
  const root = Path.resolve(SRCBOOKS_DIR);
  const resolved = Path.resolve(root, id);
  if (resolved !== root && resolved.startsWith(`${root}${Path.sep}`)) return resolved;
  throw new Error('glassBook context path escapes SRCBOOKS_DIR');
}

function summaryFromSidecar(
  id: string,
  notebookDir: string,
  sidecarContent: string,
  sidecar: any,
): GlassbookContextSummary {
  return {
    id,
    notebookDir,
    prompt: typeof sidecar.prompt === 'string' ? sidecar.prompt : undefined,
    sidecarHash: makeNotebookContextRef({
      id: `glassbook:${id}:sidecar`,
      kind: 'sidecar',
      sourcePath: Path.join(notebookDir, GLASSBOOK_SIDECAR),
      content: sidecarContent,
    }).contentHash,
    recursiveContextCallCount: Array.isArray(sidecar.recursiveContextCalls)
      ? sidecar.recursiveContextCalls.length
      : 0,
    executionStatus: sidecar.execution?.desiredStateAchieved,
    evaluationStatus: sidecar.evaluation?.verdict,
  };
}

async function readGlassbookSummary(id: string): Promise<GlassbookContextSummary> {
  const notebookDir = resolveGlassbookNotebookDir(id);
  const sidecarPath = Path.join(notebookDir, GLASSBOOK_SIDECAR);
  const sidecarContent = await fs.readFile(sidecarPath, 'utf8');
  const sidecar = JSON.parse(sidecarContent) as any;
  return summaryFromSidecar(id, notebookDir, sidecarContent, sidecar);
}

function makeApiRecursiveContextResponder(): RecursiveContextResponder {
  return async (request) => {
    const model = await getModel();
    const result = await generateText({
      model,
      output: Output.object({ schema: ContextAnswerSchema, name: 'GlassbookMcpContextAnswer' }),
      system: [
        'You are answering a question over saved glassBook notebook context.',
        'Use only the provided spans. Return citation span IDs that directly support the answer.',
      ].join('\n'),
      prompt: [
        `Question: ${request.question}`,
        'Selected spans:',
        ...request.spans.map(formatSpan),
      ].join('\n\n'),
    });
    const citations = citationsForSpanIds(result.output.citationSpanIds, request.spans);
    return {
      answer: result.output.answer,
      citations,
      usage: result.usage,
    };
  };
}

function formatSpan(span: ContextSpan): string {
  return [
    `Span ID: ${span.spanId}`,
    `Source: ${span.sourcePath}:${span.startLine}-${span.endLine}`,
    span.text,
  ].join('\n');
}

function citationsForSpanIds(
  spanIds: readonly string[],
  spans: readonly ContextSpan[],
): ContextCitation[] {
  const citations: ContextCitation[] = [];
  const seen = new Set<string>();
  for (const spanId of spanIds) {
    if (seen.has(spanId)) continue;
    seen.add(spanId);
    const span = spans.find((candidate) => candidate.spanId === spanId);
    if (!span) continue;
    citations.push({
      refId: span.refId,
      sourcePath: span.sourcePath,
      startLine: span.startLine,
      endLine: span.endLine,
      ...(span.cellId ? { cellId: span.cellId } : {}),
    });
  }
  return citations;
}

function selectContextDocumentsForExecution(
  refs: readonly ContextDocument[],
  selectors: readonly ContextSelector[] | undefined,
): ContextSpan[] {
  return selectContextSpans({ refs, selectors });
}

async function runContextCode(args: {
  readonly cwd: string;
  readonly entry: string;
  readonly language: CodeLanguageType;
  readonly timeoutMs: number;
}): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  await assertSandboxAvailable();
  const cwd = Path.resolve(args.cwd);
  const realCwd = await fs.realpath(args.cwd).catch(() => cwd);
  const allowedRoots = [...new Set([cwd, realCwd])];
  const permissionFlag = nodePermissionFlag();
  const typeStripFlag = args.language === 'typescript' ? nodeTypeStripFlag() : undefined;
  return new Promise((resolve) => {
    const command = process.execPath;
    const entry = Path.relative(cwd, args.entry);
    const permissionArgs = [
      permissionFlag,
      ...allowedRoots.flatMap((root) => [`--allow-fs-read=${root}`, `--allow-fs-write=${root}`]),
    ];
    const commandArgs =
      args.language === 'javascript'
        ? [...permissionArgs, entry]
        : [...permissionArgs, typeStripFlag!, entry];
    const child = spawn(
      SANDBOX_EXEC,
      ['-p', sandboxProfile(allowedRoots), command, ...commandArgs],
      {
        cwd,
        env: minimalExecutionEnv(),
      },
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), args.timeoutMs);
    timeout.unref?.();

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8');
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        stdout: truncate(stdout),
        stderr: truncate(stderr + error.message),
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        stdout: truncate(stdout),
        stderr: truncate(signal ? `${stderr}Process exited by signal ${signal}` : stderr),
      });
    });
  });
}

async function assertSandboxAvailable(): Promise<void> {
  try {
    await fs.access(SANDBOX_EXEC);
  } catch {
    throw new Error('context execution sandbox is unavailable');
  }
}

function nodePermissionFlag(): string {
  if (process.allowedNodeEnvironmentFlags.has('--permission')) return '--permission';
  if (process.allowedNodeEnvironmentFlags.has('--experimental-permission')) {
    return '--experimental-permission';
  }
  throw new Error('context execution node permission sandbox is unavailable');
}

function nodeTypeStripFlag(): string {
  if (process.allowedNodeEnvironmentFlags.has('--experimental-strip-types')) {
    return '--experimental-strip-types';
  }
  throw new Error('context execution TypeScript runner is unavailable');
}

function minimalExecutionEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    NODE_ENV: process.env.NODE_ENV,
  };
}

function sandboxProfile(allowedRoots: readonly string[]): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    ...allowedRoots.map((root) => `(allow file-write* (subpath ${profileString(root)}))`),
    '(allow file-write* (literal "/dev/null"))',
  ].join('\n');
}

function profileString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function truncate(text: string): string {
  if (text.length <= MAX_EXEC_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_EXEC_OUTPUT_CHARS)}\n... [truncated ${
    text.length - MAX_EXEC_OUTPUT_CHARS
  } chars]`;
}
