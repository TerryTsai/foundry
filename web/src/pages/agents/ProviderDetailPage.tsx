import { useState } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { providerApi } from '../../api.js'
import type { Provider } from '../../types.js'
import { useShell } from '../../Shell.js'
import { DetailShell } from '../../components/layout/DetailShell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { ActionButton } from '../../components/form/ActionButton.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'

export function ProviderDetailPage() {
  const { projectId } = useShell()
  const navigate = useNavigate()
  const provider = useLoaderData() as Provider
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')

  useBreadcrumbLabel(provider.name)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await providerApi.update(provider.id, { api_key: apiKey })
      navigate(`/p/${projectId}/agents/providers`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  async function handleDelete() {
    if (!confirm('Remove this provider?')) return
    await providerApi.delete(provider.id)
    navigate(`/p/${projectId}/agents/providers`)
  }

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <DetailShell
      type="provider" id={provider.id} title={provider.name}
      infoRows={[
        { label: 'key', value: provider.api_key_preview },
        { label: 'added', value: ts(provider.created_at) },
        { label: 'updated', value: provider.updated_at !== provider.created_at ? ts(provider.updated_at) : null },
      ]}
    >
      <form onSubmit={handleSave} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="new api key">
          <TextInput type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} required placeholder="sk-..." />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="update key" type="submit" className="flex-1" />
        </div>
      </form>
      <ActionButton label="remove provider" variant="destructive" onClick={handleDelete} className="w-full" />
    </DetailShell>
  )
}
