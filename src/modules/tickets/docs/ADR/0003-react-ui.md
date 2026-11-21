# ADR-0003: React 18 for the UI

**Status:** Accepted · 2026-11-21

## Context

The UI has heavy local state: popover pickers, Display/Filter popovers, drag-and-drop boards, inline editing, live updates from file changes. Implementation is done by Sonnet sub-agents, one sub-phase each.

## Decision

Use React 18 + TypeScript, bundled by esbuild, with `@dnd-kit` for drag-and-drop and CodeMirror 6 for the description editor. Style with plain CSS in `styles.css` using Obsidian CSS variables (no CSS framework). Each view mounts a React root in `onOpen` and unmounts it in `onClose`.

## Consequences

- Mature ecosystem and reliable agent output; larger bundle than Svelte/vanilla (acceptable for desktop).
- `src/core/` stays framework-free so the `kt` CLI can reuse it.
