# ADR-0003: Use node-pty's bundled ConPTY

- Status: Accepted
- Date: 2026-11-22

## Context

Windows 10's in-box ConPTY (19045) swallows the alternate-screen switch and repaints its viewport on every resize. xterm therefore treated Claude Code's full-screen UI as scrollback and reflowed it: each split left another banner behind, and shell history lost or duplicated lines.

Rejected, all working on the symptom: debouncing the pty resize, clearing the screen before resize, sending Ctrl+L afterwards (all three shipped and were reverted), and xterm's `windowsPty` option (still duplicates on height changes and truncates history when narrowing).

## Decision

Pin `@lydell/node-pty` 1.2.0-beta.18 (the first line we use that ships Microsoft's `conpty.dll` and `OpenConsole.exe`; 1.1.0 does not) and spawn with `useConptyDll: true`.

## Consequences

- xterm sees the real alternate screen, so resizing can't push TUI frames into scrollback.
- ConPTY queries the terminal at startup and waits up to 3 s for the answer. Anything driving the helper without xterm must answer `ESC[c` with `ESC[?1;2c`.
- Those answers and focus reports arrive as input; `SessionManager` doesn't count them as typing.
- Mouse-capture requests now reach xterm. `keepMouseLocal` ignores them to keep drag-select and right-click paste; the wheel does nothing in the alternate screen (use PgUp/PgDn in Claude).
- Saved scrollback flattens the alternate screen (`serializeFlat`).
- It is a beta dependency: before upgrading, repeat the tiling check in `docs/MANUAL-CHECKS.md`.
