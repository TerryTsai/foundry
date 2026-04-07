import { useState, useEffect, useCallback } from 'react'
import { projectApi } from './api.js'
import type { Project } from './types.js'
import { GlobalHeader } from './components/GlobalHeader.js'
import { TabBar } from './components/TabBar.js'
import type { Tab } from './components/TabBar.js'
import { Sidebar } from './components/Sidebar.js'
import { ProjectSwitcherSheet } from './components/ProjectSwitcherSheet.js'
import { TicketsView } from './views/TicketsView.js'
import { AgentsView } from './views/AgentsView.js'
import { FilesView } from './views/FilesView.js'
import { ProvidersView } from './views/ProvidersView.js'

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
    <div className="flex flex-col lg:flex-row h-dvh bg-white dark:bg-zinc-950">
      <Sidebar
        tab={tab}
        onTabChange={setTab}
        project={project}
        onSwitch={() => setSwitcherOpen(true)}
        onToggle={async () => {
          if (!project) return
          await projectApi.update(project.id, { status: project.status === 'active' ? 'archived' : 'active' })
          await loadProjects()
        }}
      />

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <GlobalHeader
        title={{ tickets: 'Tickets', agents: 'Agents', files: 'Files', providers: 'Providers' }[tab]}
        project={project}
        onSwitch={() => setSwitcherOpen(true)}
        onToggle={async () => {
          if (!project) return
          await projectApi.update(project.id, { status: project.status === 'active' ? 'archived' : 'active' })
          await loadProjects()
        }}
      />

      <main className="flex-1 min-h-0 overflow-hidden">
        {!project ? (
          <div className="px-4 py-3 font-mono text-xs text-zinc-600">loading…</div>
        ) : (
          <>
            <div className={tab !== 'tickets'    ? 'hidden' : 'h-full'}><TicketsView    key={project.id} projectId={project.id} /></div>
            <div className={tab !== 'agents'    ? 'hidden' : 'h-full'}><AgentsView    key={project.id} projectId={project.id} /></div>
            <div className={tab !== 'files'     ? 'hidden' : 'h-full'}><FilesView     key={project.id} projectId={project.id} /></div>
            <div className={tab !== 'providers'  ? 'hidden' : 'h-full'}><ProvidersView /></div>
          </>
        )}
      </main>

      <TabBar current={tab} onChange={setTab} />
      </div>

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
