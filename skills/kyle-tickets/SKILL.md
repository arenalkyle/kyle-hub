---
name: kyle-tickets
description: Work with kyle-tickets issues in an Obsidian vault (create, update, comment on TIX-style tickets). Use when the user mentions a ticket, an issue, an ID like TIX-12, or kyle-tickets.
---

# kyle-tickets

Tickets are Markdown files in a vault folder (usually `Tickets/`), managed by the kyle-tickets Obsidian plugin. Use the `kt` CLI; it writes the same file format and activity events as the plugin.

## Steps

1. Locate the tickets folder: the directory holding `.kyle-tickets.json` (often `<vault>/Tickets`). From inside the vault, `kt list` finds it by itself. Otherwise pass `--dir <folder>` or set `KT_DIR`.
2. Read `<folder>/AGENTS.md` once per session. It has this vault's ID prefix, exact status names and the file format.
3. Find work with `kt list --status Todo --json` and `kt show <ID> --json`. Read the description and the activity feed before changing anything.
4. Create tickets with `kt new "<title>" [--status ..] [--project ..]`. It prints the ID. Never invent an ID or create issue files by hand.
5. Change fields with `kt set <ID> <field> <value> --as <agent-name>`. Status values must match the vault's names exactly (an error lists the valid ones).
6. Report progress with `kt comment <ID> --as <agent-name> "<text>"`. For longer text, pass `-` and pipe it on stdin.
7. When the work is finished, run `kt set <ID> status "In Review" --as <agent-name>`. Never set Done or Canceled; the owner does that.
8. Link a pull request with `kt pr <ID> <url> --as <agent-name>`.

## Rules

- Always pass `--as <agent-name>` (for example `claude`) on writes.
- Prefer `kt` over hand edits. If you must edit a file, keep unknown frontmatter keys and the body intact, and set `updatedBy`.
- Comments use `### @author · YYYY-MM-DD HH:mm` headings; `kt comment` escapes body lines that would break the feed.
- Do not delete tickets, rename files or edit `AGENTS.md`.
- Exit codes: 1 usage, 2 not found, 3 validation. Fix the command rather than retrying blindly.
