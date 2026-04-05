import { useState, useEffect } from 'react'
import { agentApi, projectApi } from '../api.js'
import type { AgentDef, Project } from '../types.js'
import { Sheet } from '../components/Sheet.js'

function AgentForm({ projectId, onSave, onCancel }: { projectId: string; onSave: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState('node:20')
  const [env, setEnv] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const envList = env.trim() ? env.split(',').map(s => s.trim()).filter(Boolean) : []
      await agentApi.create({ project_id: projectId, name, prompt, image, env: envList })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="font-display text-lg text-zinc-100">New Agent</h2>
      {error && <div className="font-mono text-xs text-red-400">{error}</div>}
      {[
        { label: 'name', value: name, set: setName, ph: 'coder' },
        { label: 'image', value: image, set: setImage, ph: 'node:20' },
        { label: 'env vars (comma-separated)', value: env, set: setEnv, ph: 'API_KEY,DB_URL' },
      ].map(f => (
        <div key={f.label} className="space-y-1">
          <label className="font-mono text-xs text-zinc-500">{f.label}</label>
          <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph}
            required={f.label === 'name' || f.label === 'image'}
            className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-base rounded-lg px-3 py-3" />
        </div>
      ))}
      <div className="space-y-1">
        <label className="font-mono text-xs text-zinc-500">prompt</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} required rows={6}
          className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-base rounded-lg px-3 py-3 resize-none" />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="flex-1 font-mono text-sm bg-zinc-700 active:bg-zinc-600 text-zinc-100 py-3 rounded-lg transition-colors">create</button>
        <button type="button" onClick={onCancel} className="flex-1 font-mono text-sm bg-zinc-800 active:bg-zinc-700 text-zinc-400 py-3 rounded-lg transition-colors">cancel</button>
      </div>
    </form>
  )
}

export function AgentsView() {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  async function load() {
    const [as_, ps] = await Promise.all([agentApi.list(projectId || undefined), projectApi.list()])
    setAgents(as_)
    setProjects(ps)
  }

  useEffect(() => { load().catch(console.error) }, [projectId])

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent definition?')) return
    await agentApi.delete(id)
    await load()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 shrink-0">
        <select value={projectId} onChange={e => setProjectId(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-xs rounded-lg px-3 py-2 flex-1">
          <option value="">all projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!projectId}
          className="font-mono text-sm bg-zinc-800 active:bg-zinc-700 disabled:opacity-40 text-zinc-300 px-4 py-2 rounded-lg transition-colors"
        >
          + new
        </button>
      </div>

      <div className="overflow-auto flex-1 p-4 space-y-3">
        {agents.map(a => (
          <div key={a.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-display text-base text-zinc-100">{a.name}</span>
              <button onClick={() => handleDelete(a.id)} className="font-mono text-xs text-zinc-600 active:text-red-400 transition-colors px-2 py-1">delete</button>
            </div>
            <div className="font-mono text-xs text-zinc-500">image: {a.image}</div>
            {JSON.parse(a.env).length > 0 && (
              <div className="font-mono text-xs text-zinc-500">env: {JSON.parse(a.env as string).join(', ')}</div>
            )}
            <div className="font-mono text-xs text-zinc-600 line-clamp-2">{a.prompt}</div>
          </div>
        ))}
        {agents.length === 0 && (
          <div className="font-mono text-xs text-zinc-500">
            {projectId ? 'no agents in this project' : 'select a project to manage agents'}
          </div>
        )}
      </div>

      <Sheet open={showCreate} onClose={() => setShowCreate(false)}>
        {projectId && (
          <AgentForm
            projectId={projectId}
            onSave={() => { setShowCreate(false); load().catch(console.error) }}
            onCancel={() => setShowCreate(false)}
          />
        )}
      </Sheet>
    </div>
  )
}
