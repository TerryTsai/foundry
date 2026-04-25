import { createBrowserRouter, Navigate, Outlet, useOutletContext } from 'react-router-dom'
import type { Params } from 'react-router-dom'
import { queryClient } from './queryClient.js'
import {
  projectListOpts, projectGetOpts, agentListOpts, agentGetOpts, agentUsageOpts,
  connectionListOpts, ticketListOpts, ticketGetOpts, ticketChainOpts,
  ticketCommentsOpts, ticketUsageOpts, ticketTagsOpts, ticketVerdictsOpts,
  ticketSessionsOpts, sessionGetOpts, sessionActivitiesOpts, sessionExecutionsOpts,
  sessionUsageOpts, executionGetOpts, analyticsGetOpts,
} from './queries.js'

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

// Loaders fire-and-forget prefetches into the React Query cache and
// return null synchronously. This means navigation is never blocked
// waiting for a refetch — components read from cache via useQuery and
// render with whatever data is already there (stale-while-revalidate).
// First visits to an uncached page see a brief null render, which the
// receiving component handles with a loading/undefined guard.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prefetch = (...opts: any[]) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of opts) queryClient.prefetchQuery(o as any)
  return null
}

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
    loader: () => prefetch(analyticsGetOpts({ days: 30 }), projectListOpts(), agentListOpts()),
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
        loader: () => prefetch(agentListOpts()),
        children: [
          { index: true, element: <AgentsIndexPlaceholder /> },
          {
            path: 'new',
            element: <AgentNewPage />,
            loader: () => prefetch(connectionListOpts()),
          },
          {
            path: ':agentId',
            element: <AgentDetailPage />,
            loader: ({ params }) => prefetch(
              agentGetOpts(params.agentId!),
              agentUsageOpts(params.agentId!),
              connectionListOpts(),
            ),
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
            loader: () => prefetch(connectionListOpts()),
          },
          { path: 'new', element: <ConnectionNewPage /> },
          {
            path: ':connectionId',
            element: <ConnectionDetailPage />,
            loader: () => prefetch(connectionListOpts()),
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
            loader: () => prefetch(projectListOpts()),
          },
          { path: 'new', element: <ProjectNewPage /> },
          {
            path: ':projectId',
            element: <ProjectEditPage />,
            loader: ({ params }) => prefetch(projectGetOpts(params.projectId!)),
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
    loader: ({ params }) => prefetch(projectGetOpts(pid(params))),
    children: [
      { index: true, element: <Navigate to="tickets" replace /> },

      // Tickets
      {
        path: 'tickets',
        element: <TicketsSplitLayout />,
        handle: { crumb: 'Tickets' },
        loader: ({ params }) => prefetch(
          ticketListOpts({ projectId: pid(params) }),
          agentListOpts(),
        ),
        children: [
          {
            index: true,
            element: <TicketsIndexPlaceholder />,
          },
          {
            path: 'new',
            element: <TicketNewPage />,
            handle: { crumb: 'New' },
            loader: () => prefetch(agentListOpts()),
          },
          {
            path: ':ticketId',
            element: <Passthrough />,
            handle: { crumb: 'Ticket' },
            children: [
              {
                index: true,
                element: <TicketDetailPage />,
                loader: ({ params }) => {
                  const tid = params.ticketId!
                  return prefetch(
                    ticketGetOpts(tid),
                    agentListOpts(),
                    ticketCommentsOpts(tid),
                    ticketUsageOpts(tid),
                    ticketTagsOpts(tid),
                    ticketVerdictsOpts(tid),
                    ticketSessionsOpts(tid),
                    ticketChainOpts(tid),
                  )
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
                        loader: ({ params }) => prefetch(
                          ticketGetOpts(params.ticketId!),
                          sessionGetOpts(params.sessionId!),
                          agentListOpts(),
                          sessionExecutionsOpts(params.sessionId!),
                          sessionActivitiesOpts(params.sessionId!),
                          sessionUsageOpts(params.sessionId!),
                        ),
                      },
                      {
                        path: 'executions/:executionId',
                        element: <ExecutionDetailPage />,
                        handle: { crumb: 'Execution' },
                        loader: ({ params }) => prefetch(executionGetOpts(params.executionId!)),
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
