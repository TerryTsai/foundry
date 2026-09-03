import type { Project, Task } from './schema.js'

export type Selection = { project: Project; task: Task }

export function selectNextTask(projects: Project[], now: Date, previousTaskKey?: string): Selection | null {
  const eligible = projects.flatMap(project => {
    if (!project.config.enabled) return []
    return project.tasks
      .filter(task => task.status === 'working' && (!task.nextEligibleAt || task.nextEligibleAt <= now.toISOString()))
      .map(task => ({ project, task }))
  })
  eligible.sort((left, right) => compareSelection(left, right, previousTaskKey))
  return eligible[0] || null
}

function compareSelection(left: Selection, right: Selection, previousTaskKey?: string): number {
  const priority = combinedPriority(right) - combinedPriority(left)
  if (priority) return priority
  const continuity = Number(key(right) === previousTaskKey) - Number(key(left) === previousTaskKey)
  if (continuity) return continuity
  const fairness = lastWorked(left).localeCompare(lastWorked(right))
  if (fairness) return fairness
  return key(left).localeCompare(key(right))
}

function combinedPriority(selection: Selection): number {
  return priorityValue(selection.project.config.priority) * 10 + priorityValue(selection.task.priority)
}

function priorityValue(priority: 'low' | 'normal' | 'high' | 'urgent'): number {
  return { low: 0, normal: 1, high: 2, urgent: 3 }[priority]
}

function lastWorked(selection: Selection): string {
  return selection.project.tasks
    .filter(task => task.status === 'working' || task.status === 'done' || task.status === 'needs_you')
    .map(task => task.updated)
    .sort()
    .at(-1) || new Date(0).toISOString()
}

function key(selection: Selection): string {
  return `${selection.project.id}:${selection.task.id}`
}
