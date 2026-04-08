import { useState, useEffect } from 'react'
import { projectApi, agentApi } from '../api.js'
import type { Project } from '../types.js'
import { Sheet } from './Sheet.js'
import { EmptyState } from './list/EmptyState.js'
import { StatusBadge } from './StatusBadge.js'
import { Field } from './form/Field.js'
import { TextInput } from './form/TextInput.js'
import { ActionButton } from './form/ActionButton.js'

const DEFAULT_AGENT_PROMPT = `You are a software engineering agent working on a codebase. You receive tickets describing tasks to implement.

When given a ticket:
1. Explore the codebase to understand the relevant code
2. Implement the changes described in the ticket
3. Run tests to verify your work
4. Commit your changes with a clear message

Tools: read, write, patch, search, find, exec, fetch, scrape, think.

Always read existing code before modifying it. Write clean, minimal changes that match the existing style.`

type Mode = 'list' | 'create' | 'edit'

function ProjectForm({
  project,
  onSave,
  onCancel,
}: {
  project: Project | null
  onSave: (saved: Project) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [interval, setInterval] = useState('600')
  const [maxAgents, setMaxAgents] = useState('3')
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      let saved: Project
      if (isNew) {
        saved = await projectApi.create({ name, schedule_interval: +interval, concurrency_limit: +maxAgents })
        await agentApi.create({ project_id: saved.id, name: 'coder', model: 'anthropic:claude-sonnet-4-20250514', prompt: DEFAULT_AGENT_PROMPT })
      } else {
        saved = await projectApi.update(project.id, { schedule_interval: +interval, concurrency_limit: +maxAgents })
      }
      onSave(saved)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }


  return (
    <form onSubmit={handleSave} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
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
          <ActionButton label="cancel" variant="secondary" onClick={onCancel} className="flex-1" />
          <ActionButton label={isNew ? 'create' : 'save'} type="submit" className="flex-1" />
        </div>
      </div>
    </form>
  )
}

function ProjectList({
  projects,
  current,
  onSelect,
  onEdit,
  onNew,
}: {
  projects: Project[]
  current: Project | null
  onSelect: (p: Project) => void
  onEdit: (p: Project) => void
  onNew: () => void
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0
          ? <EmptyState message="no projects" />
          : projects.map(p => (
            <div key={p.id} className="flex items-center border-b border-zinc-100 dark:border-zinc-800/50">
              <button
                onClick={() => onSelect(p)}
                className="flex-1 text-left py-2.5 min-w-0 active:opacity-75 transition-opacity"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-900 dark:text-zinc-200 text-sm truncate">{p.name}</span>
                  {p.id === current?.id && (
                    <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 shrink-0">✓</span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 truncate">
                  {p.schedule_interval}s interval · {p.concurrency_limit} {p.concurrency_limit === 1 ? 'agent' : 'agents'}
                </div>
              </button>
              <div className="flex items-center gap-3 pl-3 shrink-0">
                <StatusBadge status={p.status} />
                <button
                  onClick={() => onEdit(p)}
                  className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 active:text-zinc-900 dark:active:text-zinc-100 py-2.5"
                >
                  edit
                </button>
              </div>
            </div>
          ))
        }
      </div>
      <div className="shrink-0 pt-3">
        <ActionButton label="new project" variant="secondary" onClick={onNew} className="w-full" />
      </div>
    </div>
  )
}

interface ProjectSwitcherSheetProps {
  open: boolean
  projects: Project[]
  current: Project | null
  onSelect: (p: Project) => void
  onClose: () => void
  onRefresh: () => Promise<void>
}

export function ProjectSwitcherSheet({
  open,
  projects,
  current,
  onSelect,
  onClose,
  onRefresh,
}: ProjectSwitcherSheetProps) {
  const [mode, setMode] = useState<Mode>('list')
  const [editTarget, setEditTarget] = useState<Project | null>(null)

  useEffect(() => { if (!open) setMode('list') }, [open])

  function handleSheetClose() {
    if (mode !== 'list') setMode('list')
    else onClose()
  }

  async function handleFormSave(saved: Project) {
    await onRefresh()
    if (mode === 'create') onSelect(saved)
    setMode('list')
  }

  return (
    <Sheet open={open} onClose={handleSheetClose} title="Projects">
      {mode === 'list' ? (
        <ProjectList
          projects={projects}
          current={current}
          onSelect={p => { onSelect(p); onClose() }}
          onEdit={p => { setEditTarget(p); setMode('edit') }}
          onNew={() => { setEditTarget(null); setMode('create') }}
        />
      ) : (
        <ProjectForm
          project={editTarget}
          onSave={handleFormSave}
          onCancel={() => setMode('list')}
        />
      )}
    </Sheet>
  )
}
