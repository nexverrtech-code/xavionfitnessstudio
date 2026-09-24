import { Bell } from 'lucide-react'
import { Suspense } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { LogoMark } from '@/components/brand/Logo'
import { OfflineBanner, PageLoader } from '@/components/ui/Feedback'
import { useConfig } from '@/contexts/ConfigContext'
import { useApi } from '@/hooks/useApi'
import { PORTAL_NAV } from '@/routes/navigation'
import { portalApi } from '@/services/endpoints'
import { cn } from '@/utils/cn'
import { UserMenu } from './AppChrome'

/** Member app shell — mobile-first, fitness-app feel. */
export default function PortalLayout() {
  const config = useConfig()
  const overview = useApi('portal:overview', () => portalApi.overview())
  const unread = overview.data?.unread_notifications ?? 0
  return (
    <div className="min-h-dvh">
      <OfflineBanner />
      <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link to="/portal" className="flex min-w-0 items-center gap-2.5" aria-label="Home">
            <LogoMark className="size-8" />
            <span className="truncate text-[15px] font-bold text-ink">{config.gym_name}</span>
          </Link>
          <nav aria-label="Member sections" className="ml-6 hidden items-center gap-1 md:flex">
            {PORTAL_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/portal'}
                className={({ isActive }) => cn('rounded-xl px-3 py-2 text-sm font-semibold', isActive ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link
              to="/portal/notifications"
              className="relative flex size-10 items-center justify-center rounded-xl text-ink-2 hover:bg-hover"
              aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <Bell className="size-5" aria-hidden />
              {unread > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white ring-2 ring-canvas">
                  {unread}
                </span>
              )}
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-32 pt-4 md:pb-12">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <nav aria-label="Member navigation" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md md:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          {PORTAL_NAV.map((item) => {
            const qr = item.to === '/portal/qr'
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/portal'}
                className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-accent-700 dark:text-accent-300' : 'text-muted')}
              >
                {qr ? (
                  <span className="-mt-7 flex size-14 items-center justify-center rounded-2xl bg-hero text-volt shadow-pop ring-4 ring-surface dark:bg-volt dark:text-on-volt">
                    <item.icon className="size-6" aria-hidden />
                  </span>
                ) : (
                  <item.icon className="size-5" aria-hidden />
                )}
                {item.label}
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
