# LOCK-32 handoff: issue right-click context menu

Worktree: `C:\Development\obsidian-plugins\kyle-tickets\.claude\worktrees\agent-adef2ff4920513fce`
Branch: `worktree-agent-adef2ff4920513fce`

## Finished
- `src/views/issueActions.ts` (new): shared helpers `issueLinkUri(app, path)`, `copyText(text, what)`, `deleteIssueConfirmed(app, store, issue, path)` (TFile check + `confirmModal` + `store.deleteIssue`).
- `src/views/IssueView.tsx`: Copy ID / Copy link / Delete now call the shared helpers. Removed the local `copy` and `file` consts and the `confirmModal` import. Unused `Notice`/`TFile` imports are still used elsewhere in the file.
- `src/views/main/issueMenuModel.ts` (new, pure, no Obsidian import): `buildIssueMenu(issue, settings): MenuEntry[]`, plus types `PickerKind`, `MenuAction`, `MenuEntry`.
  - Status and Priority are inline sections (heading item + values, `checked` on the current value). Obsidian's `MenuItem` has no `setSubmenu` in this repo's `obsidian.d.ts`, so submenus are not possible.
  - Milestone is included only when `issue.project` is set.
  - Lucide icon names are used. The React status/priority SVGs cannot go into Obsidian menus.
- `src/views/main/issueMenuModel.test.ts` (new): 4 tests. NOT YET RUN.

## Half-done / not started
1. `src/views/main/issueContextMenu.ts` (NOT created): renderer. Plan: `new Menu()`, map entries to `addSeparator()`, `addItem` with `setIsLabel(true)` for headings, `setTitle`/`setIcon`/`setChecked` (only for status/priority items)/`setWarning` (danger), then `showAtMouseEvent(evt)`. Run callback takes a `MenuAction`.
2. `src/views/main/IssueCollection.tsx` (NOT edited). Plan:
   - Root `div` gets `onContextMenu`. Find `closest("[data-kt-id]")`. If it matches an issue in `issues`, call `e.preventDefault()`, `setSelectedId(id)`, then show the menu. This is delegated, so IssueRow/IssueCard/BoardColumn/BoardView are not touched. dnd-kit ignores non-primary buttons (`event.button !== 0`), so right-click does not start a drag.
   - Action handling: status and priority call `plugin.store.updateIssue(id, {status|priority})`. `picker` opens the picker through `sp`. `open` calls `plugin.openIssue(id, newTab)`. `copyLink` uses `copyText(issueLinkUri(plugin.app, path), "link")` with `path = plugin.store.pathOf(id)`. `delete` calls `deleteIssueConfirmed`.
   - Picker anchor: create a `span` with `position: fixed` at `clientX/clientY`, width and height 0, and `dataset.ktVirtual = "1"`, append it to `document.body`. Pass it as `sp.anchor`. Add an effect that removes the anchor when `sp?.anchor` changes or unmounts, only if `ktVirtual` is set.
   - Extend the `sp.kind` union with `"project" | "milestone" | "due"`. Render `ProjectPicker` (value: `spIssue.project ? fromLink(spIssue.project) : undefined`; onChange `spUpdate({ project: p ?? null })`), `MilestonePicker` (`project={spIssue.project}`, as PropertiesSidebar does; `MilestonePicker` calls `fromLink` itself), and `DatePicker` (`spUpdate({ due: d ?? null })`). Imports are in `src/views/components/pickers/`.
3. Verify `IssueView.tsx` compiles. `Notice` and `TFile` are still imported and used.
4. Possibly add a test for `issueActions.ts` (`issueLinkUri`). Optional.
5. CSS: none yet. If `.kt-ctx-anchor` is needed, add it at the end of `styles.css` under `/* LOCK-32 */`. The virtual anchor is inline-styled, so CSS may not be needed.

## Design decisions
- Menu built from a pure function, rendered by a separate Obsidian-only file (the pure file stays testable under vitest).
- Shared actions live in `issueActions.ts` so IssueHeader/IssueView and the context menu use the same code. IssueHeader's own "More" menu is untouched and could switch to the helpers later.
- All writes go through `plugin.store` (IssueStore).

## Build / test state
- `node_modules` junction created at the worktree root (points to the main checkout's node_modules). Do not commit it.
- `npm run build`: NOT RUN.
- `npm test`: NOT RUN.
- Expected failure points: the new test file is unverified; the `sp.kind` union change may need a type fix in `onShortcut`'s `default` branch (it passes `action` as kind).
