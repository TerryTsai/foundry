import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { providerApi } from '../../api.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'

const TYPES = ['anthropic', 'openai', 'claude-subscription']

export function ProviderNewPage() {
  const { projectId } = useShell()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [type, setType] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await providerApi.create({ name, type, api_key: apiKey })
      navigate(`/p/${projectId}/agents/providers`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. personal-anthropic" />
        </Field>
        <Field label="type">
          <Select value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label={type === 'claude-subscription' ? 'oauth token' : 'api key'}>
          <TextInput
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            required
            placeholder={type === 'claude-subscription' ? 'run `claude setup-token` to obtain' : 'sk-...'}
          />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="add" type="submit" className="flex-1" />
        </div>
      </form>
    </div>
  )
}
