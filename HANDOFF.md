# LOCK-31 handoff

## Finished
- **Problem 1 (drag offset): done in code.** `BoardView.tsx` now wraps `<DragOverlay>` in `createPortal(..., document.body)`. Overlay keeps `kt-card is-overlay` classes, which are global CSS, so styling still applies.
- **Problem 2 (no drop into In Progress): partially addressed.**
  - Added regression tests in `src/core/dnd.test.ts` ("multi-word group values (LOCK-31)"): In Progress, In Review, swimlanes, "Big Launch" project, "needs review" label. All pass.
  - `dropToPatch` is correct for these values, so the bug is not in `src/core/dnd.ts`.
  - Removed string parsing of ids: the drag overlay used `activeId.slice(0, activeId.indexOf("@"))`. It now stores `activeIssueId` from `e.active.data.current.issueId`.
  - `cellId` and `itemId` in `BoardColumn.tsx` now `encodeURIComponent` their parts, so separators inside group values cannot change id structure.
  - Root cause NOT confirmed. Static reading found no code path that rejects "In Progress". Suspicions still open: a runtime issue in dnd-kit collision, or a value-dependent path not yet traced. Needs a live repro in Obsidian (drag Todo -> In Progress, check for the "Can't move the card there." Notice).

## Half-done
- **Problem 3 (hide columns): not started in code.** Design and read-through only.

## Root causes
- **Problem 1 (confirmed):** `.kt-content` (`MainView.tsx:64,82`) has `container-type: inline-size` in `styles.css`, which applies layout containment. A `position: fixed` DragOverlay is then positioned relative to that container, not the viewport. The portal fixes it.
- **Problem 2 (suspected, unconfirmed):** see above.

## Hide columns: design (to implement)
- `src/core/display.ts`: add `hiddenGroups: Record<string, string[]>` to `DisplayState`, keyed by GroupBy field (for example `status` -> `["status:Done"]`). Default `{}`. `mergeDisplay` sanitizes it (non-object -> `{}`, non-string arrays dropped), so old saved state loads with nothing hidden.
- New pure module `src/core/hidden.ts` (+ `hidden.test.ts`): `hiddenFor(hidden, groupBy)`, `toggleHidden(hidden, groupBy, key, hide)`, `visibleGroups(groups, hiddenKeys)`.
- `IssueCollection.tsx`: `visible = visibleGroups(built.groups, hiddenFor(display.hiddenGroups, display.groupBy))`. Applies to Board and List, and to nav ids. Popover values come from unfiltered `built.groups`, so hidden items stay listed. Empty groups hidden by `showEmptyGroups: false` are not listed.
- `DisplayPopover.tsx`: new "Hidden columns" section with a toggle per group value. Needs a new prop (group list) from `Header.tsx`.
- `BoardColumn.tsx` `ColumnHeader`: "..." button or right-click -> "Hide column". Writes through `onDisplayChange`.
- CSS goes at end of `styles.css` under `/* LOCK-31 */` with `kt-` prefix.

## Files touched so far
- `src/core/dnd.test.ts`
- `src/views/main/BoardView.tsx`
- `src/views/main/BoardColumn.tsx`

## Build / test state
- `npm run build`: passes (exit 0).
- `npm test`: passes, 23 files, 223 tests.

## Left to do
1. Implement hide columns per design above, with tests for `src/core/hidden.ts`.
2. Confirm problem 2 root cause (live repro or trace of the drop path).
3. Add `/* LOCK-31 */` CSS block at end of `styles.css`.
4. Run `npm run build` and `npm test`. Do not run `npm run deploy`. Do not edit STATUS.md or docs/MANUAL-CHECKS.md. Do not push.
