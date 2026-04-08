import { useState } from 'react'
import { useNavigate, useLoaderData } from 'react-router-dom'
import { ticketApi } from '../../api.js'
import type { Agent } from '../../types.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'

export function TicketNewPage() {
  const { projectId } = useShell()
  const navigate = useNavigate()
  const agents = useLoaderData() as Agent[]
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await ticketApi.create({ project_id: projectId, title, body, agent_id: agentId || undefined, created_by: 'founder' })
      navigate(`/p/${projectId}/tickets`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="agent">
          <Select value={agentId} onChange={e => setAgentId(e.target.value)}>
            <option value="">unassigned</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="title">
          <TextInput value={title} onChange={e => setTitle(e.target.value)} required />
        </Field>
        <Field label="description">
          <TextArea label="description" value={body} onChange={e => setBody(e.target.value)} required rows={5} />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="create" type="submit" className="flex-1" />
        </div>
      </form>
    </div>
  )
}
