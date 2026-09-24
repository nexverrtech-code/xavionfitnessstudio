import { lazy, type ComponentType, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { homePathFor, useAuth } from '@/contexts/AuthContext'
import type { Role } from '@/types'

/** Route guard. UX only — the API enforces every role check server-side as well. */
export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (user.must_change_password && location.pathname !== '/account/password') return <Navigate to="/account/password" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user)} replace />
  return <>{children}</>
}

export function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={homePathFor(user)} replace />
}

const RELOAD_FLAG = 'smartgym.chunk-reload'

/** React.lazy that recovers from a stale deploy (old chunk names) by reloading once. */
export function lazyPage<T extends ComponentType<object>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await factory()
      sessionStorage.removeItem(RELOAD_FLAG)
      return module
    } catch (error) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
      }
      throw error
    }
  })
}
