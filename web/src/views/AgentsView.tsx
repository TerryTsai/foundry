import { useState, useEffect, useCallback } from 'react'
import { agentApi } from '../api.js'
import type { AgentDef } from '../types.js'
import { Sheet } from '../components/Sheet.js'
import { PageShell } from '../components/layout/PageShell.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { Field } from '../components/form/Field.js'
import { TextInput } from '../components/form/TextInput.js'
import { TextArea } from '../components/form/TextArea.js'
import { ActionButton } from '../components/form/ActionButton.js'

function AgentSheet({
  agent,
  projectId,
  onClose,
  onUpdate,
}: {
  agent: AgentDef | null
  projectId: string
  onClose: () => void
  onUpdate: () => void
}) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const isNew = agent === null

  useEffect(() => {
    if (agent) {
      setName(agent.name)
      setPrompt(agent.prompt)
    } else {
      setName(''); setPrompt('')
    }
    setError('')
  }, [agent])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (isNew) {
        await agentApi.create({ project_id: projectId, name, prompt })
      } else {
        await agentApi.update(agent.id, { prompt })
      }
      onUpdate(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!agent || !confirm('Delete this agent?')) return
    await agentApi.delete(agent.id)
    onUpdate(); onClose()
  }

  return (
    <form onSubmit={handleSave} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required disabled={!isNew}
            className="disabled:opacity-40" />
        </Field>
        <Field label="prompt">
          <TextArea label="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} required rows={8} />
        </Field>
      </div>
      <div className="shrink-0 pt-3 space-y-2">
        <div className="flex gap-2">
          <ActionButton label="cancel" variant="secondary" onClick={onClose} className="flex-1" />
          <ActionButton label={isNew ? 'create' : 'save'} type="submit" className="flex-1" />
        </div>
        {!isNew && (
          <ActionButton label="delete agent" variant="destructive" onClick={handleDelete} className="w-full" />
        )}
      </div>
    </form>
  )
}

export function AgentsView({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [selected, setSelected] = useState<AgentDef | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setAgents(await agentApi.list(projectId))
  }, [projectId])

  useEffect(() => { load().catch(console.error) }, [load])

  function openNew() { setSelected(null); setOpen(true) }
  function openAgent(a: AgentDef) { setSelected(a); setOpen(true) }

  return (
    <>
      <PageShell

        action={!open ? { label: 'Agent', onPress: openNew } : undefined}
        onRefresh={load}
      >
        {agents.length === 0
          ? <EmptyState message="no agents" />
          : agents.map(a => (
            <ListRow
              key={a.id}
              title={a.name}
              subtitle={a.prompt.split('\n').find(l => l.trim()) ?? ''}
              onPress={() => openAgent(a)}
            />
          ))
        }
      </PageShell>

      <Sheet open={open} onClose={() => setOpen(false)} title="Agent">
        <AgentSheet
          agent={selected}
          projectId={projectId}
          onClose={() => setOpen(false)}
          onUpdate={() => load().catch(console.error)}
        />
      </Sheet>
    </>
  )
}
