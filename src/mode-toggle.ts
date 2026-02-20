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
