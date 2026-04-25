import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { projectApi } from '../../api.js'
import { projectGetOpts, qk } from '../../queries.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { ActionButton } from '../../components/form/ActionButton.js'

export function ProjectEditPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useQuery(projectGetOpts(projectId!))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [maxAgents, setMaxAgents] = useState('1')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!project) return
    setName(project.name)
    setRepo(project.repo)
    setMaxAgents(String(project.max_agents))
  }, [project])

  const saveMutation = useMutation({
    mutationFn: () => projectApi.update(projectId!, { repo, max_agents: +maxAgents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.project.all() })
      navigate('/settings/projects')
    },
    onError: err => setError(err instanceof Error ? err.message : 'failed'),
  })

  const toggleStatus = useMutation({
    mutationFn: () => projectApi.update(projectId!, {
      status: project?.status === 'active' ? 'archived' : 'active',
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.project.all() }),
    onError: err => setError(err instanceof Error ? err.message : 'failed'),
  })

  if (!project) return null

  return (
    <div className="px-4 py-5 lg:max-w-2xl lg:mx-auto lg:px-6">
      <form onSubmit={e => { e.preventDefault(); setError(''); saveMutation.mutate() }} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} disabled className="disabled:opacity-40" />
        </Field>
        <Field label="github repo (owner/name)">
          <TextInput value={repo} onChange={e => setRepo(e.target.value)} placeholder="TerryTsai/foundry" pattern="^[\w.-]+/[\w.-]+$" required />
        </Field>
        <Field label="max agents">
          <TextInput type="number" value={maxAgents} onChange={e => setMaxAgents(e.target.value)} required min="1" />
        </Field>
        <Field label="status">
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{project.status}</span>
            <button
              type="button"
              onClick={() => toggleStatus.mutate()}
              disabled={toggleStatus.isPending}
              className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30 transition-colors"
            >
              {project.status === 'active' ? 'Pause project' : 'Resume project'}
            </button>
          </div>
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="save" type="submit" className="flex-1" />
        </div>
      </form>
    </div>
  )
}
