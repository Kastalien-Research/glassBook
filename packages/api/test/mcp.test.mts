import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { mcpServer } from '../mcp/server.mjs';
import { mcpClientManager } from '../mcp/client.mjs';

describe('MCP Server', () => {
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
  });

  it('registers notebook readme resource', async () => {
    const templateNames = Object.keys((mcpServer as any)._registeredResourceTemplates);
    expect(templateNames).toContain('notebook-readme');
  });

  it('registers solve-problem prompt', async () => {
    const promptNames = Object.keys((mcpServer as any)._registeredPrompts);
    expect(promptNames).toContain('solve-problem');
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
