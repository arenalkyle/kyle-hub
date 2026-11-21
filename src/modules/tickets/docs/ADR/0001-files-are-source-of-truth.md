# ADR-0001: Ticket files are the source of truth

**Status:** Accepted · 2026-11-21

## Context

kyle-tickets must be readable and writable by the user, by Obsidian (search, backlinks, tags, Bases) and by AI agents working in a terminal, sometimes while Obsidian is closed.

## Decision

Each ticket is one Markdown file `Issues/<PREFIX>-<n>.md`. Properties live in YAML frontmatter; the body holds the description, then a `## Activity` section of comments (`### @author · time` + body) and events (`- time · @author text`). Projects are notes in `Projects/`, milestones live in the project's frontmatter, labels are `tags`. The plugin keeps only derived state (index, caches, view settings, ID counter) in `data.json`; it never stores ticket data anywhere else.

## Consequences

- Agents can create, edit and comment with plain file edits or the `kt` CLI.
- The parser must be round-trip safe and tolerant of hand edits (unknown keys and content preserved).
- External edits must be detected by diffing against the last snapshot to keep the activity log.
- The ID counter must reconcile with `max(existing)+1` because files can appear without the plugin.
