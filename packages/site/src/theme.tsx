import { createContext, useContext, useState, useEffect } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const ThemeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  mode: 'system', setMode: () => {},
})

function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    (localStorage.getItem('theme') as ThemeMode) ?? 'system'
  )

  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  function setMode(m: ThemeMode) {
    localStorage.setItem('theme', m)
    setModeState(m)
  }

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>
}

export function useTheme() { return useContext(ThemeContext) }
