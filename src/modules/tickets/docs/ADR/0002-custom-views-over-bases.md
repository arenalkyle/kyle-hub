# ADR-0002: Custom React views instead of Bases views

**Status:** Accepted · 2026-11-21

## Context

Obsidian Bases offers table/cards views over frontmatter and lets plugins register Bases views. kyle-tickets needs a Linear-like Board with drag-and-drop between status columns, two levels of grouping (group + swimlane sub-group), Linear's Display popover and filter bar, and a full issue page.

## Decision

The plugin renders its own `ItemView`s (Main, Issue, Project) over the ticket files via `IssueStore`. It also generates `All Issues.base` in the tickets folder as a bonus native view, but never depends on Bases.

## Consequences

- Full control over Linear's UX; no fighting Bases' config/filter model.
- Grouping, filtering and ordering are implemented in `src/core/query.ts` (pure, tested).
- Users still get native Bases querying for free.
