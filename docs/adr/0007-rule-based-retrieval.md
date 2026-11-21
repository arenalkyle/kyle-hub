# Context-pack retrieval is rule-based, with no embeddings

Docs for a context pack are chosen by priority: those linked from the ticket or project, then the repo's include list, then ADR and glossary entries whose titles or terms appear in the ticket text (ripgrep), truncated to an ~8k-token budget. No vector index or LLM ranking: deterministic, explainable, and zero-cost. Repo-specific docs stay in the repo; brain indexes them read-only and keeps only cross-project docs in the vault.
