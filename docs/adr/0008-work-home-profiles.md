# Work and home are separated by profile, vault and log tree

Every repo in the repo map has `profile: work | home`. Work tickets live in a separate work vault; logs live under separate `<profile>` trees; the plugin refuses to launch a repo whose profile doesn't match the vault's. Work retro tickets carry signatures and counts only, no excerpts. Lessons move from work to home only through **Promote**: a deterministic scrubber plus human review of the diff.
