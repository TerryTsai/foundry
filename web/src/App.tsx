import { useState, useEffect, useCallback } from 'react'
import { projectApi } from './api.js'
import type { Project } from './types.js'
import { GlobalHeader } from './components/GlobalHeader.js'
import { TabBar } from './components/TabBar.js'
import type { Tab } from './components/TabBar.js'
import { ProjectSwitcherSheet } from './components/ProjectSwitcherSheet.js'
import { TicketsView } from './views/TicketsView.js'
import { AgentsView } from './views/AgentsView.js'
import { RepoView } from './views/RepoView.js'
import { LogsView } from './views/LogsView.js'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [tab, setTab] = useState<Tab>('tickets')
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const loadProjects = useCallback(async () => {
    const ps = await projectApi.list()
    setProjects(ps)
    setProject(prev =>
      prev ? (ps.find(p => p.id === prev.id) ?? ps[0] ?? null) : (ps[0] ?? null)
    )
  }, [])

  useEffect(() => { loadProjects().catch(console.error) }, [loadProjects])

  return (
    <div className="flex flex-col h-dvh bg-zinc-950">
      <GlobalHeader project={project} onSwitch={() => setSwitcherOpen(true)} />

      <main className="flex-1 min-h-0 overflow-hidden">
        {!project ? (
          <div className="px-4 py-3 font-mono text-xs text-zinc-600">loading…</div>
        ) : (
          <>
            {tab === 'tickets' && <TicketsView key={project.id} projectId={project.id} />}
            {tab === 'agents'  && <AgentsView  key={project.id} projectId={project.id} />}
            {tab === 'repo'    && <RepoView    key={project.id} projectSlug={project.slug} />}
            {tab === 'logs'    && <LogsView    key={project.id} />}
          </>
        )}
      </main>

      <TabBar current={tab} onChange={setTab} />

      <ProjectSwitcherSheet
        open={switcherOpen}
        projects={projects}
        current={project}
        onSelect={setProject}
        onClose={() => setSwitcherOpen(false)}
        onRefresh={loadProjects}
      />
    </div>
  )
}
