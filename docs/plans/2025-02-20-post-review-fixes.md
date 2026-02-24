📌 Current branch: `feat/phase1-mvp`
# Post-Review Fixes Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Fix the error-recovery gaps and minor issues surfaced by the final code review of the Phase 1 MVP.

**Architecture:** Surgical fixes to existing modules — no new files, no architecture changes.

**Tech Stack:** TypeScript, vitest.

---

### Task 1: Reconnect failure deactivates mode when active

When `/pencil reconnect` fails while mode is active, tools remain in the active set but the MCP connection is dead — every tool call throws `Not connected`. Fix: on reconnect failure, if mode was active, deactivate it.

**Files:**
- Modify: `src/index.ts` (the `handleReconnect` catch block, ~line 145)

**Step 1: Read the current handleReconnect catch block**

Current code in `handleReconnect`:
```typescript
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.ui.setWidget('pencil', ['✏️ Pencil ✗']);
      ctx.ui.notify(`Reconnect failed: ${message}`, 'error');
      return undefined;
    }
```

**Step 2: Fix — deactivate mode if it was active when reconnect fails**

Replace the catch block with:
```typescript
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
```

This ensures:
- Active mode → fully deactivated (tools removed, widget cleared, `modeState.active = false`)
- Inactive mode → widget cleared (it was set to "⏳ Reconnecting...")

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All 14 tests PASS (no behavior change in tested code).

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: deactivate pencil mode on reconnect failure"
```

---

### Task 2: Clean up failed connect in MCP client

When `connect()` fails partway (e.g. transport spawns but `listTools()` throws), the partially-initialized `client` and `transport` are not cleaned up. Fix: null them out in the catch block.

**Files:**
- Modify: `src/mcp-client.ts` (the `connect` catch block, ~line 73)

**Step 1: Read the current catch block**

Current code:
```typescript
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateConnection({ status: 'error', error: `Failed to connect: ${message}` });
      throw err;
    }
```

**Step 2: Fix — clean up partial state before rethrowing**

Replace with:
```typescript
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
```

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All 14 tests PASS.

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: clean up partial state on failed MCP connect"
```

---

### Task 3: Clear stale state on disconnect

`disconnect()` clears `toolNames` and `error` but leaves `serverInfo` and `instructions` from the previous connection. Fix: clear all fields.

**Files:**
- Modify: `src/mcp-client.ts` (`disconnect` method, ~line 105)

**Step 1: Read current disconnect**

Current:
```typescript
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
```

**Step 2: Fix — also clear serverInfo and instructions**

Replace with:
```typescript
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
```

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All 14 tests PASS.

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: clear all stale state on MCP disconnect"
```

---

## Summary

| Task | Description | Risk |
|------|-------------|------|
| 1 | Deactivate mode on reconnect failure | Prevents dead tool calls |
| 2 | Clean up partial connect state | Prevents resource leaks |
| 3 | Clear stale state on disconnect | Prevents stale status display |
