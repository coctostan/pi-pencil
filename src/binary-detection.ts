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
