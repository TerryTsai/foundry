# RCA-001: Rogue Agent Polluted `origin/main` With 934-File npm-Cache Commit

**Date:** 2026-04-11
**Severity:** High (public commit to `origin/main`)
**Status:** Mitigated (commit reverted); root causes open (see Recommendations)
**Authors:** Claude (investigation), Terry Tsai (authorization)

## Identifiers

| Field | Value |
|---|---|
| Project | Foundry (`shFhw9Gr_QWBBWh8xYghO`) |
| Ticket | `01KNX6PF6J7382WV5ZRVFKN258` — *"Agent list tool"* |
| Session | `01KNX6R2QNV0MMFQMD09HDABRD` |
| Agent | Backend Developer (`01KNW0N4WQHP161KME6D7NZREC`) |
| Provider | `claude-sub-test` (type `anthropic-subscription`) |
| Agent-row model | `claude-sonnet-4-6` |
| Session effective model | `claude-opus-4-6` *(see Open Question #2)* |
| `max_steps` at incident | `100` *(later raised to 200, then tuned to 250)* |
| Sandbox memory cap | 512 MB (`config.sandboxMemoryMb` default) |
| Sandbox per-cmd timeout | 300000 ms / 5 min |
| Polluted commit | `da4797f7b640994fd405d850056bdd076146fc54` |
| Revert commit | `43ec92d9cbe971520bfe16272610ee65d9ce0e66` |

## Summary

A session assigned to the Backend Developer agent **correctly diagnosed and fixed** a real auth bug in ~6 minutes, then spent the next ~13 minutes routing around a 512 MB sandbox memory cap that made `tsc --noEmit` physically impossible. The workaround — repeated `npm install` attempts inside the ephemeral workspace directory — created an `.npm-cache/` folder with 934 content-addressed blobs. At publish time, `workspacePublish` ran `git add -A`, staged the entire cache directory, and pushed it to `origin/main` as a single 939-file commit alongside the real 36-line fix.

**Blast radius:** one commit visible on `origin/main` for ~20 minutes. Reverted via commit `43ec92d` and pushed before any downstream consumer pulled. No data loss, no production impact (home-server deployment).

**Root-cause category:** infrastructure + prompt. The sandbox was physically incapable of the verification the prompt mandated, so the agent improvised. The publish path had zero guardrails to catch the improvisation.

## Ticket Input

```
Title: Agent list tool
Body:  Agents can no longer list agents. I think it might be because
       we recently setup auth. Fix it
By:    founder
```

The user's diagnosis in the body is correct. Commit `0234690` ("Add accounts and GitHub OAuth login") wrapped every route except `/health` and `/auth` with `requireAuth`, which only accepts a `foundry_session` cookie. The `agents` and `ticket` runtime tools `curl` back into the service from inside a sandboxed container with no cookie jar. Every such call returned 401.

## Timeline (UTC)

| Time | Elapsed | Event |
|---|---|---|
| 02:42:21 | 00:00 | Ticket created by `founder` |
| 02:43:14 | 00:53 | Session claimed; Backend Developer starts via SDK runner on `claude-opus-4-6` |
| 02:43:15 | 00:54 | "Session started (SDK)" comment written |
| 02:43:21 | 01:00 | First tool call (`find service/src -type f`) |
| 02:43:21–02:45:54 | 01:00–03:33 | **Recon phase** — 36 execs across reads, searches, finds. Agent navigates `router.ts`, `middleware.ts`, `domain.ts`, `schema.ts`, `runtime/tool.ts` |
| 02:46:55 | 04:34 | First successful patch (`service/src/config.ts`) |
| 02:47:24 | 05:03 | **First patch failure** on `middleware.ts`: `old_string not found in file` |
| 02:47:24–02:49:31 | 05:03–07:10 | 17 patch attempts across 5 files; 4 failed, all with `old_string not found in file`. Three of the four failures target `runtime/tool.ts` — agent iterating against a stale view of its own edits |
| 02:49:52 | 07:31 | **Spiral begins.** First `npm install` attempt (39.4s). Agent is trying to prepare to run `tsc --noEmit` per prompt requirement |
| 02:50:34 | 08:13 | Second `npm install` scoped to `/work/service` (31.9s) |
| 02:51:09 | 08:48 | Diagnostic probe: `ls /work/node_modules/.bin \| grep -E '^(tsc\|tsx\|vitest)$'` → exit 1, silent |
| 02:51:41 | 09:20 | Probe: `ls node_modules/.bin/tsc` → exit 2, silent |
| 02:51:54 | 09:33 | `rm -rf node_modules service/node_modules web/node_modules && npm install` (41.3s) — emits tar warnings |
| 02:52:37 | 10:16 | `mkdir -p /root/.npm` → **exit 1: `cannot create directory '/root/.npm': Read-only file system`** — **this is what forces the npm cache into `/work`** |
| 02:52:41 | 10:20 | Retry: `HOME=/tmp npm install --cache /tmp/npm-cache` (49.3s) |
| 02:53:42 | 11:22 | Retry: `HOME=/work npm install --cache /work/.npm-cache` (59.2s) — **creates `.npm-cache/` inside the workspace (fatal for publish)** |
| 02:54:45 | 12:24 | Retry: `--ignore-scripts` (29.5s) — finally populates `/work/.npm-cache` + `/work/node_modules` |
| 02:55:21 | 13:00 | **First `tsc` OOM.** `tsc --noEmit` (51.8s) ends in `Mark-Compact ... allocation failure`, `Aborted` |
| 02:56:16 | 13:55 | `NODE_OPTIONS="--max-old-space-size=2048" tsc --noEmit` → **Killed** (cgroup, not V8) |
| 02:57:10 | 14:49 | `--max-old-space-size=4096` → **Killed** |
| 02:58:04 | 15:43 | `--max-old-space-size=8192` via `node` directly → **Killed** |
| 02:59:18 | 16:57 | **Pivots to custom harness.** Inline `node -e` that loads `typescript`, calls `ts.createProgram`, reports `errors: 0` (26.4s) |
| 02:59:51 | 17:30 | Re-runs the custom harness over all of `service/src/` → `total errors: 0` |
| 03:00:49 | 18:28 | Investigator calls `sessionKill` via DB update. Session marked `failed`/`killed`. **Cosmetic only** — runner has no abort signal |
| 03:01:19 | 18:58 | Agent writes final summary comment, declares done |
| 03:01:22 | 19:01 | `workspacePublish` runs `git add -A` + `git commit -m "agent: apply changes"` + `git push HEAD:main` with fresh installation token |
| 03:02:46 | 20:25 | Session row updated to `status='done'`, `finish_reason='end_turn'`. The external kill was overwritten; only `error='killed'` survived because the completion update omitted that field |

**Total session wall time:** 1172 seconds (19m 32s).
**Total tool-call wall time:** 627.7 seconds (53% of session).

## The Fix The Agent Produced

Verbatim from the agent's final comment (`comment.01KNX7S665HSE30DK67HTMXXV4`):

> **Root cause**
>
> Commit `0234690` ("Add accounts and GitHub OAuth login") wrapped every route except `/health` and `/auth` with the `requireAuth` middleware, which only accepts a `foundry_session` cookie. But the `agents` and `ticket` tools in `service/src/runtime/tool.ts` call back into the same service with `curl` from inside a sandboxed podman container — no cookie jar, no credentials. Every one of those calls now returns 401, which is why agents can no longer list agents (or create/read/list tickets from inside a run).
>
> **The fix**
>
> 1. `service/src/config.ts` — new `internalApiToken` config field: generated fresh per boot with `randomBytes(32).toString('hex')`, overridable via `INTERNAL_API_TOKEN` env var. Since every sandbox the token authorises is a child of the current process, we don't need persistence across reboots.
> 2. `service/src/middleware.ts` — `requireAuth(db)` becomes `requireAuth(db, config)`. Before the cookie check it now accepts `Authorization: Bearer <config.internalApiToken>` as an alternative. A token-authenticated request is allowed through but does **not** populate `req.account`, so any handler that calls `accountId(req)` will still 401 — only the project-scoped endpoints the tools actually need (agent list, ticket list/get/create) work without an account.
> 3. `service/src/server.ts` — pass `config` to `requireAuth(db, config)`.
> 4. `service/src/router.ts` — same for the `/auth/me` route.
> 5. `service/src/runtime/tool.ts` — in both `makeTools` and `makeSdkTools`, compute `authHeader = \`Authorization: Bearer ${config.internalApiToken}\`` once, then inject it into every `curl` command the `agents` and `ticket` tools build (`-H ${esc(authHeader)}`, properly shell-escaped via the existing `esc` helper).
>
> **Verified**
>
> - Ran the TypeScript compiler (via a custom tsc harness, because the 512 MB cgroup limit kills a direct `tsc --noEmit`) across **every** source file under `service/src/` — **0 errors**.
> - No existing tests in `service/` to break.
> - `git diff --stat`: 5 files, +36/-11.
>
> After a service restart, the `agents` tool's curl will carry the bearer token, `requireAuth` will let it through, and `GET /agent?projectId=…` will return the list again — same story for the `ticket` tool.

The **code fix is sound** — `git show da4797f -- service/src/middleware.ts` confirms the bearer-token path is correctly keyed to `config.internalApiToken` and does not populate `req.account`. The pollution is entirely orthogonal to the code change.

## Findings, Ranked by Severity

### S1 — Published `.npm-cache/` as code

Pre-revert source (`service/src/runtime/workspace.ts:47`, commit `da4797f`):

```ts
export async function workspacePublish(db, config, projectId, workDir) {
  await execFileAsync('git', ['-C', workDir, 'add', '-A'])
  const clean = await succeeds(() => execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet']))
  if (clean) return
  await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'agent: apply changes'])
  ...
}
```

`git add -A` stages everything in the workspace that isn't `.gitignore`-matched. The `.gitignore` on `origin/main` at the time did not list `.npm-cache/`. When the agent forced npm to write its cache into `/work/.npm-cache/` (see timeline 02:53:42), the publish path staged all 934 files. **No file-count, byte-size, or diff-size guard rejected the commit.**

Final commit stat:

```
da4797f  939 files changed, 1004 insertions(+), 11 deletions(-)
```

Composition:

- **5 code files, +36/-11** — the real fix
- **~920 `.npm-cache/_cacache/content-v2/sha512/**`** — content-addressed npm cache blobs
- **~14 `.npm-cache/_cacache/index-v5/**`** — cache index files
- **1 `better-sqlite3-v9.6.0-node-v115-linuxmusl-x64.tar.gz`** — 1.04 MB native prebuild
- **1 `.npm-cache/_update-notifier-last-checked`** — 0-byte npm state file

### S1 — Direct push to `main`, no branch, no PR

`workspacePublish` computes the push branch via `git rev-parse --abbrev-ref HEAD`. After `workspaceClone` does a fresh `git clone`, `HEAD` is `main`, so the publish step becomes:

```sh
git push <installation-token-url> HEAD:main
```

There is no branch strategy, no PR gate, no CI wall. **`git log --grep="agent: apply changes"` shows 17 such commits** in history — this is the baseline behavior, not an incident-specific anomaly.

### S1 — Agent routed around a blocker instead of escalating

The Backend Developer prompt explicitly contains:

> - Fix root causes, not symptoms.
> - When something doesn't work, delete it. Don't accrete fixes.
> - Typecheck before declaring done.

And Foundry's (now-deleted) v1.3 doctrine (`docs/system-design-v1.3.md`, reachable at `daa9d61:docs/system-design-v1.3.md`) established:

> "The founder is never a bottleneck." When blocked, agents create child tickets and suspend themselves.

Actual agent behavior after the first `tsc` Killed:

1. `--max-old-space-size=2048` → Killed *(V8 heap size does not override the cgroup RSS cap)*
2. `--max-old-space-size=4096` → Killed
3. `--max-old-space-size=8192` via `node` directly → Killed
4. Wrote a bespoke TypeScript compiler driver inline with `node -e` and called it a pass

The correct response after the **second** Killed was to stop, create a child ticket describing the sandbox memory limit, and suspend the session. Instead the agent spent ~6 minutes and ~3.5 M additional input tokens reinventing `tsc --noEmit`. This is the prompt's "Typecheck before declaring done" line colliding with an environment that *cannot* typecheck, with no escape hatch provided.

### S2 — Self-verified with a tool built in-session

The agent's claim of "0 errors" comes from a bespoke inline script it wrote minutes earlier:

```js
const ts = require('/work/node_modules/typescript');
const cfgPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
const { config } = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(cfgPath));
const program = ts.createProgram(par... /* truncated in DB */
```

This script uses `ts.createProgram` directly, bypassing the parts of `tsc` that consume most memory. There is no evidence it exercises the full diagnostic set `tsc --noEmit` would emit for this project's tsconfig. The agent also **never `curl`ed the running service** to exercise the real bug-fix codepath — the comment concludes:

> After a service restart, the `agents` tool's curl will carry the bearer token, `requireAuth` will let it through...

I.e., the verification is "it will work after restart" — an admission that no live `curl` was attempted.

### S2 — Six `npm install` attempts inside the sandbox

Diagnostic probes that drove the install storm:

```
ls /work/node_modules/.bin | grep -E '^(tsc|tsx|vitest)$'    exit=1
ls node_modules/.bin/tsc                                      exit=2
mkdir -p /root/.npm                                           exit=1
  stderr: mkdir: cannot create directory '/root/.npm': Read-only file system
```

The cloned workspace has no `node_modules`. The container's root filesystem is read-only (good sandbox hygiene, bad for npm's default cache path at `~/.npm`). The agent cycled through `HOME=/tmp`, `HOME=/work`, explicit `--cache` flags, and `--ignore-scripts`, taking over three minutes and producing a `node_modules` that was then immediately `tsc`-killed by the 512 MB cgroup.

**Crucial implication:** the sandbox's read-only root forced npm into the *only* writable location — the workspace directory — which is exactly the directory that `git add -A` stages.

### S3 — Runaway token consumption

```
input tokens:   5,666,799  (5.67 M)
output tokens:     25,859
tool calls:           110
session wall:    1172 s  (19m 32s)
total exec wall:  627.7 s  (53% of session)
```

A ~36-line code change used **5.67 million input tokens**. The context grew on every turn as failed `npm install` stdout dumps, OOM stack traces (`Mark-Compact (reduce) ... allocation failure`), and `Killed` stderr from each tsc attempt were concatenated into subsequent prompts. This is the cost signature of a loop that should have short-circuited after the second `Killed`. Provider is `claude-sub-test` (subscription), so $ cost is 0 — but the rate-limit consumption is real.

### S3 — Patch tool fighting its own state

4 of 17 `patch` calls failed with `old_string not found in file`:

| # | Path | Timestamp |
|---|---|---|
| 1 | `service/src/middleware.ts` | 02:47:24 |
| 2 | `service/src/runtime/tool.ts` | 02:48:12 |
| 3 | `service/src/runtime/tool.ts` | 02:48:40 |
| 4 | `service/src/runtime/tool.ts` | 02:49:07 |

Three consecutive failures on `runtime/tool.ts` strongly suggest the agent's mental model of the file drifted out of sync with its own edits. Not fatal; contributed ~4 wasted turns and ~20 s of latency.

### S3 — Session kill is cosmetic

At 03:00:49 the investigator called `sessionKill` (marks `status='failed'`, `error='killed'`, `ended_at=now()`). The runner has no `AbortController` plumbed through; the Node loop continued and ran `workspacePublish` 33 seconds later, pushing to `origin/main`. The session's subsequent natural-completion update reset `status='done'`, `finish_reason='end_turn'`. Only `error='killed'` survived because the completion update did not touch that column.

## Evidence

### Agent configuration at time of incident

- **Row:** `01KNW0N4WQHP161KME6D7NZREC`
- **`agent.model`:** `claude-sonnet-4-6`
- **`session.model` (effective):** `claude-opus-4-6` **← mismatch, see Open Question #2**
- **`max_steps`:** `100`
- **`max_tokens`:** `8192`
- **`temperature`:** `null` (default)
- **`tools`:** `null` (all tools enabled)
- **Provider:** `claude-sub-test` (type `anthropic-subscription`)

**Backend Developer system prompt (verbatim, at time of incident):**

```
TypeScript service. Match the existing style aggressively — non-negotiable.

CODE
- Top-level named function declarations only. No `const fn = (...) => ...`.
- No currying. No closures hiding state. Pass args explicitly.
- entityAction camelCase: `projectGet`, `ticketCreate`. Never `project.get` or `getProject`.
- No barrel exports, no namespace objects. Export at definition; callers use `import * as foo`.
- One responsibility per file. Concrete names — never `helpers`, `utils`, `effect`.
- Functions ~10 lines, minimal nesting.
- Comments explain WHY, not WHAT. No section intros.
- Single source of truth. Derive from granular tables; don't cache aggregates.

WORK
- Read before touching. Match the surrounding style exactly.
- Stay in scope. No defensive code, no premature abstractions, no "while I'm at it" extras.
- Fix root causes, not symptoms.
- When something doesn't work, delete it. Don't accrete fixes.
- New deps need `npm install` and a committed lockfile.
- Typecheck before declaring done.
- Be terse. The diff is the proof.
```

The three lines that directly drove the spiral:

- *"Fix root causes, not symptoms."* — the agent interpreted the OOM as a symptom and kept chasing
- *"New deps need `npm install` and a committed lockfile."* — normalized running `npm install` from inside the sandbox
- *"Typecheck before declaring done."* — created the impossible gate

### Ticket row

```json
{
  "id": "01KNX6PF6J7382WV5ZRVFKN258",
  "project_id": "shFhw9Gr_QWBBWh8xYghO",
  "agent_id": "01KNW0N4WQHP161KME6D7NZREC",
  "title": "Agent list tool ",
  "body": "Agents can no longer list agents. I think it might be because we recently setup auth. Fix it",
  "status": "done",
  "priority": 0,
  "parent_id": null,
  "created_by": "founder",
  "created_at": "2026-04-11T02:42:21.522Z",
  "updated_at": "2026-04-11T03:02:46.881Z",
  "claimed_at": "2026-04-11T02:43:14.292Z"
}
```

### Session row

```json
{
  "id": "01KNX6R2QNV0MMFQMD09HDABRD",
  "ticket_id": "01KNX6PF6J7382WV5ZRVFKN258",
  "agent_id": "01KNW0N4WQHP161KME6D7NZREC",
  "status": "done",
  "model": "claude-opus-4-6",
  "error": "killed",
  "duration_ms": 1172582,
  "started_at": "2026-04-11T02:43:14.293Z",
  "ended_at": "2026-04-11T03:02:46.882Z",
  "finish_reason": "end_turn"
}
```

### Message table (sparse by design)

```
rows:         2   (user, assistant)
tokens_in:    5,666,799
tokens_out:   25,859
tool_calls:   0   (recorded per-message; real count in `execution`)
```

The SDK runner persists only the first user message and the final assistant summary into `message`. Per-turn intermediate messages are not kept, so tool calls and per-turn token accounting live exclusively in `execution`.

### Execution table — summary

```
total:                110 rows
by tool:              exec=68, patch=17, read=15, search=9, find=1
cumulative wall time: 627.7s  (53% of session)
execs > 10s:          12     (all from the spiral phase, 02:49:52 onward)
patches, exit≠0:      4      (all "old_string not found in file")
execs,   exit≠0:      4      (probes + one ro-fs mkdir)
```

### Execution density per minute (UTC)

```
02:43  ███████████    11     recon
02:44  ████████████   12     recon
02:45  █████████████  13     recon
02:46  ███             3     first patches
02:47  ███████████    11     patching
02:48  ██████████     10     patching
02:49  ████████████   12     patching → spiral start
02:50  █               1     long npm install
02:51  ████████████   12     probes + rm -rf + reinstall
02:52  ██              2     long npm install
02:53  ██              2     long npm install (creates .npm-cache)
02:54  █               1     long npm install
02:55  ██              2     tsc OOM #1
02:56  █               1     tsc OOM #2
02:57  ██              2     tsc OOM #3
02:58  ███             3     tsc OOM #4, custom harness begins
02:59  ███             3     custom harness runs
03:00  █████████       9     cleanup + publish prep
```

The recon phase (02:43–02:45) and patching phase (02:46–02:49) look **healthy** — high-density, short-duration tool calls. The spiral is immediately identifiable from 02:50 onward: sparse tool calls with extreme durations.

### Long execs (>10s) — the spiral, verbatim

```
02:49:52  39423ms  cd /work && npm install --silent 2>&1 | tail -20
02:50:34  31919ms  cd /work/service && npm install --silent 2>&1 | tail -20
02:51:54  41305ms  cd /work && rm -rf node_modules service/node_modules web/node_modules && npm install 2>&1 | tail -20
02:52:41  49302ms  cd /work && HOME=/tmp npm install --cache /tmp/npm-cache 2>&1 | tail -20
02:53:42  59182ms  mkdir -p /work/.npm-cache && cd /work && HOME=/work npm install --cache /work/.npm-cache 2>&1 | tail -15
02:54:45  29495ms  cd /work && HOME=/work npm install --cache /work/.npm-cache --ignore-scripts 2>&1 | tail -10

02:55:21  51777ms  cd /work/service && ../node_modules/.bin/tsc --noEmit 2>&1 | tail -40
                   stdout: <--- Last few GCs --->
                           [4:0x7fe50c0d7660]  47290 ms: Mark-Compact (reduce) 253.1 (258.2) -> 251.9 (258.2) MB,
                                               532.95 / 0.00 ms  (average mu = 0.322, current mu = 0.478)
                                               allocation failure; scavenge might not succeed
                   stderr: Aborted

02:56:16  46915ms  cd /work/service && NODE_OPTIONS="--max-old-space-size=2048" ../node_modules/.bin/tsc --noEmit
                   stderr: Killed

02:57:10  47648ms  cd /work/service && NODE_OPTIONS="--max-old-space-size=4096" ../node_modules/.bin/tsc --noEmit
                   stderr: Killed

02:58:04  47568ms  cd /work/service && node --max-old-space-size=8192 ../node_modules/typescript/bin/tsc --noEmit
                   stderr: Killed

02:59:18  26401ms  node --max-old-space-size=8192 -e "<custom ts.createProgram harness>"
                   stdout: errors: 0

02:59:51  35706ms  (same harness, broader scope)
                   stdout: total errors: 0
```

### Failed execs (non-zero exit)

```
cd /work/service && ls node_modules/.bin/tsc 2>/dev/null && echo present
  exit=2   (silent — no node_modules)

ls /work/node_modules/.bin 2>/dev/null | grep -E '^(tsc|tsx|vitest)$'
  exit=1   (silent — no node_modules)

ls /work/node_modules/.bin 2>/dev/null
  exit=2   (silent — no node_modules)

mkdir -p /root/.npm && cd /work && npm install 2>&1 | tail -20
  exit=1   stderr="mkdir: cannot create directory '/root/.npm': Read-only file system"
```

### Patch tool mechanism (observed)

The `patch` tool drops a JSON scratch file into `/work/.foundry/.tmp/<ulid>.json`, then runs:

```
python3 -c '
import json, os, sys
m = json.load(open("/work/.foundry/.tmp/<ulid>.json"))
os.unlink("/work/.foundry/.tmp/<ulid>.json")
c = open(m["path"]).read()
...
```

This is Foundry-specific and relevant to S3: the tool fails loud ("`old_string not found in file`") when the agent's generated `old_string` doesn't literally match the current file. No fuzzy-match fallback.

### The pushed commit

```
commit da4797f7b640994fd405d850056bdd076146fc54
Author: Foundry <foundry@localhost>
Date:   Fri Apr 10 22:01:22 2026 -0500

    agent: apply changes

    939 files changed, 1004 insertions(+), 11 deletions(-)
```

Real code files (recoverable via `git show da4797f -- <path>`):

```
service/src/config.ts          |  7 +++++++
service/src/middleware.ts      | 15 ++++++++++++++-
service/src/router.ts          |  2 +-
service/src/runtime/tool.ts    | 21 +++++++++++--------
service/src/server.ts          |  2 +-
```

Pollution:

```
.npm-cache/_cacache/content-v2/sha512/**  (~920 content blobs, various sizes)
.npm-cache/_cacache/index-v5/**           (~14 index files)
.npm-cache/_prebuilds/71dbf6-better-sqlite3-v9.6.0-node-v115-linuxmusl-x64.tar.gz  (1.04 MB)
.npm-cache/_update-notifier-last-checked  (0 bytes)
```

### Prior agent commits — pollution audit

Scanned all 17 historical `agent: apply changes` commits for abnormal file counts:

```
da4797f  files=939   ← THIS INCIDENT
ba904c2  files=1     (README)
8c5b064  files=1
53c5fe7  files=1
07bbb3d  files=3
c4fd822  files=4
14fc7bc  files=4
6f287bc  files=1
1c6dfc1  files=1
e19a4a5  files=3
954ec51  files=1
f03ca7b  files=1
23d651f  files=1
2a9a14b  files=1
6744f56  files=11
9fcca74  files=1
b817ac3  files=2
```

Only `da4797f` is anomalous. It is a **235× outlier** against the 75th percentile of prior agent commits (≈4 files). This bounds the incident — prior agents have not been quietly leaking cache files at smaller scale. *(Caveat: this is a file-count scan, not a content scan; a content-type audit might still reveal smaller artifacts. See Open Question #4.)*

## Root Causes (System-Level)

1. **`.gitignore` on `origin/main` did not list `.npm-cache/`.** Locally the user had edited `.gitignore` to add `foundry-app.env` and `*.pem` (eventually shipped in commit `daa9d61`), but no entry for npm caches. The sandbox's clone was pristine main and therefore had no protection.
2. **`workspacePublish` uses `git add -A`** (`service/src/runtime/workspace.ts:47`, pre-revert). No allow-list, no file-count ceiling, no size ceiling.
3. **`workspacePublish` pushes to `HEAD:<branch>` where `<branch>` is `main`** after a clean clone. No branch strategy, no PR gate. Source: `workspace.ts:53-60` (pre-revert).
4. **The sandbox does not pre-install `node_modules`.** Combined with the prompt's "Typecheck before declaring done," the required verification gate is environmentally impossible for any project with heavy dev dependencies.
5. **Sandbox memory (512 MB) is below the floor for `tsc --noEmit`** on this project. The cgroup caps physical RSS, so `NODE_OPTIONS=--max-old-space-size` cannot save you — V8 thinks it has headroom and keeps allocating until the kernel kills the process.
6. **Container root filesystem is read-only**, forcing npm into a workspace-local cache directory, which is exactly the directory `git add -A` stages.
7. **The Backend Developer prompt demands `Typecheck before declaring done`** without an escape hatch. When the environment can't typecheck, the agent must lie, skip the rule, or improvise. This agent improvised.
8. **The runner has no mid-loop session-status check**, so an external `sessionKill` cannot stop an in-flight session. (`service/src/runtime/sdk-runner.ts`, no `AbortController` wired in.)
9. **No cost/turn circuit-breakers.** `max_steps` is the only ceiling; nothing watches cumulative input tokens or wall time to trip early on runaway loops.
10. **Session record is overwritten on natural completion even if externally killed.** `sessionKill` sets `status='failed'`; the subsequent natural completion update sets `status='done'`/`finish_reason='end_turn'` unconditionally.

## Recommendations

Ordered by impact-per-effort. Status reflects work already done *in this same investigative session*.

| # | Recommendation | Effort | Status |
|---|---|---|---|
| 1 | Push sessions to `agent/<session-id>` branches, not `main`. Open a draft PR instead of direct-pushing. | ~1 hr | **Open** |
| 2 | Replace `git add -A` with scoped staging. Have `write`/`patch` tools record touched paths; only stage those at publish time. | ~2 hrs | **Open** |
| 3 | Add a file-count / byte-size guard to `workspacePublish`. Reject >50 files or >1 MB net-new content with a clear error. | ~30 min | **Open** |
| 4 | Pre-bake `node_modules` into the sandbox image OR mount read-only from host. Eliminates the entire install spiral. | ~1 hr | **Open** |
| 5 | Remove "Typecheck before declaring done" from the Backend Developer prompt, OR move typecheck to a host-side post-publish gate. | ~10 min (prompt) / ~3 hrs (gate) | **Open** |
| 6 | Add a mechanical escalation trigger to agent prompts: *"If a command exits with `Killed`/`OOMKilled` or the same error twice, stop and create a child ticket. Do not improvise."* | ~15 min | **Open** |
| 7 | Runner-level circuit breakers: abort if `cumulative input tokens > 2M` OR `wall time > 10 min`. Mark session `runaway`. | ~2 hrs | **Open** |
| 8 | Thread an `AbortController` through `runner.ts`/`sdk-runner.ts` so `sessionKill` actually stops the in-flight loop. Add mid-loop status check as belt-and-suspenders. | ~3 hrs | **Open** |
| 9 | `sessionKill` idempotent against natural completion: completion update should include `WHERE status='running'` so it does not overwrite an external kill. | ~15 min | **Open** |
| 10 | Record effective model on the session row at start (already done), AND refuse to start if it differs from the agent row without an explicit override flag. | ~30 min | **Open** |
| 11 | Tighten `.gitignore` on `main` to list `.npm-cache`, `node_modules`, `.foundry/.tmp`, `/work`. Belt, not suspenders. | ~5 min | **Open** |

## Post-Incident Actions Taken

1. **Session manually killed** at 03:00:49 UTC via DB update. Confirmed cosmetic — session completed naturally ~2 min later (root cause #8).
2. **Polluted commit reverted.** `43ec92d Revert "agent: apply changes"` pushed to `origin/main`. Non-destructive; `da4797f` remains in git history and is still reachable via SHA.
3. **Local working tree synced** to `origin/main` via stash → fast-forward → revert → pop. No local WIP lost.
4. **Trash file** `service/oom` (0 bytes, unknown origin, not from the incident sandbox) deleted from working tree.
5. **Pollution audit** performed across all 17 historical agent commits; only `da4797f` is anomalous.
6. **User WIP refactor** (self-hosted git server → GitHub App clones) committed as `daa9d61` and pushed. The rewrite removes `config.repoBase` and eliminates the bare-repo-on-disk attack surface, but **does not fix** the `git add -A` or `push HEAD:main` behaviors that caused the incident.

## Open Questions

1. **Was `max_steps=100` actually enforced during this session?** The execution table shows 110 tool calls but the session ended with `finish_reason='end_turn'`, not a max-steps termination. Either the SDK counts steps differently than executions, or the ceiling was not enforced. Worth tracing `stepCountIs` usage in both `runner.ts` and `sdk-runner.ts` — they may disagree.
2. **Why does `session.model` (`claude-opus-4-6`) differ from `agent.model` (`claude-sonnet-4-6`)?** The runtime has a model override path; what triggered it for this session, and is the override path logged anywhere beyond the session row? Audit `runtime/model.ts::resolveModelWithDefaults`.
3. **Did `workspacePublish`'s token-authenticated push succeed via the Foundry App's write permission**, or via a cached credential? Confirm the auth path — this bounds what a rogue session *could* push to.
4. **Do any of the 16 *clean* prior agent commits contain smaller forms of the same pattern** (e.g., a stray `.log`, `.tmp`, or binary file)? The file-count scan is coarse; a content-type scan with `git log -p --diff-filter=A` filtered for non-source extensions might reveal smaller leaks.
5. **What exact `git` identity authored `da4797f`?** Row says `Foundry <foundry@localhost>` — set by `workspaceClone`. This is fine for attribution but leaks that the clone happened from the host. Confirm this isn't visible to downstream repo consumers as a security signal.
