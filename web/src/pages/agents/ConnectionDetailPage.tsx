import { useState } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { connectionApi } from '../../api.js'
import type { Connection } from '../../types.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'

export function ConnectionDetailPage() {
  const navigate = useNavigate()
  const connection = useLoaderData() as Connection
  const [name, setName] = useState(connection.name)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')

  useBreadcrumbLabel(connection.name)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const data: { name?: string; secrets?: Record<string, unknown> } = {}
      if (name && name !== connection.name) data.name    = name
      if (apiKey)                            data.secrets = { api_key: apiKey }
      if (Object.keys(data).length === 0) { setError('nothing to update'); return }
      await connectionApi.update(connection.id, data)
      navigate('/settings/connections')
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!confirm('Remove this connection?')) return
    await connectionApi.delete(connection.id)
    navigate('/settings/connections')
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
        <Field label="new api key">
          <TextInput type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="leave blank to keep current" />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="save" type="submit" className="flex-1" />
        </div>
      </form>
      <ActionButton label="remove connection" variant="destructive" onClick={handleDelete} className="w-full" />
    </DetailShell>
  )
}
