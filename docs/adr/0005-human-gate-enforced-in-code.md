# The human triage gate is enforced in code

Agents can only create tickets in Triage. `kh`/`kt` called with `--agent` refuses to add the `agent-ready` label or set a completed-category status, and moving to Done is blocked while acceptance criteria are unchecked (a human override is logged). Convention alone would erode the human gate the closed loop depends on.
