# Manual checks

Checks that need a person using Obsidian, one section per ticket. Vault: the one in `.env.local`. Run `npm run deploy` first, then reload Obsidian (or toggle the plugin).

## 1.1 Scaffold — LOCK-11

1. `npm i` → make sure `.env.local` exists → `npm run deploy`.
2. Obsidian → Settings → Community plugins → enable **kyle-tickets**. No error notice; the dev console (Ctrl+Shift+I) shows `kyle-tickets loaded`.
3. Disable it again. No errors in the console.
4. Optional: `npm run dev`, save any file under `src/`, and confirm it rebuilds and prints `deployed -> …`.
