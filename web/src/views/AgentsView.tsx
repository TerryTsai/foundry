import { useState, useEffect, useCallback } from 'react'
import { agentApi, projectApi } from '../api.js'
import type { AgentDef, Project } from '../types.js'
import { Sheet } from '../components/Sheet.js'

const inputCls = 'w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200 font-mono text-sm px-3 py-2 focus:border-zinc-400 dark:focus:border-zinc-500 transition-colors'
const labelCls = 'font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600'
const btnPrimary = 'flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-2.5 active:opacity-75 transition-opacity'
const btnSecondary = 'flex-1 font-mono text-xs uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 py-2.5 active:opacity-75 transition-opacity'

function AgentSheet({ agent, projects, onClose, onUpdate }: {
  agent: AgentDef | null
  projects: Project[]
  onClose: () => void
  onUpdate: () => void
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [name, setName] = useState('')
  const [image, setImage] = useState('node:20')
  const [env, setEnv] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const isNew = agent === null

  useEffect(() => {
    if (agent) {
      setProjectId(agent.project_id)
      setName(agent.name)
      setImage(agent.image)
      setEnv(JSON.parse(agent.env).join(', '))
      setPrompt(agent.prompt)
    } else {
      setProjectId(projects[0]?.id ?? ''); setName(''); setImage('node:20'); setEnv(''); setPrompt('')
    }
    setError('')
  }, [agent, projects])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const envList = env.trim() ? env.split(',').map(s => s.trim()).filter(Boolean) : []
    try {
      if (isNew) {
        await agentApi.create({ project_id: projectId, name, image, prompt, env: envList })
      } else {
        await agentApi.update(agent.id, { image, prompt, env: envList })
      }
      onUpdate(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!agent || !confirm('Delete this agent?')) return
    await agentApi.delete(agent.id)
    onUpdate(); onClose()
  }

  const project = projects.find(p => p.id === (agent?.project_id ?? projectId))

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-bold text-zinc-900 dark:text-zinc-100">
          {isNew ? 'New Agent' : agent.name}
        </h2>
        {!isNew && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mt-0.5">
            {project?.name}
          </span>
        )}
      </div>
      {error && <div className="font-mono text-xs text-red-500">{error}</div>}
      {isNew && (
        <div className="space-y-1">
          <label className={labelCls}>project</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} required className={inputCls}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <label className={labelCls}>name</label>
        <input value={name} onChange={e => setName(e.target.value)} required disabled={!isNew}
          className={`${inputCls} disabled:opacity-40`} />
      </div>
      <div className="space-y-1">
        <label className={labelCls}>image</label>
        <input value={image} onChange={e => setImage(e.target.value)} required className={inputCls} />
      </div>
      <div className="space-y-1">
        <label className={labelCls}>env vars (comma-separated)</label>
        <input value={env} onChange={e => setEnv(e.target.value)} placeholder="API_KEY,DB_URL" className={inputCls} />
      </div>
      <div className="space-y-1">
        <label className={labelCls}>prompt</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} required rows={8}
          className={`${inputCls} resize-none`} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className={btnPrimary}>{isNew ? 'create' : 'save'}</button>
        <button type="button" onClick={onClose} className={btnSecondary}>cancel</button>
      </div>
      {!isNew && (
        <button type="button" onClick={handleDelete}
          className="w-full font-mono text-xs uppercase tracking-wider text-zinc-300 dark:text-zinc-700 active:text-red-500 dark:active:text-red-400 active:border-red-300 dark:active:border-red-800 border border-zinc-100 dark:border-zinc-800 py-2.5">
          delete agent
        </button>
      )}
    </form>
  )
}

export function AgentsView() {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<AgentDef | null>(null)
  const [open, setOpen] = useState(false)
  const [filterProject, setFilterProject] = useState('')

  const load = useCallback(async () => {
    const [as_, ps] = await Promise.all([agentApi.list(filterProject || undefined), projectApi.list()])
    setAgents(as_); setProjects(ps)
  }, [filterProject])
  useEffect(() => { load().catch(console.error) }, [load])

  function openNew() { setSelected(null); setOpen(true) }
  function openAgent(a: AgentDef) { setSelected(a); setOpen(true) }

  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0 flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          {agents.length}
        </span>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="bg-transparent border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 font-mono text-[10px] uppercase tracking-wider px-2 py-1.5 flex-1">
          <option value="">all projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={openNew}
          className="font-mono text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 active:bg-zinc-100 dark:active:bg-zinc-800 px-3 py-1.5 shrink-0">
          + new
        </button>
        <button onClick={load}
          className="font-mono text-xs text-zinc-300 dark:text-zinc-600 active:text-zinc-900 dark:active:text-zinc-100 px-1">
          ↻
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {agents.length === 0 && (
          <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">no agents</div>
        )}
        {agents.map(a => (
          <button key={a.id} onClick={() => openAgent(a)}
            className="w-full text-left border-b border-zinc-100 dark:border-zinc-800/50 active:bg-zinc-50 dark:active:bg-zinc-900/70 px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-zinc-800 dark:text-zinc-200 text-sm leading-snug">{a.name}</div>
              <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">
                {projectName(a.project_id)} · {a.image}
              </div>
            </div>
          </button>
        ))}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)}>
        <AgentSheet
          agent={selected}
          projects={projects}
          onClose={() => setOpen(false)}
          onUpdate={() => load().catch(console.error)}
        />
      </Sheet>
    </div>
  )
}
