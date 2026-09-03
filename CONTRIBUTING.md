# Contributing

Keep Foundry smaller than the problem it coordinates.

Before adding a concept, verify that it cannot remain repository state, task Markdown, Git history, native harness configuration, or ephemeral process state. The visible domain is Projects and Tasks; the Worker is workspace configuration.

Changes should preserve these invariants:

- task states remain exactly queued, working, needs_you, paused, and done;
- a project has at most one Working task;
- autonomous execution never runs on the host;
- scheduler choice is deterministic;
- GitHub remains sufficient to reconstruct meaningful state;
- task files are current briefings, not journals;
- harness behavior and configuration stay native to the harness.

Run `npm run check` before handing off a change.
