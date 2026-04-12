import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectApi } from '../../api.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { ActionButton } from '../../components/form/ActionButton.js'

export function ProjectNewPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [maxAgents, setMaxAgents] = useState('3')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const saved = await projectApi.create({ name, repo, max_agents: +maxAgents })
      navigate(`/p/${saved.id}/tickets`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  return (
    <div className="py-5 lg:max-w-2xl lg:mx-auto lg:px-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required />
        </Field>
        <Field label="github repo (owner/name)">
          <TextInput value={repo} onChange={e => setRepo(e.target.value)} placeholder="TerryTsai/foundry" pattern="^[\w.-]+/[\w.-]+$" required />
        </Field>
        <Field label="max agents">
          <TextInput type="number" value={maxAgents} onChange={e => setMaxAgents(e.target.value)} required min="1" />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="create" type="submit" className="flex-1" />
        </div>
      </form>
    </div>
  )
}
