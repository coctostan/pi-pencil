# Phase 1: MVP — Claude Code Parity Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build a pi extension that connects to Pencil's local MCP server, registers all 14 design tools, and exposes them through a `/pencil` mode toggle — giving the LLM the same design capabilities as Claude Code.

**Architecture:** A pi extension with deferred MCP connection. On first `/pencil`, spawn the Pencil MCP server binary via stdio, discover tools via `listTools()`, register them as pi tools, inject system prompt, and activate them via `setActiveTools()`. On second `/pencil`, deactivate tools, remove system prompt, remove widget. Zero context cost when off.

**Tech Stack:** TypeScript (jiti-loaded, no build step), `@modelcontextprotocol/sdk` (MCP client + stdio transport), `zod` (peer dep), `vitest` (unit tests), pi Extension API (`registerTool`, `registerCommand`, `setActiveTools`, `before_agent_start`, `setWidget`, `setStatus`).

**Reference:** See `docs/plans/2025-02-19-phase1-design.md` for full architecture and design decisions.

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "pi-pencil",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

**Step 4: Create minimal src/index.ts**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Phase 1: Pencil MCP integration — wired up in Task 6
}
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

**Step 6: Run tests to verify setup**

Run: `npx vitest run`
Expected: "No test files found" or similar (no tests yet, but vitest runs without errors).

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: project setup with package.json, tsconfig, vitest"
```

---

### Task 2: Types + Binary Detection

**Files:**
- Create: `src/types.ts`
- Create: `src/binary-detection.ts`
- Create: `src/binary-detection.test.ts`

**Step 1: Write src/types.ts**

```typescript
/** Connection status for the Pencil MCP server */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Full connection state */
export interface PencilConnection {
  status: ConnectionStatus;
  serverInfo?: { name: string; version: string };
  toolNames?: string[];
  instructions?: string;
  error?: string;
}

/** Mode state for /pencil toggle */
export interface ModeState {
  active: boolean;
  toolNames: string[];
}
```

**Step 2: Write the failing test for binary detection**

Create `src/binary-detection.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPencilBinaryPath } from './binary-detection.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:fs');
vi.mock('node:os');

describe('getPencilBinaryPath', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    vi.mocked(os.arch).mockReturnValue('arm64');
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no binary is found', () => {
    expect(getPencilBinaryPath()).toBeNull();
  });

  it('finds macOS arm64 binary', () => {
    const expectedPath = '/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64';
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath);
    expect(getPencilBinaryPath()).toBe(expectedPath);
  });

  it('finds macOS x64 binary', () => {
    vi.mocked(os.arch).mockReturnValue('x64');
    const expectedPath = '/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-x64';
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath);
    expect(getPencilBinaryPath()).toBe(expectedPath);
  });

  it('finds Linux binary', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    const expectedPath = '/usr/lib/pencil/mcp-server-linux-x64';
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath);
    expect(getPencilBinaryPath()).toBe(expectedPath);
  });

  it('finds Windows binary via LOCALAPPDATA', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    const localAppData = 'C:\\Users\\Test\\AppData\\Local';
    vi.stubEnv('LOCALAPPDATA', localAppData);
    const expectedPath = path.join(localAppData, 'Pencil', 'mcp-server-win32-x64.exe');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath);
    expect(getPencilBinaryPath()).toBe(expectedPath);
  });

  it('falls back to Claude Code config', () => {
    const home = '/Users/test';
    vi.mocked(os.homedir).mockReturnValue(home);
    const claudeConfig = JSON.stringify({
      mcpServers: {
        pencil: {
          command: '/custom/path/to/mcp-server'
        }
      }
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => p === path.join(home, '.claude.json') || p === '/custom/path/to/mcp-server');
    vi.mocked(fs.readFileSync).mockReturnValue(claudeConfig);
    expect(getPencilBinaryPath()).toBe('/custom/path/to/mcp-server');
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run src/binary-detection.test.ts`
Expected: FAIL — module `./binary-detection.js` not found.

**Step 4: Write minimal implementation**

Create `src/binary-detection.ts`:

```typescript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Detect the Pencil MCP server binary path.
 * Checks platform-specific install locations, then falls back to Claude Code config.
 */
export function getPencilBinaryPath(): string | null {
  const platform = os.platform();
  const arch = os.arch();

  const candidates: string[] = [];

  if (platform === 'darwin') {
    candidates.push(
      `/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-${arch}`,
    );
    // Also check the other arch as fallback
    const otherArch = arch === 'arm64' ? 'x64' : 'arm64';
    candidates.push(
      `/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-${otherArch}`,
    );
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/lib/pencil/mcp-server-linux-x64',
      '/opt/Pencil/mcp-server-linux-x64',
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.PROGRAMFILES;
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Pencil', 'mcp-server-win32-x64.exe'));
    }
    if (programFiles) {
      candidates.push(path.join(programFiles, 'Pencil', 'mcp-server-win32-x64.exe'));
    }
  }

  // Check platform-specific paths first
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to Claude Code config (~/.claude.json)
  return getPencilPathFromClaudeConfig();
}

function getPencilPathFromClaudeConfig(): string | null {
  try {
    const configPath = path.join(os.homedir(), '.claude.json');
    if (!fs.existsSync(configPath)) return null;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const command = config?.mcpServers?.pencil?.command;
    if (typeof command === 'string' && fs.existsSync(command)) {
      return command;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/binary-detection.test.ts`
Expected: All 6 tests PASS.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: types and binary detection with tests"
```

---

### Task 3: MCP Client Wrapper

**Files:**
- Create: `src/mcp-client.ts`

This module wraps the MCP SDK Client for connecting to Pencil's stdio server. It's not unit-testable without a real Pencil binary, so we focus on clean code and test it in the integration task.

**Step 1: Write src/mcp-client.ts**

```typescript
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
    this.updateConnection({ status: 'disconnected', error: undefined, toolNames: undefined });
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors (or only errors from missing pi-coding-agent types, which is fine since jiti loads it at runtime).

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: MCP client wrapper with stdio transport"
```

---

### Task 4: Tool Registrar

**Files:**
- Create: `src/tool-registrar.ts`
- Create: `src/tool-registrar.test.ts`

**Step 1: Write the failing test**

Create `src/tool-registrar.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildPiToolDefinitions } from './tool-registrar.js';

describe('buildPiToolDefinitions', () => {
  it('maps MCP tools to pi tool definitions', () => {
    const mcpTools = [
      {
        name: 'batch_design',
        description: 'Insert, update, delete design elements',
        inputSchema: {
          type: 'object',
          properties: {
            operations: { type: 'array' },
          },
          required: ['operations'],
        },
      },
      {
        name: 'get_screenshot',
        description: 'Get a screenshot of a node',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
          },
        },
      },
    ];

    const callTool = vi.fn();
    const defs = buildPiToolDefinitions(mcpTools, callTool);

    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe('batch_design');
    expect(defs[0].description).toBe('Insert, update, delete design elements');
    expect(defs[1].name).toBe('get_screenshot');
  });

  it('execute calls through to MCP callTool', async () => {
    const mcpTools = [
      {
        name: 'get_editor_state',
        description: 'Get current editor state',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'editor state result' }],
    });

    const defs = buildPiToolDefinitions(mcpTools, callTool);
    const result = await defs[0].execute('tool-call-1', {}, undefined, undefined, {} as any);

    expect(callTool).toHaveBeenCalledWith('get_editor_state', {});
    expect(result.content).toEqual([{ type: 'text', text: 'editor state result' }]);
  });

  it('handles MCP tool errors', async () => {
    const mcpTools = [
      {
        name: 'batch_design',
        description: 'Design tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Something went wrong' }],
      isError: true,
    });

    const defs = buildPiToolDefinitions(mcpTools, callTool);
    const result = await defs[0].execute('tool-call-1', {}, undefined, undefined, {} as any);

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Something went wrong' }]);
  });

  it('handles image content in tool results', async () => {
    const mcpTools = [
      {
        name: 'get_screenshot',
        description: 'Get screenshot',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const callTool = vi.fn().mockResolvedValue({
      content: [
        { type: 'image', data: 'base64data...', mimeType: 'image/png' },
        { type: 'text', text: 'Screenshot taken' },
      ],
    });

    const defs = buildPiToolDefinitions(mcpTools, callTool);
    const result = await defs[0].execute('tool-call-1', {}, undefined, undefined, {} as any);

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('image');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tool-registrar.test.ts`
Expected: FAIL — module `./tool-registrar.js` not found.

**Step 3: Write implementation**

Create `src/tool-registrar.ts`:

```typescript
import type { PencilMcpClient } from './mcp-client.js';

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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tool-registrar.test.ts`
Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: tool registrar maps MCP tools to pi tools"
```

---

### Task 5: Mode Toggle (activate/deactivate logic)

**Files:**
- Create: `src/mode-toggle.ts`
- Create: `src/mode-toggle.test.ts`

**Step 1: Write the failing test**

Create `src/mode-toggle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activateTools, deactivateTools } from './mode-toggle.js';

describe('activateTools', () => {
  it('adds pencil tools to current active tools', () => {
    const currentTools = ['read', 'bash', 'edit', 'write'];
    const pencilTools = ['batch_design', 'get_screenshot', 'get_editor_state'];

    const result = activateTools(currentTools, pencilTools);

    expect(result).toEqual([
      'read', 'bash', 'edit', 'write',
      'batch_design', 'get_screenshot', 'get_editor_state',
    ]);
  });

  it('does not duplicate tools already in active set', () => {
    const currentTools = ['read', 'bash', 'batch_design'];
    const pencilTools = ['batch_design', 'get_screenshot'];

    const result = activateTools(currentTools, pencilTools);

    expect(result).toEqual(['read', 'bash', 'batch_design', 'get_screenshot']);
  });
});

describe('deactivateTools', () => {
  it('removes pencil tools from active tools', () => {
    const currentTools = [
      'read', 'bash', 'edit', 'write',
      'batch_design', 'get_screenshot', 'get_editor_state',
    ];
    const pencilTools = ['batch_design', 'get_screenshot', 'get_editor_state'];

    const result = deactivateTools(currentTools, pencilTools);

    expect(result).toEqual(['read', 'bash', 'edit', 'write']);
  });

  it('leaves non-pencil tools untouched', () => {
    const currentTools = ['read', 'bash', 'batch_design', 'custom_tool'];
    const pencilTools = ['batch_design', 'get_screenshot'];

    const result = deactivateTools(currentTools, pencilTools);

    expect(result).toEqual(['read', 'bash', 'custom_tool']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/mode-toggle.test.ts`
Expected: FAIL — module `./mode-toggle.js` not found.

**Step 3: Write implementation**

Create `src/mode-toggle.ts`:

```typescript
/**
 * Add pencil tools to the current active tool set.
 * Avoids duplicates.
 */
export function activateTools(currentTools: string[], pencilTools: string[]): string[] {
  const currentSet = new Set(currentTools);
  const result = [...currentTools];
  for (const tool of pencilTools) {
    if (!currentSet.has(tool)) {
      result.push(tool);
    }
  }
  return result;
}

/**
 * Remove pencil tools from the current active tool set.
 */
export function deactivateTools(currentTools: string[], pencilTools: string[]): string[] {
  const pencilSet = new Set(pencilTools);
  return currentTools.filter((t) => !pencilSet.has(t));
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/mode-toggle.test.ts`
Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: mode toggle activate/deactivate logic"
```

---

### Task 6: Extension Entry Point — Wire Everything Together

**Files:**
- Modify: `src/index.ts` (full rewrite)

This is the main integration task. It wires the MCP client, tool registrar, mode toggle, widget, and `/pencil` command into a single extension entry point.

**Step 1: Write the full src/index.ts**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PencilMcpClient } from './mcp-client.js';
import { buildPiToolDefinitions } from './tool-registrar.js';
import { activateTools, deactivateTools } from './mode-toggle.js';
import { getPencilBinaryPath } from './binary-detection.js';
import type { ModeState } from './types.js';

export default function pencilExtension(pi: ExtensionAPI) {
  const mcpClient = new PencilMcpClient({
    onStatusChange: (conn) => {
      updateWidget(pi, modeState, conn.status, conn.error);
    },
  });

  const modeState: ModeState = {
    active: false,
    toolNames: [],
  };

  // System prompt instructions from the MCP server
  let pencilInstructions: string | undefined;

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
        await handleReconnect(pi, mcpClient, modeState, ctx);
        return;
      }

      if (sub === 'status') {
        handleStatus(mcpClient, modeState, ctx);
        return;
      }

      // Toggle mode
      if (modeState.active) {
        await deactivate(pi, mcpClient, modeState, ctx);
      } else {
        pencilInstructions = await activate(pi, mcpClient, modeState, ctx);
      }
    },
  });

  // Clean shutdown
  pi.on('session_shutdown', async () => {
    await mcpClient.disconnect();
  });
}

// --- Activate ---

async function activate(
  pi: ExtensionAPI,
  mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
): Promise<string | undefined> {
  // Detect binary
  const binaryPath = getPencilBinaryPath();
  if (!binaryPath) {
    ctx.ui.notify('Pencil not installed. Install from pencil.dev', 'error');
    return undefined;
  }

  // Connect (if not already connected)
  if (mcpClient.connection.status !== 'connected') {
    ctx.ui.setStatus('pencil', 'Connecting to Pencil...');

    try {
      const { tools, instructions } = await mcpClient.connect(binaryPath);

      // Register tools with pi
      const piToolDefs = buildPiToolDefinitions(tools, (name, args) =>
        mcpClient.callTool(name, args),
      );
      for (const toolDef of piToolDefs) {
        pi.registerTool(toolDef as any);
      }

      modeState.toolNames = tools.map((t) => t.name);

      // Activate tools
      const currentTools = pi.getActiveTools();
      pi.setActiveTools(activateTools(currentTools, modeState.toolNames));

      modeState.active = true;
      updateWidget(pi, modeState, 'connected');
      ctx.ui.setStatus('pencil', undefined);
      ctx.ui.notify(
        `Pencil mode active — ${modeState.toolNames.length} design tools loaded`,
        'info',
      );

      return instructions;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.ui.setStatus('pencil', undefined);
      ctx.ui.notify(`Pencil MCP server failed to start: ${message}`, 'error');
      return undefined;
    }
  }

  // Already connected, just activate tools
  const currentTools = pi.getActiveTools();
  pi.setActiveTools(activateTools(currentTools, modeState.toolNames));
  modeState.active = true;
  updateWidget(pi, modeState, 'connected');
  ctx.ui.notify(
    `Pencil mode active — ${modeState.toolNames.length} design tools loaded`,
    'info',
  );
  return mcpClient.connection.instructions;
}

// --- Deactivate ---

async function deactivate(
  pi: ExtensionAPI,
  _mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
) {
  const currentTools = pi.getActiveTools();
  pi.setActiveTools(deactivateTools(currentTools, modeState.toolNames));
  modeState.active = false;

  // Remove widget
  ctx.ui.setWidget('pencil', undefined);
  ctx.ui.notify('Pencil mode deactivated', 'info');
}

// --- Reconnect ---

async function handleReconnect(
  pi: ExtensionAPI,
  mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
) {
  await mcpClient.disconnect();

  const binaryPath = getPencilBinaryPath();
  if (!binaryPath) {
    ctx.ui.notify('Pencil not installed. Install from pencil.dev', 'error');
    return;
  }

  ctx.ui.setStatus('pencil', 'Reconnecting to Pencil...');

  try {
    await mcpClient.connect(binaryPath);
    updateWidget(pi, modeState, 'connected');
    ctx.ui.setStatus('pencil', undefined);
    ctx.ui.notify('Pencil reconnected', 'info');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.setStatus('pencil', undefined);
    ctx.ui.notify(`Reconnect failed: ${message}`, 'error');
  }
}

// --- Status ---

function handleStatus(mcpClient: PencilMcpClient, modeState: ModeState, ctx: any) {
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

// --- Widget ---

function updateWidget(
  pi: ExtensionAPI,
  modeState: ModeState,
  status: string,
  error?: string,
) {
  if (!modeState.active) return;

  // We need a ctx to set widget — use pi.on events instead.
  // Widget is set via the pi events system, not directly here.
  // This is handled in the command handler via ctx.ui.setWidget.
}
```

Wait — widgets need `ctx.ui.setWidget`, but we may not have `ctx` in `onStatusChange`. Let me restructure: use `pi.on('session_start')` to capture ctx, and manage widget state through the command handler only. Let me rewrite more cleanly:

**Step 1 (revised): Write the full src/index.ts**

```typescript
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
        return handleReconnect(pi, mcpClient, modeState, ctx);
      }
      if (sub === 'status') {
        return handleStatus(mcpClient, modeState, ctx);
      }

      // Toggle
      if (modeState.active) {
        deactivatePencil(pi, modeState, ctx);
      } else {
        pencilInstructions = await activatePencil(pi, mcpClient, modeState, ctx);
      }
    },
  });

  // Clean shutdown
  pi.on('session_shutdown', async () => {
    await mcpClient.disconnect();
  });
}

async function activatePencil(
  pi: ExtensionAPI,
  mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
): Promise<string | undefined> {
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

      // Register tools with pi
      const piToolDefs = buildPiToolDefinitions(tools, (name, args) =>
        mcpClient.callTool(name, args),
      );
      for (const toolDef of piToolDefs) {
        pi.registerTool(toolDef as any);
      }
      modeState.toolNames = tools.map((t) => t.name);

      // Activate
      const currentTools = pi.getActiveTools();
      pi.setActiveTools(activateTools(currentTools, modeState.toolNames));
      modeState.active = true;

      ctx.ui.setWidget('pencil', ['✏️ Pencil']);
      ctx.ui.notify(`Pencil mode active — ${modeState.toolNames.length} design tools loaded`, 'info');
      return instructions;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.ui.setWidget('pencil', undefined);
      ctx.ui.notify(`Pencil MCP server failed to start: ${message}`, 'error');
      return undefined;
    }
  }

  // Already connected — just activate tools
  const currentTools = pi.getActiveTools();
  pi.setActiveTools(activateTools(currentTools, modeState.toolNames));
  modeState.active = true;
  ctx.ui.setWidget('pencil', ['✏️ Pencil']);
  ctx.ui.notify(`Pencil mode active — ${modeState.toolNames.length} design tools loaded`, 'info');
  return mcpClient.connection.instructions;
}

function deactivatePencil(
  pi: ExtensionAPI,
  modeState: ModeState,
  ctx: any,
) {
  const currentTools = pi.getActiveTools();
  pi.setActiveTools(deactivateTools(currentTools, modeState.toolNames));
  modeState.active = false;
  ctx.ui.setWidget('pencil', undefined);
  ctx.ui.notify('Pencil mode deactivated', 'info');
}

async function handleReconnect(
  pi: ExtensionAPI,
  mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
) {
  await mcpClient.disconnect();

  const binaryPath = getPencilBinaryPath();
  if (!binaryPath) {
    ctx.ui.notify('Pencil not installed. Install from pencil.dev', 'error');
    return;
  }

  ctx.ui.setWidget('pencil', ['⏳ Reconnecting...']);
  try {
    await mcpClient.connect(binaryPath);
    if (modeState.active) {
      ctx.ui.setWidget('pencil', ['✏️ Pencil']);
    }
    ctx.ui.notify('Pencil reconnected', 'info');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.setWidget('pencil', ['✏️ Pencil ✗']);
    ctx.ui.notify(`Reconnect failed: ${message}`, 'error');
  }
}

function handleStatus(mcpClient: PencilMcpClient, modeState: ModeState, ctx: any) {
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
```

**Step 2: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: All existing tests PASS (binary-detection, tool-registrar, mode-toggle).

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: extension entry point wiring all components together"
```

---

### Task 7: Manual Integration Testing + README

**Files:**
- Modify: `README.md` (full rewrite)

**Step 1: Write README.md**

```markdown
# pi-pencil

A [pi](https://github.com/badlogic/pi-mono) extension that integrates [Pencil](https://pencil.dev) — a local vector design tool — with pi via Pencil's MCP server.

## Install

```bash
cd ~/.pi/agent/extensions/
git clone <repo-url> pi-pencil
cd pi-pencil
npm install
```

Or add to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/pi-pencil/src/index.ts"]
}
```

## Requirements

- [Pencil](https://pencil.dev) installed (provides the MCP server binary)
- [pi](https://github.com/badlogic/pi-mono) coding agent

## Usage

### Toggle design mode

```
/pencil          — Toggle design mode on/off
/pencil status   — Show connection info and tool count
/pencil reconnect — Reconnect to Pencil MCP server
```

When active:
- 14 Pencil design tools are available to the LLM
- Pencil's system prompt instructions are injected
- A ✏️ widget shows in the TUI

When inactive:
- Zero context cost — no tools, no system prompt overhead

### Design tools

All 14 Pencil MCP tools are registered with their original names:

| Tool | Purpose |
|------|---------|
| `batch_design` | Insert/copy/update/replace/move/delete/image operations |
| `batch_get` | Read nodes by pattern or ID |
| `find_empty_space_on_canvas` | Find placement locations |
| `get_editor_state` | Current file, selection, context |
| `get_guidelines` | Design rules for specific topics |
| `get_screenshot` | Render visual preview |
| `get_style_guide` | Style inspiration |
| `get_style_guide_tags` | Available style guide tags |
| `get_variables` | Design tokens/themes |
| `open_document` | Open or create `.pen` files |
| `replace_all_matching_properties` | Bulk property replacement |
| `search_all_unique_properties` | Find unique properties |
| `set_variables` | Create/update design tokens |
| `snapshot_layout` | Analyze layout, detect problems |
```

**Step 2: Integration test checklist (manual)**

Test with Pencil installed:

1. Start pi with the extension: `pi -e ./src/index.ts`
2. Type `/pencil` → should see "Connecting to Pencil..." then "Pencil mode active — 14 design tools loaded"
3. Check widget shows "✏️ Pencil"
4. Ask the LLM to use `get_editor_state` → should return current Pencil state
5. Type `/pencil` → should see "Pencil mode deactivated", widget disappears
6. Type `/pencil status` → should show connection info
7. Type `/pencil reconnect` → should reconnect

Test without Pencil installed:

1. Start pi with the extension
2. Type `/pencil` → should see "Pencil not installed. Install from pencil.dev"

**Step 3: Run all unit tests one final time**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add -A
git commit -m "docs: README with install and usage instructions"
```

---

## Summary

| Task | Description | Files | Tests |
|------|-------------|-------|-------|
| 1 | Project setup | package.json, tsconfig, vitest.config, src/index.ts | Setup only |
| 2 | Types + binary detection | src/types.ts, src/binary-detection.ts | 6 unit tests |
| 3 | MCP client wrapper | src/mcp-client.ts | Type-check only |
| 4 | Tool registrar | src/tool-registrar.ts | 4 unit tests |
| 5 | Mode toggle logic | src/mode-toggle.ts | 4 unit tests |
| 6 | Entry point wiring | src/index.ts (full) | Existing tests pass |
| 7 | README + integration test | README.md | Manual integration |

**Final file structure:**
```
pi-pencil/
├── src/
│   ├── index.ts              # Extension entry point
│   ├── mcp-client.ts         # MCP SDK client wrapper
│   ├── tool-registrar.ts     # MCP → pi tool mapping
│   ├── tool-registrar.test.ts
│   ├── mode-toggle.ts        # activate/deactivate tool lists
│   ├── mode-toggle.test.ts
│   ├── binary-detection.ts   # Platform binary detection
│   ├── binary-detection.test.ts
│   └── types.ts              # Shared types
├── docs/
│   └── plans/
│       ├── 2025-02-19-roadmap.md
│       ├── 2025-02-19-phase1-design.md
│       └── 2025-02-19-phase1-implementation.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```
