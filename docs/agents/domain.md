# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root, or `CONTEXT-MAP.md` if the repository later becomes multi-context.
- `docs/adr/` for decisions that touch the area being changed.

If a referenced document does not exist, proceed without treating its absence as a task failure. Create it when a domain decision has been resolved and needs a durable home.

## File structure

This repository uses a single context:

```
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

Use the glossary terms defined in `CONTEXT.md` in issue titles, tests, and implementation notes. Surface conflicts with an existing ADR instead of silently overriding them.
