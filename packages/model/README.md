# @foundry/model

The bottom of the dependency graph. Defines shared types — entities, error unions, `Ctx`, `Result` — that cross module boundaries. Depends on nothing (not even `zod` for v1).

A type belongs here only when at least two modules need it. Single-module types stay internal to their module. Promotion to `model` is a deliberate, visible move.

See `/ARCHITECTURE.md` for the rules.
