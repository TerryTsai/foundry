import { useState, useEffect } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { agentApi } from '../../api.js'
import type { Agent } from '../../types.js'
import { useShell } from '../../Shell.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { ToolPicker } from '../../components/form/ToolPicker.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'

export function AgentDetailPage() {
  const { projectId } = useShell()
  const navigate = useNavigate()
  const agent = useLoaderData() as Agent
  const [editing, setEditing] = useState(false)
  const [model, setModel] = useState(agent.model)
  const [prompt, setPrompt] = useState(agent.prompt)
  const [maxTokens, setMaxTokens] = useState(String(agent.max_tokens))
  const [maxSteps, setMaxSteps] = useState(String(agent.max_steps))
  const [temperature, setTemperature] = useState(agent.temperature !== null ? String(agent.temperature) : '')
  const [reasoningBudget, setReasoningBudget] = useState(agent.reasoning_budget !== null ? String(agent.reasoning_budget) : '')
  const [availableTools, setAvailableTools] = useState<string[]>([])
  const [selectedTools, setSelectedTools] = useState<Set<string>>(agent.tools ? new Set(JSON.parse(agent.tools) as string[]) : new Set())
  const [error, setError] = useState('')

  useEffect(() => { agentApi.tools().then(setAvailableTools).catch(() => {}) }, [])

  useBreadcrumbLabel(agent.name)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const tools = selectedTools.size > 0 ? [...selectedTools] : undefined
      await agentApi.update(agent.id, {
        model, prompt,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
        reasoning_budget: reasoningBudget ? +reasoningBudget : null,
        tools,
      })
      setEditing(false)
      navigate(`/p/${projectId}/agents`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!confirm('Delete this agent?')) return
    await agentApi.delete(agent.id)
    navigate(`/p/${projectId}/agents`)
  }

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <DetailShell
      type="agent" id={agent.id} title={agent.name}
      subtitle={!editing ? agent.prompt : undefined}
      actions={!editing ? (
        <button onClick={() => setEditing(true)}
          className="text-xs text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 shrink-0">
          edit
        </button>
      ) : undefined}
      infoRows={!editing ? [
        { label: 'model',       value: agent.model },
        { label: 'tools',       value: agent.tools ? (JSON.parse(agent.tools) as string[]).join(', ') : 'all' },
        { label: 'temperature', value: agent.temperature !== null ? String(agent.temperature) : 'default' },
        { label: 'reasoning',   value: agent.reasoning_budget !== null ? `${agent.reasoning_budget} tokens` : 'off' },
        { label: 'max steps',   value: String(agent.max_steps) },
        { label: 'max tokens',  value: String(agent.max_tokens) },
        { label: 'created',     value: ts(agent.created_at) },
        { label: 'updated',     value: agent.updated_at !== agent.created_at ? ts(agent.updated_at) : null },
      ] : []}
    >
      {editing && (
        <form onSubmit={handleSave} className="space-y-4">
          {error && <div className="text-sm text-red-400">{error}</div>}
          <Field label="model">
            <TextInput value={model} onChange={e => setModel(e.target.value)} required />
          </Field>
          <Field label="prompt">
            <TextArea label="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} required rows={8} />
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
          <Field label="reasoning budget (tokens)">
            <TextInput type="number" value={reasoningBudget} onChange={e => setReasoningBudget(e.target.value)} min="1024" placeholder="off" />
          </Field>
          <ToolPicker available={availableTools} selected={selectedTools} onChange={setSelectedTools} />
          <div className="flex gap-2 pt-2">
            <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
            <ActionButton label="save" type="submit" className="flex-1" />
          </div>
        </form>
      )}

      {!editing && (
        <ActionButton label="delete agent" variant="destructive" onClick={handleDelete} className="w-full" />
      )}
    </DetailShell>
  )
}
