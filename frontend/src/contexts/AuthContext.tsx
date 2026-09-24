import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearApiCache } from '@/hooks/useApi'
import { onPasswordChangeRequired, onUnauthorized, setAuthToken } from '@/services/api'
import { authApi } from '@/services/endpoints'
import type { AuthResponse, Role, User } from '@/types'
import { KEYS, readJSON, readStorage, writeJSON, writeStorage } from '@/utils/storage'

interface AuthValue {
  user: User | null
  /** true once the stored session has been checked with the server (or there was none) */
  verified: boolean
  sessionExpired: boolean
  login: (identifier: string, password: string, remember: boolean) => Promise<User>
  applySession: (auth: AuthResponse) => void
  logout: () => void
  hasRole: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function homePathFor(user: User | null): string {
  if (!user) return '/login'
  if (user.must_change_password) return '/account/password'
  if (user.role === 'MEMBER') return '/portal'
  if (user.role === 'TRAINER') return '/trainer'
  return '/dashboard'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const token = readStorage(KEYS.token)
    if (!token) return null
    setAuthToken(token)
    return readJSON<User>(KEYS.user)
  })
  const [verified, setVerified] = useState(() => !readStorage(KEYS.token))
  const [sessionExpired, setSessionExpired] = useState(false)

  const clearSession = useCallback((expired: boolean) => {
    writeStorage(KEYS.token, null)
    writeStorage(KEYS.user, null)
    writeStorage(KEYS.memberQr, null)
    setAuthToken(null)
    clearApiCache()
    setUser(null)
    setSessionExpired(expired)
    setVerified(true)
  }, [])

  const applySession = useCallback((auth: AuthResponse) => {
    writeStorage(KEYS.token, auth.token)
    writeJSON(KEYS.user, auth.user)
    setAuthToken(auth.token)
    clearApiCache()
    setSessionExpired(false)
    setUser(auth.user)
    setVerified(true)
  }, [])

  useEffect(() => {
    onUnauthorized(() => clearSession(true))
    onPasswordChangeRequired(() =>
      setUser((current) => {
        if (!current) return current
        const next = { ...current, must_change_password: true }
        writeJSON(KEYS.user, next)
        return next
      }),
    )
  }, [clearSession])

  // Revalidate a stored session in the background; the UI renders immediately from cache.
  useEffect(() => {
    if (!readStorage(KEYS.token)) return
    authApi
      .me()
      .then((fresh) => {
        writeJSON(KEYS.user, fresh)
        setUser(fresh)
      })
      .catch(() => undefined) // 401 is handled by onUnauthorized; offline keeps the cached session
      .finally(() => setVerified(true))
  }, [])

  const login = useCallback(
    async (identifier: string, password: string, remember: boolean) => {
      const auth = await authApi.login(identifier, password, remember)
      applySession(auth)
      return auth.user
    },
    [applySession],
  )

  const logout = useCallback(() => clearSession(false), [clearSession])
  const hasRole = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user])

  const value = useMemo(
    () => ({ user, verified, sessionExpired, login, applySession, logout, hasRole }),
    [user, verified, sessionExpired, login, applySession, logout, hasRole],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
