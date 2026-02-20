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
