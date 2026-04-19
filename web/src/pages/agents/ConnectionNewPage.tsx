import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionApi } from '../../api.js'
import { connectionProvOpts, qk } from '../../queries.js'
import type { CredentialField } from '../../types.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'

export function ConnectionNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: providers = [] } = useQuery(connectionProvOpts())
  const [kind, setKind] = useState('')
  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    if (providers.length > 0 && !kind) setKind(providers[0].kind)
  }, [providers, kind])

  const provider = providers.find(p => p.kind === kind)

  // Reset field values when provider changes so stale entries don't leak.
  useEffect(() => { setValues({}) }, [kind])

  const createMutation = useMutation({
    mutationFn: () => {
      if (!provider) throw new Error('no provider')
      const secrets: Record<string, string> = {}
      const config:  Record<string, string> = {}
      for (const f of provider.credentials) {
        const v = values[f.key] ?? ''
        if (!v && !f.required) continue
        if (f.type === 'password') secrets[f.key] = v
        else                       config[f.key]  = v
      }
      return connectionApi.create({ name, kind, secrets, config })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.connection.all() })
      navigate('/settings/connections')
    },
    onError: err => setError(err instanceof Error ? err.message : 'failed'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!provider) return
    createMutation.mutate()
  }

  function renderField(f: CredentialField) {
    const val = values[f.key] ?? ''
    const set = (v: string) => setValues(prev => ({ ...prev, [f.key]: v }))
    const label = f.label + (f.required ? '' : ' (optional)')
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
          <TextArea value={val} onChange={e => set(e.target.value)} placeholder={f.placeholder} required={f.required} />
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
          required={f.required}
        />
      </Field>
    )
  }

  return (
    <div className="px-4 py-5 lg:max-w-2xl lg:mx-auto lg:px-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. personal-anthropic" />
        </Field>
        <Field label="kind">
          <Select value={kind} onChange={e => setKind(e.target.value)}>
            {providers.map(p => <option key={p.kind} value={p.kind}>{p.name}</option>)}
          </Select>
        </Field>
        {provider?.credentials.map(renderField)}
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="add" type="submit" className="flex-1" disabled={!provider} />
        </div>
      </form>
    </div>
  )
}
