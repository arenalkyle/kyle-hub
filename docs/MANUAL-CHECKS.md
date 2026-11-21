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

## 3.2 Triage view, type chips, Done gate, .base slices — LOCK-48

- [ ] Throwaway vault, Obsidian started with `--remote-debugging-port=9222`: `npm run smoke:triage` prints PASS and deletes its fixtures (CDP smoke and CDP Done-gate check not run unattended).
- [ ] Create 3 tickets with `KH_AGENT=1 kh tickets new …`. Triage shows all 3 with type chips, source, repo, age and "+N seen" where applicable.
- [ ] Press `a`, `r`, then `d` with a reason: statuses, `agent-ready` label and "Declined: …" comment are right. `u` undoes the decline.
- [ ] `j`, `k`, `Enter` navigate; typing in the decline box does not trigger the keys.
- [ ] Add an unchecked `## Acceptance criteria` item, move the ticket to Done via Board drag, status picker, context menu and `S`: each shows "N of M criteria unchecked. Mark done anyway?". Confirm logs an override event; cancel leaves status unchanged. (`kh` CLI Done is not gated.)
- [ ] Display popover: group, order and filter by Type; chip shows in List, Board and issue header; dragging a card between type groups sets the type.
- [ ] Issue page sidebar edits Type, Repo, Model, Blocked by; Runs, Outcome, Cost, Source are read-only.
- [ ] `Triage.base`, `Queue.base`, `Proposals.base`, `Blocked.base` open; the `r` ticket appears in Queue; a hand-edited `.base` survives a restart.

## 4.1 LogService + redaction — LOCK-49

- [ ] Run a short Claude Code session in any repo, then exit.
- [ ] `kh logs ingest` prints "runs updated: N, records: M, skipped: K".
- [ ] Open `%LOCALAPPDATA%\kyle-hub\home\runs\`: one file has tool_call, usage and file_* records, and no secrets (check for tokens/keys).
- [ ] `kh logs ingest` again: runs updated 0, records 0 (apart from skipped lines from a live session).
- [ ] Note: LogService isn't registered on the hub and the hook server doesn't call `appendHookEvent` yet; `core.repos`/`core.logs` settings shapes are assumed (see ticket comment).

## 4.2 Run index, retention, maintain/doctor/schedule — LOCK-50

- [ ] `kh schedule install` prints the schtasks command; review, then `kh schedule install --yes`. `kh schedule status` shows the next run; Task Scheduler lists `kyle-hub-maintain` (real registration not done unattended).
- [ ] Obsidian → kyle-hub settings → Log health → Run doctor. If it warns about `cleanupPeriodDays`, set `"cleanupPeriodDays": 30` in `~/.claude/settings.json`; if it warns about kyle-hook, install the hook from term settings.
- [ ] Set the `core.logs.prices` table in plugin settings for cost figures (CLI reads it from data.json); without it costs show $0.
- [ ] Close Obsidian, run a Claude session, wait 30 min (or `schtasks /Run /TN kyle-hub-maintain`): `kh logs runs --since 2026-11-01` includes the session.
- [ ] With the term hook installed, hook events land in `%LOCALAPPDATA%\kyle-hub\<profile>\hooks\<date>.jsonl`.

## 5.1 Launch queue + worktree + context pack — LOCK-51

- [ ] Reload Obsidian. Settings → kyle-hub → "Repo map and launch": add a scratch repo (key, absolute path with no spaces, profile).
- [ ] Create a ticket with `repo:` set and acceptance criteria, accept it in Triage with `r`. "Open launch queue" lists it.
- [ ] Click Launch: terminal opens in `...\.kh-worktrees\<repo>\<ID>` on branch `kh/<ID>-<slug>`; Claude starts with `Work ticket <ID>. Context: @<pack>`; ticket is In Progress with a run id and a "launched by" event; pack is under `%LOCALAPPDATA%\kyle-hub\<profile>\packs`.
- [ ] Click the "running" row to focus the session. Close it and relaunch: worktree reused, pack names the previous run.
- [ ] Launch 4 tickets: the 4th shows a refusal notice (max 3 concurrent). Turn the tickets module off: Queue shows "Tickets module disabled" (implemented, not unit-tested).
- [ ] Throwaway vault, CDP on port 9222, `KH_SMOKE_CLAUDE=echo`: `npm run smoke:launch` passes (not run unattended).
- [ ] Note: repo chosen in the picker isn't written back to the ticket; `worktrees:false` runs are tracked only until restart.

## 5.2 Session end, mechanical summary, attention badges, cleanup — LOCK-52

- [ ] Run "Install hooks" in kyle-hub so `SessionEnd` is registered (it's new), then reload the plugin.
- [ ] Throwaway vault, Obsidian with `--remote-debugging-port=9222`: `npm run smoke:session-end` prints PASS (not run unattended).
- [ ] Launch a small real ticket; let the agent finish and `kt comment`: ticket goes to In Review with outcome and cost set. (`kt comment` inside a run authors as `agent:<runId>`.)
- [ ] Launch another and exit Claude immediately: a `@kyle-hub` mechanical comment appears, ticket stays In Progress, needs-attention badge shows on the Queue item and on List, Board and issue header; clicking the badge focuses the terminal.
- [ ] Trigger a permission prompt mid-run: Queue badge appears and clears when the session returns to working.
- [ ] Mark a ticket Done after merging its branch: "Remove worktree for ID?" appears; Remove deletes worktree and merged branch, Keep does nothing. (After a squash-merge the worktree is removed but the branch is kept.)

## 6.1 Retro detectors — LOCK-53

- [ ] After a few days of real runs (`kh logs ingest` first), `kh retro detect` shows clusters that look real (a repeated command sequence, a denied permission).
- [ ] Run `kh retro detect` twice: same output, and `%LOCALAPPDATA%\kyle-hub\<profile>\retro.json` is not created or changed.
- [ ] Note: outliers appear only after 6.2 supplies ticket types; retro config is read from `term.retro` in data.json (no settings UI).

## 6.2 Retro: templates, Perform Retro, Apply, recurrence — LOCK-54

- [ ] Throwaway vault, Obsidian with `--remote-debugging-port=9222`: `npm run smoke:retro` passes (writes `retro.json` under `%LOCALAPPDATA%\kyle-hub\home`; not run unattended).
- [ ] Click Perform Retro on real logs: Triage gets ≤5 proposal/finding tickets with evidence; "Last retro: just now"; sessions-since is 0.
- [ ] Accept a permission proposal and click Apply: `~/.claude/settings.json` updated and a timestamped `.bak` sits next to it.
- [ ] Click Perform Retro again right away: no duplicate tickets (repeats become "seen again" comments).
- [ ] No "Draft rule with Haiku" button until `allowDraftRule` is on in Retro settings; with it on, the button appears on a `corr:` finding and opens the diff modal; check the Haiku spend cap with a real `claude`.
- [ ] Settings → term → Retro section: `nudgeAt`, `maxTickets`, `allowDraftRule`, `dailyCapUsd`.
- [ ] Known gap: built-in patcher on CRLF files is untested (git-apply path is tested).
