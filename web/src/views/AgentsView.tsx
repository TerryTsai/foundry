import { useState, useEffect, useCallback } from 'react'
import { agentApi } from '../api.js'
import type { Agent } from '../types.js'
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
  agent: Agent | null
  projectId: string
  onClose: () => void
  onUpdate: () => void
}) {
  const [name, setName] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState('8192')
  const [maxSteps, setMaxSteps] = useState('20')
  const [temperature, setTemperature] = useState('')
  const [error, setError] = useState('')
  const isNew = agent === null

  useEffect(() => {
    if (agent) {
      setName(agent.name)
      setModel(agent.model)
      setPrompt(agent.prompt)
      setMaxTokens(String(agent.max_tokens))
      setMaxSteps(String(agent.max_steps))
      setTemperature(agent.temperature !== null ? String(agent.temperature) : '')
    } else {
      setName(''); setModel('claude-sonnet-4-20250514'); setPrompt('')
      setMaxTokens('8192'); setMaxSteps('20'); setTemperature('')
    }
    setError('')
  }, [agent])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const shared = {
        model, prompt,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
      }
      if (isNew) {
        await agentApi.create({ project_id: projectId, name, ...shared })
      } else {
        await agentApi.update(agent.id, shared)
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
        <Field label="model">
          <TextInput value={model} onChange={e => setModel(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="max tokens">
            <TextInput type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} required min="1" />
          </Field>
          <Field label="max steps">
            <TextInput type="number" value={maxSteps} onChange={e => setMaxSteps(e.target.value)} required min="1" />
          </Field>
          <Field label="temperature">
            <TextInput type="number" value={temperature} onChange={e => setTemperature(e.target.value)} min="0" max="2" step="0.1" placeholder="default" />
          </Field>
        </div>
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
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<Agent | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setAgents(await agentApi.list(projectId))
  }, [projectId])

  useEffect(() => { load().catch(console.error) }, [load])

  function openNew() { setSelected(null); setOpen(true) }
  function openAgent(a: Agent) { setSelected(a); setOpen(true) }

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[minmax(320px,1fr)_2fr]">
          {/* List column */}
          <div className="h-full lg:border-r lg:border-zinc-200 dark:lg:border-zinc-800/60 lg:overflow-y-auto">
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
                    subtitle={a.model}
                    active={open && selected?.id === a.id}
                    onPress={() => openAgent(a)}
                  />
                ))
              }
            </PageShell>
          </div>

          {/* Detail column — desktop only */}
          <div className="hidden lg:flex flex-col overflow-y-auto">
            {open ? (
              <div className="flex-1 px-6 py-5 max-w-3xl">
                <AgentSheet
                  agent={selected}
                  projectId={projectId}
                  onClose={() => setOpen(false)}
                  onUpdate={() => load().catch(console.error)}
                />
              </div>
            ) : (
              <EmptyState message="select an agent" />
            )}
          </div>
        </div>
      </div>

      {/* Detail sheet — mobile only */}
      <div className="lg:hidden">
        <Sheet open={open} onClose={() => setOpen(false)} title="Agent">
          <AgentSheet
            agent={selected}
            projectId={projectId}
            onClose={() => setOpen(false)}
            onUpdate={() => load().catch(console.error)}
          />
        </Sheet>
      </div>
    </>
  )
}
