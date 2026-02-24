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
