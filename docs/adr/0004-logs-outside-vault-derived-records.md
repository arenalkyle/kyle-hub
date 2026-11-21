# Logs live outside the vault as redacted derived records, not transcript copies

Logs live in `%LOCALAPPDATA%\kyle-hub\<profile>\`. Transcripts already exist in `~/.claude/projects`; ingest reads them incrementally (byte offset per file) and writes only compact, redacted derived records (`runs/<runId>.jsonl`) plus a run index (`index.jsonl`). Redaction happens before write. Derived records are kept 365 days, context packs 30 days. No SQLite, to avoid native modules in the Obsidian bundle; the volume is small enough to scan. Revisit with a new ADR if full-text search is needed.

## Consequences
Claude Code's `cleanupPeriodDays` must exceed the ingest interval or transcripts vanish before ingest; setup warns when it doesn't.
