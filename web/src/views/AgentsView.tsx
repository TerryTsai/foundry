import { useState, useEffect, useCallback } from 'react'
import { agentApi, providerApi } from '../api.js'
import type { Agent, Provider } from '../types.js'
import { Sheet } from '../components/Sheet.js'
import { PageShell } from '../components/layout/PageShell.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { Field } from '../components/form/Field.js'
import { TextInput } from '../components/form/TextInput.js'
import { TextArea } from '../components/form/TextArea.js'
import { ActionButton } from '../components/form/ActionButton.js'
import { ToolPicker } from '../components/form/ToolPicker.js'

type SubTab = 'agents' | 'providers'

// ── Agent Form ──

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
  const [model, setModel] = useState('anthropic:claude-sonnet-4-20250514')
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState('8192')
  const [maxSteps, setMaxSteps] = useState('20')
  const [temperature, setTemperature] = useState('')
  const [availableTools, setAvailableTools] = useState<string[]>([])
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const isNew = agent === null

  useEffect(() => {
    agentApi.tools().then(setAvailableTools).catch(() => {})
  }, [])

  useEffect(() => {
    if (agent) {
      setName(agent.name)
      setModel(agent.model)
      setPrompt(agent.prompt)
      setMaxTokens(String(agent.max_tokens))
      setMaxSteps(String(agent.max_steps))
      setTemperature(agent.temperature !== null ? String(agent.temperature) : '')
      setSelectedTools(agent.tools ? new Set(JSON.parse(agent.tools) as string[]) : new Set())
    } else {
      setName(''); setModel('anthropic:claude-sonnet-4-20250514'); setPrompt('')
      setMaxTokens('8192'); setMaxSteps('20'); setTemperature('')
      setSelectedTools(new Set())
    }
    setError('')
  }, [agent])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const tools = selectedTools.size > 0 ? [...selectedTools] : undefined
      const shared = {
        model, prompt,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
        tools,
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
        <ToolPicker available={availableTools} selected={selectedTools} onChange={setSelectedTools} />
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

// ── Provider Form ──

const SUPPORTED = ['anthropic', 'openai']

function ProviderSheet({
  provider,
  onClose,
  onUpdate,
}: {
  provider: Provider | null
  onClose: () => void
  onUpdate: () => void
}) {
  const [name, setName] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const isNew = provider === null

  useEffect(() => {
    if (provider) {
      setName(provider.name)
      setApiKey('')
    } else {
      setName('anthropic'); setApiKey('')
    }
    setError('')
  }, [provider])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (isNew) {
        await providerApi.create({ name, api_key: apiKey })
      } else {
        await providerApi.update(provider.id, { api_key: apiKey })
      }
      onUpdate(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!provider || !confirm('Remove this provider?')) return
    await providerApi.delete(provider.id)
    onUpdate(); onClose()
  }

  return (
    <form onSubmit={handleSave} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="provider">
          {isNew ? (
            <select
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800"
            >
              {SUPPORTED.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <TextInput value={name} disabled className="disabled:opacity-40" />
          )}
        </Field>
        <Field label={isNew ? 'api key' : 'new api key'}>
          <TextInput
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            required
            placeholder={provider ? provider.api_key_preview : 'sk-...'}
          />
        </Field>
        {provider && (
          <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
            current: {provider.api_key_preview}
          </div>
        )}
      </div>
      <div className="shrink-0 pt-3 space-y-2">
        <div className="flex gap-2">
          <ActionButton label="cancel" variant="secondary" onClick={onClose} className="flex-1" />
          <ActionButton label={isNew ? 'add' : 'update key'} type="submit" className="flex-1" />
        </div>
        {!isNew && (
          <ActionButton label="remove provider" variant="destructive" onClick={handleDelete} className="w-full" />
        )}
      </div>
    </form>
  )
}

// ── Agents Sub-View ──

function AgentsList({ projectId }: { projectId: string }) {
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
      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[minmax(320px,1fr)_2fr]">
        <div className="h-full lg:border-r lg:border-zinc-200 dark:lg:border-zinc-800/60 lg:overflow-y-auto">
          <PageShell
            action={!open ? { label: 'Agent', onPress: openNew } : undefined}
            onRefresh={load}
          >
            {agents.length === 0
              ? <EmptyState message="no agents" />
              : <div className="[&>:last-child]:border-b-0">{agents.map(a => (
                <ListRow
                  key={a.id}
                  title={a.name}
                  subtitle={a.model}
                  active={open && selected?.id === a.id}
                  onPress={() => openAgent(a)}
                />
              ))}</div>
            }
          </PageShell>
        </div>

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

// ── Providers Sub-View ──

function ProvidersList() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [selected, setSelected] = useState<Provider | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setProviders(await providerApi.list())
  }, [])

  useEffect(() => { load().catch(console.error) }, [load])

  function openNew() { setSelected(null); setOpen(true) }
  function openProvider(p: Provider) { setSelected(p); setOpen(true) }

  return (
    <>
      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[minmax(320px,1fr)_2fr]">
        <div className="h-full lg:border-r lg:border-zinc-200 dark:lg:border-zinc-800/60 lg:overflow-y-auto">
          <PageShell
            action={!open ? { label: 'Provider', onPress: openNew } : undefined}
            onRefresh={load}
          >
            {providers.length === 0
              ? <EmptyState message="no providers configured" />
              : <div className="[&>:last-child]:border-b-0">{providers.map(p => (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={p.api_key_preview}
                  active={open && selected?.id === p.id}
                  onPress={() => openProvider(p)}
                />
              ))}</div>
            }
          </PageShell>
        </div>

        <div className="hidden lg:flex flex-col overflow-y-auto">
          {open ? (
            <div className="flex-1 px-6 py-5 max-w-3xl">
              <ProviderSheet
                provider={selected}
                onClose={() => setOpen(false)}
                onUpdate={() => load().catch(console.error)}
              />
            </div>
          ) : (
            <EmptyState message="select a provider" />
          )}
        </div>
      </div>

      <div className="lg:hidden">
        <Sheet open={open} onClose={() => setOpen(false)} title="Provider">
          <ProviderSheet
            provider={selected}
            onClose={() => setOpen(false)}
            onUpdate={() => load().catch(console.error)}
          />
        </Sheet>
      </div>
    </>
  )
}

// ── Main View ──

export function AgentsView({ projectId }: { projectId: string }) {
  const [subTab, setSubTab] = useState<SubTab>('agents')

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-zinc-200 dark:border-zinc-800/60 shrink-0 flex items-center px-4 h-11">
        {(['agents', 'providers'] as SubTab[]).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className={`relative text-sm px-4 h-full flex items-center transition-colors capitalize ${
              subTab === t ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 active:text-zinc-700 dark:active:text-zinc-300'
            }`}>
            {subTab === t && <span className="absolute bottom-0 left-0 right-0 h-px bg-zinc-700 dark:bg-zinc-300 rounded-full" />}
            {t}
          </button>
        ))}
      </div>

      {subTab === 'agents' ? (
        <AgentsList projectId={projectId} />
      ) : (
        <ProvidersList />
      )}
    </div>
  )
}
