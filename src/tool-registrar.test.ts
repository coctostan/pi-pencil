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
