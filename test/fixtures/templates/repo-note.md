---
doctype: overview
audience: agent
reviewed: 2026-11-20
---
# kyle-hub

## Summary

Obsidian plugin for tickets, terminals, logs, retros and brain notes.

## Run

- `npm run build`: typecheck and bundle `main.js`.
- `npm test`: vitest.
- `npm run lint`: ESLint, enforces the module rules.
- `npm run deploy`: build and copy into the vault plugin folder.

## Layout

- `src/core/`: services, event bus, settings, domain model.
- `src/modules/`: one folder per module.
- `docs/`: plan, phases and ADRs.

## Rules

- Modules import only core.
- Windows 10 only, desktop only.

## More

- Read `CLAUDE.md` for the full agent guide and `GLOSSARY.md` for terms.
