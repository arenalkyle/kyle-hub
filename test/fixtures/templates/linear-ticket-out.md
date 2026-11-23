---
doctype: ticket
audience: agent
reviewed: 2026-11-20
---
# Add kh doctor check for stale hooks

Agents lose hook events when the installed hook script is older than the plugin. `kh doctor` should say so and print the fix.

## Acceptance

- [ ] `kh doctor` warns when the installed `hooks/kyle-hook.js` differs from the shipped one.
- [ ] The warning prints `npm run deploy` as the fix.
- [ ] No warning when the files match.
- [ ] Build, test and lint pass.

+++ Agent notes

- Check lives next to the other checks in the `kh doctor` command.
- Compare file contents, not timestamps.
- `hooks/kyle-hook.js` must never block or fail Claude Code. Doctor only reads it.
- Tests override `LOCALAPPDATA` and `USERPROFILE`.

+++
