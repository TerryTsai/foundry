import { QueryClient } from '@tanstack/react-query'

// Single shared cache. Loaders warm it via ensureQueryData; components read
// via useQuery. Mutations invalidate only the keys they affect — no more
// blunt cache clears.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Trust the cache for navigation. staleTime Infinity means
      // loaders (ensureQueryData) and mounting components never wait on
      // a refetch just because some arbitrary clock elapsed.
      staleTime: Infinity,
      // Keep cached data around 30m after the last observer unmounts
      // so revisits within a normal session hit the cache.
      gcTime: 30 * 60 * 1000,
      // On mount, refetch only if the query was explicitly invalidated
      // (by a mutation or focus). Prevents double-fetching on every
      // route change.
      refetchOnMount: true,
      // Always refresh on tab refocus — that's the user's signal that
      // they're looking at this thing again and want it current.
      refetchOnWindowFocus: 'always',
      retry: 1,
    },
  },
})
