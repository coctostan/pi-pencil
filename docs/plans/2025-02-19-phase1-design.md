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

**Tool name mapping:**
```
MCP tool name          → pi tool name
batch_design           → pencil_batch_design
batch_get              → pencil_batch_get
get_screenshot         → pencil_get_screenshot
snapshot_layout        → pencil_snapshot_layout
get_editor_state       → pencil_get_editor_state
open_document          → pencil_open_document
get_guidelines         → pencil_get_guidelines
get_style_guide_tags   → pencil_get_style_guide_tags
get_style_guide        → pencil_get_style_guide
get_variables          → pencil_get_variables
set_variables          → pencil_set_variables
find_empty_space       → pencil_find_empty_space_on_canvas
search_all_unique_*    → pencil_search_all_unique_properties
replace_all_matching_* → pencil_replace_all_matching_properties
```

**Tool registration pattern:**
```typescript
function registerPencilTools(pi: ExtensionAPI, tools: McpTool[], client: McpClient) {
  for (const tool of tools) {
    const piToolName = `pencil_${tool.name}`;
    pi.registerTool(piToolName, {
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async (params) => {
        const result = await client.callTool(tool.name, params);
        return formatResult(result);
      },
    });
  }
}
```

### 3. Mode Toggle (`mode-toggle.ts`)

Manages the `/pencil` command and active tool state.

**Responsibilities:**
- Register `/pencil` command
- Track mode state (on/off)
- On activate: add all `pencil_*` tools to active tools via `setActiveTools()`, inject system prompt, show widget
- On deactivate: remove all `pencil_*` tools from active tools, remove system prompt, remove widget
- Show current status when already in expected state

**Mode activation flow:**
```
/pencil (when off):
  1. Check MCP connection → connect if needed
  2. Get current active tools: pi.getActiveTools()
  3. Add pencil tools: pi.setActiveTools([...current, ...pencilTools])
  4. Inject system prompt header with Pencil instructions
  5. Set status widget: "✏️ Pencil"
  6. Confirm: "Pencil mode active — 14 design tools loaded"

/pencil (when on):
  1. Get current active tools: pi.getActiveTools()
  2. Remove pencil tools: pi.setActiveTools(current.filter(not pencil))
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

  // Register tools eagerly (so they're ready when mode activates)
  // but don't add them to active tools yet
  try {
    const connection = await mcpClient.connect();
    if (connection.tools) {
      registerPencilTools(pi, connection.tools, mcpClient);
      pencilToolNames.push(...connection.tools.map(t => `pencil_${t.name}`));
    }
  } catch {
    // Pencil not available — tools will be registered on first /pencil
  }

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
- Deferred connection (connect on first `/pencil`, not on extension load)

### Task 7: Testing + Polish
- Unit tests for all modules
- Integration test with live Pencil MCP server
- Manual end-to-end testing
- README with install and usage instructions

---

## Open Questions

1. **Eager vs deferred connection** — Should we connect to the MCP server when the extension loads (to pre-cache tool schemas), or wait until the user types `/pencil`? Current design: attempt eager connection, fall back to deferred if Pencil isn't available.

2. **Tool name prefix** — `pencil_batch_design` vs `batch_design`. Prefix avoids collisions but the LLM sees longer names. Pencil's own instructions reference unprefixed names. We may need to rewrite the instructions to use prefixed names, or skip the prefix entirely since tools are only active in Pencil mode.

3. **Instructions rewriting** — Pencil's injected instructions reference tool names like `batch_design`. If we prefix tools, we need to rewrite these references. Alternatively, keep original names (no prefix) since they're only active in Pencil mode and won't collide.

4. **Screenshot rendering** — Phase 1 returns screenshots as base64 in tool results (same as Claude Code). Phase 2 will render them inline. Should Phase 1 do any special handling?
