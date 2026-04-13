import { createBrowserRouter, Navigate, Outlet, useOutletContext } from 'react-router-dom'
import type { Params } from 'react-router-dom'
import { projectApi, ticketApi, agentApi, connectionApi, commentApi, sessionApi, executionApi, analyticsApi } from './api.js'

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
import { HealthPage } from './pages/HealthPage.js'
import { SettingsLayout, SettingsIndexPlaceholder } from './pages/settings/SettingsLayout.js'
import { AnalyticsPage } from './pages/analytics/AnalyticsPage.js'

const pid = (p: Params) => p.projectId!

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/health', element: <HealthPage /> },
  { path: '/', element: <RootRedirect /> },

  // Account-level analytics. Lives outside the project shell because it
  // aggregates across every project the account owns; project/agent
  // narrowing happens via filter chips on the page itself.
  {
    path: '/analytics',
    element: <AnalyticsPage />,
    loader: async () => {
      const [analytics, projects, agents] = await Promise.all([
        analyticsApi.get({ days: 30 }),
        projectApi.list(),
        agentApi.list(),
      ])
      return { analytics, projects, agents }
    },
  },
  {
    path: '/settings',
    element: <SettingsLayout />,
    children: [
      { index: true, element: <SettingsIndexPlaceholder /> },

      // Agents
      {
        path: 'agents',
        element: <AgentsSplitLayout />,
        loader: () => agentApi.list(),
        children: [
          { index: true, element: <AgentsIndexPlaceholder /> },
          {
            path: 'new',
            element: <AgentNewPage />,
            loader: () => connectionApi.list(),
          },
          {
            path: ':agentId',
            element: <AgentDetailPage />,
            loader: async ({ params }) => {
              const [agent, usage, connections] = await Promise.all([
                agentApi.get(params.agentId!),
                agentApi.usage(params.agentId!),
                connectionApi.list(),
              ])
              return { agent, usage, connections }
            },
          },
        ],
      },

      // Connections
      {
        path: 'connections',
        element: <Outlet />,
        children: [
          {
            index: true,
            element: <ConnectionListPage />,
            loader: () => connectionApi.list(),
          },
          { path: 'new', element: <ConnectionNewPage /> },
          {
            path: ':connectionId',
            element: <ConnectionDetailPage />,
            loader: async ({ params }) => {
              const cs = await connectionApi.list()
              return cs.find(c => c.id === params.connectionId!) ?? null
            },
          },
        ],
      },

      // Projects
      {
        path: 'projects',
        element: <Outlet />,
        children: [
          {
            index: true,
            element: <ProjectListPage />,
            loader: () => projectApi.list(),
          },
          { path: 'new', element: <ProjectNewPage /> },
          {
            path: ':projectId',
            element: <ProjectEditPage />,
            loader: ({ params }) => projectApi.get(params.projectId!),
          },
        ],
      },

      { path: 'profile', element: <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">coming soon</div> },
    ],
  },
  {
    path: '/p/:projectId',
    element: <Shell />,
    handle: { crumb: 'Project' },
    loader: ({ params }) => projectApi.get(pid(params)),
    children: [
      { index: true, element: <Navigate to="tickets" replace /> },

      // Tickets
      {
        path: 'tickets',
        element: <TicketsSplitLayout />,
        handle: { crumb: 'Tickets' },
        loader: ({ params }) =>
          Promise.all([ticketApi.list({ projectId: pid(params) }), agentApi.list()])
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
            loader: () => agentApi.list(),
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
                  const [ticket, agents, comments, usage, tags] = await Promise.all([
                    ticketApi.get(params.ticketId!),
                    agentApi.list(),
                    commentApi.list(params.ticketId!),
                    ticketApi.usage(params.ticketId!),
                    ticketApi.tags(params.ticketId!),
                  ])
                  return { ticket, agents, comments, usage, tags }
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
                          const [ticket, session, agents, executions, activities, usage] = await Promise.all([
                            ticketApi.get(params.ticketId!),
                            sessionApi.get(params.sessionId!),
                            agentApi.list(),
                            sessionApi.executions(params.sessionId!),
                            sessionApi.activities(params.sessionId!),
                            sessionApi.usage(params.sessionId!),
                          ])
                          const agentName = agents.find(a => a.id === session.agent_id)?.name ?? null
                          return { ticket, session: { ...session, agent_name: agentName }, executions, activities, usage }
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
    ],
  },
])
