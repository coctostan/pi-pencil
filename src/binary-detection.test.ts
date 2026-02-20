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
