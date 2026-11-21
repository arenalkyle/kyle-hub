# Manual checks

Steps that need someone using Obsidian. One section per ticket, appended as each ticket is closed. Tick the boxes as you run them.

## 1.1 Repo + core skeleton — LOCK-43

- [ ] `git log --oneline | wc -l` shows ~130+ commits; `git log ada8a65^2 --oneline | head -5` shows old kyle-tickets commits (`git log -- src/modules/tickets` shows only the merge commit — inherent to `git subtree`).
- [ ] Run `npm run deploy`, enable **kyle-hub** in the test vault: no errors in the dev console (old plugins can stay enabled).
- [ ] kyle-hub settings tab shows toggles for Tickets, Terminals, Brain, Command center; Core is greyed out.
- [ ] `kt --help` works (global `kt` was re-linked from kyle-tickets to kyle-hub).

## 1.2 Tickets module on core — LOCK-44

- [ ] Disable kyle-tickets, enable kyle-hub, reload: tickets, views, display settings, labels, statuses and watched repos are all present.
- [ ] Create a ticket, drag it on the Board, comment on it. Open the raw `.md`: format unchanged.
- [ ] `.obsidian/plugins/kyle-tickets/data.json.bak` exists (written once).
- [ ] Toggle Tickets off and on in kyle-hub settings: views/commands vanish and return, or a notice asks for a reload.
- [ ] Rebind any hotkeys that used kyle-tickets command ids (now `kyle-hub:<id>`); old workspace layouts with tickets views close.
- [ ] Main view, List/Board, Display, filters, shortcuts, issue page, projects, milestones, PR status, auto-link, comments all work as before.

## 2.1 Term module on core — LOCK-45

- [ ] Disable kyle-term, enable kyle-hub, reload: saved folders, profiles, sounds, appearance and sessions carry over; `.obsidian/plugins/kyle-term/data.json.bak` exists.
- [ ] Run "kyle-hub: Install hooks", review the diff, accept. `~/.claude/settings.json` has no kyle-term path left; run again: "already installed". (Backup: `settings.json.kyle-hub-backup-<stamp>`.)
- [ ] Open a terminal on each profile (PowerShell, cmd, Git Bash). Font follows Obsidian's monospace.
- [ ] Start Claude in one: state goes to working; a permission prompt sounds needs-input; finishing sounds finished; an idle session stays silent.
- [ ] Restart Obsidian: sessions restore with scrollback and Resume works. Vault path insertion by dragging a note and via Send note.
- [ ] Start Obsidian with `--remote-debugging-port=9222`, run `npm run smoke`: prints "smoke: PASS" (CDP smoke criterion could not be run unattended).
- [ ] Term module toggle needs a reload (as noted in settings); old kyle-term workspace leaves don't restore (view type `kh-term-view`).

## 2.2 kh CLI + Linear import + cutover — LOCK-46

- [ ] Reload/enable kyle-hub from the deployed build; the tickets view still loads.
- [ ] From inside the vault: `kt list` and `kh tickets list` both work (global `kt` now points at kyle-hub `bin/kt.js`).
- [ ] `$env:LINEAR_API_KEY="<key>"; kh import linear --team LockedAway --dry-run` writes nothing and prints a plan.
- [ ] Same without `--dry-run`: ~58 tickets with `linearId`, sub-issues nested, comments present. Run again: 0 created. (Linear "In Review" state lands on "In Progress" — status maps by state type.)
- [ ] Missing `LINEAR_API_KEY` → exit code 2.
- [ ] **Cutover:** disable the old kyle-tickets and kyle-term plugins in the vault, confirm kyle-hub covers everything, then archive the old repos.

## 3.1 Ticket schema + agent gates — LOCK-47

- [ ] Terminal with `KH_AGENT=1`: `kh tickets new "Test proposal" --type proposal` → ticket lands in Triage with `source: agent:...` in the file.
- [ ] Run the same command again: no new file; a "seen again (+1)" comment on the first ticket.
- [ ] `KH_AGENT=1 kh tickets set <id> labels +agent-ready` is refused; without `KH_AGENT` it works.
- [ ] Back-date an old triage ticket's `updated` by 15 days, run `kh tickets expire`: it becomes Canceled with an "expired" event line.
- [ ] kyle-hub loads in Obsidian with no console errors (core settings now include `repos` and `flood`).
- [ ] Known gap: plugin-side gates use default flood limits (not the `core.flood` override) and dedupe/caps/expiry are CLI-only.
