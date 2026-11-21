# kyle-term

Obsidian terminal plugin built for AI coding agents (Claude Code first-class). Multiple sessions in one tab, a sidebar showing each agent's state, sub-agents and live activity, and sound alerts when an agent needs you. Windows 10 first; macOS best-effort.

> Status: in development — see [STATUS.md](STATUS.md) and [docs/PLAN.md](docs/PLAN.md).

## Requirements

- Obsidian desktop
- Node.js ≥ 18 (on PATH, or set in plugin settings)
- Claude Code (`claude` on PATH)

## Install (from source)

```bash
git clone https://github.com/arenalkyle/kyle-term.git
cd kyle-term
npm install
# list target vaults (`;`-separated):
echo 'KYLE_TERM_VAULTS=C:\path\to\vault' > .env.local
npm run deploy        # or: npm run dev (watch + deploy)
```

Then in Obsidian: Settings → Community plugins → enable **kyle-term**, and run the command **kyle-term: Install hooks** once.

## macOS

Best-effort; Windows 10 is the primary target. Not yet verified on a real Mac.

1. Install Node 18+ (`brew install node`) and Claude Code.
2. `git clone` the repo, `npm install` (fetches the `darwin-arm64` or `darwin-x64` node-pty prebuild).
3. Create `.env.local` with `KYLE_TERM_VAULTS=/Users/<name>/path/to/vault` (several vaults separated by `:` or `;`).
4. `npm run deploy`, enable **kyle-term** in Obsidian, run **kyle-term: Install hooks**.

- **PATH:** Obsidian launched from the Dock has no shell PATH. kyle-term reads PATH from your login shell (`$SHELL -ilc`, 3 s timeout) at startup and adds `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin` when they exist. Settings shows the detected Node and PATH; the **Node path** setting overrides detection (reload the plugin after changing).
- **Shells:** bash (default, `bash -l`) and zsh (`zsh -l`).
- **Keys:** Cmd+C (with a selection) / Cmd+V copy and paste; Ctrl+C always interrupts; Cmd+= / Cmd+- / Cmd+0 zoom the session; Shift+Enter inserts a newline.
- **Limitations:** Intel Macs untested; Linux is not targeted.

## License

MIT
