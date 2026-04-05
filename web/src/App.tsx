import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TopNav, BottomNav } from './components/Nav.js'
import { TicketsView } from './views/TicketsView.js'
import { ProjectsView } from './views/ProjectsView.js'
import { AgentsView } from './views/AgentsView.js'
import { RepoView } from './views/RepoView.js'
import { LogsView } from './views/LogsView.js'

export function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col h-dvh">
        <TopNav />
        <div className="flex-1 min-h-0">
          <Routes>
            <Route path="/" element={<Navigate to="/tickets" replace />} />
            <Route path="/tickets" element={<TicketsView />} />
            <Route path="/projects" element={<ProjectsView />} />
            <Route path="/agents" element={<AgentsView />} />
            <Route path="/repo" element={<RepoView />} />
            <Route path="/logs" element={<LogsView />} />
          </Routes>
        </div>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}
