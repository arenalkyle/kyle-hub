# macOS terminals are supported

Supersedes [ADR-0009](0009-windows-only.md) for the terminal module. Windows 10 stays the primary, fully tested platform.

On macOS and Linux the terminal offers the login shell (`$SHELL`), then zsh and bash, all started as login shells (`-l`) so Homebrew, nvm and `claude` are on PATH (apps launched from the Dock get a minimal PATH). Node for the helper falls back to the usual install locations. `npm run deploy` also copies the darwin node-pty prebuilds, so a vault deployed from Windows works on a Mac; the helper restores `spawn-helper`'s execute bit, which copying or syncing drops. Log data lives in `~/Library/Application Support/kyle-hub/` unless `LOCALAPPDATA` is set.

Still Windows-only: `kh schedule` (schtasks) and the CDP smoke scripts. macOS paths are unit-tested only.
