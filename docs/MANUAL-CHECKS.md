# Manual checks

Steps that need someone using Obsidian. One section per ticket, appended as each ticket is closed. Tick the boxes as you run them.

## 1.1 Repo + core skeleton — LOCK-43

- [ ] `git log --oneline | wc -l` shows ~130+ commits; `git log ada8a65^2 --oneline | head -5` shows old kyle-tickets commits (`git log -- src/modules/tickets` shows only the merge commit — inherent to `git subtree`).
- [ ] Run `npm run deploy`, enable **kyle-hub** in the test vault: no errors in the dev console (old plugins can stay enabled).
- [ ] kyle-hub settings tab shows toggles for Tickets, Terminals, Brain, Command center; Core is greyed out.
- [ ] `kt --help` works (global `kt` was re-linked from kyle-tickets to kyle-hub).
