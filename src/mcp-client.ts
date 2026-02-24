import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PencilConnection } from './types.js';

export class PencilMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private _connection: PencilConnection = { status: 'disconnected' };
  private onStatusChange?: (connection: PencilConnection) => void;

  constructor(opts?: { onStatusChange?: (connection: PencilConnection) => void }) {
    this.onStatusChange = opts?.onStatusChange;
  }

  get connection(): PencilConnection {
    return this._connection;
  }

  private updateConnection(update: Partial<PencilConnection>) {
    this._connection = { ...this._connection, ...update };
    this.onStatusChange?.(this._connection);
  }

  /**
   * Connect to the Pencil MCP server via stdio.
   * Returns the list of tool definitions and server instructions.
   */
  async connect(binaryPath: string): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
    instructions?: string;
  }> {
    this.updateConnection({ status: 'connecting', error: undefined });

    try {
      this.client = new Client({ name: 'pi-pencil', version: '0.1.0' });
      this.transport = new StdioClientTransport({
        command: binaryPath,
        args: ['--app', 'desktop'],
      });

      // Listen for transport close to detect disconnection
      this.transport.onclose = () => {
        if (this._connection.status === 'connected') {
          this.updateConnection({ status: 'error', error: 'Pencil connection lost' });
        }
      };

      await this.client.connect(this.transport);

      // Get server info from the client after connection
      const serverInfo = this.client.getServerVersion();
      const instructions = this.client.getInstructions();

      // Discover tools
      const { tools } = await this.client.listTools();

      const toolDefs = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      this.updateConnection({
        status: 'connected',
        serverInfo: serverInfo
          ? { name: serverInfo.name, version: serverInfo.version }
          : undefined,
        toolNames: toolDefs.map((t) => t.name),
        instructions: instructions ?? undefined,
      });

      return { tools: toolDefs, instructions: instructions ?? undefined };
    } catch (err) {
      // Clean up partially initialized client/transport
      try {
        await this.client?.close();
      } catch {
        // Ignore cleanup errors
      }
      this.client = null;
      this.transport = null;
      const message = err instanceof Error ? err.message : String(err);
      this.updateConnection({ status: 'error', error: `Failed to connect: ${message}` });
      throw err;
    }
  }

  /**
   * Call a tool on the Pencil MCP server.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; [key: string]: unknown }>; isError?: boolean }> {
    if (!this.client || this._connection.status !== 'connected') {
      throw new Error('Not connected to Pencil MCP server');
    }

    const result = await this.client.callTool({ name, arguments: args });
    return {
      content: (result.content ?? []) as Array<{ type: string; [key: string]: unknown }>,
      isError: result.isError as boolean | undefined,
    };
  }

  /**
   * Disconnect from the Pencil MCP server.
   */
  async disconnect() {
    try {
      await this.client?.close();
    } catch {
      // Ignore close errors
    }
    this.client = null;
    this.transport = null;
    this.updateConnection({
      status: 'disconnected',
      error: undefined,
      toolNames: undefined,
      serverInfo: undefined,
      instructions: undefined,
    });
  }
}
