# Linear tracks the build until cutover; kyle-tickets after

kyle-hub's sub-phases are tracked in Linear (team LockedAway) because Phases 1–2 refactor kyle-tickets itself, and a tracker shouldn't track its own teardown. Sub-phase 2.2 builds `kh import linear` (idempotent, original id kept in `linearId`); it imports the LOCK project, including the open kyle-hub tickets, and from Phase 3 on work is tracked in kyle-hub. Linear then becomes read-only history.
