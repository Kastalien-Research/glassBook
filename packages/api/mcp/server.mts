import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import z from 'zod';
import {
  createSession,
  deleteSessionByDirname,
  findSession,
  listSessions,
  addCell,
  updateCell,
  sessionToResponse,
} from '../session.mjs';
import { createSrcbook, removeSrcbook } from '../srcbook/index.mjs';
import { node, tsx } from '../exec.mjs';
import { pathToCodeFile, pathToReadme } from '../srcbook/path.mjs';
import { type CodeLanguageType, type CodeCellType, type MarkdownCellType } from '@srcbook/shared';
import {
  askGlassbookContext,
  executeGlassbookContext,
  listGlassbookContexts,
  readGlassbookContext,
} from './glassbook-context.mjs';

const mcpServerConfig = {
  name: 'srcbook-notebook-server',
  version: '1.0.0',
};

// Create the global MCP Server instance used by direct in-process callers/tests.
export const mcpServer = new McpServer(mcpServerConfig);

// Registry to track streamable HTTP transports
export const activeHttpTransports = new Map<string, StreamableHTTPServerTransport>();
export const activeMcpServers = new Map<string, McpServer>();

export function createMcpServer(): McpServer {
  const server = new McpServer(mcpServerConfig);
  cloneRegisteredSurface(mcpServer, server);
  registerSolveProblemPrompt(server);
  return server;
}

function cloneRegisteredSurface(source: McpServer, target: McpServer): void {
  const sourceServer = source as any;
  const targetServer = target as any;

  for (const [name, tool] of Object.entries(sourceServer._registeredTools ?? {}) as [
    string,
    any,
  ][]) {
    const config = omitNullish({
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
      _meta: tool._meta,
    });
    targetServer.registerTool(name, config, tool.handler);
  }

  for (const [name, resource] of Object.entries(
    sourceServer._registeredResourceTemplates ?? {},
  ) as [string, any][]) {
    targetServer.registerResource(
      name,
      resource.resourceTemplate,
      resource.metadata,
      resource.readCallback,
    );
  }
}

function omitNullish<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  );
}

// Expose Notebook CRUD & Execution as Tools
mcpServer.registerTool(
  'list-srcbooks',
  {
    title: 'List Srcbooks',
    description: 'Lists all available Srcbooks and active sessions.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const sessions = await listSessions();
      const result = Object.values(sessions).map(sessionToResponse);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to list Srcbooks: ${error?.message || error}` }],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'create-srcbook',
  {
    title: 'Create Srcbook',
    description:
      'Creates a new Srcbook with a specified name and language (typescript or javascript).',
    inputSchema: z.object({
      name: z.string().min(1).describe('The name of the new Srcbook'),
      language: z
        .enum(['typescript', 'javascript'])
        .default('typescript')
        .describe('The programming language of the notebook'),
    }),
  },
  async ({ name, language }) => {
    try {
      const srcbookDir = await createSrcbook(name, language as CodeLanguageType);
      const session = await createSession(srcbookDir);
      const id = session.id;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ id, name, path: srcbookDir, language }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to create Srcbook: ${error?.message || error}` }],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'get-srcbook',
  {
    title: 'Get Srcbook Details',
    description: 'Retrieves cells, language, and details of a specific Srcbook by its ID.',
    inputSchema: z.object({
      id: z.string().describe('The Srcbook session ID'),
    }),
  },
  async ({ id }) => {
    try {
      const session = await findSession(id);
      return {
        content: [{ type: 'text', text: JSON.stringify(sessionToResponse(session), null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [
          { type: 'text', text: `Failed to retrieve Srcbook details: ${error?.message || error}` },
        ],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'add-cell',
  {
    title: 'Add Notebook Cell',
    description: 'Adds a code or markdown cell to a specific Srcbook session.',
    inputSchema: z.object({
      id: z.string().describe('The Srcbook session ID'),
      type: z.enum(['code', 'markdown']).describe('The cell type'),
      source: z.string().describe('The cell code source or markdown text content'),
      filename: z
        .string()
        .optional()
        .describe('Filename of the cell (required for code cells, e.g., index.ts or cell.js)'),
      index: z.number().describe('The insertion index inside the notebook'),
    }),
  },
  async ({ id, type, source, filename, index }) => {
    try {
      const session = await findSession(id);
      const cellId = randomUUID().slice(0, 10);

      let cell: MarkdownCellType | CodeCellType;
      if (type === 'markdown') {
        cell = {
          id: cellId,
          type,
          text: source,
        };
      } else {
        if (!filename) {
          throw new Error('Filename is required for code cells.');
        }
        cell = {
          id: cellId,
          type,
          source,
          filename,
          language: session.language,
          status: 'idle',
        };
      }

      await addCell(session, cell, index);

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, cellId, cell }, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to add cell: ${error?.message || error}` }],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'update-cell',
  {
    title: 'Update Notebook Cell',
    description:
      'Updates the code source or markdown text of an existing cell in a Srcbook session.',
    inputSchema: z.object({
      id: z.string().describe('The Srcbook session ID'),
      cellId: z.string().describe('The ID of the cell to update'),
      source: z.string().describe('The updated cell source code or markdown text'),
    }),
  },
  async ({ id, cellId, source }) => {
    try {
      const session = await findSession(id);
      const cell = session.cells.find((c) => c.id === cellId);
      if (!cell) {
        throw new Error(`Cell ${cellId} not found in session ${id}.`);
      }

      const updates =
        cell.type === 'markdown' || cell.type === 'title' ? { text: source } : { source };
      const result = await updateCell(session, cell, updates);
      if (!result.success) {
        return {
          content: [
            { type: 'text', text: `Failed to update cell: ${JSON.stringify(result.errors)}` },
          ],
          isError: true,
        };
      }

      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: true, cell: result.cell }, null, 2) },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to update cell: ${error?.message || error}` }],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'run-cell',
  {
    title: 'Run Code Cell',
    description:
      'Executes a specific code cell in a session, capturing and returning its execution stdout and stderr.',
    inputSchema: z.object({
      id: z.string().describe('The Srcbook session ID'),
      cellId: z.string().describe('The ID of the code cell to execute'),
    }),
  },
  async ({ id, cellId }) => {
    try {
      const session = await findSession(id);
      const cell = session.cells.find((c) => c.id === cellId) as CodeCellType | undefined;
      if (!cell || cell.type !== 'code') {
        throw new Error(`Code cell ${cellId} not found in session ${id}.`);
      }

      const filePath = pathToCodeFile(session.dir, cell.filename);
      const execFn = cell.language === 'javascript' ? node : tsx;

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      return new Promise((resolve) => {
        execFn({
          cwd: session.dir,
          env: process.env,
          entry: filePath,
          stdout: (data) => {
            stdoutChunks.push(data.toString('utf8'));
          },
          stderr: (data) => {
            stderrChunks.push(data.toString('utf8'));
          },
          onExit: (code) => {
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      exitCode: code,
                      stdout: stdoutChunks.join(''),
                      stderr: stderrChunks.join(''),
                    },
                    null,
                    2,
                  ),
                },
              ],
            });
          },
        });
      });
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to execute cell: ${error?.message || error}` }],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'delete-srcbook',
  {
    title: 'Delete Srcbook',
    description: 'Removes a Srcbook session and deletes its files from the disk.',
    inputSchema: z.object({
      id: z.string().describe('The Srcbook session ID'),
    }),
  },
  async ({ id }) => {
    try {
      const session = await findSession(id);
      await removeSrcbook(session.dir);
      await deleteSessionByDirname(session.dir);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: id }, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to delete Srcbook: ${error?.message || error}` }],
        isError: true,
      };
    }
  },
);

// Code Mode execution tool (Server-side Code Mode)
mcpServer.registerTool(
  'execute-code',
  {
    title: 'Execute Code (Code Mode)',
    description:
      'Executes arbitrary TypeScript/JavaScript code on the server and returns the output. This behaves like a sandboxed scratchpad.',
    inputSchema: z.object({
      language: z
        .enum(['typescript', 'javascript'])
        .default('typescript')
        .describe('The script programming language'),
      code: z.string().describe('The TypeScript or JavaScript code block to run'),
    }),
  },
  async ({ language, code }) => {
    let srcbookDir: string | undefined;
    try {
      // Create a temporary scratchpad srcbook to run this code securely
      const name = `scratchpad-${randomUUID().slice(0, 8)}`;
      srcbookDir = await createSrcbook(name, language as CodeLanguageType);
      const session = await createSession(srcbookDir);

      const filename = language === 'typescript' ? 'index.ts' : 'index.js';
      const cellId = randomUUID().slice(0, 10);

      const cell: CodeCellType = {
        id: cellId,
        type: 'code',
        source: code,
        filename,
        language: language as CodeLanguageType,
        status: 'idle',
      };

      await addCell(session, cell, 1);

      const filePath = pathToCodeFile(session.dir, filename);
      const execFn = language === 'javascript' ? node : tsx;

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const execResult = await new Promise<any>((resolve) => {
        execFn({
          cwd: session.dir,
          env: process.env,
          entry: filePath,
          stdout: (data) => {
            stdoutChunks.push(data.toString('utf8'));
          },
          stderr: (data) => {
            stderrChunks.push(data.toString('utf8'));
          },
          onExit: (exitCode) => {
            resolve({
              exitCode,
              stdout: stdoutChunks.join(''),
              stderr: stderrChunks.join(''),
            });
          },
        });
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(execResult, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to execute code: ${error?.message || error}` }],
        isError: true,
      };
    } finally {
      if (srcbookDir) {
        await deleteSessionByDirname(srcbookDir);
        await removeSrcbook(srcbookDir);
      }
    }
  },
);

// glassBook recursive context projection tools.
mcpServer.registerTool(
  'list-glassbook-contexts',
  {
    title: 'List glassBook Contexts',
    description: 'Lists saved glassBook notebook/sidecar contexts.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const result = await listGlassbookContexts();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [
          { type: 'text', text: `Failed to list glassBook contexts: ${error?.message || error}` },
        ],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'read-glassbook-context',
  {
    title: 'Read glassBook Context',
    description: 'Reads saved glassBook sidecar/notebook context by notebook ID.',
    inputSchema: z.object({
      id: z.string().describe('The saved Srcbook notebook ID containing glassbook.json'),
      includeSidecar: z.boolean().optional().default(true),
      includeNotebook: z.boolean().optional().default(true),
    }),
  },
  async ({ id, includeSidecar, includeNotebook }) => {
    try {
      const result = await readGlassbookContext({
        id,
        includeSidecar: includeSidecar ?? true,
        includeNotebook: includeNotebook ?? true,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [
          { type: 'text', text: `Failed to read glassBook context: ${error?.message || error}` },
        ],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'ask-glassbook-context',
  {
    title: 'Ask glassBook Context',
    description: 'Asks a cited, read-only question over saved glassBook context.',
    inputSchema: z.object({
      id: z.string().describe('The saved Srcbook notebook ID containing glassbook.json'),
      question: z.string().min(1).describe('Question to answer from the saved context'),
      selectors: z
        .array(
          z.object({
            query: z.string().optional(),
            cellIds: z.array(z.string()).optional(),
            maxSpans: z.number().int().positive().optional(),
            maxCharsPerSpan: z.number().int().positive().optional(),
          }),
        )
        .optional(),
      maxTokens: z.number().int().positive().optional(),
    }),
  },
  async ({ id, question, selectors, maxTokens }) => {
    try {
      const result = await askGlassbookContext({ id, question, selectors, maxTokens });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status === 'failed',
      };
    } catch (error: any) {
      return {
        content: [
          { type: 'text', text: `Failed to ask glassBook context: ${error?.message || error}` },
        ],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  'execute-glassbook-context',
  {
    title: 'Execute glassBook Context',
    description:
      'Executes caller code in a temporary scratchpad containing selected saved glassBook context files.',
    inputSchema: z.object({
      id: z.string().describe('The saved Srcbook notebook ID containing glassbook.json'),
      code: z.string().min(1).describe('Code to execute against materialized context files'),
      language: z.enum(['typescript', 'javascript']).default('typescript'),
      selectors: z
        .array(
          z.object({
            query: z.string().optional(),
            cellIds: z.array(z.string()).optional(),
            maxSpans: z.number().int().positive().optional(),
            maxCharsPerSpan: z.number().int().positive().optional(),
          }),
        )
        .optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
  },
  async ({ id, code, language, selectors, timeoutMs }) => {
    try {
      const result = await executeGlassbookContext({
        id,
        code,
        language: language as CodeLanguageType,
        selectors,
        timeoutMs,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute glassBook context: ${error?.message || error}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Register Resources for viewing notebook cells and files
mcpServer.registerResource(
  'notebook-readme',
  new ResourceTemplate('srcbook://{id}/readme', {
    list: async () => {
      const sessions = await listSessions();
      return {
        resources: Object.keys(sessions).map((id) => ({
          uri: `srcbook://${id}/readme`,
          name: `Readme for Srcbook ${id}`,
        })),
      };
    },
  }),
  {
    title: 'Srcbook Readme',
    description: 'Retrieves the complete markdown readme file representing the notebook layout.',
    mimeType: 'text/markdown',
  },
  async (uri, { id }) => {
    try {
      const idStr = Array.isArray(id) ? id[0] : id;
      if (!idStr) {
        throw new Error('ID is required');
      }
      const session = await findSession(idStr);
      const readmePath = pathToReadme(session.dir);
      const contents = await fs.readFile(readmePath, 'utf8');
      return {
        contents: [{ uri: uri.href, text: contents }],
      };
    } catch (error: any) {
      throw new Error(`Failed to read notebook readme: ${error?.message || error}`);
    }
  },
);

mcpServer.registerResource(
  'glassbook-context',
  new ResourceTemplate('glassbook://{id}/context', {
    list: async () => {
      const contexts = await listGlassbookContexts();
      return {
        resources: contexts.map((context) => ({
          uri: `glassbook://${context.id}/context`,
          name: `glassBook context ${context.id}`,
        })),
      };
    },
  }),
  {
    title: 'glassBook Context',
    description: 'Retrieves saved glassBook sidecar/notebook context metadata.',
    mimeType: 'application/json',
  },
  async (uri, { id }) => {
    try {
      const idStr = Array.isArray(id) ? id[0] : id;
      if (!idStr) throw new Error('ID is required');
      const context = await readGlassbookContext({ id: idStr });
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(context, null, 2) }],
      };
    } catch (error: any) {
      throw new Error(`Failed to read glassBook context: ${error?.message || error}`);
    }
  },
);

// Register Prompts
registerSolveProblemPrompt(mcpServer);

function registerSolveProblemPrompt(server: McpServer): void {
  server.registerPrompt(
    'solve-problem',
    {
      title: 'Solve coding problem in a cell',
      description:
        'Creates a prompt to help solve a specific programming question or requirement inside a notebook cell.',
      argsSchema: {
        problem: z.string().describe('The programming task or problem description'),
        language: z.enum(['typescript', 'javascript']).default('typescript'),
      },
    },
    ({ problem, language }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please generate a clean, modular code block in ${language} to solve the following requirement. Explain the approach briefly, and output ONLY valid code within a markdown block.\n\nRequirement:\n${problem}`,
          },
        },
      ],
    }),
  );
}
