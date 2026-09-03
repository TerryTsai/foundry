import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, Check, ChevronRight, Circle, Factory, GitBranch, Pause, Play, Plus, Settings2 } from 'lucide-react'
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'

import {
  authStatus, createTask, enableRepository, getHistory, getProject, getRepositories,
  getWorkspace, runWorker, saveWorkerSettings, setTaskStatus, steer, updateTask,
} from './api.js'
import type { GithubCommit, Project, Repository, Task, TaskStatus, Workspace } from './types.js'

export function App() {
  const [auth, setAuth] = useState<{ loading: boolean; connected: boolean; oauthConfigured: boolean }>({ loading: true, connected: false, oauthConfigured: false })
  useEffect(() => { authStatus().then(value => setAuth({ loading: false, ...value })).catch(() => setAuth({ loading: false, connected: false, oauthConfigured: false })) }, [])
  if (auth.loading) return <Centered><span className="muted">Opening Foundry…</span></Centered>
  if (!auth.connected) return <Connect oauthConfigured={auth.oauthConfigured} />
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/repositories" element={<Repositories />} />
    <Route path="/projects/:owner/:repo" element={<ProjectPage />} />
    <Route path="/projects/:owner/:repo/tasks/:taskId" element={<TaskPage />} />
    <Route path="/projects/:owner/:repo/tasks/:taskId/history" element={<HistoryPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => getWorkspace().then(setWorkspace).catch(errorValue => setError(message(errorValue))), [])
  useEffect(() => { void load(); const interval = setInterval(() => void load(), 15_000); return () => clearInterval(interval) }, [load])
  if (!workspace) return <Page title="Foundry"><Loading error={error} /></Page>
  return <Page title="Foundry" action={<WorkerDot workspace={workspace} />}>
    <main className="stack home-stack">
      {workspace.projects.length === 0
        ? <Empty title="No Foundry projects yet" detail="Enable Foundry on a GitHub repository to begin." action={<Link className="button primary" to="/repositories">Choose repository</Link>} />
        : workspace.projects.map(project => <ProjectRow key={project.id} project={project} />)}
    </main>
    <WorkerControls workspace={workspace} onChange={load} />
    <Link className="floating-button" to="/repositories" aria-label="Add project"><Plus size={20} /></Link>
  </Page>
}

function ProjectRow({ project }: { project: Project }) {
  const featured = project.tasks.find(task => task.status === 'needs_you') || project.tasks.find(task => task.status === 'working')
  return <Link className="project-row" to={`/projects/${project.owner}/${project.repo}`}>
    <div className="row-heading">
      <strong>{project.config.name || project.repo}</strong>
      {!project.config.enabled && <span className="muted small">Paused</span>}
    </div>
    {featured
      ? <div className="task-glance"><StatusMark status={featured.status} /><div><div>{featured.title}</div><p>{featured.next || featured.current.at(-1) || featured.description}</p></div><StatusLabel status={featured.status} /></div>
      : <p className="muted project-empty">{project.tasks.length ? 'No active task' : 'No tasks yet'}</p>}
  </Link>
}

function ProjectPage() {
  const { owner = '', repo = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => getProject(owner, repo).then(setProject).catch(errorValue => setError(message(errorValue))), [owner, repo])
  useEffect(() => { void load() }, [load])
  if (!project) return <Page title={repo} back><Loading error={error} /></Page>
  return <Page title={project.config.name || project.repo} back action={<button className="icon-button" onClick={() => setCreating(value => !value)}><Plus size={20} /></button>}>
    <main className="stack">
      {creating && <NewTask owner={owner} repo={repo} onDone={() => { setCreating(false); void load() }} />}
      <section className="task-list">
        {project.tasks.map(task => <TaskRow key={task.id} project={project} task={task} />)}
        {!project.tasks.length && <Empty title="No delegated tasks" detail="Tell Foundry what responsibility to take on." />}
      </section>
      <Steering owner={owner} repo={repo} onDone={load} />
    </main>
  </Page>
}

function TaskRow({ project, task }: { project: Project; task: Task }) {
  return <Link className="task-row" to={`/projects/${project.owner}/${project.repo}/tasks/${task.id}`}>
    <StatusMark status={task.status} />
    <div className="task-row-copy"><strong>{task.title}</strong>{task.status === 'working' && <p>{task.next || task.current.at(-1)}</p>}</div>
    <StatusLabel status={task.status} compact />
    <ChevronRight size={16} className="chevron" />
  </Link>
}

function TaskPage() {
  const { owner = '', repo = '', taskId = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => getProject(owner, repo).then(setProject).catch(errorValue => setError(message(errorValue))), [owner, repo])
  useEffect(() => { void load() }, [load])
  const task = project?.tasks.find(item => item.id === taskId)
  if (!project || !task) return <Page title="Task" back><Loading error={error} /></Page>
  const changeStatus = async (status: TaskStatus) => { await setTaskStatus(owner, repo, taskId, status); await load() }
  return <Page title={task.title} back>
    <main className="stack task-detail">
      <div className="detail-status"><StatusMark status={task.status} /><StatusLabel status={task.status} /></div>
      {editing && <EditTask owner={owner} repo={repo} task={task} onDone={() => { setEditing(false); void load() }} />}
      {task.status === 'needs_you' ? <NeedsYou task={task} owner={owner} repo={repo} onDone={load} /> : <TaskBrief task={task} />}
      <Steering owner={owner} repo={repo} taskId={taskId} onDone={load} />
      <div className="task-actions">
        <div className="inline-actions"><button className="text-button" onClick={() => setEditing(value => !value)}>Edit</button>{task.status === 'working' && <button className="text-button" onClick={() => void changeStatus('paused')}><Pause size={16} /> Pause</button>}{(task.status === 'paused' || task.status === 'queued') && <button className="text-button" onClick={() => void changeStatus('working')}><Play size={16} /> Start working</button>}</div>
        <Link className="text-button" to={`/projects/${owner}/${repo}/tasks/${taskId}/history`}>History <ChevronRight size={16} /></Link>
      </div>
    </main>
  </Page>
}

function EditTask({ owner, repo, task, onDone }: { owner: string; repo: string; task: Task; onDone: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try { await updateTask(owner, repo, task.id, { title, description }); onDone() } finally { setSaving(false) }
  }
  return <form className="panel new-task" onSubmit={event => void submit(event)}><Label>Edit task</Label><input value={title} onChange={event => setTitle(event.target.value)} required /><textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} /><button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></form>
}

function TaskBrief({ task }: { task: Task }) {
  return <>
    {task.current.length > 0 && <section><Label>Latest</Label><ul className="progress-list">{task.current.map((item, index) => <li key={item}><span>{index === task.current.length - 1 && task.status === 'working' ? '→' : '✓'}</span>{item}</li>)}</ul></section>}
    {task.next && <section><Label>Next</Label><p className="brief-copy">{task.next}</p></section>}
    {!task.current.length && <p className="brief-copy">{task.description}</p>}
    {task.guidance.length > 0 && <section><Label>Guidance</Label><ul className="plain-list">{task.guidance.map(item => <li key={item}>{item}</li>)}</ul></section>}
    <p className="muted small">Updated {relativeTime(task.updated)}</p>
  </>
}

function NeedsYou({ task, owner, repo, onDone }: { task: Task; owner: string; repo: string; onDone: () => void }) {
  const act = async (messageText: string) => { await steer(owner, repo, messageText, task.id); onDone() }
  return <section className="needs-you-card">
    <Label>Needs You</Label>
    {task.current.map(item => <p key={item}>{item}</p>)}
    <p className="recommendation">{task.next || 'Review the current state and reply with the missing judgment.'}</p>
    <div className="button-row"><button className="button primary" onClick={() => void act('Approve the recommendation and continue')}>Approve</button><button className="button" onClick={() => document.getElementById('steering-input')?.focus()}>Reply</button><button className="button" onClick={() => void act('Pause')}>Pause</button></div>
  </section>
}

function NewTask({ owner, repo, onDone }: { owner: string; repo: string; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState(false)
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try { await createTask(owner, repo, { title, description, start }); onDone() } finally { setSaving(false) }
  }
  return <form className="panel new-task" onSubmit={event => void submit(event)}>
    <Label>Delegate a task</Label>
    <input value={title} onChange={event => setTitle(event.target.value)} placeholder="What responsibility should Foundry own?" required />
    <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Outcome, constraints, and context" required rows={4} />
    <label className="checkbox"><input type="checkbox" checked={start} onChange={event => setStart(event.target.checked)} /> Start now <span className="muted">(queues the current task)</span></label>
    <button className="button primary" disabled={saving}>{saving ? 'Delegating…' : 'Delegate'}</button>
  </form>
}

function Steering({ owner, repo, taskId, onDone }: { owner: string; repo: string; taskId?: string; onDone: () => void }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!value.trim()) return; setSaving(true)
    try { await steer(owner, repo, value, taskId); setValue(''); onDone() } finally { setSaving(false) }
  }
  return <form className="steering" onSubmit={event => void submit(event)}>
    <input id="steering-input" value={value} onChange={event => setValue(event.target.value)} placeholder="Tell Foundry anything…" />
    <button disabled={!value.trim() || saving} aria-label="Send">→</button>
  </form>
}

function WorkerControls({ workspace, onChange }: { workspace: Workspace; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const settings = workspace.settings
  const save = async (patch: Partial<Workspace['settings']>) => { await saveWorkerSettings({ ...settings, ...patch }); onChange() }
  return <section className="worker-footer">
    <button className="worker-summary" onClick={() => setOpen(value => !value)}><Settings2 size={15} /> Worker · {settings.paused ? 'paused' : frequencyLabel(settings.frequency)}</button>
    {open && <div className="worker-panel">
      <select value={settings.frequency} onChange={event => void save({ frequency: event.target.value as Workspace['settings']['frequency'] })}>
        <option value="manual">Manual</option><option value="15m">Every 15 minutes</option><option value="30m">Every 30 minutes</option><option value="1h">Every hour</option><option value="4h">Every 4 hours</option>
      </select>
      <button className="button" onClick={() => void save({ paused: !settings.paused })}>{settings.paused ? <Play size={15} /> : <Pause size={15} />}{settings.paused ? 'Resume' : 'Pause'}</button>
      <button className="button primary" disabled={workspace.worker.busy} onClick={async () => { await runWorker(); onChange() }}>{workspace.worker.busy ? 'Working…' : 'Work now'}</button>
      {workspace.worker.lastMessage && <p className="muted small">{workspace.worker.lastMessage}</p>}
    </div>}
  </section>
}

function Repositories() {
  const [repositories, setRepositories] = useState<Repository[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { getRepositories().then(setRepositories).catch(errorValue => setError(message(errorValue))) }, [])
  const enable = async (repository: Repository) => {
    await enableRepository(repository)
    setRepositories(current => current?.map(item => item.full_name === repository.full_name ? { ...item, foundryEnabled: true } : item) || null)
  }
  return <Page title="Repositories" back><main className="stack"><p className="muted">A repository becomes a project when it contains <code>.foundry/config.yaml</code>.</p>
    {!repositories ? <Loading error={error} /> : repositories.map(repository => <div className="repository-row" key={repository.full_name}><div><strong>{repository.name}</strong><p>{repository.owner.login}{repository.private ? ' · Private' : ''}</p></div>{repository.foundryEnabled ? <span className="enabled"><Check size={15} /> Enabled</span> : <button className="button" onClick={() => void enable(repository)}>Enable</button>}</div>)}
  </main></Page>
}

function HistoryPage() {
  const { owner = '', repo = '', taskId = '' } = useParams()
  const [commits, setCommits] = useState<GithubCommit[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { getHistory(owner, repo, taskId).then(setCommits).catch(errorValue => setError(message(errorValue))) }, [owner, repo, taskId])
  return <Page title="History" back><main className="stack">{!commits ? <Loading error={error} /> : commits.map(commit => <a className="history-row" href={commit.html_url} target="_blank" rel="noreferrer" key={commit.sha}><GitBranch size={16} /><div><strong>{commit.commit.message.split('\n')[0]}</strong><p>{relativeTime(commit.commit.author.date)} · {commit.commit.author.name}</p></div></a>)}</main></Page>
}

function Page({ title, back = false, action, children }: { title: string; back?: boolean; action?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate()
  return <div className="app"><header>{back ? <button className="icon-button" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button> : <Factory size={19} className="brand-mark" />}<h1>{title}</h1><div className="header-action">{action}</div></header>{children}</div>
}

function Connect({ oauthConfigured }: { oauthConfigured: boolean }) {
  return <Centered><div className="connect-card"><Factory size={28} /><h1>Foundry</h1><p>Delegate durable responsibilities across your GitHub projects.</p>{oauthConfigured ? <a className="button primary" href="/auth/github">Connect GitHub</a> : <p className="notice">Configure GitHub OAuth, or set <code>GITHUB_TOKEN</code> for local use.</p>}</div></Centered>
}

function WorkerDot({ workspace }: { workspace: Workspace }) {
  const label = workspace.settings.paused ? 'Paused' : workspace.worker.busy ? 'Working' : 'Worker'
  return <span className={`worker-dot ${workspace.worker.busy ? 'active' : ''}`}><i /> {label}</span>
}

function StatusMark({ status }: { status: TaskStatus }) {
  if (status === 'done') return <Check className="status-mark done" size={18} />
  if (status === 'needs_you') return <AlertCircle className="status-mark needs" size={18} />
  if (status === 'working') return <span className="status-mark pulse" />
  if (status === 'paused') return <Pause className="status-mark muted-icon" size={17} />
  return <Circle className="status-mark queued" size={16} />
}

function StatusLabel({ status, compact = false }: { status: TaskStatus; compact?: boolean }) {
  const labels: Record<TaskStatus, string> = { queued: 'Queued', working: 'Working', needs_you: 'Needs You', paused: 'Paused', done: 'Done' }
  return <span className={`status-label ${status} ${compact ? 'compact' : ''}`}>{labels[status]}</span>
}

function Loading({ error }: { error: string }) { return error ? <p className="error">{error}</p> : <p className="muted loading">Loading…</p> }
function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) { return <div className="empty"><strong>{title}</strong><p>{detail}</p>{action}</div> }
function Label({ children }: { children: ReactNode }) { return <h2 className="label">{children}</h2> }
function Centered({ children }: { children: ReactNode }) { return <div className="centered">{children}</div> }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function frequencyLabel(value: Workspace['settings']['frequency']): string { return ({ manual: 'manual', '15m': 'every 15m', '30m': 'every 30m', '1h': 'every hour', '4h': 'every 4h' })[value] }
function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
