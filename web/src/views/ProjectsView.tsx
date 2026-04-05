import { useState, useEffect } from 'react'
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

function ProjectForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const project = await projectApi.create({ name, workspace })
      await agentApi.create({
        project_id: project.id,
        name: 'coder',
        image: 'node:20',
        prompt: DEFAULT_AGENT_PROMPT,
        env: [],
      })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  const inputCls = 'w-full bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-base rounded-lg px-3 py-3'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="font-display text-lg text-zinc-100">New Project</h2>
      {error && <div className="font-mono text-xs text-red-400">{error}</div>}
      <div className="space-y-1.5">
        <label className="font-mono text-xs text-zinc-500">name</label>
        <input value={name} onChange={e => setName(e.target.value)} required className={inputCls} />
      </div>
      <div className="space-y-1.5">
        <label className="font-mono text-xs text-zinc-500">workspace path</label>
        <input value={workspace} onChange={e => setWorkspace(e.target.value)} required
          placeholder="/repos/myproject.git" className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="flex-1 font-mono text-sm bg-zinc-700 active:bg-zinc-600 text-zinc-100 py-3 rounded-lg transition-colors">create</button>
        <button type="button" onClick={onCancel} className="flex-1 font-mono text-sm bg-zinc-800 active:bg-zinc-700 text-zinc-400 py-3 rounded-lg transition-colors">cancel</button>
      </div>
    </form>
  )
}

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())

  async function load() {
    const ps = await projectApi.list()
    setProjects(ps)
  }

  useEffect(() => { load().catch(console.error) }, [])

  async function handleRun(id: string) {
    setRunningIds(s => new Set(s).add(id))
    try {
      await projectApi.run(id)
    } finally {
      setRunningIds(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  async function handleToggle(project: Project) {
    const newStatus = project.status === 'active' ? 'paused' : 'active'
    await projectApi.update(project.id, { status: newStatus })
    await load()
  }

  const ts = (s: string) => new Date(s).toLocaleDateString()

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <span className="font-mono text-xs text-zinc-500">{projects.length} projects</span>
        <button
          onClick={() => setShowCreate(true)}
          className="font-mono text-sm bg-zinc-800 active:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors"
        >
          + new
        </button>
      </div>

      <div className="overflow-y-auto flex-1 p-4 space-y-3">
        {projects.length === 0 && (
          <div className="font-mono text-xs text-zinc-600 pt-2">no projects yet</div>
        )}
        {projects.map(p => (
          <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-base text-zinc-100">{p.name}</div>
                <div className="font-mono text-xs text-zinc-600 mt-0.5">{p.slug}</div>
              </div>
              <StatusBadge status={p.status} />
            </div>

            <div className="font-mono text-xs text-zinc-500 flex flex-wrap gap-x-4 gap-y-0.5">
              <span>every {p.schedule_interval}s</span>
              <span>concurrency {p.concurrency_limit}</span>
              <span>created {ts(p.created_at)}</span>
            </div>

            <div className="font-mono text-xs text-zinc-600 truncate">{p.workspace}</div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleRun(p.id)}
                disabled={p.status !== 'active' || runningIds.has(p.id)}
                className="flex-1 font-mono text-sm bg-zinc-800 active:bg-zinc-700 disabled:opacity-40 text-zinc-300 py-2.5 rounded-lg transition-colors"
              >
                {runningIds.has(p.id) ? 'dispatching…' : 'run now'}
              </button>
              <button
                onClick={() => handleToggle(p)}
                className="flex-1 font-mono text-sm bg-zinc-800 active:bg-zinc-700 text-zinc-400 py-2.5 rounded-lg transition-colors"
              >
                {p.status === 'active' ? 'pause' : 'resume'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <Sheet open={showCreate} onClose={() => setShowCreate(false)}>
        <ProjectForm onSave={() => { setShowCreate(false); load().catch(console.error) }} onCancel={() => setShowCreate(false)} />
      </Sheet>
    </div>
  )
}
