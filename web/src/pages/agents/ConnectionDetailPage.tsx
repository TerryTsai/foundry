import { useEffect, useState } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { connectionApi } from '../../api.js'
import type { Connection, ProviderMetadata, CredentialField } from '../../types.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'

export function ConnectionDetailPage() {
  const navigate = useNavigate()
  const connection = useLoaderData() as Connection
  const [name, setName] = useState(connection.name)
  const [provider, setProvider] = useState<ProviderMetadata | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useBreadcrumbLabel(connection.name)

  useEffect(() => {
    connectionApi.providers()
      .then(list => setProvider(list.find(p => p.kind === connection.kind) ?? null))
      .catch(err => setError(err instanceof Error ? err.message : 'failed to load provider'))
  }, [connection.kind])

  // Pre-populate non-secret fields from the connection's stored config.
  // Secrets are never round-tripped to the client — they stay blank.
  useEffect(() => {
    if (!provider) return
    try {
      const cfg = JSON.parse(connection.config) as Record<string, string>
      const init: Record<string, string> = {}
      for (const f of provider.credentials) {
        if (f.type !== 'password' && cfg[f.key] != null) init[f.key] = String(cfg[f.key])
      }
      setValues(init)
    } catch { /* malformed stored config — leave blank */ }
  }, [provider, connection.config])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!provider) return
    const secrets: Record<string, string> = {}
    const config:  Record<string, string> = {}
    for (const f of provider.credentials) {
      const v = values[f.key] ?? ''
      if (f.type === 'password') { if (v) secrets[f.key] = v }       // omit blank secrets (keep current)
      else                       { config[f.key] = v }
    }
    const data: { name?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> } = {}
    if (name && name !== connection.name) data.name = name
    if (Object.keys(config).length  > 0) data.config  = config
    if (Object.keys(secrets).length > 0) data.secrets = secrets
    if (Object.keys(data).length === 0) { setError('nothing to update'); return }
    try {
      await connectionApi.update(connection.id, data)
      navigate('/settings/connections')
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!confirm('Remove this connection?')) return
    await connectionApi.delete(connection.id)
    navigate('/settings/connections')
  }

  function renderField(f: CredentialField) {
    const val = values[f.key] ?? ''
    const set = (v: string) => setValues(prev => ({ ...prev, [f.key]: v }))
    const label = f.type === 'password' ? `${f.label} (leave blank to keep current)` : f.label
    if (f.type === 'select' && f.options) {
      return (
        <Field key={f.key} label={label} help={f.help}>
          <Select value={val} onChange={e => set(e.target.value)}>
            <option value="">—</option>
            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
          </Select>
        </Field>
      )
    }
    if (f.type === 'textarea') {
      return (
        <Field key={f.key} label={label} help={f.help}>
          <TextArea value={val} onChange={e => set(e.target.value)} placeholder={f.placeholder} />
        </Field>
      )
    }
    return (
      <Field key={f.key} label={label} help={f.help}>
        <TextInput
          type={f.type === 'password' ? 'password' : 'text'}
          value={val}
          onChange={e => set(e.target.value)}
          placeholder={f.placeholder}
        />
      </Field>
    )
  }

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <DetailShell
      type="connection" id={connection.id} title={connection.name}
      infoRows={[
        { label: 'kind',    value: connection.kind },
        { label: 'scope',   value: 'account' },
        { label: 'key',     value: connection.api_key_preview },
        { label: 'added',   value: ts(connection.created_at) },
        { label: 'updated', value: connection.updated_at !== connection.created_at ? ts(connection.updated_at) : null },
      ]}
    >
      <form onSubmit={handleSave} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required />
        </Field>
        {provider?.credentials.map(renderField)}
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="save" type="submit" className="flex-1" disabled={!provider} />
        </div>
      </form>
      <ActionButton label="remove connection" variant="destructive" onClick={handleDelete} className="w-full" />
    </DetailShell>
  )
}
