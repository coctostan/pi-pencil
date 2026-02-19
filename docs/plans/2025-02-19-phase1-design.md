# Phase 1: MVP — Claude Code Parity

## Overview

A pi extension that connects to Pencil's local MCP server via stdio, registers all 14 design tools, and exposes them through a `/pencil` mode toggle. When active, the LLM has full design capabilities identical to what Claude Code gets. When inactive, zero context cost.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  pi                                         │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  pi-pencil extension                 │   │
│  │                                      │   │
│  │  ┌─────────────┐  ┌──────────────┐  │   │
│  │  │ MCP Client  │  │ Tool         │  │   │
│  │  │ (SDK)       │◄─┤ Registrar    │  │   │
│  │  │             │  │              │  │   │
│  │  │ stdio       │  │ 14 tools     │  │   │
│  │  │ transport   │  │ (inactive    │  │   │
│  │  │             │  │  by default) │  │   │
│  │  └──────┬──────┘  └──────────────┘  │   │
│  │         │                            │   │
│  │  ┌──────┴──────┐  ┌──────────────┐  │   │
│  │  │ Connection  │  │ /pencil      │  │   │
│  │  │ Manager     │  │ Command      │  │   │
│  │  │             │  │              │  │   │
│  │  │ detect,     │  │ toggle mode  │  │   │
│  │  │ connect,    │  │ setActive    │  │   │
│  │  │ reconnect   │  │ Tools()      │  │   │
│  │  └──────┬──────┘  └──────────────┘  │   │
│  │         │                            │   │
│  └─────────┼────────────────────────────┘   │
│            │ stdio (stdin/stdout)            │
└────────────┼────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│  Pencil MCP Server                          │
│  (mcp-server-darwin-arm64 --app desktop)    │
│                                             │
│  14 tools: batch_design, batch_get,         │
│  get_screenshot, snapshot_layout, ...       │
└─────────────────────────────────────────────┘
```

---

## Components

### 1. MCP Client (`mcp-client.ts`)

Manages the stdio connection to Pencil's MCP server binary.

**Responsibilities:**
- Spawn the Pencil MCP server binary as a child process
- Handle MCP protocol lifecycle: `initialize` → `notifications/initialized` → ready
- Forward `tools/list` to discover available tools and their schemas
- Forward `tools/call` requests and return results
- Handle connection errors, process exit, reconnection
- Clean shutdown on pi exit

**Dependencies:**
- `@modelcontextprotocol/sdk` — Official MCP client library
- Uses `StdioClientTransport` for subprocess communication

**Key types:**
```typescript
interface PencilConnection {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  serverInfo?: { name: string; version: string };
  tools?: ToolDefinition[];
  instructions?: string;
  error?: string;
}
```

**Binary detection:**
```typescript
function getPencilBinaryPath(): string | null {
  // macOS
  const macPaths = [
    '/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64',
    '/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-x64',
  ];
  // Linux
  const linuxPaths = [
    '/usr/lib/pencil/mcp-server-linux-x64',
    '/opt/Pencil/mcp-server-linux-x64',
  ];
  // Windows
  const winPaths = [
    `${process.env.LOCALAPPDATA}\\Pencil\\mcp-server-win32-x64.exe`,
    `${process.env.PROGRAMFILES}\\Pencil\\mcp-server-win32-x64.exe`,
  ];
  // Also check Claude Code config as fallback
  // ~/.claude.json -> mcpServers.pencil.command
}
```

### 2. Tool Registrar (`tool-registrar.ts`)

Converts MCP tool definitions to pi tool registrations.

**Responsibilities:**
- Take MCP tool definitions from `tools/list` response
- Register each as a pi tool via `pi.registerTool()`
- Tool execution: marshal pi tool call → MCP `tools/call` → return result
- Prefix tool names with `pencil_` to namespace them (e.g. `pencil_batch_design`)

**Tool registration pattern:**

Tools keep their original MCP names — no prefix. Pencil's injected instructions reference these names directly.

```typescript
function registerPencilTools(pi: ExtensionAPI, tools: McpTool[], client: McpClient) {
  const toolNames: string[] = [];
  for (const tool of tools) {
    pi.registerTool(tool.name, {
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async (params) => {
        const result = await client.callTool(tool.name, params);
        return formatResult(result);
      },
    });
    toolNames.push(tool.name);
  }
  return toolNames;
}
```

### 3. Mode Toggle (`mode-toggle.ts`)

Manages the `/pencil` command and active tool state.

**Responsibilities:**
- Register `/pencil` command
- Track mode state (on/off)
- On activate: connect MCP (if first time), add all Pencil tools to active tools via `setActiveTools()`, inject system prompt, show widget
- On deactivate: remove all Pencil tools from active tools, remove system prompt, remove widget
- Show current status when already in expected state

**Mode activation flow:**
```
/pencil (when off):
  1. If first activation: connect MCP, discover tools, register them
  2. Get current active tools: pi.getActiveTools()
  3. Add Pencil tools: pi.setActiveTools([...current, ...pencilToolNames])
  4. Inject system prompt header with Pencil's instructions (verbatim from MCP)
  5. Set status widget: "✏️ Pencil"
  6. Confirm: "Pencil mode active — 14 design tools loaded"

/pencil (when on):
  1. Get current active tools: pi.getActiveTools()
  2. Remove Pencil tools: pi.setActiveTools(current.filter(t => !pencilToolNames.includes(t)))
  3. Remove system prompt header
  4. Remove status widget
  5. Confirm: "Pencil mode deactivated"
```

**System prompt injection:**

When mode is active, inject Pencil's MCP server instructions as a system prompt header. This is the same text Claude Code receives, telling the LLM:
- Use `pencil_*` tools for all `.pen` file operations (never read/edit raw JSON)
- Start with `pencil_get_editor_state` to understand context
- Use `pencil_get_guidelines` for design-specific rules
- Use `pencil_get_screenshot` to validate designs visually
- Follow the `batch_design` operation syntax exactly

### 4. Connection Manager (`connection-manager.ts`)

Handles lifecycle and error states.

**Responsibilities:**
- Detect if Pencil binary exists on the system
- Attempt connection on `/pencil` activation
- Handle connection failure gracefully (clear error message)
- Detect MCP server process exit → update status, notify user
- Reconnect capability: `/pencil reconnect`
- Clean shutdown: kill MCP server process on pi exit

**Error states:**
| State | Message | Action |
|-------|---------|--------|
| Binary not found | "Pencil not installed. Install from pencil.dev" | No-op |
| Binary found, can't spawn | "Pencil MCP server failed to start: {error}" | Show error |
| Connected, then disconnected | "Pencil connection lost. Use /pencil reconnect" | Update widget |
| Tool call fails | "Pencil tool error: {error}" | Return error to LLM |

### 5. Status Widget (`widget.ts`)

Persistent indicator showing Pencil mode state.

**States:**
- Mode off: no widget (invisible)
- Mode on, connected: `✏️ Pencil` (green)
- Mode on, disconnected: `✏️ Pencil ⚠` (yellow)
- Mode on, error: `✏️ Pencil ✗` (red)

---

## Extension Entry Point (`index.ts`)

```typescript
import { ExtensionAPI } from '@anthropic-ai/pi-sdk';

export default async function(pi: ExtensionAPI) {
  const mcpClient = createMcpClient();
  const modeState = { active: false };
  const pencilToolNames: string[] = [];

  // Register /pencil command
  pi.registerCommand('pencil', {
    description: 'Toggle Pencil design mode on/off',
    args: [{ name: 'subcommand', optional: true }],
    execute: async (args) => {
      const sub = args?.subcommand;
      
      if (sub === 'reconnect') {
        await reconnect(pi, mcpClient);
        return;
      }

      if (sub === 'status') {
        showStatus(pi, mcpClient, modeState);
        return;
      }

      // Toggle mode
      if (modeState.active) {
        await deactivate(pi, mcpClient, modeState, pencilToolNames);
      } else {
        await activate(pi, mcpClient, modeState, pencilToolNames);
      }
    },
  });

  // Connection is deferred — no MCP connection until first /pencil
  // Tools are registered dynamically on first activation

  // Clean up on exit
  pi.on('shutdown', () => mcpClient.disconnect());
}
```

---

## `/pencil` Subcommands

| Command | Description |
|---------|-------------|
| `/pencil` | Toggle design mode on/off |
| `/pencil reconnect` | Reconnect to Pencil MCP server |
| `/pencil status` | Show connection info, active file, tool count |

---

## File Structure

```
pi-pencil/
├── index.ts              # Extension entry point
├── mcp-client.ts         # MCP SDK client wrapper (stdio transport)
├── tool-registrar.ts     # MCP tools → pi tools mapping
├── mode-toggle.ts        # /pencil command, setActiveTools logic
├── connection-manager.ts # Binary detection, lifecycle, reconnect
├── widget.ts             # Status widget rendering
├── types.ts              # Shared type definitions
├── package.json          # Dependencies: @modelcontextprotocol/sdk
├── tsconfig.json
├── docs/
│   └── plans/
│       ├── 2025-02-19-roadmap.md
│       └── 2025-02-19-phase1-design.md
└── README.md
```

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x"
  }
}
```

Pi extension API is provided by the pi runtime — no explicit dependency needed.

---

## Testing Strategy

### Unit Tests
- **Binary detection** — Mock filesystem, verify path resolution per platform
- **Tool name mapping** — MCP tool definitions → pi tool registrations
- **Mode toggle logic** — Active tool list manipulation (add/remove pencil tools)
- **System prompt construction** — Verify instructions injection content

### Integration Tests
- **MCP connection** — Connect to real Pencil MCP server, verify `initialize` handshake
- **Tool discovery** — Verify all 14 tools are discovered with correct schemas
- **Tool execution** — Call `get_editor_state`, verify response format
- **Reconnection** — Kill server process, verify reconnect flow

### Manual Testing
- **Full workflow** — `/pencil` on → design a component → `/pencil` off → verify tools removed
- **Error cases** — Start pi without Pencil installed, verify error message
- **Context cost** — Verify zero tool tokens when mode is off

---

## Implementation Plan

### Task 1: Project Setup
- Initialize npm project with TypeScript
- Add `@modelcontextprotocol/sdk` dependency
- Set up pi extension boilerplate (`index.ts` exporting default function)
- Configure tsconfig for pi extension compatibility

### Task 2: MCP Client
- Implement `mcp-client.ts` with `StdioClientTransport`
- Binary path detection (multi-platform)
- Also check `~/.claude.json` for Pencil's registered path as fallback
- Initialize connection, handle protocol handshake
- Implement `callTool()` method
- Handle process exit and errors

### Task 3: Tool Registrar
- Implement `tool-registrar.ts`
- Map MCP tool schemas to pi tool registrations
- Handle tool call forwarding (pi → MCP → response)
- Handle error responses from MCP tools

### Task 4: Mode Toggle + Command
- Implement `/pencil` command registration
- Mode state management (on/off)
- `setActiveTools()` integration — add/remove `pencil_*` tools
- System prompt injection via `setSystemPromptHeader()`
- Subcommands: `reconnect`, `status`

### Task 5: Status Widget
- Implement widget rendering with connection state
- Color-coded status indicator
- Update on connection state changes

### Task 6: Connection Manager
- Graceful error handling for all failure modes
- Reconnect logic
- Clean shutdown on pi exit
- All connection is deferred — first `/pencil` triggers connect + tool registration

### Task 7: Testing + Polish
- Unit tests for all modules
- Integration test with live Pencil MCP server
- Manual end-to-end testing
- README with install and usage instructions

---

## Design Decisions

1. **Deferred connection** — The MCP server is NOT connected on pi startup. Connection happens on first `/pencil` command. Zero overhead when Pencil isn't being used. A 1-2 second handshake delay on first activation is acceptable — show "Connecting to Pencil..." in the widget.

2. **No tool name prefix** — Tools keep their original MCP names (`batch_design`, not `pencil_batch_design`). Since tools are only in the active set during `/pencil` mode, collision risk is negligible. This lets us inject Pencil's MCP instructions verbatim without rewriting tool name references.

3. **Screenshot: save + pass through** — `get_screenshot` results are saved to a temp file AND the base64 data is passed through to the LLM (for vision model support). Tool result display shows `📸 Screenshot saved: /tmp/pencil-screenshot-{id}.png`. Phase 2 replaces the file path message with inline TUI image rendering.
