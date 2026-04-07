import { useState, useEffect, useCallback } from 'react'
import { providerApi } from '../api.js'
import type { Provider } from '../types.js'
import { Sheet } from '../components/Sheet.js'
import { PageShell } from '../components/layout/PageShell.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { Field } from '../components/form/Field.js'
import { TextInput } from '../components/form/TextInput.js'
import { ActionButton } from '../components/form/ActionButton.js'

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

export function ProvidersView() {
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
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[minmax(320px,1fr)_2fr]">
          <div className="h-full lg:border-r lg:border-zinc-200 dark:lg:border-zinc-800/60 lg:overflow-y-auto">
            <PageShell
              action={!open ? { label: 'Provider', onPress: openNew } : undefined}
              onRefresh={load}
            >
              {providers.length === 0
                ? <EmptyState message="no providers configured" />
                : providers.map(p => (
                  <ListRow
                    key={p.id}
                    title={p.name}
                    subtitle={p.api_key_preview}
                    active={open && selected?.id === p.id}
                    onPress={() => openProvider(p)}
                  />
                ))
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
