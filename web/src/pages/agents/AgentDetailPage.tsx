import { useState, useEffect } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { agentApi } from '../../api.js'
import type { Agent, Connection, UsageRollup, McpServerInfo, McpToolSelection } from '../../types.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { ToolPicker } from '../../components/form/ToolPicker.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { fmtDuration, fmtBytes } from '../../lib/format.js'

// Render agent.tools for the infoRows display. Handles both the flat legacy
// shape (string[]) and the nested McpToolSelection shape. Returns 'all' when
// no selection is stored.
function formatTools(raw: string | null): string {
  if (!raw) return 'all'
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return (parsed as string[]).join(', ') || 'none'
    if (parsed && typeof parsed === 'object') {
      const parts: string[] = []
      for (const [server, val] of Object.entries(parsed as Record<string, unknown>)) {
        if (val === '*') parts.push(`${server}:*`)
        else if (Array.isArray(val)) parts.push(`${server}:${val.length}`)
      }
      return parts.join(' · ') || 'none'
    }
    return 'all'
  } catch { return 'malformed' }
}

// Convert raw agent.tools JSON (legacy flat string[] or nested McpToolSelection)
// into McpToolSelection, using the loaded server list to map legacy tool names.
function normalizeSelection(raw: string | null, servers: McpServerInfo[]): McpToolSelection | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as McpToolSelection
    if (Array.isArray(parsed)) {
      const flat = parsed as string[]
      if (!flat.length) return null
      const result: McpToolSelection = {}
      for (const srv of servers) {
        const matched = flat.filter(n => srv.tools.some(t => t.name === n))
        if (matched.length === srv.tools.length) result[srv.id] = '*'
        else if (matched.length > 0) result[srv.id] = matched
      }
      return Object.keys(result).length === 0 ? null : result
    }
    return null
  } catch { return null }
}

export function AgentDetailPage() {
  const navigate = useNavigate()
  const { agent, usage, connections } = useLoaderData() as { agent: Agent; usage: UsageRollup; connections: Connection[] }
  const [editing, setEditing] = useState(false)
  const [connectionId, setConnectionId] = useState(agent.connection_id)
  const [model, setModel] = useState(agent.model)
  const [description, setDescription] = useState(agent.description)
  const [maxTokens, setMaxTokens] = useState(String(agent.max_tokens))
  const [maxSteps, setMaxSteps] = useState(String(agent.max_steps))
  const [temperature, setTemperature] = useState(agent.temperature !== null ? String(agent.temperature) : '')
  const [reasoningBudget, setReasoningBudget] = useState(agent.reasoning_budget !== null ? String(agent.reasoning_budget) : '')
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [toolSelection, setToolSelection] = useState<McpToolSelection | null>(null)
  const [error, setError] = useState('')

  // Load servers then normalize stored tools against the real server/tool list
  useEffect(() => {
    agentApi.mcp().then(srv => {
      setServers(srv)
      setToolSelection(normalizeSelection(agent.tools, srv))
    }).catch(() => {})
  }, [agent.tools])

  useBreadcrumbLabel(agent.name)

  const connectionName = connections.find(c => c.id === agent.connection_id)?.name ?? agent.connection_id

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const tools = toolSelection && Object.keys(toolSelection).length > 0 ? toolSelection : undefined
      await agentApi.update(agent.id, {
        connection_id: connectionId, model, description,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
        reasoning_budget: reasoningBudget ? +reasoningBudget : null,
        tools,
      })
      setEditing(false)
      navigate('/settings/agents')
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!confirm('Delete this agent?')) return
    await agentApi.delete(agent.id)
    navigate('/settings/agents')
  }

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <DetailShell
      type="agent" id={agent.id} title={agent.name}
      subtitle={!editing ? agent.description : undefined}
      actions={!editing ? (
        <button onClick={() => setEditing(true)}
          className="text-xs text-zinc-400 dark:text-zinc-500 active:text-zinc-900 dark:active:text-zinc-100 shrink-0">
          edit
        </button>
      ) : undefined}
      infoRows={!editing ? [
        { label: 'connection',  value: connectionName },
        { label: 'model',       value: agent.model },
        { label: 'tools',       value: formatTools(agent.tools) },
        { label: 'temperature', value: agent.temperature !== null ? String(agent.temperature) : 'default' },
        { label: 'reasoning',   value: agent.reasoning_budget !== null ? `${agent.reasoning_budget} tokens` : 'off' },
        { label: 'max steps',   value: String(agent.max_steps) },
        { label: 'max tokens',  value: String(agent.max_tokens) },
        { label: 'created',     value: ts(agent.created_at) },
        { label: 'superseded',  value: agent.superseded_at !== null ? ts(agent.superseded_at) : null },
        { label: 'sessions',    value: usage.session_count > 0 ? String(usage.session_count) : null },
        { label: 'tokens in',   value: usage.tokens_in  > 0 ? usage.tokens_in.toLocaleString()  : null },
        { label: 'tokens out',  value: usage.tokens_out > 0 ? usage.tokens_out.toLocaleString() : null },
        { label: 'tool calls',  value: usage.tool_calls > 0 ? String(usage.tool_calls)          : null },
        { label: 'cpu',         value: usage.cpu_ms > 0 ? fmtDuration(usage.cpu_ms) : null },
        { label: 'memory',      value: usage.peak_memory_mb !== null ? `${usage.peak_memory_mb.toFixed(0)} MB peak` : null },
        { label: 'network',     value: usage.net_bytes > 0 ? fmtBytes(usage.net_bytes) : null },
        { label: 'duration',    value: usage.duration_ms > 0 ? fmtDuration(usage.duration_ms) : null },
      ] : []}
    >
      {editing && (
        <form onSubmit={handleSave} className="space-y-4">
          {error && <div className="text-sm text-red-400">{error}</div>}
          <Field label="connection">
            <Select value={connectionId} onChange={e => setConnectionId(e.target.value)} required>
              {connections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
            </Select>
          </Field>
          <Field label="model">
            <TextInput value={model} onChange={e => setModel(e.target.value)} required />
          </Field>
          <Field label="description">
            <TextArea label="description" value={description} onChange={e => setDescription(e.target.value)} required rows={8} />
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
