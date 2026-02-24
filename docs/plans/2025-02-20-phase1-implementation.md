# Phase 1: MVP — Claude Code Parity Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build a pi extension that connects to Pencil's local MCP server, registers all 14 design tools, and exposes them through a `/pencil` mode toggle — giving the LLM the same design capabilities as Claude Code.

**Architecture:** A pi extension with deferred MCP connection. On first `/pencil`, spawn the Pencil MCP server binary via stdio, discover tools via `listTools()`, register them as pi tools, inject system prompt, and activate them via `setActiveTools()`. On second `/pencil`, deactivate tools, remove system prompt, remove widget. Zero context cost when off.

**Tech Stack:** TypeScript (jiti-loaded, no build step), `@modelcontextprotocol/sdk` (MCP client + stdio transport), `vitest` (unit tests), pi Extension API (`registerTool`, `registerCommand`, `setActiveTools`, `before_agent_start`, `setWidget`, `setStatus`).

**Reference:** See `docs/plans/2025-02-19-phase1-design.md` for full architecture and design decisions.

---

## Task 1: Project Setup

**TDD scenario:** Trivial change — use judgment

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
    "@modelcontextprotocol/sdk": "^1.12.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^3.0.0"
  }
}
```

Note: `zod` is a peer dep of `@modelcontextprotocol/sdk` — npm will install it automatically. No need to list it explicitly.

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

export default function pencilExtension(pi: ExtensionAPI) {
  // Phase 1: Pencil MCP integration — wired up in Task 6
}
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

**Step 6: Run tests to verify setup**

Run: `npx vitest run`
Expected: "No test files found" or exits cleanly (no tests yet).

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: project setup with package.json, tsconfig, vitest"
```

---

## Task 2: Types + Binary Detection

**TDD scenario:** New feature — full TDD cycle

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

  it('falls back to Claude Code config (~/.claude.json)', () => {
    const home = '/Users/test';
    vi.mocked(os.homedir).mockReturnValue(home);
    const claudeConfig = JSON.stringify({
      mcpServers: {
        pencil: {
          command: '/custom/path/to/mcp-server'
        }
      }
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === path.join(home, '.claude.json') || p === '/custom/path/to/mcp-server'
    );
    vi.mocked(fs.readFileSync).mockReturnValue(claudeConfig);
    expect(getPencilBinaryPath()).toBe('/custom/path/to/mcp-server');
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run src/binary-detection.test.ts`
Expected: FAIL — module `./binary-detection.js` not found.

**Step 4: Write implementation**

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

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

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

## Task 3: MCP Client Wrapper

**TDD scenario:** Modifying tested code — this wraps a third-party SDK, not unit-testable without a real Pencil binary. Focus on clean code; integration tested manually in Task 7.

**Files:**
- Create: `src/mcp-client.ts`

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

      // Detect disconnection
      this.transport.onclose = () => {
        if (this._connection.status === 'connected') {
          this.updateConnection({ status: 'error', error: 'Pencil connection lost' });
        }
      };

      await this.client.connect(this.transport);

      const serverInfo = this.client.getServerVersion();
      const instructions = this.client.getInstructions();
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

**Step 2: Verify it compiles (type-check only)**

Run: `npx vitest run`
Expected: Existing tests still pass. No new tests needed for this module.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: MCP client wrapper with stdio transport"
```

---

## Task 4: Tool Registrar

**TDD scenario:** New feature — full TDD cycle

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
          type: 'object' as const,
          properties: { operations: { type: 'array' } },
          required: ['operations'],
        },
      },
      {
        name: 'get_screenshot',
        description: 'Get a screenshot of a node',
        inputSchema: {
          type: 'object' as const,
          properties: { nodeId: { type: 'string' } },
        },
      },
    ];

    const callTool = vi.fn();
    const defs = buildPiToolDefinitions(mcpTools, callTool);

    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe('batch_design');
    expect(defs[0].label).toBe('batch_design');
    expect(defs[0].description).toBe('Insert, update, delete design elements');
    expect(defs[0].parameters).toEqual(mcpTools[0].inputSchema);
    expect(defs[1].name).toBe('get_screenshot');
  });

  it('execute calls through to MCP callTool', async () => {
    const mcpTools = [
      {
        name: 'get_editor_state',
        description: 'Get current editor state',
        inputSchema: { type: 'object' as const, properties: {} },
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

  it('passes isError through from MCP tool errors', async () => {
    const mcpTools = [
      {
        name: 'batch_design',
        description: 'Design tool',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];

    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Something went wrong' }],
      isError: true,
    });

    const defs = buildPiToolDefinitions(mcpTools, callTool);
    const result = await defs[0].execute('tool-call-1', {}, undefined, undefined, {} as any);

    expect(result.isError).toBe(true);
  });

  it('handles callTool throwing an error', async () => {
    const mcpTools = [
      {
        name: 'batch_design',
        description: 'Design tool',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];

    const callTool = vi.fn().mockRejectedValue(new Error('Connection lost'));

    const defs = buildPiToolDefinitions(mcpTools, callTool);
    const result = await defs[0].execute('tool-call-1', {}, undefined, undefined, {} as any);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Pencil tool error: Connection lost' });
  });

  it('uses empty string for missing description', () => {
    const mcpTools = [
      {
        name: 'some_tool',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];

    const callTool = vi.fn();
    const defs = buildPiToolDefinitions(mcpTools, callTool);

    expect(defs[0].description).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tool-registrar.test.ts`
Expected: FAIL — module `./tool-registrar.js` not found.

**Step 3: Write implementation**

Create `src/tool-registrar.ts`:

```typescript
interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type CallToolFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; [key: string]: unknown }>; isError?: boolean }>;

export interface PiToolDef {
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
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      try {
        const result = await callTool(tool.name, params);
        return {
          content: result.content,
          isError: result.isError ?? false,
          details: {},
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Pencil tool error: ${message}` }],
          isError: true,
          details: {},
        };
      }
    },
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tool-registrar.test.ts`
Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: tool registrar maps MCP tools to pi tools"
```

---

## Task 5: Mode Toggle (activate/deactivate logic)

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `src/mode-toggle.ts`
- Create: `src/mode-toggle.test.ts`

**Step 1: Write the failing test**

Create `src/mode-toggle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { activateTools, deactivateTools } from './mode-toggle.js';

describe('activateTools', () => {
  it('adds pencil tools to current active tools', () => {
    const current = ['read', 'bash', 'edit', 'write'];
    const pencil = ['batch_design', 'get_screenshot', 'get_editor_state'];

    const result = activateTools(current, pencil);

    expect(result).toEqual([
      'read', 'bash', 'edit', 'write',
      'batch_design', 'get_screenshot', 'get_editor_state',
    ]);
  });

  it('does not duplicate tools already in active set', () => {
    const current = ['read', 'bash', 'batch_design'];
    const pencil = ['batch_design', 'get_screenshot'];

    const result = activateTools(current, pencil);

    expect(result).toEqual(['read', 'bash', 'batch_design', 'get_screenshot']);
  });

  it('returns only pencil tools when current is empty', () => {
    const result = activateTools([], ['batch_design']);
    expect(result).toEqual(['batch_design']);
  });
});

describe('deactivateTools', () => {
  it('removes pencil tools from active tools', () => {
    const current = [
      'read', 'bash', 'edit', 'write',
      'batch_design', 'get_screenshot', 'get_editor_state',
    ];
    const pencil = ['batch_design', 'get_screenshot', 'get_editor_state'];

    const result = deactivateTools(current, pencil);

    expect(result).toEqual(['read', 'bash', 'edit', 'write']);
  });

  it('leaves non-pencil tools untouched', () => {
    const current = ['read', 'bash', 'batch_design', 'custom_tool'];
    const pencil = ['batch_design', 'get_screenshot'];

    const result = deactivateTools(current, pencil);

    expect(result).toEqual(['read', 'bash', 'custom_tool']);
  });

  it('handles case where pencil tools are not in current set', () => {
    const current = ['read', 'bash'];
    const pencil = ['batch_design'];

    const result = deactivateTools(current, pencil);

    expect(result).toEqual(['read', 'bash']);
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
Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: mode toggle activate/deactivate logic"
```

---

## Task 6: Extension Entry Point — Wire Everything Together

**TDD scenario:** Modifying tested code — run existing tests first. This task is integration wiring. The individual components are tested; the entry point is tested manually in Task 7.

**Files:**
- Modify: `src/index.ts` (full rewrite)

**Important pi Extension API notes (read before implementing):**
- `pi.registerTool(def)` — takes `{ name, label, description, parameters, execute }`. `parameters` accepts raw JSON Schema objects (same as TypeBox output). The `execute` signature is `(toolCallId, params, signal, onUpdate, ctx)`.
- `pi.registerCommand(name, { description, handler })` — `handler` is `async (args: string, ctx: ExtensionCommandContext) => void`. `args` is a raw string (the text after `/pencil `), not an object.
- `pi.on('before_agent_start', handler)` — return `{ systemPrompt: string }` to replace the system prompt for this turn.
- `pi.on('session_shutdown', handler)` — fired on exit.
- `ctx.ui.setWidget(id, lines | undefined)` — `lines` is `string[]`. Pass `undefined` to clear.
- `ctx.ui.setStatus(id, text | undefined)` — footer status. Pass `undefined` to clear.
- `ctx.ui.notify(message, level)` — `level` is `"info" | "warning" | "error"`.
- `pi.getActiveTools()` returns `string[]`, `pi.setActiveTools(names)` takes `string[]`.

**Step 1: Run existing tests to verify they pass**

Run: `npx vitest run`
Expected: All tests from Tasks 2, 4, 5 pass.

**Step 2: Write the full src/index.ts**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PencilMcpClient } from './mcp-client.js';
import { buildPiToolDefinitions } from './tool-registrar.js';
import { activateTools, deactivateTools } from './mode-toggle.js';
import { getPencilBinaryPath } from './binary-detection.js';
import type { ModeState } from './types.js';

export default function pencilExtension(pi: ExtensionAPI) {
  const mcpClient = new PencilMcpClient();
  const modeState: ModeState = { active: false, toolNames: [] };
  let pencilInstructions: string | undefined;

  // Inject system prompt when pencil mode is active
  pi.on('before_agent_start', async (event) => {
    if (modeState.active && pencilInstructions) {
      return {
        systemPrompt: event.systemPrompt + '\n\n' + pencilInstructions,
      };
    }
  });

  // Register /pencil command
  pi.registerCommand('pencil', {
    description: 'Toggle Pencil design mode on/off. Subcommands: status, reconnect',
    handler: async (args, ctx) => {
      const sub = args?.trim();

      if (sub === 'status') {
        return handleStatus(mcpClient, modeState, ctx);
      }

      if (sub === 'reconnect') {
        return handleReconnect(mcpClient, modeState, ctx);
      }

      // Toggle
      if (modeState.active) {
        deactivatePencil(pi, modeState, ctx);
      } else {
        await activatePencil(pi, mcpClient, modeState, ctx, (instr) => {
          pencilInstructions = instr;
        });
      }
    },
  });

  // Clean shutdown — kill MCP server process
  pi.on('session_shutdown', async () => {
    await mcpClient.disconnect();
  });
}

async function activatePencil(
  pi: ExtensionAPI,
  mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
  setInstructions: (instr: string | undefined) => void,
) {
  const binaryPath = getPencilBinaryPath();
  if (!binaryPath) {
    ctx.ui.notify('Pencil not installed. Install from https://pencil.dev', 'error');
    return;
  }

  // Connect if not already connected
  if (mcpClient.connection.status !== 'connected') {
    ctx.ui.setWidget('pencil', ['⏳ Connecting to Pencil...']);

    try {
      const { tools, instructions } = await mcpClient.connect(binaryPath);
      setInstructions(instructions);

      // Register each MCP tool as a pi tool
      const piToolDefs = buildPiToolDefinitions(tools, (name, args) =>
        mcpClient.callTool(name, args),
      );
      for (const toolDef of piToolDefs) {
        pi.registerTool(toolDef as any);
      }
      modeState.toolNames = tools.map((t) => t.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.ui.setWidget('pencil', undefined);
      ctx.ui.notify(`Pencil MCP server failed to start: ${message}`, 'error');
      return;
    }
  }

  // Activate tools
  const currentTools = pi.getActiveTools();
  pi.setActiveTools(activateTools(currentTools, modeState.toolNames));
  modeState.active = true;

  ctx.ui.setWidget('pencil', ['✏️ Pencil']);
  ctx.ui.notify(
    `Pencil mode active — ${modeState.toolNames.length} design tools loaded`,
    'info',
  );
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
  mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
) {
  await mcpClient.disconnect();

  const binaryPath = getPencilBinaryPath();
  if (!binaryPath) {
    ctx.ui.notify('Pencil not installed. Install from https://pencil.dev', 'error');
    return;
  }

  ctx.ui.setWidget('pencil', ['⏳ Reconnecting to Pencil...']);
  try {
    await mcpClient.connect(binaryPath);
    if (modeState.active) {
      ctx.ui.setWidget('pencil', ['✏️ Pencil']);
    } else {
      ctx.ui.setWidget('pencil', undefined);
    }
    ctx.ui.notify('Pencil reconnected', 'info');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (modeState.active) {
      ctx.ui.setWidget('pencil', ['✏️ Pencil ✗']);
    } else {
      ctx.ui.setWidget('pencil', undefined);
    }
    ctx.ui.notify(`Reconnect failed: ${message}`, 'error');
  }
}

function handleStatus(
  mcpClient: PencilMcpClient,
  modeState: ModeState,
  ctx: any,
) {
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

**Step 3: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: All existing tests PASS (binary-detection: 6, tool-registrar: 5, mode-toggle: 6).

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: extension entry point wiring all components"
```

---

## Task 7: README + Manual Integration Testing

**TDD scenario:** Trivial change — use judgment

**Files:**
- Create: `README.md`

**Step 1: Write README.md**

````markdown
# pi-pencil

A [pi](https://github.com/badlogic/pi-mono) extension that integrates [Pencil](https://pencil.dev) — a local vector design tool — with pi via Pencil's MCP server.

Gives the LLM the same design capabilities as Claude Code's Pencil integration, with a clean on/off toggle.

## Requirements

- [pi](https://github.com/badlogic/pi-mono) coding agent
- [Pencil](https://pencil.dev) installed (provides the MCP server binary)

## Install

**Option A: Clone into extensions directory**

```bash
cd ~/.pi/agent/extensions/
git clone <repo-url> pi-pencil
cd pi-pencil
npm install
```

**Option B: Add path to settings.json**

```json
{
  "extensions": ["/path/to/pi-pencil/src/index.ts"]
}
```

**Option C: Quick test**

```bash
pi -e /path/to/pi-pencil/src/index.ts
```

## Usage

### Toggle design mode

```
/pencil            Toggle design mode on/off
/pencil status     Show connection info and tool count
/pencil reconnect  Reconnect to Pencil MCP server
```

When **active**:
- All 14 Pencil design tools are available to the LLM
- Pencil's system prompt instructions are injected (same as Claude Code)
- A ✏️ widget shows in the TUI

When **inactive**:
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

## How it works

1. On `/pencil`, the extension spawns the Pencil MCP server binary as a child process (stdio transport)
2. It performs the MCP protocol handshake (`initialize` → `notifications/initialized`)
3. It discovers all 14 tools via `tools/list` and registers them as pi tools
4. It injects Pencil's system prompt instructions (verbatim from the MCP server)
5. It adds all tools to the active set via `setActiveTools()`
6. On second `/pencil`, tools are removed from active set and system prompt is restored

Connection is deferred — the MCP server is NOT started on pi launch. First `/pencil` triggers the ~1 second connection.

## Development

```bash
npm install
npm test           # Run unit tests
npm run test:watch # Watch mode
```

## License

MIT
````

**Step 2: Manual integration test checklist**

Test with Pencil installed:

1. Start pi: `pi -e ./src/index.ts`
2. Type `/pencil` → expect "Connecting..." widget then "Pencil mode active — 14 design tools loaded"
3. Check widget shows "✏️ Pencil"
4. Ask the LLM to call `get_editor_state` → expect valid response
5. Type `/pencil` → expect "Pencil mode deactivated", widget disappears
6. Type `/pencil status` → expect connection info
7. Type `/pencil reconnect` → expect reconnect

Test without Pencil installed:

1. Temporarily rename the binary, start pi
2. Type `/pencil` → expect "Pencil not installed. Install from https://pencil.dev"

**Step 3: Run all unit tests one final time**

Run: `npx vitest run`
Expected: All 17 tests PASS.

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
| 4 | Tool registrar | src/tool-registrar.ts | 5 unit tests |
| 5 | Mode toggle logic | src/mode-toggle.ts | 6 unit tests |
| 6 | Entry point wiring | src/index.ts (full) | Existing tests pass |
| 7 | README + integration test | README.md | Manual integration |

**Final file structure:**
```
pi-pencil/
├── src/
│   ├── index.ts                # Extension entry point
│   ├── mcp-client.ts           # MCP SDK client wrapper
│   ├── tool-registrar.ts       # MCP → pi tool mapping
│   ├── tool-registrar.test.ts
│   ├── mode-toggle.ts          # activate/deactivate tool lists
│   ├── mode-toggle.test.ts
│   ├── binary-detection.ts     # Platform binary detection
│   ├── binary-detection.test.ts
│   └── types.ts                # Shared types
├── docs/plans/                 # Design docs and plans
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```
