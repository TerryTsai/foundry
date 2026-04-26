import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectApi } from '../api.js'

export function RootRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    projectApi.list().then(ps => {
      if (ps.length > 0) navigate(`/p/${ps[0].id}/tickets`, { replace: true })
    }).catch(console.error)
  }, [navigate])

  return <div className="h-dvh flex items-center justify-center bg-white dark:bg-zinc-950">
    <span className="text-sm text-zinc-400">loading...</span>
  </div>
}
