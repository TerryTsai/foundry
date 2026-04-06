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

function usePreventSafariBounce() {
  useEffect(() => {
    let startY = 0

    function onTouchStart(e: TouchEvent) {
      startY = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      const dy = e.touches[0].clientY - startY

      // Walk up from the target to find a scrollable ancestor
      let el = e.target as HTMLElement | null
      while (el && el !== document.documentElement) {
        const { overflowY } = window.getComputedStyle(el)
        const scrollable = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight
        if (scrollable) {
          const atTop    = el.scrollTop === 0
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
          // Pulling down at top — let it through so pull-to-refresh touchEnd fires
          if (dy > 0 && atTop) return
          // Scrolling within bounds — allow
          if ((dy < 0 && !atBottom) || (dy > 0 && !atTop)) return
          break
        }
        el = el.parentElement
      }

      e.preventDefault()
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
    }
  }, [])
}

export function App() {
  usePreventSafariBounce()
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
      <GlobalHeader
        title={{ tickets: 'Tickets', agents: 'Agents', repo: 'Repo', logs: 'Logs' }[tab]}
        project={project}
        onSwitch={() => setSwitcherOpen(true)}
        onToggle={async () => {
          if (!project) return
          await projectApi.update(project.id, { status: project.status === 'active' ? 'paused' : 'active' })
          await loadProjects()
        }}
      />

      <main className="flex-1 min-h-0 overflow-hidden">
        {!project ? (
          <div className="px-4 py-3 font-mono text-xs text-zinc-600">loading…</div>
        ) : (
          <>
            <div className={tab !== 'tickets' ? 'hidden' : 'h-full'}><TicketsView key={project.id} projectId={project.id} /></div>
            <div className={tab !== 'agents'  ? 'hidden' : 'h-full'}><AgentsView  key={project.id} projectId={project.id} /></div>
            <div className={tab !== 'repo'    ? 'hidden' : 'h-full'}><RepoView    key={project.id} projectSlug={project.slug} /></div>
            <div className={tab !== 'logs'    ? 'hidden' : 'h-full'}><LogsView    key={project.id} /></div>
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
