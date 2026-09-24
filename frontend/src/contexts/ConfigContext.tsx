import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/services/endpoints'
import type { PublicConfig } from '@/types'
import { configureFormatting } from '@/utils/format'
import { KEYS, readJSON, writeJSON } from '@/utils/storage'

const DEFAULTS: PublicConfig = { gym_name: 'SmartGym', currency: 'INR', timezone: 'Asia/Kolkata', member_code_prefix: 'GYM' }

const ConfigContext = createContext<PublicConfig>(DEFAULTS)

export function ConfigProvider({ children }: { children: ReactNode }) {
  // Branding is safe to cache locally, so the first paint never waits for the network.
  const [config, setConfig] = useState<PublicConfig>(() => {
    const cached = readJSON<PublicConfig>(KEYS.config) ?? DEFAULTS
    configureFormatting(cached)
    return cached
  })

  useEffect(() => {
    authApi
      .publicConfig()
      .then((fresh) => {
        configureFormatting(fresh)
        writeJSON(KEYS.config, fresh)
        setConfig(fresh)
      })
      .catch(() => undefined)
  }, [])

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
}

export function useConfig(): PublicConfig {
  return useContext(ConfigContext)
}
