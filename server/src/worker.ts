import type { Config } from './config.js'
import { repositoryWorkerToken } from './github.js'
import type { AccountContext, LocalState } from './local-state.js'
import { runIsolatedWorker } from './sandbox.js'
import { selectNextTask } from './scheduler.js'
import type { WorkerState, WorkspaceSettings } from './schema.js'
import { discoverProjects, findProject, patchTask } from './workspace.js'

export type WorkspaceWorker = ReturnType<typeof createWorkspaceWorker>

export function createWorkspaceWorker(config: Config, state: LocalState) {
  const worker: WorkerState = {
    busy: false, startedAt: null, projectId: null, taskId: null,
    lastCycleAt: null, lastMessage: null,
  }
  let continuationKey: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  return {
    state: () => ({ ...worker }),
    start() {
      if (timer) return
      timer = setInterval(() => { void scheduledTick() }, 30_000)
      timer.unref()
      void scheduledTick()
    },
    stop() { if (timer) clearInterval(timer); timer = undefined },
    runNow: (account?: AccountContext) => runCycle(account || configuredAccount()),
  }

  function configuredAccount(): AccountContext | null {
    if (config.githubToken) return { login: config.ownerGithubLogin || 'local', token: config.githubToken }
    return state.firstAccount()
  }

  async function scheduledTick(): Promise<void> {
    const settings = state.settings()
    if (!shouldRun(settings, worker.lastCycleAt)) return
    await runCycle(configuredAccount())
  }

  async function runCycle(account: AccountContext | null): Promise<WorkerState> {
    if (worker.busy) return worker
    if (!account) return setMessage('Connect GitHub before running the worker')
    worker.busy = true
    worker.startedAt = new Date().toISOString()
    try {
      let projects = await discoverProjects(account.token, config, true)
      if (await promotePendingNext(account.token, projects)) projects = await discoverProjects(account.token, config, true)
      const selection = selectNextTask(projects, new Date(), continuationKey)
      if (!selection) return setMessage('No Working task is currently eligible')
      worker.projectId = selection.project.id
      worker.taskId = selection.task.id
      const workerToken = await repositoryWorkerToken(config, account.token, selection.project.id)
      await runIsolatedWorker(config, workerToken, selection.project, selection.task)
      const key = `${selection.project.id}:${selection.task.id}`
      state.clearFailure(key)
      continuationKey = continuationKey === key ? undefined : key
      try {
        await promoteExplicitNext(account.token, selection.project.owner, selection.project.repo, selection.task.id)
      } catch (error) {
        console.error('Could not promote explicit next task; the next tick will retry.', error)
      }
      return setMessage(`Advanced ${selection.project.config.name || selection.project.repo} · ${selection.task.title}`)
    } catch (error) {
      try { await handleFailure(account, error) }
      catch (failureError) { console.error('Could not persist worker failure state.', failureError) }
      return setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      worker.busy = false
      worker.startedAt = null
      worker.projectId = null
      worker.taskId = null
      worker.lastCycleAt = new Date().toISOString()
    }
  }

  function setMessage(message: string): WorkerState {
    worker.lastMessage = message
    return worker
  }

  async function handleFailure(account: AccountContext, error: unknown): Promise<void> {
    if (!worker.projectId || !worker.taskId) return
    const key = `${worker.projectId}:${worker.taskId}`
    const count = state.recordFailure(key, error instanceof Error ? error.message : String(error))
    if (count < 3) return
    const [owner, repo] = splitProjectId(worker.projectId)
    const project = await findProject(account.token, config, owner, repo, true)
    const task = project.tasks.find(item => item.id === worker.taskId)
    if (!task || task.status !== 'working') return
    await patchTask(account.token, project, task.id, {
      status: 'needs_you',
      current: [...task.current, `Foundry could not start or checkpoint the isolated worker after ${count} attempts.`],
      next: 'Check the repository runtime image, harness credentials, and verification command, then resume this task. I recommend testing the configured worker image manually first.',
    })
  }

  async function promoteExplicitNext(token: string, owner: string, repo: string, completedTaskId: string): Promise<void> {
    const project = await findProject(token, config, owner, repo, true)
    const completed = project.tasks.find(task => task.id === completedTaskId)
    if (completed?.status !== 'done' || !completed.nextTask) return
    const next = project.tasks.find(task => task.id === completed.nextTask && task.status === 'queued')
    if (next) await patchTask(token, project, next.id, { status: 'working' })
  }

  async function promotePendingNext(token: string, projects: Awaited<ReturnType<typeof discoverProjects>>): Promise<boolean> {
    let promoted = false
    for (const project of projects) {
      if (project.tasks.some(task => task.status === 'working')) continue
      const completed = project.tasks.find(task => task.status === 'done' && task.nextTask)
      const next = completed && project.tasks.find(task => task.id === completed.nextTask && task.status === 'queued')
      if (!next) continue
      await patchTask(token, project, next.id, { status: 'working' })
      promoted = true
    }
    return promoted
  }
}

function shouldRun(settings: WorkspaceSettings, lastCycleAt: string | null): boolean {
  if (settings.paused || settings.frequency === 'manual') return false
  const interval = { '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000 }[settings.frequency]
  return !lastCycleAt || Date.now() - new Date(lastCycleAt).getTime() >= interval
}

function splitProjectId(id: string): [string, string] {
  const slash = id.indexOf('/')
  return [id.slice(0, slash), id.slice(slash + 1)]
}
