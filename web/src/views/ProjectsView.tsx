import { useState, useEffect } from 'react'
import { projectApi } from '../api.js'
import type { Project } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'

function ProjectForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await projectApi.create({ name, workspace })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="font-display text-lg text-zinc-100">New Project</h2>
      {error && <div className="font-mono text-xs text-red-400">{error}</div>}
      <div className="space-y-2">
        <label className="font-mono text-xs text-zinc-500">name</label>
        <input value={name} onChange={e => setName(e.target.value)} required
          className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-sm rounded px-3 py-2" />
      </div>
      <div className="space-y-2">
        <label className="font-mono text-xs text-zinc-500">workspace (path to bare git repo)</label>
        <input value={workspace} onChange={e => setWorkspace(e.target.value)} required
          placeholder="/repos/myproject.git"
          className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-sm rounded px-3 py-2" />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 font-mono text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-100 py-2 rounded transition-colors">create</button>
        <button type="button" onClick={onCancel} className="flex-1 font-mono text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 py-2 rounded transition-colors">cancel</button>
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
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <span className="font-mono text-xs text-zinc-500">{projects.length} projects</span>
        <button
          onClick={() => setShowCreate(true)}
          className="font-mono text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1 rounded transition-colors"
        >
          + new
        </button>
      </div>

      <div className="overflow-auto flex-1 p-4 space-y-3">
        {projects.map(p => (
          <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-base text-zinc-100">{p.name}</div>
                <div className="font-mono text-xs text-zinc-600 mt-0.5">{p.slug}</div>
              </div>
              <StatusBadge status={p.status} />
            </div>

            <div className="font-mono text-xs text-zinc-500 space-y-0.5">
              <div>interval: {p.schedule_interval}s</div>
              <div>concurrency: {p.concurrency_limit}</div>
              <div>created: {ts(p.created_at)}</div>
            </div>

            <div className="font-mono text-xs text-zinc-600 truncate">{p.workspace}</div>

            <div className="flex gap-2">
              <button
                onClick={() => handleRun(p.id)}
                disabled={p.status !== 'active' || runningIds.has(p.id)}
                className="font-mono text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 px-3 py-1.5 rounded transition-colors"
              >
                {runningIds.has(p.id) ? 'dispatching…' : 'run now'}
              </button>
              <button
                onClick={() => handleToggle(p)}
                className="font-mono text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-3 py-1.5 rounded transition-colors"
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
