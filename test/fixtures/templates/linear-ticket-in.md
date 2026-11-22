---
doctype: ticket
audience: agent
source: linear
reviewed: 2026-11-20
---
# Add kh doctor check for stale hooks

Linear: LOCK-120. In Progress, assigned to the agent.

## Summary

Agents lose hook events when the installed hook script is older than the plugin. `kh doctor` should warn and print the fix.

## Acceptance

- [ ] `kh doctor` warns when the installed hook differs from the shipped one.
- [ ] The warning prints `npm run deploy` as the fix.
- [ ] No warning when the files match.

## Agent notes

- Compare file contents, not timestamps.
- Doctor only reads the hook, never writes it.
