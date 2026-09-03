import type { Config } from './config.js'
import { getContent, getTextFile, listRepositories, putTextFile } from './github.js'
import { parseProjectConfig, renderProjectConfig } from './project-config.js'
import type { GithubContent, GithubRepository, Project, ProjectConfig, Task, TaskStatus } from './schema.js'
import { makeTask, parseTask, renderTask } from './task-markdown.js'

let cache: { token: string; expiresAt: number; projects: Project[] } | null = null
const projectLocks = new Map<string, Promise<void>>()

export async function discoverProjects(token: string, config: Config, fresh = false): Promise<Project[]> {
  if (!fresh && cache?.token === token && cache.expiresAt > Date.now()) return cache.projects
  const repositories = await listRepositories(token)
  const settled = await Promise.allSettled(repositories.map(repo => loadProject(token, repo, config)))
  for (const result of settled) if (result.status === 'rejected') console.warn('Could not inspect a GitHub repository for Foundry configuration.', result.reason)
  const projects = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
  projects.sort((left, right) => left.config.name?.localeCompare(right.config.name || right.repo) || left.repo.localeCompare(right.repo))
  cache = { token, expiresAt: Date.now() + 30_000, projects }
  return projects
}

export async function accessibleRepositories(token: string, config: Config): Promise<Array<GithubRepository & { foundryEnabled: boolean }>> {
  const [repositories, projects] = await Promise.all([listRepositories(token), discoverProjects(token, config)])
  const enabled = new Set(projects.map(project => project.id))
  return repositories.map(repository => ({ ...repository, foundryEnabled: enabled.has(repository.full_name) }))
}

export async function enableRepository(token: string, repo: string, branch: string, runtime: ProjectConfig['runtime']): Promise<void> {
  const existing = await getTextFile(token, repo, '.foundry/config.yaml')
  if (existing) return
  const text = renderProjectConfig({ enabled: true, priority: 'normal', harness: { type: 'codex' }, runtime })
  await putTextFile(token, repo, '.foundry/config.yaml', text, 'Enable Foundry', branch)
  invalidateWorkspace()
}

export async function findProject(token: string, config: Config, owner: string, repo: string, fresh = false): Promise<Project> {
  const projects = await discoverProjects(token, config, fresh)
  const project = projects.find(item => item.id.toLowerCase() === `${owner}/${repo}`.toLowerCase())
  if (!project) throw new Error(`Foundry project ${owner}/${repo} was not found`)
  return project
}

export async function createTask(token: string, project: Project, title: string, description: string, start = false): Promise<Task> {
  return withProjectLock(project.id, async () => {
    const current = { ...project, tasks: await loadTasks(token, project.id) }
    const number = Math.max(0, ...current.tasks.map(task => Number.parseInt(task.id, 10)).filter(Number.isFinite)) + 1
    const id = String(number).padStart(3, '0')
    if (start) await queueWorkingTask(token, current, '')
    const task = makeTask(id, title, description, start ? 'working' : 'queued')
    await putTextFile(token, current.id, task.path, renderTask(task), `Delegate: ${task.title}`, current.defaultBranch)
    invalidateWorkspace()
    return task
  })
}

export async function patchTask(
  token: string, project: Project, taskId: string,
  patch: Partial<Pick<Task, 'title' | 'description' | 'guidance' | 'current' | 'next' | 'status' | 'priority' | 'nextEligibleAt' | 'nextTask'>>,
): Promise<Task> {
  return withProjectLock(project.id, async () => {
    const current = { ...project, tasks: await loadTasks(token, project.id) }
    const task = requiredTask(current, taskId)
    if (patch.status === 'working') await queueWorkingTask(token, current, task.id)
    const updated = { ...task, ...patch, updated: new Date().toISOString() }
    await putTextFile(token, current.id, task.path, renderTask(updated), `Update task: ${updated.title}`, current.defaultBranch, task.sha)
    invalidateWorkspace()
    return updated
  })
}

export async function patchProjectConfig(token: string, project: Project, patch: Partial<ProjectConfig>): Promise<void> {
  const updated: ProjectConfig = { ...project.config, ...patch }
  await putTextFile(token, project.id, project.configPath, renderProjectConfig(updated), `Update Foundry project settings`, project.defaultBranch, project.configSha)
  invalidateWorkspace()
}

export async function steer(token: string, project: Project, taskId: string | undefined, message: string): Promise<{ action: string }> {
  const normalized = message.trim()
  const task = taskId ? requiredTask(project, taskId) : matchingTask(project, normalized) || project.tasks.find(item => item.status === 'working' || item.status === 'needs_you')
  if (/^(pause|stop)\b/i.test(normalized) && task) {
    await patchTask(token, project, task.id, { status: 'paused' })
    return { action: 'paused' }
  }
  if (/^(resume|continue|approve)\b/i.test(normalized) && task) {
    await patchTask(token, project, task.id, { status: 'working', guidance: addGuidance(task, normalized) })
    return { action: 'resumed' }
  }
  if (/^(done|complete|finish)\b/i.test(normalized) && task) {
    await patchTask(token, project, task.id, { status: 'done' })
    return { action: 'completed' }
  }
  if (/^(also\s+)?(add|create|investigate|research|write|plan)\b/i.test(normalized) && !taskId) {
    await createTask(token, project, sentenceTitle(normalized), normalized, false)
    return { action: 'created_task' }
  }
  if (/\bfocus\b/i.test(normalized) && !taskId) {
    await patchProjectConfig(token, project, { priority: 'high' })
    return { action: 'prioritized' }
  }
  if (task) {
    await patchTask(token, project, task.id, { guidance: addGuidance(task, normalized) })
    return { action: 'updated_guidance' }
  }
  await createTask(token, project, sentenceTitle(normalized), normalized, false)
  return { action: 'created_task' }
}

export function invalidateWorkspace(): void {
  cache = null
}

async function loadProject(token: string, repository: GithubRepository, config: Config): Promise<Project | null> {
  const configFile = await getTextFile(token, repository.full_name, '.foundry/config.yaml')
  if (!configFile) return null
  const projectConfig = parseProjectConfig(configFile.text, { runtime: config.sandboxRuntime, image: config.sandboxImage })
  const tasks = await loadTasks(token, repository.full_name)
  return {
    id: repository.full_name,
    owner: repository.owner.login,
    repo: repository.name,
    defaultBranch: repository.default_branch,
    private: repository.private,
    htmlUrl: repository.html_url,
    configPath: '.foundry/config.yaml',
    configSha: configFile.sha,
    config: projectConfig,
    tasks,
  }
}

async function loadTasks(token: string, repo: string): Promise<Task[]> {
  const directory = await getContent(token, repo, '.foundry/tasks')
  if (!directory || !Array.isArray(directory)) return []
  const files = directory.filter(item => item.type === 'file' && item.name.endsWith('.md'))
  const tasks = await Promise.all(files.map(item => loadTask(token, repo, item)))
  return tasks.sort((left, right) => left.id.localeCompare(right.id))
}

async function loadTask(token: string, repo: string, item: GithubContent): Promise<Task> {
  const file = await getTextFile(token, repo, item.path)
  if (!file) throw new Error(`Task disappeared while reading ${repo}/${item.path}`)
  return parseTask(item.path, file.sha, file.text)
}

async function queueWorkingTask(token: string, project: Project, exceptId: string): Promise<void> {
  const working = project.tasks.find(task => task.status === 'working' && task.id !== exceptId)
  if (!working) return
  const queued = { ...working, status: 'queued' as TaskStatus, updated: new Date().toISOString() }
  await putTextFile(token, project.id, working.path, renderTask(queued), `Queue task: ${working.title}`, project.defaultBranch, working.sha)
}

function requiredTask(project: Project, taskId: string): Task {
  const task = project.tasks.find(item => item.id === taskId)
  if (!task) throw new Error(`Task ${taskId} was not found in ${project.id}`)
  return task
}

function addGuidance(task: Task, message: string): string[] {
  return [...task.guidance.filter(item => item !== message), message]
}

function sentenceTitle(message: string): string {
  const clean = message.replace(/^also\s+/i, '').replace(/[.!?]+$/, '').trim()
  return `${clean.slice(0, 1).toUpperCase()}${clean.slice(1, 80)}` || 'New task'
}

function matchingTask(project: Project, message: string): Task | undefined {
  const ignored = new Set(['also', 'actually', 'complete', 'continue', 'finish', 'pause', 'resume', 'stop', 'task', 'that', 'this', 'working'])
  const words = (message.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter(word => !ignored.has(word))
  return project.tasks.find(task => words.some(word => task.title.toLowerCase().includes(word)))
}

async function withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const prior = projectLocks.get(projectId) || Promise.resolve()
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const current = prior.then(() => gate)
  projectLocks.set(projectId, current)
  await prior
  try { return await operation() }
  finally {
    release()
    if (projectLocks.get(projectId) === current) projectLocks.delete(projectId)
  }
}
