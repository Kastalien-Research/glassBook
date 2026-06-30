import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionType } from '../types.mjs';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => schema),
  getModel: vi.fn(async () => ({ provider: 'test', modelId: 'model' })),
  mcpClientManager: {
    connectAll: vi.fn(),
    listAllTools: vi.fn(),
    callTool: vi.fn(),
    shutdownAll: vi.fn(),
  },
}));

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  jsonSchema: mocks.jsonSchema,
}));

vi.mock('../ai/config.mjs', () => ({
  getModel: mocks.getModel,
}));

vi.mock('../mcp/client.mjs', () => ({
  mcpClientManager: mocks.mcpClientManager,
}));

import { generateCells } from '../ai/generate.mjs';

function makeSession(): SessionType {
  return {
    id: 'session',
    dir: '/tmp/session',
    language: 'typescript',
    openedAt: 0,
    'tsconfig.json': '{}',
    cells: [
      { id: 'title', type: 'title', text: 'Notebook' },
      {
        id: 'package',
        type: 'package.json',
        source: '{}',
        filename: 'package.json',
        status: 'idle',
      },
    ],
  };
}

const generatedCell = `###### index.ts

\`\`\`typescript
console.log("from tools");
\`\`\`
`;

describe('generateCells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mcpClientManager.connectAll.mockResolvedValue(undefined);
    mocks.mcpClientManager.listAllTools.mockResolvedValue([]);
    mocks.mcpClientManager.callTool.mockResolvedValue('tool result');
    mocks.mcpClientManager.shutdownAll.mockResolvedValue(undefined);
    mocks.generateText.mockResolvedValue({
      finishReason: 'stop',
      text: generatedCell,
      steps: [{ text: generatedCell }],
    });
  });

  it('decodes the latest non-empty step text when the final step only made tool calls', async () => {
    mocks.generateText.mockResolvedValue({
      finishReason: 'tool-calls',
      text: '',
      steps: [{ text: generatedCell }, { text: '' }],
    });

    const result = await generateCells('add a log cell', makeSession(), 1);

    expect(result.error).toBe(false);
    expect(result.cells).toEqual([
      {
        id: expect.any(String),
        type: 'code',
        source: 'console.log("from tools");',
        language: 'typescript',
        filename: 'index.ts',
        status: 'idle',
      },
    ]);
  });

  it('shuts down MCP clients after generation uses tool context', async () => {
    mocks.mcpClientManager.listAllTools.mockResolvedValue([
      {
        serverName: 'docs',
        name: 'search',
        description: 'Search docs',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);

    await generateCells('add a log cell', makeSession(), 1);

    expect(mocks.mcpClientManager.connectAll).toHaveBeenCalledOnce();
    expect(mocks.mcpClientManager.shutdownAll).toHaveBeenCalledOnce();
  });
});
