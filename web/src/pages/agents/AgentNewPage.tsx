import { useState, useEffect } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { agentApi } from '../../api.js'
import type { Connection, McpServerInfo, McpToolSelection } from '../../types.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { ToolPicker } from '../../components/form/ToolPicker.js'

export function AgentNewPage() {
  const navigate = useNavigate()
  const connections = useLoaderData() as Connection[]
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState('8192')
  const [maxSteps, setMaxSteps] = useState('20')
  const [temperature, setTemperature] = useState('')
  const [reasoningBudget, setReasoningBudget] = useState('')
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [toolSelection, setToolSelection] = useState<McpToolSelection | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { agentApi.mcp().then(setServers).catch(() => {}) }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!connectionId) { setError('select a connection'); return }
    try {
      const tools = toolSelection && Object.keys(toolSelection).length > 0 ? toolSelection : undefined
      await agentApi.create({
        connection_id: connectionId, name, model, prompt,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
        reasoning_budget: reasoningBudget ? +reasoningBudget : null,
        tools,
      })
      navigate('/settings/agents')
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  return (
    <div className="py-5 lg:max-w-2xl lg:mx-auto lg:px-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required />
        </Field>
        <Field label="connection">
          {connections.length === 0 ? (
            <div className="text-xs text-zinc-500">no connections configured — add one first</div>
          ) : (
            <Select value={connectionId} onChange={e => setConnectionId(e.target.value)} required>
              {connections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
            </Select>
          )}
        </Field>
        <Field label="model">
          <TextInput value={model} onChange={e => setModel(e.target.value)} required placeholder="claude-sonnet-4-20250514" />
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
        <ToolPicker servers={servers} selection={toolSelection} onChange={setToolSelection} />
        <Field label="prompt">
          <TextArea label="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} required rows={8} />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="create" type="submit" className="flex-1" disabled={connections.length === 0} />
        </div>
      </form>
    </div>
  )
}
