import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authApi } from '@/services/endpoints'
import type { PublicConfig } from '@/types'
import { configureFormatting } from '@/utils/format'
import { KEYS, readJSON, writeJSON } from '@/utils/storage'

// The gym's own name is shown everywhere; until the first profile loads there is no name
// (showing another brand for a moment would be wrong).
const DEFAULTS: PublicConfig = { gym_name: '', currency: 'INR', timezone: 'Asia/Kolkata', member_code_prefix: 'GYM' }
const REFRESH_AFTER_MS = 5 * 60_000

interface ConfigActions {
  /** Use new public settings right away (after the admin saves them) on every screen. */
  applyConfig: (changes: Partial<PublicConfig>) => void
  /** Re-read the gym profile from the server. */
  refresh: () => Promise<void>
}

const ConfigContext = createContext<PublicConfig>(DEFAULTS)
const ConfigActionsContext = createContext<ConfigActions>({ applyConfig: () => undefined, refresh: async () => undefined })

/** Names the browser shows outside the page: the iOS home-screen label and the app name. */
function applyBranding(name: string): void {
  if (!name) return
  for (const selector of ['meta[name="apple-mobile-web-app-title"]', 'meta[name="application-name"]']) {
    const meta = document.querySelector(selector) ?? document.head.appendChild(document.createElement('meta'))
    meta.setAttribute('name', selector.includes('apple') ? 'apple-mobile-web-app-title' : 'application-name')
    meta.setAttribute('content', name)
  }
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  // Cached on the device so the first paint already shows the gym's name and currency.
  const [config, setConfig] = useState<PublicConfig>(() => {
    const cached = { ...DEFAULTS, ...(readJSON<PublicConfig>(KEYS.config) ?? {}) }
    configureFormatting(cached)
    return cached
  })
  const fetchedAt = useRef(0)

  const applyConfig = useCallback((changes: Partial<PublicConfig>) => {
    setConfig((current) => {
      const next = { ...current, ...changes }
      configureFormatting(next)
      writeJSON(KEYS.config, next)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    fetchedAt.current = Date.now()
    try {
      applyConfig(await authApi.publicConfig())
    } catch {
      /* offline: keep the cached profile */
    }
  }, [applyConfig])

  useEffect(() => {
    void refresh()
    // Phones keep the app open for days: pick up a renamed gym when it comes back to the front.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedAt.current > REFRESH_AFTER_MS) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  useEffect(() => applyBranding(config.gym_name), [config.gym_name])

  const actions = useMemo(() => ({ applyConfig, refresh }), [applyConfig, refresh])
  return (
    <ConfigActionsContext.Provider value={actions}>
      <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
    </ConfigActionsContext.Provider>
  )
}

export function useConfig(): PublicConfig {
  return useContext(ConfigContext)
}

export function useConfigActions(): ConfigActions {
  return useContext(ConfigActionsContext)
}
