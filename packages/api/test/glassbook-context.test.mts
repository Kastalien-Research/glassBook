import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Path from 'node:path';
import fsSync from 'node:fs';
import { EventEmitter } from 'node:events';

const mocks = vi.hoisted(() => ({
  srcbooksDir: `/tmp/glassbook-context-test-${process.pid}`,
  access: vi.fn(async () => undefined),
  spawn: vi.fn(),
  getModel: vi.fn(async () => ({ provider: 'test', modelId: 'model' })),
  generateText: vi.fn(),
  object: vi.fn((spec: unknown) => spec),
  createdScratchpads: [] as string[],
}));

vi.mock('../constants.mjs', () => ({
  SRCBOOKS_DIR: mocks.srcbooksDir,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mocked = {
    ...actual,
    access: mocks.access,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  Output: { object: mocks.object },
}));

vi.mock('../ai/config.mjs', () => ({
  getModel: mocks.getModel,
}));

vi.mock('../srcbook/index.mjs', () => {
  return {
    createSrcbook: vi.fn(async (name: string, _language: 'typescript' | 'javascript') => {
      const dir = Path.join(mocks.srcbooksDir, name);
      fsSync.mkdirSync(Path.join(dir, 'src'), { recursive: true });
      fsSync.writeFileSync(Path.join(dir, 'README.md'), `# ${name}\n`);
      fsSync.writeFileSync(Path.join(dir, 'package.json'), '{"type":"module"}\n');
      mocks.createdScratchpads.push(dir);
      return dir;
    }),
    removeSrcbook: vi.fn(async (dir: string) => {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }),
  };
});

vi.mock('../session.mjs', () => {
  return {
    createSession: vi.fn(async (dir: string) => ({
      id: Path.basename(dir),
      dir,
      language: 'typescript',
      cells: [],
      openedAt: Date.now(),
    })),
    deleteSessionByDirname: vi.fn(async () => undefined),
    addCell: vi.fn(async (session: any, cell: any) => {
      fsSync.mkdirSync(Path.join(session.dir, 'src'), { recursive: true });
      fsSync.writeFileSync(Path.join(session.dir, 'src', cell.filename), cell.source, 'utf8');
    }),
  };
});

function seedGlassbookRun(id: string) {
  const dir = Path.join(mocks.srcbooksDir, id);
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.writeFileSync(
    Path.join(dir, 'glassbook.json'),
    JSON.stringify(
      {
        prompt: 'fix a bug',
        recursiveContextCalls: [{ status: 'ok' }],
        execution: { desiredStateAchieved: true },
        evaluation: { verdict: 'approve' },
      },
      null,
      2,
    ),
    'utf8',
  );
  fsSync.writeFileSync(Path.join(dir, 'README.md'), '# glassBook\n\nImportant evidence.\n', 'utf8');
  return dir;
}

function makeSpawnResult(stdout: string, stderr = '', code: number | null = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  }, 0);
  return child;
}

describe('glassBook MCP context helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsSync.rmSync(mocks.srcbooksDir, { recursive: true, force: true });
    fsSync.mkdirSync(mocks.srcbooksDir, { recursive: true });
    mocks.createdScratchpads.length = 0;
    mocks.access.mockResolvedValue(undefined);
    mocks.generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const spanId = prompt.match(/Span ID: ([^\n]+)/)?.[1] ?? 'missing';
      return {
        output: {
          answer: 'The saved run approved the fix.',
          citationSpanIds: [spanId],
        },
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
      };
    });
    mocks.spawn.mockImplementation(() => makeSpawnResult('derived result\n'));
  });

  afterEach(() => {
    fsSync.rmSync(mocks.srcbooksDir, { recursive: true, force: true });
  });

  it('lists and reads only saved glassBook contexts under SRCBOOKS_DIR', async () => {
    seedGlassbookRun('run-1');
    fsSync.mkdirSync(Path.join(mocks.srcbooksDir, 'ordinary-srcbook'), { recursive: true });

    const { listGlassbookContexts, readGlassbookContext } = await import(
      '../mcp/glassbook-context.mjs'
    );

    await expect(readGlassbookContext({ id: '../outside' })).rejects.toThrow('not a path');
    await expect(readGlassbookContext({ id: '/tmp/outside' })).rejects.toThrow('not a path');

    const contexts = await listGlassbookContexts();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      id: 'run-1',
      prompt: 'fix a bug',
      recursiveContextCallCount: 1,
      executionStatus: true,
      evaluationStatus: 'approve',
    });

    const read = await readGlassbookContext({ id: 'run-1' });
    expect(read.refs.map((doc) => doc.ref.kind)).toEqual(['sidecar', 'notebook']);
    expect(read.refs[0]?.ref.contentHash).toHaveLength(64);
  });

  it('asks a cited question without mutating the saved sidecar', async () => {
    const dir = seedGlassbookRun('run-1');
    const before = fsSync.readFileSync(Path.join(dir, 'glassbook.json'), 'utf8');
    const { askGlassbookContext } = await import('../mcp/glassbook-context.mjs');

    const answer = await askGlassbookContext({
      id: 'run-1',
      question: 'Was the run approved?',
      selectors: [{ query: 'approve', maxSpans: 1 }],
    });

    expect(answer).toMatchObject({
      status: 'ok',
      answer: 'The saved run approved the fix.',
    });
    expect(answer.citations).toHaveLength(1);
    expect(fsSync.readFileSync(Path.join(dir, 'glassbook.json'), 'utf8')).toBe(before);
    expect(mocks.generateText).toHaveBeenCalledOnce();
  });

  it('executes code in a cleaned-up context scratchpad with minimal env', async () => {
    seedGlassbookRun('run-1');
    const { executeGlassbookContext } = await import('../mcp/glassbook-context.mjs');

    const result = await executeGlassbookContext({
      id: 'run-1',
      language: 'javascript',
      code: 'console.log("derived result")',
      selectors: [{ maxSpans: 1 }],
    });

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: 'derived result\n',
      audit: {
        notebookId: 'run-1',
        language: 'javascript',
        sandboxed: true,
      },
    });
    expect(result.audit.contextFiles.map((file) => Path.basename(file))).toEqual([
      'glassbook-context.json',
      'glassbook-context.md',
    ]);
    expect(fsSync.existsSync(result.audit.scratchpadDir)).toBe(false);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    const spawnArgs = mocks.spawn.mock.calls[0]?.[1];
    expect(spawnArgs).toEqual(
      expect.arrayContaining([
        '--permission',
        expect.stringContaining('--allow-fs-read='),
        expect.stringContaining('--allow-fs-write='),
      ]),
    );
    const spawnOptions = mocks.spawn.mock.calls[0]?.[2];
    expect(spawnOptions.env.OPENAI_API_KEY).toBeUndefined();
    expect(spawnOptions.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('fails closed when the context execution sandbox is unavailable', async () => {
    seedGlassbookRun('run-1');
    mocks.access.mockRejectedValue(new Error('missing sandbox'));
    const { executeGlassbookContext } = await import('../mcp/glassbook-context.mjs');

    await expect(
      executeGlassbookContext({
        id: 'run-1',
        language: 'javascript',
        code: 'console.log("never")',
      }),
    ).rejects.toThrow('context execution sandbox is unavailable');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
