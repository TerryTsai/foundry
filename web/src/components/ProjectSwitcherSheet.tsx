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

Use run_command to run shell commands (git, npm, tests, etc).
Use create_ticket to break large tasks into sub-tickets before starting work on them.

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
  const [workspace, setWorkspace] = useState('')
  const [interval, setInterval] = useState('600')
  const [concurrency, setConcurrency] = useState('3')
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
      let saved: Project
      if (isNew) {
        saved = await projectApi.create({ name, workspace, schedule_interval: +interval, concurrency_limit: +concurrency })
        await agentApi.create({ project_id: saved.id, name: 'coder', prompt: DEFAULT_AGENT_PROMPT })
      } else {
        saved = await projectApi.update(project.id, { name, workspace, schedule_interval: +interval, concurrency_limit: +concurrency })
      }
      onSave(saved)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleToggle() {
    if (!project) return
    const saved = await projectApi.update(project.id, { status: project.status === 'active' ? 'paused' : 'active' })
    onSave(saved)
  }

  async function handleRun() {
    if (!project) return
    await projectApi.run(project.id)
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <h2 className="font-display text-base font-bold text-zinc-100">
        {isNew ? 'New Project' : project.name}
      </h2>
      {error && <div className="font-mono text-xs text-red-400">{error}</div>}
      <Field label="name">
        <TextInput value={name} onChange={e => setName(e.target.value)} required />
      </Field>
      <Field label="workspace path">
        <TextInput value={workspace} onChange={e => setWorkspace(e.target.value)} required placeholder="/repos/myproject.git" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="interval (s)">
          <TextInput type="number" value={interval} onChange={e => setInterval(e.target.value)} required min="10" />
        </Field>
        <Field label="concurrency">
          <TextInput type="number" value={concurrency} onChange={e => setConcurrency(e.target.value)} required min="1" />
        </Field>
      </div>
      <div className="flex gap-2 pt-1">
        <ActionButton label={isNew ? 'create' : 'save'} type="submit" className="flex-1" />
        <ActionButton label="cancel" variant="secondary" onClick={onCancel} className="flex-1" />
      </div>
      {project && (
        <div className="flex gap-2">
          <ActionButton
            label="run now"
            variant="secondary"
            onClick={handleRun}
            disabled={project.status !== 'active'}
            className="flex-1"
          />
          <ActionButton
            label={project.status === 'active' ? 'pause' : 'resume'}
            variant="secondary"
            onClick={handleToggle}
            className="flex-1"
          />
        </div>
      )}
    </form>
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
    <Sheet open={open} onClose={handleSheetClose}>
      {mode === 'list' ? (
        <>
          <h2 className="font-display text-base font-bold text-zinc-100 mb-3">Projects</h2>
          {projects.length === 0
            ? <EmptyState message="no projects" />
            : projects.map(p => (
              <div key={p.id} className="flex items-center border-b border-zinc-800/50">
                <button
                  onClick={() => { onSelect(p); onClose() }}
                  className="flex-1 text-left py-2.5 min-w-0 active:opacity-75 transition-opacity"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-200 text-sm truncate">{p.name}</span>
                    {p.id === current?.id && (
                      <span className="font-mono text-[10px] text-zinc-600 shrink-0">✓</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-zinc-600 truncate">
                    {p.workspace} · {p.schedule_interval}s
                  </div>
                </button>
                <div className="flex items-center gap-3 pl-3 shrink-0">
                  <StatusBadge status={p.status} />
                  <button
                    onClick={() => { setEditTarget(p); setMode('edit') }}
                    className="font-mono text-[10px] text-zinc-600 active:text-zinc-100 py-2.5"
                  >
                    edit
                  </button>
                </div>
              </div>
            ))
          }
          <div className="pt-3">
            <ActionButton
              label="new project"
              variant="secondary"
              onClick={() => { setEditTarget(null); setMode('create') }}
              className="w-full"
            />
          </div>
        </>
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
