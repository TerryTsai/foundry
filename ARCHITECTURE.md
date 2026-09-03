# Architecture

Foundry is intentionally one application process with four internal seams:

```text
React UI
   ↓
GitHub-backed workspace functions
   ↓
deterministic scheduler
   ↓
sandbox adapter → harness adapter
```

These seams are replaceable code boundaries, not services.

## Durable model

GitHub owns durable truth. A repository is a Project when `.foundry/config.yaml` exists. Files in `.foundry/tasks/` are Tasks. Git history is history. Foundry does not persist a parallel project, task, activity, execution, or conversation model.

Local SQLite contains only GitHub login sessions, the workspace worker cadence, and repeated infrastructure-failure counts. All of it is recoverable or disposable. A restart reconstructs projects and tasks from GitHub.

## Scheduling

The in-process Worker permits one execution across the workspace. A tick that finds it busy is skipped, not queued. Eligible tasks are Working tasks in enabled projects whose optional `next_eligible_at` has arrived.

Selection is a stable sort:

1. explicit project and task priority;
2. continuation of the previous task;
3. least recently worked project;
4. repository and task ID as a deterministic tie-breaker.

Foundry chooses where attention goes. It does not plan the work; the repository-selected harness does.

## Execution

One cycle creates one disposable Podman or Docker container. When GitHub App credentials are configured, Foundry mints an installation token narrowed to the selected repository and Contents permission. The container clones the repository, launches the harness with a high-level delegation, validates the task state, optionally runs the repository verification command, commits all useful changes, pushes the default branch, and disappears.

The default Codex invocation is non-interactive, ephemeral, and disables its inner sandbox because the whole process is already isolated by the outer container. No autonomous work runs directly on the Foundry host.

If the container dies before a push, GitHub remains at the prior checkpoint. If it dies after a push, the checkpoint survives. Foundry deliberately has no transaction protocol for partial local work.

## Human boundary

The harness must leave the task Working, Done, or Needs You. Needs You is reserved for consequential spending, publication, contact, irreversible action, physical action, real access gaps, or direction-changing judgment. The task's Current and Next sections carry the explanation and recommendation.

Infrastructure failures leave the task Working. Foundry records only a local retry count and converts the task to Needs You after three consecutive failures with a concrete runtime recommendation.

## Deliberately absent

There are no visible or durable Runs, Sessions, Agents, Objectives, Outcomes, Feedback, Decisions, Activities, subtasks, execution graphs, queues, event buses, microservices, or central project registry. Atta is not required and execution identity is outside Foundry's responsibility.
