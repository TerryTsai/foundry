import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ticketApi } from '../../api.js'
import { agentListOpts, qk } from '../../queries.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'

export function TicketNewPage() {
  const { projectId } = useShell()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: agents = [] } = useQuery(agentListOpts())
  const [agentId, setAgentId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: () => ticketApi.create({
      project_id: projectId, title, description,
      agent_id: agentId || undefined, created_by: 'founder',
    }),
    onSuccess: ticket => {
      queryClient.invalidateQueries({ queryKey: qk.ticket.all() })
      navigate(`/p/${projectId}/tickets/${ticket.id}`)
    },
    onError: err => setError(err instanceof Error ? err.message : 'failed'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    createMutation.mutate()
  }

  return (
    <div className="px-4 py-5 lg:max-w-2xl lg:mx-auto lg:px-6">
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
          <TextArea label="description" value={description} onChange={e => setDescription(e.target.value)} required rows={5} />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="create" type="submit" className="flex-1" />
        </div>
      </form>
    </div>
  )
}
