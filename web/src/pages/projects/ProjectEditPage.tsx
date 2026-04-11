import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectApi } from '../../api.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { ActionButton } from '../../components/form/ActionButton.js'

export function ProjectEditPage() {
  const { projectId, project, revalidate } = useShell()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [interval, setInterval] = useState('')
  const [maxAgents, setMaxAgents] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (project) {
      setName(project.name)
      setRepo(project.repo)
      setInterval(String(project.schedule_interval))
      setMaxAgents(String(project.concurrency_limit))
    }
  }, [project])

  if (!project) return null

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await projectApi.update(projectId, { repo, schedule_interval: +interval, concurrency_limit: +maxAgents })
      revalidate()
      navigate(`/p/${projectId}/tickets`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5">
      <form onSubmit={handleSave} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} disabled className="disabled:opacity-40" />
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
          <ActionButton label="save" type="submit" className="flex-1" />
        </div>
      </form>
    </div>
  )
}
