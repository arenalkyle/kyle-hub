# kyle-term

Obsidian terminal plugin built for AI coding agents (Claude Code first-class). Multiple sessions in one tab, a sidebar showing each agent's state, sub-agents and live activity, and sound alerts when an agent needs you. Windows 10 first; macOS best-effort.

> Status: in development — see [STATUS.md](STATUS.md) and [docs/PLAN.md](docs/PLAN.md).

## Requirements

- Obsidian desktop
- Node.js ≥ 18 (on PATH, or set in plugin settings)
- Claude Code (`claude` on PATH)

## Install (from source)

```bash
git clone https://github.com/<you>/kyle-term.git
cd kyle-term
npm install
# list target vaults (`;`-separated):
echo 'KYLE_TERM_VAULTS=C:\path\to\vault' > .env.local
npm run deploy        # or: npm run dev (watch + deploy)
```

Then in Obsidian: Settings → Community plugins → enable **kyle-term**, and run the command **kyle-term: Install hooks** once.

## License

MIT
