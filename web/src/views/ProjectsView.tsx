import { useState, useEffect, useCallback } from 'react'
import { RotateCw } from 'lucide-react'
import { projectApi, agentApi } from '../api.js'
import type { Project } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { Field } from '../components/form/Field.js'
import { TextInput } from '../components/form/TextInput.js'
import { ActionButton } from '../components/form/ActionButton.js'

const DEFAULT_AGENT_PROMPT = `You are a software engineering agent working on a codebase. You receive tickets describing tasks to implement.

When given a ticket:
1. Explore the codebase to understand the relevant code
2. Implement the changes described in the ticket
3. Run tests to verify your work
4. Commit your changes with a clear message

Use run_command to run shell commands (git, npm, tests, etc).
Use create_ticket to break large tasks into sub-tickets before starting work on them.

Always read existing code before modifying it. Write clean, minimal changes that match the existing style.`

function ProjectSheet({ project, onClose, onUpdate }: { project: Project | null; onClose: () => void; onUpdate: () => void }) {
  const [name, setName] = useState('')
  const [interval, setInterval] = useState('')
  const [maxAgents, setMaxAgents] = useState('')
  const [error, setError] = useState('')
  const isNew = project === null

  useEffect(() => {
    if (project) {
      setName(project.name)
      setInterval(String(project.schedule_interval))
      setMaxAgents(String(project.concurrency_limit))
    } else {
      setName(''); setInterval('600'); setMaxAgents('3')
    }
    setError('')
  }, [project])

  function toWorkspace(n: string) {
    return `/repos/${n.toLowerCase().replace(/\s+/g, '-')}`
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (isNew) {
        const p = await projectApi.create({ name, workspace: toWorkspace(name), schedule_interval: +interval, concurrency_limit: +maxAgents })
        await agentApi.create({ project_id: p.id, name: 'coder', image: 'node:20', prompt: DEFAULT_AGENT_PROMPT, env: [] })
      } else {
        await projectApi.update(project.id, { schedule_interval: +interval, concurrency_limit: +maxAgents })
      }
      onUpdate(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }


  return (
    <form onSubmit={handleSave} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        {project && <StatusBadge status={project.status} />}
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="interval (s)">
            <TextInput type="number" value={interval} onChange={e => setInterval(e.target.value)} required min="10" />
          </Field>
          <Field label="max agents">
            <TextInput type="number" value={maxAgents} onChange={e => setMaxAgents(e.target.value)} required min="1" />
          </Field>
        </div>
      </div>
      <div className="shrink-0 pt-3 space-y-2">
        <div className="flex gap-2">
          <ActionButton label="cancel" variant="secondary" onClick={onClose} className="flex-1" />
          <ActionButton label={isNew ? 'create' : 'save'} type="submit" className="flex-1" />
        </div>
      </div>
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
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800/60 shrink-0 flex items-center gap-3">
        <span className="text-xs text-zinc-500">{projects.length}</span>
        <button onClick={openNew}
          className="text-xs text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700/60 rounded px-3 py-1.5 active:bg-zinc-100 dark:active:bg-zinc-800">
          + new
        </button>
        <button onClick={load} className="text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 ml-auto p-1">
          <RotateCw size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {projects.length === 0
          ? <EmptyState message="no projects" />
          : projects.map(p => (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={`${p.schedule_interval}s interval · ${p.concurrency_limit} ${p.concurrency_limit === 1 ? 'agent' : 'agents'} · ${ts(p.created_at)}`}
              status={p.status}
              onPress={() => openProject(p)}
            />
          ))
        }
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Project">
        <ProjectSheet
          project={selected}
          onClose={() => setOpen(false)}
          onUpdate={() => load().catch(console.error)}
        />
      </Sheet>
    </div>
  )
}
