# kyle-tickets

A Linear-style issue tracker for Obsidian. Tickets are plain Markdown files with frontmatter, so you, Obsidian and AI agents can all read and edit them. The plugin adds List and Board views, grouping, an issue page, projects with milestones, comments, GitHub PR status, and a `kt` CLI for agents.

Windows 10, desktop only. Personal project, not in the community plugin store.

Status: [STATUS.md](STATUS.md). Spec: [docs/PLAN.md](docs/PLAN.md). Decisions: [docs/ADR](docs/ADR). Terms: [GLOSSARY.md](GLOSSARY.md).

## Features

- All Issues, Active and Backlog views, in List or Board layout. _[screenshot: main view]_
- Grouping, sub-grouping (Board swimlanes), ordering, property chips, per-view filters. _[screenshot: display popover]_
- Linear-style issue page with properties sidebar, description editor, sub-issues, activity feed and comments. _[screenshot: issue page]_
- Projects with milestones and progress. _[screenshot: project page]_
- Live GitHub PR status through the `gh` CLI, and auto-link of PRs by issue ID. _[screenshot: PR chips]_
- Keyboard shortcuts, editable statuses and label colors.
- `kt` CLI and a generated `AGENTS.md` so agents can work tickets.

## Install

```sh
npm install
echo KYLE_TICKETS_VAULTS=C:\path\to\vault > .env.local
npm run deploy
```

`KYLE_TICKETS_VAULTS` can list several vaults separated by `;`. Deploy copies `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/kyle-tickets/`. Enable **kyle-tickets** under Community plugins. Use `npm run dev` to rebuild on change.

## First run

The setup modal asks for the tickets folder (default `Tickets/`), the ID prefix (default `TIX`) and your display name (used as `@author`). It creates `Issues/`, `Projects/`, `All Issues.base`, `.kyle-tickets.json` and `AGENTS.md`. All of these can be changed later in Settings.

## Using the views

- Open with the ribbon icon or the **Open kyle-tickets** command. The sidebar lists All Issues, Active, Backlog and your projects.
- **List | Board** toggle in the header. **Display** sets grouping, sub-grouping, ordering, sub-issue/completed/empty-group toggles and chips. **Filter** adds AND-ed conditions (status, priority, project, label, assignee, milestone, due). Both are saved per sidebar view.
- Board: drag cards between columns or swimlanes to change the grouped field; with Manual ordering, drag within a column to reorder.
- Shortcuts (when a kyle-tickets view is focused): `C` new issue, `J/K` or arrows move, `Enter` open, `Esc` back, `S` status, `P` priority, `L` labels, `A` assignee, `F` filter, `Ctrl+Enter` post a comment.

## Issue page

Ticket files inside the tickets folder open as an issue page instead of raw Markdown. Edit the title inline, set properties in the right sidebar, click the description to edit it, add sub-issues, and comment at the bottom. **Open as Markdown** (or the **Toggle issue / Markdown view** command) shows the raw file. Every change made in the UI is logged in the activity feed.

## Projects & milestones

Create a project with **+** next to Projects or the **New project** command. A project has an icon, color, status, lead, target date and description. Add milestones with target dates; each shows done/total progress, can be reordered by drag, and filters the project's issue list when clicked. Renaming a project or milestone rewrites the issues that use it.

## Pull requests (gh)

Install and authenticate the [GitHub CLI](https://cli.github.com/) (`gh auth login`). Link a PR URL from the issue page to see its live state; chips show on rows and cards. In Settings, GitHub section, list watched repos and enable **Auto-link PRs** to attach PRs whose title or branch contains an issue ID. Without `gh`, PRs show as plain links.

## Agents & `kt`

The plugin writes `AGENTS.md` into the tickets folder (regenerated when the prefix, statuses or display name change; a file you edited by hand is never overwritten). It documents the file format and the commands below.

```sh
npm run build && npm link        # puts `kt` on PATH
kt new "Fix login bug" --status Todo --project Website
kt set TIX-1 status "In Review" --as claude
kt comment TIX-1 --as claude "Done; tests pass"
kt list --status Todo --json
kt show TIX-1
kt pr TIX-1 https://github.com/owner/repo/pull/4 --as claude
```

`kt` finds the folder with `--dir`, `KT_DIR`, or by walking up from the current directory. Exit codes: 0 ok, 1 usage, 2 not found, 3 validation. Agent etiquette: pass `--as <agent-name>`, comment progress, and move work to In Review rather than Done.

**Claude Code skill.** Copy or symlink `skills/kyle-tickets` into your skills folder:

```sh
cp -r skills/kyle-tickets ~/.claude/skills/
# or, in an elevated cmd: mklink /D "%USERPROFILE%\.claude\skills\kyle-tickets" "<repo>\skills\kyle-tickets"
```

The skill triggers on "ticket", "issue", `TIX-12` or "kyle-tickets", then reads `AGENTS.md` and prefers `kt`.

## Settings

Folder, ID prefix and display name; GitHub (gh status and re-check, optional gh path, refresh interval, watched repos, auto-link, sync now); a Statuses editor (rename, recolor, category, reorder, default, delete with reassign); a Labels editor (colors, rename, delete). Renames and deletes rewrite affected issue files.

## Troubleshooting

- **Setup modal did not appear**: it opens once the workspace is ready. Check Settings, kyle-tickets.
- **Ticket opens as Markdown**: only files under `<folder>/Issues` and `<folder>/Projects` are intercepted; check the folder setting.
- **`kt: command not found`**: run `npm run build && npm link`, then check `where kt`.
- **`kt` cannot find the folder**: pass `--dir`, set `KT_DIR`, or run from inside the vault (the marker `.kyle-tickets.json` must exist).
- **PRs show as plain links**: install `gh`, run `gh auth login`, then **Re-check** in Settings, GitHub section.
- **External edits show as `@external`**: set `updatedBy` in the frontmatter when editing files by hand.

## License

MIT
