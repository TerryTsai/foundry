# Foundry

Foundry is a small control plane for delegated autonomous work across GitHub projects. Projects contain durable Tasks. One workspace Worker periodically chooses one Working task, gives it to the repository-selected harness inside a disposable container, and relies on Git for cold continuity.

Foundry is not an agent harness. Codex is the first supported harness; repository-native files such as `AGENTS.md` and `.codex/` remain authoritative for harness behavior.

## What this version proves

- Connect to GitHub with OAuth or a local token.
- Discover projects by `.foundry/config.yaml`; there is no project registry.
- Read and write compact Markdown tasks in `.foundry/tasks/`.
- Enforce at most one Working task per project.
- Steer, create, pause, resume, prioritize, and complete tasks from a mobile-first UI.
- Schedule one workspace-wide execution at Manual, 15m, 30m, 1h, or 4h cadence.
- Select work deterministically by priority, continuity, and project fairness.
- Clone, execute, verify, commit, and push inside a disposable Podman or Docker container.
- Retry execution failures quietly and surface Needs You after three repeated failures.

## Run locally

Requirements: Node.js 22.12+, GitHub access, and Podman or Docker for autonomous worker cycles.

```sh
npm install
podman build -t foundry-worker:latest -f server/Dockerfile.worker .
cp .env.example .env
set -a; . ./.env; set +a
npm run build
npm run dev
```

Open `http://localhost:3000`. During UI development, run `npm run dev -w @foundry/site` and open port 3006.

For OAuth, create a GitHub App or OAuth App with callback URL `http://localhost:3000/auth/github/callback`, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. For private local use, `GITHUB_TOKEN` skips the login screen. The OAuth token and scheduler settings are operational local state in `foundry-local.db`; deleting it never deletes project or task state.

For autonomous work, configure `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH` and install that GitHub App on enabled repositories with Contents read/write permission. `scripts/setup-github-app-key.sh` can securely install a downloaded GitHub App key and update `.env`. Foundry then mints a token restricted to the selected repository for each worker cycle. Without App credentials it falls back to the connected token; use only a suitably restricted token in that mode.

The worker image expects `OPENAI_API_KEY` for Codex. A repository may select another harness only by providing its explicit non-interactive command.

## Enable a repository

Use **Repositories → Enable** in the UI, or add:

```yaml
# .foundry/config.yaml
name: Magic Wand
enabled: true
priority: normal
harness: codex
runtime:
  type: podman
  image: foundry-worker:latest
# Optional command run after the harness exits:
# verify: npm test
```

Runtime may be `podman` or `docker`. `harness` may also be configured as an object:

```yaml
harness:
  type: another-harness
  command: another-harness --non-interactive "$FOUNDRY_PROMPT"
```

The command runs only inside the disposable container. Foundry never falls back to host execution.

## Task format

```markdown
---
status: working
priority: normal
updated: 2026-09-03T04:14:00Z
---

# Get physical prototype ready

Get the token → generated story → narrated audio path ready for physical testing.

## Guidance

- Prefer NFC before BLE.
- Optimize for proving the interaction.

## Current

- NFC reader works.
- Story generation works.
- Playback occasionally fails after generation.

## Next

Fix playback and repeatedly test the complete physical flow.
```

Valid states are exactly `queued`, `working`, `needs_you`, `paused`, and `done`. `next_eligible_at` may defer a Working task without inventing another state. `next_task` may name a specific queued task to promote when this one becomes Done.

## Verify

```sh
npm run check
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the responsibility boundaries and failure semantics.

Private — internal use only.
