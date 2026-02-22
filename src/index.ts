import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PencilMcpClient } from './mcp-client.js';
import { buildPiToolDefinitions } from './tool-registrar.js';
import { activateTools, deactivateTools } from './mode-toggle.js';
import { getPencilBinaryPath } from './binary-detection.js';
import type { ModeState } from './types.js';

export default function pencilExtension(pi: ExtensionAPI) {
  const mcpClient = new PencilMcpClient();

  const modeState: ModeState = {
    active: false,
    toolNames: [],
  };

  let pencilInstructions: string | undefined;
  /** Full MCP tool definitions from the most recent successful connect/reconnect */
  let knownTools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> = [];

  // Inject system prompt when pencil mode is active
  pi.on('before_agent_start', async (event, _ctx) => {
    if (modeState.active && pencilInstructions) {
      return {
        systemPrompt: event.systemPrompt + '\n\n' + pencilInstructions,
      };
    }
  });

  // Register /pencil command
  pi.registerCommand('pencil', {
    description: 'Toggle Pencil design mode on/off',
    handler: async (args, ctx) => {
      const sub = args?.trim();

      if (sub === 'reconnect') {
        const newInstructions = await handleReconnect(ctx);
        if (newInstructions !== undefined) {
          pencilInstructions = newInstructions;
        }
        return;
      }
      if (sub === 'status') {
        return handleStatus(ctx);
      }

      // Toggle
      if (modeState.active) {
        deactivatePencil(ctx);
      } else {
        pencilInstructions = await activatePencil(ctx);
      }
    },
  });

  // Clean shutdown
  pi.on('session_shutdown', async () => {
    await mcpClient.disconnect();
  });

  // ── helpers (inner functions so they share the knownTools closure) ──────────

  /** Register tools with Pi and optionally activate them in modeState. */
  function registerAndActivateTools(
    tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>,
    activate: boolean,
    ctx: any,
  ) {
    const callTool = (name: string, args: Record<string, unknown>) =>
      mcpClient.callTool(name, args);
    const piToolDefs = buildPiToolDefinitions(tools, callTool);
    for (const toolDef of piToolDefs) {
      pi.registerTool(toolDef as any);
    }
    knownTools = tools;
    modeState.toolNames = tools.map((t) => t.name);

    if (activate) {
      const currentTools = pi.getActiveTools();
      pi.setActiveTools(activateTools(currentTools, modeState.toolNames));
      modeState.active = true;
      ctx.ui.setWidget('pencil', ['✏️ Pencil']);
    }
  }

  async function activatePencil(ctx: any): Promise<string | undefined> {
    const binaryPath = getPencilBinaryPath();
    if (!binaryPath) {
      ctx.ui.notify('Pencil not installed. Install from pencil.dev', 'error');
      return undefined;
    }

    // Connect if needed
    if (mcpClient.connection.status !== 'connected') {
      ctx.ui.setWidget('pencil', ['⏳ Connecting to Pencil...']);

      try {
        const { tools, instructions } = await mcpClient.connect(binaryPath);

        registerAndActivateTools(tools, true, ctx);

        ctx.ui.notify(`Pencil mode active — ${modeState.toolNames.length} design tools loaded`, 'info');
        return instructions;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.setWidget('pencil', undefined);
        ctx.ui.notify(`Pencil MCP server failed to start: ${message}`, 'error');
        return undefined;
      }
    }

    // Already connected — ensure tools are registered with Pi, then activate
    const toolsToRegister =
      knownTools.length > 0
        ? knownTools
        : (mcpClient.connection.toolNames ?? []).map((name) => ({
            name,
            inputSchema: {},
          }));
    registerAndActivateTools(toolsToRegister, true, ctx);

    ctx.ui.notify(`Pencil mode active — ${modeState.toolNames.length} design tools loaded`, 'info');
    return mcpClient.connection.instructions;
  }

  function deactivatePencil(ctx: any) {
    const currentTools = pi.getActiveTools();
    pi.setActiveTools(deactivateTools(currentTools, modeState.toolNames));
    modeState.active = false;

    // Remove widget
    ctx.ui.setWidget('pencil', undefined);
    ctx.ui.notify('Pencil mode deactivated', 'info');
  }

  async function handleReconnect(ctx: any): Promise<string | undefined> {
    await mcpClient.disconnect();

    const binaryPath = getPencilBinaryPath();
    if (!binaryPath) {
      if (modeState.active) {
        deactivatePencil(ctx);
      }
      ctx.ui.notify('Pencil not installed. Install from pencil.dev', 'error');
      return undefined;
    }

    ctx.ui.setWidget('pencil', ['⏳ Reconnecting...']);
    try {
      const { tools, instructions } = await mcpClient.connect(binaryPath);

      // Re-register tools and re-activate if mode was active
      registerAndActivateTools(tools, modeState.active, ctx);

      ctx.ui.notify('Pencil reconnected', 'info');
      return instructions;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // If mode was active, deactivate to prevent dead tool calls
      if (modeState.active) {
        deactivatePencil(ctx);
      } else {
        ctx.ui.setWidget('pencil', undefined);
      }
      ctx.ui.notify(`Reconnect failed — Pencil mode deactivated: ${message}`, 'error');
      return undefined;
    }
  }

  function handleStatus(ctx: any) {
    const conn = mcpClient.connection;
    const lines = [
      `Mode: ${modeState.active ? 'active' : 'inactive'}`,
      `Connection: ${conn.status}`,
    ];
    if (conn.serverInfo) {
      lines.push(`Server: ${conn.serverInfo.name} v${conn.serverInfo.version}`);
    }
    if (conn.toolNames) {
      lines.push(`Tools: ${conn.toolNames.length} registered`);
    }
    if (conn.error) {
      lines.push(`Error: ${conn.error}`);
    }
    ctx.ui.notify(lines.join('\n'), 'info');
  }
}
