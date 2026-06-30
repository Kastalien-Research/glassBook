import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Path from 'node:path';
import fs from 'node:fs/promises';
import { SRCBOOK_DIR } from '../constants.mjs';
import { fileExists } from '../fs-utils.mjs';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport>();

  /**
   * Loads the MCP server configuration from ~/.srcbook/mcp.json
   */
  async loadConfig(): Promise<McpConfig> {
    const configPath = Path.join(SRCBOOK_DIR, 'mcp.json');
    if (!(await fileExists(configPath))) {
      const defaultConfig: McpConfig = { mcpServers: {} };
      try {
        await fs.mkdir(SRCBOOK_DIR, { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      } catch (err) {
        console.error(`Failed to create default mcp.json: ${err}`);
      }
      return defaultConfig;
    }

    try {
      const content = await fs.readFile(configPath, 'utf8');
      return JSON.parse(content) as McpConfig;
    } catch (err) {
      console.error(`Failed to parse mcp.json: ${err}`);
      return { mcpServers: {} };
    }
  }

  /**
   * Connects to all configured external MCP servers
   */
  async connectAll(): Promise<void> {
    const config = await this.loadConfig();
    const servers = config.mcpServers || {};

    for (const [name, serverConfig] of Object.entries(servers)) {
      if (this.clients.has(name)) {
        continue; // Already connected
      }

      console.log(`[MCP Client] Connecting to server "${name}"...`);
      try {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({
          ...process.env,
          ...(serverConfig.env || {}),
        })) {
          if (value !== undefined) {
            env[key] = value;
          }
        }

        const transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args || [],
          env,
        });

        const client = new Client(
          { name: 'srcbook-client', version: '1.0.0' },
          { capabilities: {} },
        );

        await client.connect(transport);
        this.clients.set(name, client);
        this.transports.set(name, transport);
        console.log(`[MCP Client] Successfully connected to server "${name}"`);
      } catch (err) {
        console.error(`[MCP Client] Failed to connect to server "${name}": ${err}`);
      }
    }
  }

  /**
   * Lists all available tools from all connected MCP clients, formatted for the AI SDK
   */
  async listAllTools(): Promise<
    Array<{ serverName: string; name: string; description?: string; inputSchema: any }>
  > {
    const allTools: Array<{
      serverName: string;
      name: string;
      description?: string;
      inputSchema: any;
    }> = [];

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const result = await client.listTools();
        for (const tool of result.tools) {
          allTools.push({
            serverName,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      } catch (err) {
        console.error(`[MCP Client] Failed to list tools for server "${serverName}": ${err}`);
      }
    }

    return allTools;
  }

  /**
   * Calls a tool on a specific connected MCP server
   */
  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP Client "${serverName}" is not connected.`);
    }

    try {
      console.log(
        `[MCP Client] Calling tool "${toolName}" on server "${serverName}" with args:`,
        JSON.stringify(args),
      );
      const result = await client.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (err) {
      console.error(
        `[MCP Client] Error calling tool "${toolName}" on server "${serverName}": ${err}`,
      );
      throw err;
    }
  }

  /**
   * Gracefully shuts down all active MCP client sessions
   */
  async shutdownAll(): Promise<void> {
    for (const [name, client] of this.clients.entries()) {
      try {
        console.log(`[MCP Client] Closing connection to server "${name}"...`);
        await client.close();
      } catch (err) {
        console.error(`[MCP Client] Error closing server "${name}": ${err}`);
      }
    }
    this.clients.clear();
    this.transports.clear();
  }
}

// Global shared client manager instance
export const mcpClientManager = new McpClientManager();
