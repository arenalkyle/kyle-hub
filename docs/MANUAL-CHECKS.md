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

## 7.1 Brain doc types + staleness — LOCK-55

- [ ] Enable the Brain module in settings, reload Obsidian: it loads with no console errors.
- [ ] Run New doc → lesson → vault: file appears under `Brain/lesson/` and opens.
- [ ] Run New doc → ADR → repo kyle-hub: `docs/adr/0013-...` is numbered and lint-clean.
- [ ] `kh brain check` on kyle-hub lists ~14 findings (shorthand paths like `core/domain/pack` in STATUS.md, PLAN.md, ADR-0003): fix the docs or add `brain.ignoreSymbols`.
- [ ] `kh brain check --repo kyle-term` works (needs a kyle-term entry in the vault repo map).
- [ ] Findings cap is only tested with a fake sink, not the real CLI; `kh brain check --tickets` twice adds no duplicate tickets.

## 7.2 Doc retrieval + brain health — LOCK-56

- [ ] Run "Create style conventions": `Brain/conventions/agent.md` and `human.md` appear in the vault; running again says they already exist.
- [ ] Add kyle-hub to the vault repo map, then `kh status draft --repo kyle-hub` prints a skeleton and changes no files (until the repo is mapped it reports "unknown repo").
- [ ] Launch a ticket linked to an ADR: the pack's "Docs included" section lists the ADR with its reason.
- [ ] Turn the brain module off, launch again: the pack has no docs section (parent/blocker/previous-run sections remain).
- [ ] Health score appears where expected (emitted on plugin load; `kh maintain` does not recompute it).

## 8.1 Command center dashboard — LOCK-57

- [ ] Enable Command center in kyle-hub settings, reload. Open the view from the ribbon icon or command palette: all tiles show values and the spend sparkline draws.
- [ ] Disable Terminals, reload, reopen: session and retro tiles and the needs-attention list show "module disabled"; the rest still render.
- [ ] Leave the view open >60 s while a new run starts: numbers refresh.
- [ ] Clicking a needs-attention row focuses that session.
- [ ] Optional: `node scripts/cdp-command-center-smoke.mjs` with Obsidian on `--remote-debugging-port=9222` and the module enabled prints PASS (not run unattended).
- [ ] Note: "running" counts non-exited sessions; runs without an outcome show "running".

## 8.2 Work/home profiles + promote — LOCK-58

- [ ] Settings → kyle-hub → "Profile and promote": set Vault profile to `work`. Launch a ticket whose repo is a `home` repo: refusal notice names both profiles and nothing is spawned.
- [ ] Set the home vault path. In a work vault, open a `type: lesson` note and run "Promote to home" (needs the brain module on): the diff shows `<repo>` and `<path>` placeholders; confirm writes to the home vault's `Brain/lessons/` (never overwrites; adds `-2`, `-3`); cancel writes nothing.
- [ ] `kh promote <file> --to <homeVault> --dry-run` changes no files.
- [ ] In a work vault, "Draft rule" is hidden/refused; command center and retro show only the vault profile's data.
- [ ] With CDP on port 9222: `npm run smoke:promote` passes (not run unattended).

## 9.1 Accounts + launch routing — LOCK-59

- [ ] Settings → Claude accounts → Add: a login tab opens; run `/login` there with a real account (config dir defaults to `%LOCALAPPDATA%\kyle-hub\claude-accounts\<id>`, never `~/.claude`).
- [ ] Set the new account as default for one repo (repo-row dropdown), launch a ticket from the Queue: the run used that account (`kh logs runs --json` shows its `accountId`).
- [ ] With two or more accounts, launch another ticket and pick a different account in the picker: the ticket gets `account:` frontmatter and the run uses it.
- [ ] An unknown account id on a ticket/repo refuses the launch; an account whose profile doesn't match the vault is refused.
- [ ] `kh account list` and `kh account use <id> --repo <key>` (with `KYLE_HUB_VAULTS` set) work; reload the plugin after a CLI change (Obsidian rewrites data.json on save).
- [ ] With no accounts configured, launch behaves as before (no `CLAUDE_CONFIG_DIR`).

## 9.2 Usage tracker + surfaces — LOCK-60

- [ ] Enable the usage and command-center modules; start Obsidian with `--remote-debugging-port=9222` and run `npm run smoke:usage` (not run unattended).
- [ ] Compare the session and week numbers with `/usage`; adjust `usage.caps.<plan>` in Settings → Usage (default caps are placeholders; subscription % = tokens excl. cache reads ÷ cap).
- [ ] Add an enterprise account, set a budget: tile, status-bar chip and picker show $ and no percent.
- [ ] Set a low cap and cross 80%: a notice appears and a running ticket of that account gets a comment (fires once per window; never switches accounts).
- [ ] With 2+ accounts, launch a ticket: each picker row shows its usage line.
- [ ] Optional: turn on "official reading" (`claude -p "/usage"` parsed per account; unverified guess, falls back to the estimate). `kh usage` reads the estimate only.
- [ ] Note: the usage module runs `logs.ingest()` at most every 2 minutes so the chip isn't stale.

## Terminal tiling (term ADR-0003)

- [ ] Reload Obsidian, open two Claude sessions, drag the first onto the left edge of the second: one banner per pane, prompt at the bottom of both.
- [ ] Stack, expand and restore panes with a long conversation open: no repeated content; the mouse wheel and PgUp/PgDn scroll Claude, including in a pane without focus.
- [ ] Drag-select + Ctrl+C copies and right-click pastes once.
- [ ] Open several sessions: each gets its own colour on the sidebar stripe and, when split, on its pane header; right-click → Colour tag still overrides it.

## Command Center v2 — LOCK-61 (Phases 10–16)

Before you start: close Obsidian and run `npm run deploy` once, so the locked node-pty files are refreshed too. Then start Obsidian with `--remote-debugging-port=9222` and run `node scripts/cdp-command-center-smoke.mjs`. It has never run against the v2 build.

### 10.1 Layout — LOCK-62

- [ ] At 1920px: side columns are about half their old width; the middle column takes the rest. Under 1000px it collapses to one column.
- [ ] Spend is a slim strip at the top of the middle column (title, total and caption on one line, ~24px sparkline; about half its old height). System sparklines are still full height (56px). No Usage tile.
- [ ] The 3D brain fills the whole Command Center behind the cards; cards are translucent and show the brain through them. Empty space orbits, zooms, hovers and clicks the brain; cards still scroll and click normally.
- [ ] Retro sits in the left column under Needs attention.
- [ ] Header tabs read `Command Center | Tickets | Terminal | Brain`; Brain opens in the same leaf.
- [ ] `npm run smoke:usage` passes (chip and picker lines only now).

### 11.1 Vault-scoped hooks — LOCK-63

- [ ] Run "Install hooks": first dialog says vault `.claude/settings.local.json`; accept. Second dialog says global `~/.claude/settings.json` removal; accept. Cancel at the first dialog and the second never appears.
- [ ] Run it again: "already installed" notice, no dialogs.
- [ ] `kh doctor` and the settings "Run doctor" button report kyle-hook ok (in the vault, not global).
- [ ] A Claude session inside the vault shows status lights; one outside the vault does not (intended).
- [ ] A Read/Grep in the vault adds hook spool lines with `access` (path, pattern, hits) and no file contents; a sub-agent's lines carry `parentSessionId`.

### 11.2 History capture — LOCK-65

- [ ] After `kh maintain`, a vault session's run records include `search` records (pattern, root, hits, durationMs); an old session shows no hits field (unknown), not 0.
- [ ] Opening notes in Obsidian writes `<profile>/human/<day>.jsonl` lines with only `{type, t, path}`.

### 12.1 Brain Vitals — LOCK-66

- [ ] Right column shows Brain Vitals: health score, Docs/Scripts/Skills/Agents counts, Notes read (agent line and dimmer "You:" line), Writes, Searches, Active agents with sparklines.
- [ ] Per min / per hour toggle switches and is remembered after reload (default per hour).
- [ ] Agent reads and your own note opens move the numbers within seconds (no 60s wait).
- [ ] Brain module off: card shows "module disabled".
- [ ] Settings → Brain FPS (10/20/30/60) changes the 3D brain's frame rate without reload.

### 13.1 3D brain — LOCK-67

- [ ] Command Center backdrop and Brain tab both show the 3D brain (not white): teal notes, violet folder hubs, glow, nebula, slow drift, no auto-rotate.
- [ ] Every note is connected: note → folder hub → parent folder → vault root (faint lines). Wikilinks and frontmatter references (a ticket's `project`/`parent`) draw brighter lines.
- [ ] Hover a note: card with title, folder, a short snippet and link count. Click opens it in a new tab (or reveals it if already open); the brain's tab stays. Ctrl-click opens a split.
- [ ] Hover a folder hub: name and note count. Click focuses it (others dim, camera flies there); click again or the root shows everything. The "All folders" picker does the same.
- [ ] Mouse zoom, rotate and pan work.
- [ ] With ~2,000 notes, frame rate holds the FPS cap on the RTX 3070 (DevTools → Rendering → FPS meter). First open lays out in about a second or less.
- [ ] Recently/often-read notes are gold and larger; notes untouched for 30–90 days are dim.
- [ ] Bloom strength and node size sliders (Brain settings) change the look live; the defaults (1.1, 1.0) look right.
- [ ] Create, rename and delete a note: the graph updates within a second.
- [ ] Switch to another tab or minimise: GPU use drops (rendering paused). Close the Brain tab and Command Center: no "too many WebGL contexts" warning after reopening several times.

### 13.2 Agents on the brain — LOCK-70

- [ ] Start three Claude sessions in the vault (one outside a terminal pane if possible) and trigger sub-agents: each session is a glowing point in its pane colour; the paneless one is named `folder·abcd`.
- [ ] Sub-agents are a lighter shade, named `parent › agent-type`, tethered while both are active.
- [ ] Agents fly to notes they read or write, leaving a short trail; reads flash, writes pulse harder.
- [ ] Every agent carries a name tag in its colour that follows it. Hover shows name and current note. Idle agents fade after 2 minutes; ending a session removes it.

### 14.1 Grading and `kh gaps` — LOCK-68

- [ ] `kh gaps` writes `<vault>/.kyle-hub/gaps/latest.json` for each vault in `KYLE_HUB_VAULTS`; `--vault <path>` limits to one; `kh maintain` runs it.
- [ ] `.kyle-hub/gaps/` is in the vault `.gitignore` (added once).
- [ ] Spot-check five grades: reasons read like `F 42: 1,900 words, not reviewed for 140 days, re-read 9×` and match the notes.
- [ ] Put invalid JSON in `.kyle-hub/grading.json`: report still written, with a `warning`.

### 14.2 Retro gap proposals — LOCK-71

- [ ] Run Perform Retro with a gaps report present: at most 5 gap proposals (split note, write note, review note, split folder) appear as triage findings.
- [ ] Reject one and run Retro again: it doesn't come back until the gap gets worse.
- [ ] Command Center Retro card shows "N gap proposals waiting".

### 15.1 Gaps on the Brain tab — LOCK-72

- [ ] Brain tab shows the Gaps panel beside the full-size brain: worst first, cutoff 70, slider changes it and the "Under N" label.
- [ ] Row click highlights the note on the brain without navigating; clicking the note name or double-clicking opens it in a new tab and the Brain tab stays.
- [ ] Sub-lists: empty searches, missing notes (linkedFrom links open), folders to split, search-time share.
- [ ] Delete `latest.json`: "No gaps data yet. Run `kh maintain`." Run `kh gaps`: panel refreshes on its own.

### 15.2 Terminal sidebar tabs — LOCK-73

- [ ] Sidebar shows Triage n / Todo n / Gaps tabs (no "Queue" label); counts update when a ticket changes status.
- [ ] Last tab is remembered after reload; collapse hides the tab strip and still works; the strip fits the sidebar.
- [ ] Gaps tab: compact worst-first rows; click opens the note in a new tab, the terminal stays.
- [ ] Tickets module off: Triage/Todo show a disabled message, no counts. Brain module off: Gaps shows a disabled message.

### 16.1 Editable templates — LOCK-64

- [ ] Settings → Templates (main tab, shown whichever modules are on) lists six templates.
- [ ] Edit and Save one: `<vault>/.kyle-hub/templates/<id>.md` appears. Reset deletes it and shows the default again.
- [ ] Edit the vault file directly: settings and `kh templates show <id>` show the change without reload.

### 16.2 Default templates — LOCK-69

- [ ] `kh templates show <id>` for all six reads well; each has `reviewed` frontmatter and a valid doctype (`ticket`, `reminder`, `proposal`, `overview`).
- [ ] Add this line to the vault's `Brain/conventions/agent.md` (the shipped template already has it): `- Templates for agents live in `.kyle-hub/templates/` (vault root). You may edit them to fit the work.`
- [ ] A note made from each template shows no brain lint errors.

### 16.3 Code in the vault — LOCK-74

- [ ] Put a code repo (with `.git` or `package.json`) in the vault: `kh gaps` grades none of its notes, and no gaps or brain lint issues mention it. It may still appear on the 3D brain.
- [ ] Add a folder to `exclude` in `.kyle-hub/grading.json`: it drops out of the next `kh gaps` run.

## Brain v3 — LOCK-75 (Phases 17–19)

### 17.1 Brain shape and regions — LOCK-76

- [ ] Brain has two hemispheres with a gap down the middle, lobes, cerebellum and brainstem; folds visible.
- [ ] Top-level vault folders each get a region; root notes sit near the brainstem; nothing jumps on reload.

### 17.2 Scene shapes, themes, rotation — LOCK-77

- [ ] Shape switch morphs over about 1 s; all 11 shapes load (Brain plus the 10 Hivemynd shapes, no Cerebrum).
- [ ] Morph doesn't hitch at the FPS setting on a vault of about 500 notes.
- [ ] Every one of the 10 themes renders with no white-out; Inkblot (light) stays readable behind the see-through cards.
- [ ] Multiverse and Inkblot colours look right (values were chosen by the agent, not copied from Hivemynd).
- [ ] Screenshots for LOCK-77: Brain, Galaxy, and an Inkblot-themed brain (needs Obsidian started with `--remote-debugging-port=9222`).
- [ ] Theme switch changes only the brain; cards keep Obsidian colours.
- [ ] Region labels replace folder hubs; tree edges are hidden.
- [ ] Auto-rotate slider 0–1 (default 0.3): pauses on drag, zoom and folder fly, and resumes after about 5 s; 0.3 feels right.

### 18.1 Orbiting agents — LOCK-78

- [ ] Each running session orbits the brain from start to end in its own colour; sub-agents appear as smaller moons.
- [ ] A read or write zaps a lightning line to the note; writes are brighter; no flights or trails.
- [ ] Orbit mode (drift, still, solar, atom) and orbit line colour and opacity settings apply live.
- [ ] Orbit speed slider (0–2, default 1) changes orbit speed live without agents jumping; 0 freezes them.
- [ ] A session idle for 10 minutes is still orbiting.
- [ ] A sub-agent's moon stays while the sub-agent is quiet (for example, during a long command) and disappears when it finishes.

### 18.2 Name tags and toasts — LOCK-81

- [ ] A Claude session's tag says Claude (or its first prompt / title), never the shell name.
- [ ] Agent name tags are always visible; clashing titles show the short ID; sub-agent tags are smaller.
- [ ] Toasts appear bottom-right in the Command Center only: one per agent, merged within 2 s, gone after 3 s, max 5 plus a faded 6th.
- [ ] Hover pauses a toast; click opens its note; toasts can be turned off in settings.
- [ ] A burst of reads from one agent shows a single toast ("<name> read N notes · ./last.md").

### 19.1 No Brain tab; brain menu — LOCK-79

- [ ] No Brain tab, nav item or command; an old saved Brain tab opens the Command Center.
- [ ] Brain icon in the Brain Vitals title row opens the menu: folder focus, theme, shape, orbit mode, colour, opacity, rotation, toasts, per-min/per-hour.
- [ ] Settings tab offers the same options and they stay in sync with the menu.
- [ ] Menu keyboard: Esc closes it and returns focus to the brain icon; Tab moves between controls.

### 19.2 Retro card and scrolling lists — LOCK-80

- [ ] Command Center Retro card has Perform Retro with "Last retro" and "N sessions since last retro"; the terminal sidebar no longer has the button.
- [ ] Perform Retro (term module on) shows its result in the scrolling box; with term module off the button is hidden.
- [ ] Box lists last retro clusters and tickets; clicking a ticket opens it.
- [ ] Box lists doc gaps worst first under the cutoff (setting, default 70); clicking a note opens it in a new tab.
- [ ] Terminal sidebar Queue has only Triage and Todo tabs; there is no Gaps side panel anywhere.
- [ ] With 40 proposals and 40 gaps, the Command Center page height does not change; each list card scrolls inside itself.

## WSL2 vault (ADR-0014)

> **Windows 10:** Windows Obsidian can't open the WSL share there (`fs.watch` fails with `EISDIR` on `\\wsl.localhost`, `\\wsl$` and mapped drives), so these checks only apply where Windows Obsidian can open it (e.g. Windows 11 with mirrored networking). On Windows 10, use the "Linux Obsidian in WSLg" section instead ([ADR-0014](adr/0014-wsl2-vaults.md)).

Setup: vault at `/home/<user>/<vault>` in WSL2, opened in Windows Obsidian as `\\wsl$\<distro>\...` (or `\\wsl.localhost\...`). kyle-hub adds a "WSL (<distro>)" shell profile for it.

- [ ] `npm run deploy` lists `deployed -> \\wsl.localhost\Ubuntu\home\...\kyle-hub`; in WSL, `ls ~/locked-away/.obsidian/plugins/kyle-hub` shows `main.js`, `helper/`, `hooks/` and `node_modules/@lydell/node-pty-win32-x64`. Reload kyle-hub: terminals start (the helper loads node-pty from the share).
- [ ] New terminal in the vault: the pane title or profile reads "WSL (Ubuntu)"; `pwd` prints `/home/<user>/<vault>`.
- [ ] Right-click a subfolder > "New Claude session here": WSL shell, `pwd` is that subfolder's Linux path, and `claude` runs from WSL (`command -v claude` gives `/home/<user>/.local/bin/claude`; `/status` shows Linux `~/.claude`).
- [ ] Restart Obsidian with a Claude session open: it restores in WSL; Resume types `claude --resume <id>` in the same Linux folder.
- [ ] Sessions saved in the old Windows copy (cwd `C:\...`) restore in WSL at the vault root.
- [ ] A saved folder or Claude start folder on `C:\` still opens with the Windows default profile (PowerShell).
- [ ] Run "Install hooks": the diff replaces each `node "C:\...\kyle-hook.js" <Event>` with `node "${CLAUDE_PROJECT_DIR}/.obsidian/plugins/kyle-hub/hooks/kyle-hook.js" <Event>`, one per event and no duplicates. Run it again: "already installed".
- [ ] "Run doctor" (settings) and `kh doctor` report kyle-hook ok. Before migrating, they warn "uses an absolute path".
- [ ] In a WSL terminal, `echo $KYLE_TERM_SESSION $KYLE_TERM_PORT $KYLE_TERM_WSL_HOST` prints all three (the last is `<ip>:<port>`; if it is empty, open a new terminal once WSL is running).
- [ ] Claude in WSL: no `MODULE_NOT_FOUND` hook errors (`claude --debug`, or check `/hooks`).
- [ ] Allow Obsidian through Windows Firewall on the WSL adapter. Accept the prompt for Public networks, or run in admin PowerShell: `New-NetFirewallRule -DisplayName "kyle-hub WSL hooks" -Direction Inbound -InterfaceAlias "vEthernet (WSL)" -Program "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe" -Action Allow`. Status lights then change for the WSL Claude session.
- [ ] Windows 11 only: with `networkingMode=mirrored` in `%USERPROFILE%\.wslconfig`, lights work without the firewall rule (loopback path).
- [ ] The same vault opened from a Windows path still works: Claude on Windows (Git Bash and PowerShell-only) shows lights with the portable entry.
- [ ] Claude started in a vault subfolder: note whether it loads the vault's `.claude/settings.local.json`. If it does, `${CLAUDE_PROJECT_DIR}` is the subfolder and the hook fails silently (no lights); report it.

## Configurable brain folder

- [ ] kyle-hub settings > Brain: "Brain folder" is empty (placeholder `Brain`) and "Conventions folder" is empty (placeholder `Brain/conventions`).
- [ ] In locked-away, set "Conventions folder" to `docs/conventions` and leave "Brain folder" alone (pointing it at `docs` would lint all 107 notes there, including ADRs and plugin docs). "Create style conventions" then reports the files already exist.
- [ ] Set "Brain folder" to a folder of brain docs (e.g. `docs/brain`). Within about a second the Brain Vitals health and the Docs count reflect only that folder. New doc > lesson > vault creates `docs/brain/lesson/<slug>.md`.
- [ ] `kh lint docs --vault` lints the configured brain folder (read from the vault's `data.json`), not `Brain/`.
- [ ] Promote to home writes to the home vault's own brain folder (`<home>/<its brain folder>/lessons/`); `kh promote --brain-folder <dir>` overrides it.
- [ ] After the brain scene saves its layout once, `data.json` has no `layoutCache` keys under the old `Brain/` tree.

## Linux Obsidian in WSLg (ADR-0014, Windows 10)

Setup: Linux Obsidian installed in WSL2 and launched through WSLg (`DISPLAY=:0`), opening `/home/<user>/<vault>`. The deploy target in `.env.local` is still `\\wsl.localhost\Ubuntu\home\<user>\<vault>`.

- [ ] `npm run deploy` lists the WSL target; `ls ~/<vault>/.obsidian/plugins/kyle-hub/node_modules/@lydell` shows `node-pty-linux-x64`.
- [ ] Enable kyle-hub in Linux Obsidian; a new terminal starts (the helper uses `/usr/bin/node`, or the Node path setting). The profile is "Login shell (bash)", and there is no "WSL (...)" profile.
- [ ] Launch Obsidian from the WSLg Start-menu entry (minimal env) and open a terminal: `command -v claude node` prints `~/.local/bin/claude` and `/usr/bin/node`.
- [ ] New Claude session: types `claude` into the Linux shell; `/status` shows Linux `~/.claude`.
- [ ] In a terminal, `echo $KYLE_TERM_SESSION $KYLE_TERM_PORT` prints both, and `$KYLE_TERM_WSL_HOST` and `$WSLENV` are empty.
- [ ] Run "Install hooks" from Linux Obsidian: entries become `node "${CLAUDE_PROJECT_DIR}/.obsidian/plugins/kyle-hub/hooks/kyle-hook.js" <Event>` (replacing the old `/home/...` absolute ones); doctor reports kyle-hook ok.
- [ ] A Claude session shows working/needs-input/finished lights (hooks reach 127.0.0.1; no firewall rule needed).
- [ ] Sessions restored from the old Windows `data.json` (cwd `C:\...`) start in the vault root with the login shell.
