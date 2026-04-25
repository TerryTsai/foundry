import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentApi } from '../../api.js'
import {
  agentGetOpts, agentUsageOpts, connectionListOpts, agentListOpts, agentMcpOpts, qk,
} from '../../queries.js'
import type { McpServerInfo, McpToolSelection } from '../../types.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { ToolPicker } from '../../components/form/ToolPicker.js'
import { VerifierPicker } from '../../components/form/VerifierPicker.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'
import { fmtDuration, fmtBytes } from '../../lib/format.js'

function formatVerifierCount(raw: string | null): string {
  if (!raw) return 'none'
  try {
    const arr = JSON.parse(raw) as string[]
    if (!Array.isArray(arr) || arr.length === 0) return 'none'
    return `${arr.length}`
  } catch { return 'malformed' }
}

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
  const { agentId } = useParams<{ agentId: string }>()
  const queryClient = useQueryClient()
  const { data: agent }           = useQuery(agentGetOpts(agentId!))
  const { data: usage }           = useQuery(agentUsageOpts(agentId!))
  const { data: connections = [] } = useQuery(connectionListOpts())
  const { data: allAgents = [] }  = useQuery(agentListOpts())
  const { data: servers = [] }    = useQuery(agentMcpOpts())
  const [editing, setEditing] = useState(false)
  const [connectionId, setConnectionId] = useState('')
  const [model, setModel] = useState('')
  const [description, setDescription] = useState('')
  const [maxTokens, setMaxTokens] = useState('8192')
  const [maxSteps, setMaxSteps] = useState('20')
  const [temperature, setTemperature] = useState('')
  const [reasoningBudget, setReasoningBudget] = useState('')
  const [toolSelection, setToolSelection] = useState<McpToolSelection | null>(null)
  const [verifiers, setVerifiers] = useState<string[]>([])
  const [error, setError] = useState('')

  // Hydrate form state once the agent loads (and on server list changes —
  // tool normalization needs the server/tool manifest).
  useEffect(() => {
    if (!agent) return
    setConnectionId(agent.connection_id)
    setModel(agent.model)
    setDescription(agent.description)
    setMaxTokens(String(agent.max_tokens))
    setMaxSteps(String(agent.max_steps))
    setTemperature(agent.temperature !== null ? String(agent.temperature) : '')
    setReasoningBudget(agent.reasoning_budget !== null ? String(agent.reasoning_budget) : '')
    setToolSelection(normalizeSelection(agent.tools, servers))
    try { const v = agent.verifiers ? JSON.parse(agent.verifiers) : []; setVerifiers(Array.isArray(v) ? v : []) } catch { setVerifiers([]) }
  }, [agent, servers])

  useBreadcrumbLabel(agent?.name ?? '')

  const saveMutation = useMutation({
    mutationFn: () => {
      const tools = toolSelection && Object.keys(toolSelection).length > 0 ? toolSelection : undefined
      return agentApi.update(agent!.id, {
        connection_id: connectionId, model, description,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
        reasoning_budget: reasoningBudget ? +reasoningBudget : null,
        tools,
        verifiers: verifiers.length > 0 ? verifiers : null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.agent.all() })
      setEditing(false)
      navigate('/settings/agents')
    },
    onError: err => setError(err instanceof Error ? err.message : 'failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => agentApi.delete(agent!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.agent.all() })
      navigate('/settings/agents')
    },
  })

  if (!agent || !usage) return null
  const connectionName = connections.find(c => c.id === agent.connection_id)?.name ?? agent.connection_id

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
        { label: 'verifiers',   value: formatVerifierCount(agent.verifiers) },
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
        <form onSubmit={e => { e.preventDefault(); setError(''); saveMutation.mutate() }} className="space-y-4">
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
          <VerifierPicker agents={allAgents.filter(a => a.id !== agent.id)} selected={verifiers} onChange={setVerifiers} />
          <div className="flex gap-2 pt-2">
            <ActionButton label="cancel" variant="secondary" onClick={() => setEditing(false)} className="flex-1" />
            <ActionButton label="save" type="submit" className="flex-1" />
          </div>
        </form>
      )}

      {!editing && (
        <ActionButton label="delete agent" variant="destructive" onClick={() => { if (confirm('Delete this agent?')) deleteMutation.mutate() }} className="w-full" />
      )}
    </DetailShell>
  )
}
