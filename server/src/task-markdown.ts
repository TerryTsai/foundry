import YAML from 'yaml'

import { taskStatuses, type Priority, type Task, type TaskStatus } from './schema.js'

type Frontmatter = Record<string, unknown>

export function parseTask(path: string, sha: string, source: string): Task {
  const { data, body } = splitFrontmatter(source)
  const sections = splitSections(body)
  const title = firstHeading(body) || path.split('/').pop()?.replace(/\.md$/, '') || 'Untitled task'
  return {
    id: path.split('/').pop()?.replace(/\.md$/, '') || path,
    path,
    sha,
    title,
    description: sections.description.join('\n').trim(),
    guidance: listItems(sections.Guidance),
    current: listItems(sections.Current),
    next: (sections.Next || []).join('\n').trim(),
    status: parseStatus(data.status),
    priority: parsePriority(data.priority),
    updated: typeof data.updated === 'string' ? data.updated : new Date(0).toISOString(),
    nextEligibleAt: typeof data.next_eligible_at === 'string' ? data.next_eligible_at : undefined,
    nextTask: typeof data.next_task === 'string' ? data.next_task : undefined,
  }
}

export function renderTask(task: Task): string {
  const data: Frontmatter = {
    status: task.status,
    priority: task.priority,
    updated: task.updated,
  }
  if (task.nextEligibleAt) data.next_eligible_at = task.nextEligibleAt
  if (task.nextTask) data.next_task = task.nextTask
  const blocks = [`---\n${YAML.stringify(data).trim()}\n---`, `# ${task.title}`, task.description.trim()]
  if (task.guidance.length) blocks.push(`## Guidance\n${asList(task.guidance)}`)
  if (task.current.length) blocks.push(`## Current\n${asList(task.current)}`)
  if (task.next.trim()) blocks.push(`## Next\n${task.next.trim()}`)
  return `${blocks.filter(Boolean).join('\n\n')}\n`
}

export function makeTask(id: string, title: string, description: string, status: TaskStatus = 'queued'): Task {
  return {
    id,
    path: `.foundry/tasks/${id}.md`,
    sha: '',
    title: title.trim(),
    description: description.trim(),
    guidance: [],
    current: [],
    next: description.trim(),
    status,
    priority: 'normal',
    updated: new Date().toISOString(),
  }
}

function splitFrontmatter(source: string): { data: Frontmatter; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, body: source }
  const parsed: unknown = YAML.parse(match[1] || '')
  return { data: isRecord(parsed) ? parsed : {}, body: match[2] || '' }
}

function splitSections(body: string): Record<string, string[]> {
  const result: Record<string, string[]> = { description: [] }
  let section = 'description'
  for (const line of body.split(/\r?\n/)) {
    if (/^# /.test(line)) continue
    const heading = line.match(/^##\s+(.+)$/)
    if (heading) { section = heading[1]?.trim() || 'description'; result[section] = []; continue }
    result[section] ??= []
    result[section]?.push(line)
  }
  return result
}

function firstHeading(body: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''
}

function listItems(lines: string[] | undefined): string[] {
  return (lines || []).map(line => line.trim()).filter(Boolean).map(line => line.replace(/^[-*✓→]\s*/, ''))
}

function asList(items: string[]): string {
  return items.map(item => `- ${item}`).join('\n')
}

function parseStatus(value: unknown): TaskStatus {
  return typeof value === 'string' && taskStatuses.includes(value as TaskStatus) ? value as TaskStatus : 'queued'
}

function parsePriority(value: unknown): Priority {
  return value === 'low' || value === 'high' || value === 'urgent' ? value : 'normal'
}

function isRecord(value: unknown): value is Frontmatter {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
