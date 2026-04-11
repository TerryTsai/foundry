// GitHub development-flow server. Tools operate against the session's
// shared working directory (the same tmpdir the sandbox server mounts into
// its containers). At session start a before-hook clones the configured
// project repo into that dir; at session end an after-hook pushes
// `foundry/<session-id>` and opens a draft PR against the default branch.
//
// Scope is deliberately narrow for v1: inspect, stage, commit. No API
// operations (issue search, PR review, code search) — those live in the
// community GitHub MCP server if we want them later.
//
// The scoped git subset rejects -A, --all, `.`, globs, absolute paths, and
// paths inside known-trash directories. This is the RCA-001 #2 mitigation.
//
// Metadata-only for now — implementation lands in a later commit.

import type { McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'github',
  name:        'GitHub',
  description: 'Development flow against a configured GitHub repo: inspect, stage, commit, open draft PRs.',
  tools: [
    { name: 'gitStatus',         description: 'Show the working tree status (porcelain format).' },
    { name: 'gitDiff',           description: 'Show the working-tree or staged diff, optionally scoped to paths.' },
    { name: 'gitAdd',            description: 'Stage specific paths for commit. Literal paths only — no -A, no wildcards.' },
    { name: 'gitRemove',         description: 'Remove paths from the working tree and index (git rm).' },
    { name: 'gitCommit',         description: 'Commit the staged index with a message.' },
    { name: 'pullRequestCreate', description: 'Push the session branch and open a draft pull request.' },
  ],
}
