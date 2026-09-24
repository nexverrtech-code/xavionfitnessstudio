import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { KEYS, readStorage, writeStorage } from '@/utils/storage'

export type ThemePreference = 'light' | 'dark' | 'system'

interface ThemeValue {
  theme: ThemePreference
  resolved: 'light' | 'dark'
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // A UI preference lives in the browser only — never in the database.
  const [theme, setThemeState] = useState<ThemePreference>(() => (readStorage(KEYS.theme) as ThemePreference) || 'system')
  const [dark, setDark] = useState(() => theme === 'dark' || (theme === 'system' && systemDark()))

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setDark(theme === 'dark' || (theme === 'system' && media.matches))
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    const meta = document.querySelector('meta[name="theme-color"]:not([media])') ?? document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', dark ? '#0a0b0e' : '#ffffff')
    if (!meta.parentElement) document.head.appendChild(meta)
  }, [dark])

  const setTheme = useCallback((next: ThemePreference) => {
    writeStorage(KEYS.theme, next)
    setThemeState(next)
  }, [])

  const value = useMemo(() => ({ theme, resolved: dark ? ('dark' as const) : ('light' as const), setTheme }), [theme, dark, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
