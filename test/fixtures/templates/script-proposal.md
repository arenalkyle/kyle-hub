---
doctype: proposal
audience: human
reviewed: 2026-11-20
---
# Script: count words per note

## Replaces

Agents opening each note to judge its size. Replaces repeated `Read` calls on large notes.

## Inputs

- Folder path, for example `Brain/lessons`.

## Outputs

- One line per note: word count, tab, path.
- Exit code 0, or 1 when the folder is missing.

## Deterministic

No network, clock or random input. Notes are read in sorted path order. Words split on whitespace after the frontmatter is dropped. A test pins the output for a fixed folder.
