import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Nav } from './components/Nav.js'
import { TicketsView } from './views/TicketsView.js'
import { ProjectsView } from './views/ProjectsView.js'
import { AgentsView } from './views/AgentsView.js'
import { RepoView } from './views/RepoView.js'

export function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col h-dvh">
        <Nav />
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/tickets" replace />} />
            <Route path="/tickets" element={<TicketsView />} />
            <Route path="/projects" element={<ProjectsView />} />
            <Route path="/agents" element={<AgentsView />} />
            <Route path="/repo" element={<RepoView />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}
