# kyle-tickets

A Linear-style issue tracker for Obsidian. Tickets are plain Markdown files with frontmatter; the plugin gives them Linear's All Issues List/Board views, grouping and sub-grouping, the issue page, projects with milestones, comments that AI agents can write, and GitHub PR status via the `gh` CLI.

Windows 10, desktop only. Personal project — not in the community plugin store.

**Status:** planning. See [STATUS.md](STATUS.md) and [docs/PLAN.md](docs/PLAN.md).

## Install (dev)

```sh
npm install
echo KYLE_TICKETS_VAULTS=C:\path\to\vault > .env.local
npm run deploy
```

Then enable **kyle-tickets** in Obsidian → Community plugins.

## License

MIT
