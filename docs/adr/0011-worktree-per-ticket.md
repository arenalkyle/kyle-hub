# Each ticket runs in its own git worktree

A launch creates or reuses `<repo-parent>/.kh-worktrees/<repo>/<ID>` on branch `kh/<ID>-<slug>`, with a per-repo opt-out. This allows parallel runs without clobbering each other, makes relaunch double as resume, and keeps paths free of spaces. Cleanup is offered, never automatic, once the ticket is Done and its branch is merged.
