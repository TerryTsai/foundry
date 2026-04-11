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
  const [interval, setInterval] = useState('600')
  const [maxAgents, setMaxAgents] = useState('3')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const saved = await projectApi.create({ name, repo, schedule_interval: +interval, concurrency_limit: +maxAgents })
      navigate(`/p/${saved.id}/agents/new`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  return (
    <div className="h-dvh flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2.5 px-4 h-12 shrink-0 border-b border-zinc-200 dark:border-zinc-800/60">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">New Project</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto lg:px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="text-sm text-red-400">{error}</div>}
            <Field label="name">
              <TextInput value={name} onChange={e => setName(e.target.value)} required />
            </Field>
            <Field label="github repo (owner/name)">
              <TextInput value={repo} onChange={e => setRepo(e.target.value)} placeholder="TerryTsai/foundry" pattern="^[\w.-]+/[\w.-]+$" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="interval (s)">
                <TextInput type="number" value={interval} onChange={e => setInterval(e.target.value)} required min="10" />
              </Field>
              <Field label="max agents">
                <TextInput type="number" value={maxAgents} onChange={e => setMaxAgents(e.target.value)} required min="1" />
              </Field>
            </div>
            <div className="flex gap-2 pt-2">
              <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
              <ActionButton label="create" type="submit" className="flex-1" />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
