# The `kh` CLI is the backend; the plugin is UI

All automation lives in a pure Node CLI, `kh`, built on the Obsidian-free `core/domain` code (an extension of today's `kt`). Hooks, a Windows scheduled task and the plugin all call it, so ingest, retention and expiry run even when Obsidian is closed. `kt` stays as a shim for `kh tickets …` so existing skills keep working.
