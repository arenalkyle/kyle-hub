# Vaults in WSL2: portable hook command and a WSL host fallback

- Status: Accepted
- Date: 2026-11-26

## Context

The vault can live in WSL2 (`/home/<user>/<vault>`), opened by Windows Obsidian through `\wsl$\<distro>\...` or `\wsl.localhost\<distro>\...`, with Claude Code running inside WSL (Linux node). The hook installer wrote absolute Windows paths (`node "C:\...\kyle-hook.js" Stop`), which Linux treats as relative, so every hook failed with `MODULE_NOT_FOUND`. Separately, 127.0.0.1 inside WSL2 is the Linux VM, not Windows, unless `networkingMode=mirrored` is set, and mirrored networking needs Windows 11 22H2+. Windows 10 (the primary platform) only has NAT.

## Decision

- Hook entries use `node "${CLAUDE_PROJECT_DIR}/<configDir>/plugins/kyle-hub/hooks/kyle-hook.js" <Event>`. Claude Code substitutes this placeholder with the project root where the session started, and also exports it as an env var, so it resolves under sh, Git Bash and PowerShell. Any existing entry containing `kyle-hook.js` counts as ours and is replaced by this form on install, so no OS-specific path is ever written.
- `kh doctor` and the settings "Run doctor" report an absolute-path kyle-hook entry as needing migration. The portable form is ok.
- On Windows the PTY env lists `KYLE_TERM_*` and `KH_*` in `WSLENV` (`/u`), so `wsl.exe` shells see the session, port and token.
- When the vault path is a WSL share, the hook server also listens on the `vEthernet (WSL)` adapter address (the WSL side's default gateway), with the same token check, and passes `KYLE_TERM_WSL_HOST=<ip>:<port>`. `kyle-hook.js` tries 127.0.0.1 first, and only inside WSL (`WSL_DISTRO_NAME`) falls back to that address.

- Terminals for a WSL-share vault open inside WSL: a "WSL (<distro>)" profile (`wsl.exe -d <distro> --cd <linux path>`, the UNC path converted to Linux) is listed first. Any session whose folder is on the share uses it, so Claude is the Linux `claude` with Linux `~/.claude`. Folders on a Windows drive keep the saved Windows default. Restored sessions reopen in WSL, and a saved Windows cwd falls back to the vault root. `wsl.exe` starts a login shell, so `~/.local/bin` is on PATH. The deploy script copies to the UNC vault path as-is, and the Windows helper loads node-pty from the share.

## Consequences

- One settings entry works from Windows, macOS and WSL. Hooks only fire when Claude starts in the vault root, because `CLAUDE_PROJECT_DIR` is the session's start folder. That was already the case for a vault-scoped `settings.local.json`.
- Windows Firewall must allow Obsidian inbound on the WSL adapter (it's a Public network on Windows 10). Until it does, hook events from WSL are dropped silently and Claude is never blocked. The listener is bound to that adapter only, never 0.0.0.0, so the LAN can't reach it.
- The adapter exists only while WSL runs. The plugin retries on each terminal spawn, so the first session started right after WSL boots can miss events until the next spawn.
- With mirrored networking (Windows 11), loopback works directly and the fallback is never used.
- Rejected: binding to 0.0.0.0 (exposes the server to the LAN), relaying through a Windows `node.exe` via interop (it adds hundreds of ms to every hook, and PreToolUse/PostToolUse fire constantly), and a file spool on the `\wsl$` share (file watching over 9P is unreliable).

## Update 2026-11-26: on Windows 10, run Linux Obsidian in WSLg

Windows Obsidian cannot open a vault on the WSL share on Windows 10: `fs.watch` fails with `EISDIR` on `\\wsl.localhost\...`, `\\wsl$\...` and on a drive letter mapped to them (it fails in plain Node too, so no plugin-side fix exists). Without a working watcher Obsidian cannot track vault changes.

The supported Windows 10 setup is therefore **Linux Obsidian inside WSL2 through WSLg** (tested with WSLg 1.0.79, `DISPLAY=:0`), opening `/home/<user>/<vault>` natively:

- The vault path is a plain Linux path, so none of the bridging above activates: no "WSL (<distro>)" profile, no `WSLENV`, no `vEthernet (WSL)` listener, no `KYLE_TERM_WSL_HOST`. Terminals use the login shell (`$SHELL -l`, else bash), which reads `~/.profile`, so `claude` (`~/.local/bin`) and `node` resolve even when WSLg starts Obsidian with a minimal env. The helper runs on the system Node (`/usr/bin/node`).
- Hooks reach the server on 127.0.0.1 (same Linux network namespace). The `${CLAUDE_PROJECT_DIR}` command was checked with Claude Code 2.1.332 on Linux: it expands to the project root for both `SessionStart` and `Stop`.
- `npm run deploy` also ships the `@lydell/node-pty-linux-x64` prebuild. It is an N-API module, and the helper loads it in the system Node rather than Obsidian's Electron (term ADR-0001), so it does not depend on Linux Obsidian's Electron ABI. Deploy still copies over the `\\wsl.localhost` share from Windows.

The Windows-side bridging (the WSL profile, `WSLENV` and the adapter listener) stays, for Windows builds where Windows Obsidian can open the share, such as Windows 11 with mirrored networking.
