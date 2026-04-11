import { createBrowserRouter, Navigate, Outlet, useOutletContext } from 'react-router-dom'
import type { Params } from 'react-router-dom'
import { projectApi, ticketApi, agentApi, connectionApi, commentApi, sessionApi, executionApi } from './api.js'

function Passthrough() {
  const ctx = useOutletContext()
  return <Outlet context={ctx} />
}

import { Shell } from './Shell.js'
import { RootRedirect } from './pages/RootRedirect.js'
import { ProjectListPage } from './pages/projects/ProjectListPage.js'
import { ProjectNewPage } from './pages/projects/ProjectNewPage.js'
import { ProjectEditPage } from './pages/projects/ProjectEditPage.js'
import { TicketsSplitLayout, TicketsIndexPlaceholder } from './components/layout/TicketsSplitLayout.js'
import { TicketNewPage } from './pages/tickets/TicketNewPage.js'
import { TicketDetailPage } from './pages/tickets/TicketDetailPage.js'
import { TicketSessionDetailPage } from './pages/tickets/TicketSessionDetailPage.js'
import { ExecutionDetailPage } from './pages/tickets/ExecutionDetailPage.js'
import { AgentsSplitLayout, AgentsIndexPlaceholder } from './components/layout/AgentsSplitLayout.js'
import { AgentNewPage } from './pages/agents/AgentNewPage.js'
import { AgentDetailPage } from './pages/agents/AgentDetailPage.js'
import { ConnectionListPage } from './pages/agents/ConnectionListPage.js'
import { ConnectionNewPage } from './pages/agents/ConnectionNewPage.js'
import { ConnectionDetailPage } from './pages/agents/ConnectionDetailPage.js'
import { LoginPage } from './pages/auth/LoginPage.js'

const pid = (p: Params) => p.projectId!

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <RootRedirect /> },
  {
    path: '/projects',
    element: <ProjectListPage />,
    loader: () => projectApi.list(),
  },
  { path: '/projects/new', element: <ProjectNewPage /> },
  {
    path: '/p/:projectId',
    element: <Shell />,
    handle: { crumb: 'Project' },
    loader: ({ params }) => projectApi.get(pid(params)),
    children: [
      { index: true, element: <Navigate to="tickets" replace /> },

      // Project settings
      { path: 'settings', element: <ProjectEditPage />, handle: { crumb: 'Settings' } },

      // Tickets
      {
        path: 'tickets',
        element: <TicketsSplitLayout />,
        handle: { crumb: 'Tickets' },
        loader: ({ params }) =>
          Promise.all([ticketApi.list({ projectId: pid(params) }), agentApi.list(pid(params))])
            .then(([tickets, agents]) => ({ tickets, agents })),
        children: [
          {
            index: true,
            element: <TicketsIndexPlaceholder />,
          },
          {
            path: 'new',
            element: <TicketNewPage />,
            handle: { crumb: 'New' },
            loader: ({ params }) => agentApi.list(pid(params)),
          },
          {
            path: ':ticketId',
            element: <Passthrough />,
            handle: { crumb: 'Ticket' },
            children: [
              {
                index: true,
                element: <TicketDetailPage />,
                loader: async ({ params }) => {
                  const [ticket, agents, comments, usage] = await Promise.all([
                    ticketApi.get(params.ticketId!),
                    agentApi.list(pid(params)),
                    commentApi.list(params.ticketId!),
                    ticketApi.usage(params.ticketId!),
                  ])
                  return { ticket, agents, comments, usage }
                },
              },
              {
                path: 'sessions',
                element: <Passthrough />,
                children: [
                  {
                    path: ':sessionId',
                    element: <Passthrough />,
                    handle: { crumb: 'Session' },
                    children: [
                      {
                        index: true,
                        element: <TicketSessionDetailPage />,
                        loader: async ({ params }) => {
                          const [ticket, session, agents, executions, messages, usage] = await Promise.all([
                            ticketApi.get(params.ticketId!),
                            sessionApi.get(params.sessionId!),
                            agentApi.list(pid(params)),
                            sessionApi.executions(params.sessionId!),
                            sessionApi.messages(params.sessionId!),
                            sessionApi.usage(params.sessionId!),
                          ])
                          const agentName = agents.find(a => a.id === session.agent_id)?.name ?? null
                          return { ticket, session: { ...session, agent_name: agentName }, executions, messages, usage }
                        },
                      },
                      {
                        path: 'executions/:executionId',
                        element: <ExecutionDetailPage />,
                        handle: { crumb: 'Execution' },
                        loader: ({ params }) => executionApi.get(params.executionId!),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },

      // Agents
      {
        path: 'agents',
        element: <AgentsSplitLayout />,
        handle: { crumb: 'Agents' },
        loader: ({ params }) => agentApi.list(pid(params)),
        children: [
          {
            index: true,
            element: <AgentsIndexPlaceholder />,
          },
          {
            path: 'new',
            element: <AgentNewPage />,
            handle: { crumb: 'New' },
            loader: () => connectionApi.list(),
          },
          {
            path: ':agentId',
            element: <AgentDetailPage />,
            handle: { crumb: 'Agent' },
            loader: async ({ params }) => {
              const [agent, usage, connections] = await Promise.all([
                agentApi.get(params.agentId!),
                agentApi.usage(params.agentId!),
                connectionApi.list(),
              ])
              return { agent, usage, connections }
            },
          },
          {
            path: 'connections',
            element: <Passthrough />,
            handle: { crumb: 'Connections' },
            children: [
              {
                index: true,
                element: <ConnectionListPage />,
                loader: () => connectionApi.list(),
              },
              { path: 'new', element: <ConnectionNewPage />, handle: { crumb: 'New' } },
              {
                path: ':connectionId',
                element: <ConnectionDetailPage />,
                handle: { crumb: 'Connection' },
                loader: async ({ params }) => {
                  const cs = await connectionApi.list()
                  return cs.find(c => c.id === params.connectionId!) ?? null
                },
              },
            ],
          },
        ],
      },

      // Files
    ],
  },
])
