import { describe, expect, it } from 'vitest'

import { selectNextTask } from './scheduler.js'
import type { Project, Task } from './schema.js'

describe('deterministic scheduler', () => {
  it('orders by priority, continuity, then fairness', () => {
    const old = project('owner/old', task('001', '2026-09-01T00:00:00Z'))
    const recent = project('owner/recent', task('001', '2026-09-02T00:00:00Z'))
    expect(selectNextTask([recent, old], new Date('2026-09-03T00:00:00Z'))?.project.id).toBe('owner/old')
    expect(selectNextTask([recent, old], new Date('2026-09-03T00:00:00Z'), 'owner/recent:001')?.project.id).toBe('owner/recent')
    recent.config.priority = 'high'
    expect(selectNextTask([old, recent], new Date('2026-09-03T00:00:00Z'))?.project.id).toBe('owner/recent')
  })

  it('excludes disabled, blocked, and future tasks', () => {
    const future = project('owner/future', { ...task('001', '2026-09-01T00:00:00Z'), nextEligibleAt: '2026-09-04T00:00:00Z' })
    const blocked = project('owner/blocked', { ...task('001', '2026-09-01T00:00:00Z'), status: 'needs_you' })
    const disabled = project('owner/disabled', task('001', '2026-09-01T00:00:00Z'))
    disabled.config.enabled = false
    expect(selectNextTask([future, blocked, disabled], new Date('2026-09-03T00:00:00Z'))).toBeNull()
  })
})

function task(id: string, updated: string): Task {
  return { id, path: `.foundry/tasks/${id}.md`, sha: 'sha', title: id, description: '', guidance: [], current: [], next: '', status: 'working', priority: 'normal', updated }
}

function project(id: string, selectedTask: Task): Project {
  const [owner, repo] = id.split('/') as [string, string]
  return {
    id, owner, repo, defaultBranch: 'main', private: true, htmlUrl: '', configPath: '.foundry/config.yaml', configSha: 'sha',
    config: { enabled: true, priority: 'normal', harness: { type: 'codex' }, runtime: { type: 'podman', image: 'foundry-worker' } },
    tasks: [selectedTask],
  }
}
