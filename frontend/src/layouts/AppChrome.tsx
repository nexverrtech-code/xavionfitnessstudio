import {
  Bell,
  CalendarClock,
  ChevronDown,
  Hourglass,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Receipt,
  ScanLine,
  Search,
  Sun,
  UserPlus,
  Wallet,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { InboxList, useInbox } from '@/components/notifications/Inbox'
import { Button, IconButton } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Avatar, Kbd, Menu } from '@/components/ui/Menu'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useConfig } from '@/contexts/ConfigContext'
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext'
import { useApi } from '@/hooks/useApi'
import { useClickOutside } from '@/hooks/useUtilities'
import { bottomNavFor, navFor } from '@/routes/navigation'
import { dashboardApi } from '@/services/endpoints'
import { cn } from '@/utils/cn'
import { formatMoney } from '@/utils/format'

const ROLE_LABELS = { ADMIN: 'Admin', STAFF: 'Front desk', TRAINER: 'Trainer', MEMBER: 'Member' }

export function Sidebar() {
  const { user } = useAuth()
  const config = useConfig()
  const actions = useActions()
  if (!user) return null
  const items = navFor(user.role)
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link to="/" className="min-w-0" aria-label={`${config.gym_name} home`}>
          <Logo name={config.gym_name} />
        </Link>
      </div>
      <nav aria-label="Main" className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
                isActive ? 'bg-accent-50 text-accent-800 dark:bg-accent-500/15 dark:text-accent-200' : 'text-ink-2 hover:bg-hover hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute -left-3 top-2 h-6 w-1 rounded-r-full bg-accent-500" aria-hidden />}
                <item.icon className={cn('size-[18px]', isActive ? 'text-accent-700 dark:text-accent-300' : 'text-muted group-hover:text-ink-2')} aria-hidden />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      {user.role !== 'TRAINER' && (
        <div className="m-3 hidden overflow-hidden rounded-2xl bg-hero p-4 text-white ring-1 ring-white/5 [@media(min-height:860px)]:block">
          <p className="text-sm font-semibold">Front desk mode</p>
          <p className="mt-0.5 text-[12px] text-white/75">Scan QR codes to mark attendance in one tap.</p>
          <Link to="/attendance" className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3 text-[13px] font-bold text-accent-800 hover:bg-white/90">
            <ScanLine className="size-4" aria-hidden /> Open scanner
          </Link>
        </div>
      )}
      <div className="border-t border-line p-3">
        <button type="button" onClick={actions.openPalette} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] text-muted hover:bg-hover">
          <span>Command palette</span>
          <span className="flex gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>
    </aside>
  )
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  const options: { value: ThemePreference; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ]
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1" role="radiogroup" aria-label="Theme">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={cn('flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold', theme === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}

export function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  if (!user) return null
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-hover"
      >
        <Avatar name={user.name} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block max-w-32 truncate text-[13px] font-semibold leading-tight text-ink">{user.name}</span>
          <span className="block text-[11px] leading-tight text-muted">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 animate-pop-in rounded-2xl border border-line bg-surface p-2 shadow-pop">
          <div className="px-2 pb-2 pt-1">
            <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
            <p className="truncate text-[12px] text-muted">{user.login}</p>
          </div>
          <div className="px-1 pb-2">
            <ThemeSwitch />
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              navigate('/account/password')
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-2 hover:bg-hover"
          >
            <KeyRound className="size-4" aria-hidden /> Change password
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-500/10"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function NotificationBell({ staff }: { staff: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  useClickOutside(ref, () => setOpen(false), open)
  // One lightweight request per page visit — no background polling.
  const summary = useApi(staff ? 'dashboard:summary' : null, () => dashboardApi.summary())
  const inbox = useInbox()
  const { reload } = summary
  const reloadInbox = inbox.reload
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (staff) reload()
      reloadInbox()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload, reloadInbox, staff])
  useEffect(() => setOpen(false), [location.pathname])

  const pending = summary.data?.pending_payments.count ?? 0
  const expiring = summary.data?.members.expiring ?? 0
  const badge = pending + inbox.unread
  const label = `Notifications${pending ? `, ${pending} payment${pending === 1 ? '' : 's'} to verify` : ''}${inbox.unread ? `, ${inbox.unread} unread` : ''}`
  return (
    <div ref={ref} className="relative">
      <IconButton icon={Bell} label={label} badge={badge} onClick={() => setOpen((v) => !v)} aria-expanded={open} />
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          {staff && (
            <div className="border-b border-line p-2">
              <p className="px-2 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-faint">Needs attention</p>
              <Link to="/payments?tab=pending" className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-hover">
                <span className="flex size-9 items-center justify-center rounded-lg bg-subtle text-ink-2 ring-1 ring-line">
                  <Hourglass className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">
                    {pending} UPI payment{pending === 1 ? '' : 's'} to verify
                  </span>
                  <span className="block text-[12px] text-muted">{formatMoney(summary.data?.pending_payments.amount ?? 0)} awaiting approval</span>
                </span>
              </Link>
              <Link to="/memberships" className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-hover">
                <span className="flex size-9 items-center justify-center rounded-lg bg-subtle text-ink-2 ring-1 ring-line">
                  <CalendarClock className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">
                    {expiring} membership{expiring === 1 ? '' : 's'} expiring
                  </span>
                  <span className="block text-[12px] text-muted">Within the next 7 days</span>
                </span>
              </Link>
            </div>
          )}
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">Your notifications</p>
            {inbox.unread > 0 && (
              <button type="button" onClick={() => void inbox.markAll()} className="cursor-pointer text-[12px] font-semibold text-ink-2 hover:text-ink hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="scrollbar-thin max-h-80 overflow-y-auto">
            <InboxList inbox={inbox} compact />
          </div>
        </div>
      )}
    </div>
  )
}

export function Topbar({ onMore }: { onMore: () => void }) {
  const { user } = useAuth()
  const config = useConfig()
  const actions = useActions()
  const staff = user?.role === 'ADMIN' || user?.role === 'STAFF'
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface/70">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6 lg:px-8">
        <IconButton icon={MenuIcon} label="Open menu" onClick={onMore} className="-ml-2 lg:hidden" />
        <Link to="/" className="flex min-w-0 items-center gap-2 lg:hidden" aria-label="Home">
          <LogoMark className="size-8" />
          <span className="truncate text-[15px] font-bold text-ink">{config.gym_name}</span>
        </Link>
        <button
          type="button"
          onClick={actions.openPalette}
          className="hidden h-10 w-full max-w-md items-center gap-3 rounded-xl border border-line bg-subtle px-3.5 text-left text-sm text-faint transition hover:border-line-strong md:flex"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 truncate">Search members or type a command…</span>
          <span className="flex gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <IconButton icon={Search} label="Search" onClick={actions.openPalette} className="md:hidden" />
          {staff && (
            <Menu
              label="Quick add"
              trigger={({ toggle, open }) => (
                <Button size="sm" icon={Plus} onClick={toggle} aria-expanded={open} className="hidden sm:inline-flex">
                  New
                </Button>
              )}
              items={[
                { label: 'Add member', icon: UserPlus, onSelect: actions.addMember },
                { label: 'Record payment', icon: Wallet, onSelect: () => actions.collectPayment() },
                { label: 'Add expense', icon: Receipt, onSelect: actions.addExpense, hidden: user?.role !== 'ADMIN' },
              ]}
            />
          )}
          <NotificationBell staff={staff} />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

export function MobileNav({ onMore }: { onMore: () => void }) {
  const { user } = useAuth()
  if (!user) return null
  const items = bottomNavFor(user.role)
  return (
    <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden">
      <div className="mx-auto grid h-16 max-w-md grid-cols-4">
        {items.map((item) => {
          const scan = item.label === 'Scan'
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-accent-700 dark:text-accent-300' : 'text-muted')}
            >
              {scan ? (
                <span className="-mt-7 flex size-14 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-glow ring-4 ring-surface">
                  <item.icon className="size-6" aria-hidden />
                </span>
              ) : (
                <item.icon className="size-5" aria-hidden />
              )}
              {item.label}
            </NavLink>
          )
        })}
        <button type="button" onClick={onMore} className="flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted">
          <MoreHorizontal className="size-5" aria-hidden />
          More
        </button>
      </div>
    </nav>
  )
}

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth()
  const actions = useActions()
  const location = useLocation()
  useEffect(() => onClose(), [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null
  const staff = user.role === 'ADMIN' || user.role === 'STAFF'
  return (
    <Dialog open={open} onClose={onClose} title="Menu">
      {staff && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button variant="soft" icon={UserPlus} onClick={() => (onClose(), actions.addMember())}>
            Add member
          </Button>
          <Button variant="soft" icon={Wallet} onClick={() => (onClose(), actions.collectPayment())}>
            Collect payment
          </Button>
        </div>
      )}
      <nav aria-label="All sections" className="grid grid-cols-3 gap-2">
        {navFor(user.role).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-2 rounded-2xl border px-2 py-3.5 text-center text-[12px] font-semibold',
                isActive ? 'border-accent-600 bg-accent-50 text-accent-800 dark:bg-accent-500/15 dark:text-accent-200' : 'border-line text-ink-2',
              )
            }
          >
            <item.icon className="size-5" aria-hidden />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-4 space-y-3">
        <ThemeSwitch />
        <Button variant="secondary" icon={LogOut} fullWidth onClick={logout} className="text-danger-600">
          Sign out
        </Button>
      </div>
    </Dialog>
  )
}
