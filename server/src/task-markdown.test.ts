import { describe, expect, it } from 'vitest'

import { makeTask, parseTask, renderTask } from './task-markdown.js'

describe('task markdown', () => {
  it('round trips the durable briefing', () => {
    const task = makeTask('001', 'Get physical prototype ready', 'Prove the token to audio path.', 'working')
    task.guidance = ['Prefer NFC before BLE.']
    task.current = ['NFC reads reliably.', 'Story generation is connected.']
    task.next = 'Fix intermittent playback.'
    task.nextEligibleAt = '2026-09-14T09:00:00Z'
    const parsed = parseTask(task.path, 'sha', renderTask(task))
    expect(parsed).toMatchObject({
      title: task.title,
      description: task.description,
      guidance: task.guidance,
      current: task.current,
      next: task.next,
      status: 'working',
      nextEligibleAt: task.nextEligibleAt,
    })
  })

  it('defaults unknown status and priority conservatively', () => {
    const parsed = parseTask('.foundry/tasks/x.md', 'sha', '---\nstatus: running\npriority: someday\n---\n# Test\nBody')
    expect(parsed.status).toBe('queued')
    expect(parsed.priority).toBe('normal')
  })
})
