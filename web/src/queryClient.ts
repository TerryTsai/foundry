import { QueryClient } from '@tanstack/react-query'

// Single shared cache. Loaders warm it via ensureQueryData; components read
// via useQuery. Mutations invalidate only the keys they affect — no more
// blunt cache clears.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is usable for 30s after fetch before being considered stale.
      // Within that window, re-renders / re-mounts hit the cache without
      // network I/O. After it, React Query refetches in the background.
      staleTime: 30_000,
      // Refetch whenever a component mounts with a stale query — covers
      // back-nav, route change, any remount. This is what fixes the
      // "everything is stale on back" problem.
      refetchOnMount: 'always',
      // Also refetch when the tab regains focus.
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})
