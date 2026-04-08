import { useState } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { agentApi } from '../../api.js'
import type { Agent } from '../../types.js'
import { useShell } from '../../Shell.js'
import { InfoGroup } from '../../components/detail/InfoGroup.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'
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
  const [error, setError] = useState('')

  useBreadcrumbLabel(agent.name)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await agentApi.update(agent.id, {
        model, prompt,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
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
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{agent.name}</h2>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="text-xs text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 shrink-0">
            edit
          </button>
        )}
      </div>

      {editing ? (
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
          <div className="flex gap-2 pt-2">
            <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
            <ActionButton label="save" type="submit" className="flex-1" />
          </div>
        </form>
      ) : (
        <>
          <InfoGroup rows={[
            { label: 'model',       value: agent.model },
            { label: 'max tokens',  value: String(agent.max_tokens) },
            { label: 'max steps',   value: String(agent.max_steps) },
            { label: 'temperature', value: agent.temperature !== null ? String(agent.temperature) : 'default' },
            { label: 'created',     value: ts(agent.created_at) },
          ]} />

          {agent.prompt && (
            <div className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{agent.prompt}</div>
          )}

          <ActionButton label="delete agent" variant="destructive" onClick={handleDelete} className="w-full" />
        </>
      )}
    </div>
  )
}
