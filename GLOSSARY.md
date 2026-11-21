# Glossary

- **Issue / ticket** — one Markdown file in `Issues/`, identified by an **ID** like `TIX-12`.
- **Prefix** — the ID's letter part (`TIX`), set at setup.
- **Status** — workflow state (Backlog, Todo, …). Each status has a **category**: triage, backlog, unstarted, started, completed, canceled.
- **Active** — issues whose status category is unstarted or started.
- **Priority** — none, urgent, high, medium, low.
- **Label** — a frontmatter `tags` entry; color comes from plugin settings.
- **Project** — a note in `Projects/` (`kind: kt-project`); issues link to it via `project: "[[Name]]"`.
- **Milestone** — a named target inside a project's `milestones` list; issues reference it by name.
- **Sub-issue** — an issue whose `parent` links another issue.
- **Activity feed** — everything under `## Activity` in a ticket: **comments** (`### @author · time` + body) and **events** (`- time · @author text`).
- **External edit** — a change to a ticket file not made through `IssueStore`; logged as an event by diffing.
- **View** — a sidebar entry (All Issues, Active, Backlog, a project) with its own **display state** (layout, grouping, sub-grouping, ordering, toggles, property chips) and **filters**.
- **Grouping / sub-grouping** — List sections / Board columns, and List sub-sections / Board swimlanes.
- **Preview card** — the compact Board card for an issue.
- **IssueStore** — the plugin module that indexes and writes ticket and project files.
- **kt** — the Node CLI agents use to create, update and comment on tickets.
