interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface PiToolDef {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: any,
    ctx: any,
  ) => Promise<{
    content: Array<{ type: string; [key: string]: unknown }>;
    isError?: boolean;
    details?: Record<string, unknown>;
  }>;
}

type CallToolFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; [key: string]: unknown }>; isError?: boolean }>;

/**
 * Build pi tool definitions from MCP tool definitions.
 * Each pi tool forwards calls to the MCP client's callTool method.
 */
export function buildPiToolDefinitions(
  mcpTools: McpToolDef[],
  callTool: CallToolFn,
): PiToolDef[] {
  return mcpTools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description ?? '',
    parameters: tool.inputSchema,
    execute: async (toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = await callTool(tool.name, params);
      return {
        content: result.content,
        isError: result.isError ?? false,
        details: {},
      };
    },
  }));
}
