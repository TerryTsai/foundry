import { useState, useEffect, useCallback } from 'react'
import { projectApi, agentApi } from '../api.js'
import type { Project } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'

const DEFAULT_AGENT_PROMPT = `You are a software engineering agent working on a codebase. You receive tickets describing tasks to implement.

When given a ticket:
1. Explore the codebase to understand the relevant code
2. Implement the changes described in the ticket
3. Run tests to verify your work
4. Commit your changes with a clear message

Use run_command to run shell commands (git, npm, tests, etc).
Use create_ticket to break large tasks into sub-tickets before starting work on them.

Always read existing code before modifying it. Write clean, minimal changes that match the existing style.`

const inputCls = 'w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200 font-mono text-sm px-3 py-2 focus:border-zinc-400 dark:focus:border-zinc-500 transition-colors'
const labelCls = 'font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600'
const btnPrimary = 'flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-2.5 active:opacity-75 transition-opacity'
const btnSecondary = 'flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 py-2.5 active:opacity-75 transition-opacity'

function ProjectSheet({ project, onClose, onUpdate }: { project: Project | null; onClose: () => void; onUpdate: () => void }) {
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [interval, setInterval] = useState('')
  const [concurrency, setConcurrency] = useState('')
  const [error, setError] = useState('')
  const isNew = project === null

  useEffect(() => {
    if (project) {
      setName(project.name)
      setWorkspace(project.workspace)
      setInterval(String(project.schedule_interval))
      setConcurrency(String(project.concurrency_limit))
    } else {
      setName(''); setWorkspace(''); setInterval('600'); setConcurrency('3')
    }
    setError('')
  }, [project])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (isNew) {
        const p = await projectApi.create({ name, workspace, schedule_interval: +interval, concurrency_limit: +concurrency })
        await agentApi.create({ project_id: p.id, name: 'coder', image: 'node:20', prompt: DEFAULT_AGENT_PROMPT, env: [] })
      } else {
        await projectApi.update(project.id, { name, workspace, schedule_interval: +interval, concurrency_limit: +concurrency })
      }
      onUpdate(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleToggle() {
    if (!project) return
    await projectApi.update(project.id, { status: project.status === 'active' ? 'paused' : 'active' })
    onUpdate(); onClose()
  }

  async function handleRun() {
    if (!project) return
    await projectApi.run(project.id)
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-bold text-zinc-900 dark:text-zinc-100">
          {isNew ? 'New Project' : project.name}
        </h2>
        {project && <StatusBadge status={project.status} />}
      </div>
      {error && <div className="font-mono text-xs text-red-500">{error}</div>}
      <div className="space-y-1">
        <label className={labelCls}>name</label>
        <input value={name} onChange={e => setName(e.target.value)} required className={inputCls} />
      </div>
      <div className="space-y-1">
        <label className={labelCls}>workspace path</label>
        <input value={workspace} onChange={e => setWorkspace(e.target.value)} required
          placeholder="/repos/myproject.git" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={labelCls}>interval (s)</label>
          <input type="number" value={interval} onChange={e => setInterval(e.target.value)} required min="10" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>concurrency</label>
          <input type="number" value={concurrency} onChange={e => setConcurrency(e.target.value)} required min="1" className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className={btnPrimary}>{isNew ? 'create' : 'save'}</button>
        <button type="button" onClick={onClose} className={btnSecondary}>cancel</button>
      </div>
      {project && (
        <div className="flex gap-2">
          <button type="button" onClick={handleRun} disabled={project.status !== 'active'}
            className="flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 py-2.5 active:opacity-75 disabled:opacity-30">
            run now
          </button>
          <button type="button" onClick={handleToggle}
            className="flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 py-2.5 active:opacity-75">
            {project.status === 'active' ? 'pause' : 'resume'}
          </button>
        </div>
      )}
    </form>
  )
}

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<Project | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => { setProjects(await projectApi.list()) }, [])
  useEffect(() => { load().catch(console.error) }, [load])

  function openNew() { setSelected(null); setOpen(true) }
  function openProject(p: Project) { setSelected(p); setOpen(true) }

  const ts = (s: string) => new Date(s).toLocaleDateString()

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0 flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          {projects.length}
        </span>
        <button onClick={openNew}
          className="font-mono text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 active:bg-zinc-100 dark:active:bg-zinc-800 px-3 py-1.5">
          + new
        </button>
        <button onClick={load}
          className="font-mono text-xs text-zinc-300 dark:text-zinc-600 active:text-zinc-900 dark:active:text-zinc-100 ml-auto px-1">
          ↻
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {projects.length === 0 && (
          <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">no projects</div>
        )}
        {projects.map(p => (
          <button key={p.id} onClick={() => openProject(p)}
            className="w-full text-left border-b border-zinc-100 dark:border-zinc-800/50 active:bg-zinc-50 dark:active:bg-zinc-900/70 px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-zinc-800 dark:text-zinc-200 text-sm leading-snug truncate">{p.name}</div>
              <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">
                {p.workspace} · {p.schedule_interval}s · {ts(p.created_at)}
              </div>
            </div>
            <div className="shrink-0"><StatusBadge status={p.status} /></div>
          </button>
        ))}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)}>
        <ProjectSheet
          project={selected}
          onClose={() => setOpen(false)}
          onUpdate={() => load().catch(console.error)}
        />
      </Sheet>
    </div>
  )
}
