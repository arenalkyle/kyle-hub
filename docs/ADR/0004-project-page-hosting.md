# ADR-0004: Project page lives in MainView and in its own view type

**Status:** Accepted · 2026-11-21

## Context

A project page must keep the sidebar visible when opened from it (like Linear), but project files can also be opened from the file explorer, links or the issue breadcrumb, where there is no main view.

## Decision

One React component (`ProjectPage`) is hosted twice: inside `MainView` (sidebar click on a project; the content area switches between the page and the project's issue list) and in `ProjectView` (`kyle-tickets-project` view type) for project files opened directly. `IssueInterceptor` routes `Projects/*.md` to `ProjectView` using the pure `interceptTarget` decision.

## Consequences

- No duplicated UI; both hosts own only navigation (rename/delete callbacks).
- The sidebar shows the page by default; "View issues" switches to the existing project-scoped list until Phase 7.2 moves List/Board onto the page.
