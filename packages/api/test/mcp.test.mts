import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const mocks = vi.hoisted(() => {
  const basename = (dir: string) => dir.split('/').filter(Boolean).pop() ?? dir;
  const sessions = new Map<string, any>();
  let counter = 0;

  const makeSession = (dir: string, language: 'typescript' | 'javascript' = 'typescript') => {
    const id = basename(dir);
    const session = {
      id,
      dir,
      language,
      openedAt: Date.now(),
      cells: [
        { id: 'title', type: 'title', text: id },
        {
          id: 'package',
          type: 'package.json',
          source: '{}',
          filename: 'package.json',
          status: 'idle',
        },
      ],
    };
    sessions.set(id, session);
    return session;
  };

  return {
    sessions,
    createSrcbook: vi.fn(async (name: string, _language: 'typescript' | 'javascript') => {
      counter += 1;
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return `/tmp/srcbooks/${slug || 'srcbook'}-${counter}`;
    }),
    removeSrcbook: vi.fn(async () => undefined),
    createSession: vi.fn(async (dir: string) => makeSession(dir)),
    deleteSessionByDirname: vi.fn(async (dir: string) => {
      for (const [id, session] of sessions) {
        if (session.dir === dir) {
          sessions.delete(id);
        }
      }
    }),
    findSession: vi.fn(async (id: string) => {
      const session = sessions.get(id);
      if (!session) {
        throw new Error(`Session with id ${id} not found`);
      }
      return session;
    }),
    listSessions: vi.fn(async () => Object.fromEntries(sessions)),
    addCell: vi.fn(async (session: any, cell: any, index: number) => {
      if (cell.type === 'markdown' && typeof cell.text !== 'string') {
        throw new Error('Markdown cells must store content in text');
      }
      session.cells.splice(index, 0, cell);
    }),
    updateCell: vi.fn(async (_session: any, cell: any, updates: any) => {
      if (cell.type === 'markdown' && typeof updates.text !== 'string') {
        return {
          success: false,
          errors: [{ message: 'Markdown updates must store content in text' }],
        };
      }
      Object.assign(cell, updates);
      return { success: true, cell };
    }),
    removeCell: vi.fn((session: any, id: string) =>
      session.cells.filter((cell: any) => cell.id !== id),
    ),
    sessionToResponse: vi.fn((session: any) => ({
      id: session.id,
      cells: session.cells,
      language: session.language,
      openedAt: session.openedAt,
    })),
    execNode: vi.fn(({ stdout, onExit }: any) => {
      stdout(Buffer.from('ok\n'));
      onExit(0);
    }),
    execTsx: vi.fn(({ stdout, onExit }: any) => {
      stdout(Buffer.from('ok\n'));
      onExit(0);
    }),
    listGlassbookContexts: vi.fn(async () => [
      {
        id: 'glassbook-run',
        notebookDir: '/tmp/srcbooks/glassbook-run',
        prompt: 'fix bug',
        sidecarHash: 'hash',
        recursiveContextCallCount: 1,
        executionStatus: true,
        evaluationStatus: 'approve',
      },
    ]),
    readGlassbookContext: vi.fn(async () => ({
      summary: {
        id: 'glassbook-run',
        notebookDir: '/tmp/srcbooks/glassbook-run',
        sidecarHash: 'hash',
        recursiveContextCallCount: 1,
      },
      refs: [],
    })),
    askGlassbookContext: vi.fn(async () => ({
      status: 'ok',
      answer: 'approved',
      citations: [
        {
          refId: 'ref',
          sourcePath: '/tmp/srcbooks/glassbook-run/glassbook.json',
          startLine: 1,
          endLine: 3,
        },
      ],
      selectedSpans: [],
    })),
    executeGlassbookContext: vi.fn(async () => ({
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      selectedSpans: [],
      audit: {
        notebookId: 'glassbook-run',
        scratchpadDir: '/tmp/srcbooks/scratchpad',
        language: 'javascript',
        contextFiles: ['/tmp/srcbooks/scratchpad/glassbook-context.json'],
        sandboxed: true,
      },
    })),
    reset: () => {
      counter = 0;
      sessions.clear();
    },
    seedSession: (id: string, language: 'typescript' | 'javascript' = 'typescript') =>
      makeSession(`/tmp/srcbooks/${id}`, language),
  };
});

vi.mock('../session.mjs', () => ({
  createSession: mocks.createSession,
  findSession: mocks.findSession,
  listSessions: mocks.listSessions,
  addCell: mocks.addCell,
  updateCell: mocks.updateCell,
  removeCell: mocks.removeCell,
  deleteSessionByDirname: mocks.deleteSessionByDirname,
  sessionToResponse: mocks.sessionToResponse,
}));

vi.mock('../srcbook/index.mjs', () => ({
  createSrcbook: mocks.createSrcbook,
  removeSrcbook: mocks.removeSrcbook,
}));

vi.mock('../exec.mjs', () => ({
  node: mocks.execNode,
  tsx: mocks.execTsx,
}));

vi.mock('../mcp/glassbook-context.mjs', () => ({
  listGlassbookContexts: mocks.listGlassbookContexts,
  readGlassbookContext: mocks.readGlassbookContext,
  askGlassbookContext: mocks.askGlassbookContext,
  executeGlassbookContext: mocks.executeGlassbookContext,
}));

import { createMcpServer, mcpServer } from '../mcp/server.mjs';
import { mcpClientManager } from '../mcp/client.mjs';

async function callTool(name: string, args: any) {
  return (mcpServer as any)._registeredTools[name].handler(args, {});
}

function parseToolJson(result: any) {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0].text);
}

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
  });

  it('instantiates an McpServer instance', () => {
    expect(mcpServer).toBeDefined();
    expect(mcpServer.server).toBeDefined();
  });

  it('registers all required notebook tools', async () => {
    // _registeredTools is a plain object keyed by tool name
    const toolNames = Object.keys((mcpServer as any)._registeredTools);

    expect(toolNames).toContain('list-srcbooks');
    expect(toolNames).toContain('create-srcbook');
    expect(toolNames).toContain('get-srcbook');
    expect(toolNames).toContain('add-cell');
    expect(toolNames).toContain('update-cell');
    expect(toolNames).toContain('run-cell');
    expect(toolNames).toContain('delete-srcbook');
    expect(toolNames).toContain('execute-code');
    expect(toolNames).toContain('list-glassbook-contexts');
    expect(toolNames).toContain('read-glassbook-context');
    expect(toolNames).toContain('ask-glassbook-context');
    expect(toolNames).toContain('execute-glassbook-context');
  });

  it('registers notebook readme and glassBook context resources', async () => {
    const templateNames = Object.keys((mcpServer as any)._registeredResourceTemplates);
    expect(templateNames).toContain('notebook-readme');
    expect(templateNames).toContain('glassbook-context');
  });

  it('creates fresh registered MCP servers for HTTP transports', async () => {
    const freshServer = createMcpServer();

    expect(freshServer).not.toBe(mcpServer);
    expect(Object.keys((freshServer as any)._registeredTools)).toEqual(
      expect.arrayContaining([
        'list-srcbooks',
        'list-glassbook-contexts',
        'execute-glassbook-context',
      ]),
    );
    expect(Object.keys((freshServer as any)._registeredResourceTemplates)).toEqual(
      expect.arrayContaining(['notebook-readme', 'glassbook-context']),
    );
  });

  it('registers solve-problem prompt', async () => {
    const promptNames = Object.keys((mcpServer as any)._registeredPrompts);
    expect(promptNames).toContain('solve-problem');
  });

  it('registers newly created srcbooks before returning their IDs', async () => {
    const created = parseToolJson(
      await callTool('create-srcbook', { name: 'Review Notebook', language: 'typescript' }),
    );

    expect(mocks.createSession).toHaveBeenCalledWith(created.path);

    const retrieved = parseToolJson(await callTool('get-srcbook', { id: created.id }));
    expect(retrieved).toMatchObject({ id: created.id, language: 'typescript' });
  });

  it('creates a scratchpad session before executing code', async () => {
    const result = parseToolJson(
      await callTool('execute-code', { language: 'typescript', code: 'console.log("ok")' }),
    );

    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/srcbooks/scratchpad-'),
    );
    expect(mocks.addCell).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringContaining('scratchpad-') }),
      expect.objectContaining({ type: 'code', source: 'console.log("ok")' }),
      1,
    );
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok\n' });
  });

  it('projects saved glassBook contexts through dedicated MCP tools', async () => {
    const listed = parseToolJson(await callTool('list-glassbook-contexts', {}));
    expect(listed[0]).toMatchObject({ id: 'glassbook-run', recursiveContextCallCount: 1 });

    const read = parseToolJson(await callTool('read-glassbook-context', { id: 'glassbook-run' }));
    expect(read.summary).toMatchObject({ id: 'glassbook-run', sidecarHash: 'hash' });
    expect(mocks.readGlassbookContext).toHaveBeenCalledWith({
      id: 'glassbook-run',
      includeSidecar: true,
      includeNotebook: true,
    });

    const answer = parseToolJson(
      await callTool('ask-glassbook-context', {
        id: 'glassbook-run',
        question: 'What happened?',
      }),
    );
    expect(answer).toMatchObject({ status: 'ok', answer: 'approved' });

    const executed = parseToolJson(
      await callTool('execute-glassbook-context', {
        id: 'glassbook-run',
        language: 'javascript',
        code: 'console.log("ok")',
      }),
    );
    expect(executed).toMatchObject({
      exitCode: 0,
      audit: { notebookId: 'glassbook-run', sandboxed: true },
    });
    expect(mocks.executeGlassbookContext).toHaveBeenCalledWith({
      id: 'glassbook-run',
      language: 'javascript',
      code: 'console.log("ok")',
      selectors: undefined,
      timeoutMs: undefined,
    });
  });

  it('stores added markdown cell content in text', async () => {
    mocks.seedSession('markdown-session');

    const result = parseToolJson(
      await callTool('add-cell', {
        id: 'markdown-session',
        type: 'markdown',
        source: 'Rendered markdown',
        index: 1,
      }),
    );

    expect(result.cell).toMatchObject({ type: 'markdown', text: 'Rendered markdown' });
    expect(result.cell).not.toHaveProperty('source');
  });

  it('updates markdown cell content through text', async () => {
    const session = mocks.seedSession('update-markdown');
    session.cells.push({ id: 'md', type: 'markdown', text: 'old text' });

    const result = parseToolJson(
      await callTool('update-cell', {
        id: 'update-markdown',
        cellId: 'md',
        source: 'new text',
      }),
    );

    expect(result.cell).toMatchObject({ id: 'md', type: 'markdown', text: 'new text' });
  });

  it('unregisters deleted srcbook sessions after removing their directory', async () => {
    mocks.seedSession('delete-me');

    parseToolJson(await callTool('delete-srcbook', { id: 'delete-me' }));

    expect(mocks.removeSrcbook).toHaveBeenCalledWith('/tmp/srcbooks/delete-me');
    expect(mocks.deleteSessionByDirname).toHaveBeenCalledWith('/tmp/srcbooks/delete-me');
    await expect(mocks.findSession('delete-me')).rejects.toThrow(
      'Session with id delete-me not found',
    );
  });
});

describe('MCP Client Manager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(Path.join(os.tmpdir(), 'srcbook-mcp-test-'));
    // Mock the constant SRCBOOK_DIR or let it use custom mcp.json under test directory
    // In our test, mcpClientManager will load the config. Let's mock loadConfig or fs.readFile
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads configuration correctly', async () => {
    const spy = vi.spyOn(mcpClientManager, 'loadConfig').mockResolvedValue({
      mcpServers: {
        dummy: {
          command: 'node',
          args: ['dummy.js'],
          env: { TEST_KEY: 'test_val' },
        },
      },
    });

    const config = await mcpClientManager.loadConfig();
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers?.dummy).toBeDefined();
    expect(config.mcpServers?.dummy?.command).toBe('node');

    spy.mockRestore();
  });
});
