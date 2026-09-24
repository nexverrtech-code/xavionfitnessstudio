import {
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  Dumbbell,
  FileBarChart,
  LogOut,
  MoonStar,
  RefreshCw,
  Ruler,
  ScanLine,
  Search,
  Settings,
  UserPlus,
  Users,
  Wallet,
  Receipt,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { StatusBadge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Feedback'
import { Avatar, Kbd } from '@/components/ui/Menu'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useDebounce } from '@/hooks/useUtilities'
import { navFor } from '@/routes/navigation'
import { membersApi } from '@/services/endpoints'
import type { MemberListItem, Role } from '@/types'
import { cn } from '@/utils/cn'

export type PickAction = 'workout' | 'measurement' | 'renew' | 'attendance'

export interface PaletteActions {
  addMember: () => void
  collectPayment: (memberId?: number) => void
  addExpense: () => void
  pick: (action: PickAction, member: MemberListItem) => void
}

interface Entry {
  id: string
  label: string
  hint?: string
  icon?: LucideIcon
  member?: MemberListItem
  group: 'Members' | 'Actions' | 'Go to'
  run: () => void
}

const PICK_LABELS: Record<PickAction, string> = {
  workout: 'Create workout for…',
  measurement: 'Add measurement for…',
  renew: 'Renew membership for…',
  attendance: 'Mark attendance for…',
}

export function CommandPalette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: PaletteActions }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { resolved, setTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<PickAction | null>(null)
  const [members, setMembers] = useState<MemberListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounced = useDebounce(query.trim(), 220)
  const role = (user?.role ?? 'STAFF') as Role

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPick(null)
    setMembers([])
    setActive(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open || debounced.length < 2) {
      setMembers([])
      return
    }
    const controller = new AbortController()
    setLoading(true)
    membersApi
      .search(debounced, controller.signal)
      .then((data) => setMembers(data.items))
      .catch(() => undefined)
      .finally(() => !controller.signal.aborted && setLoading(false))
    return () => controller.abort()
  }, [debounced, open])

  const entries = useMemo<Entry[]>(() => {
    const done = (fn: () => void) => () => {
      onClose()
      fn()
    }
    const memberEntries: Entry[] = members.map((member) => ({
      id: `m${member.id}`,
      label: member.name,
      hint: `${member.member_code} · ${member.phone}`,
      member,
      group: 'Members',
      run: pick ? done(() => actions.pick(pick, member)) : done(() => navigate(`/members/${member.id}`)),
    }))
    if (pick) return memberEntries

    const commands: (Entry & { roles?: Role[] })[] = [
      { id: 'add-member', label: 'Add Member', icon: UserPlus, group: 'Actions', roles: ['ADMIN', 'STAFF'], run: done(actions.addMember) },
      { id: 'search-member', label: 'Search Member', hint: 'Type a name, phone or member ID', icon: Search, group: 'Actions', run: () => inputRef.current?.focus() },
      { id: 'collect', label: 'Record payment', icon: Wallet, group: 'Actions', roles: ['ADMIN', 'STAFF'], run: done(() => actions.collectPayment()) },
      { id: 'scan', label: 'Scan Attendance', icon: ScanLine, group: 'Actions', run: done(() => navigate('/attendance')) },
      { id: 'renew', label: 'Renew Membership', icon: RefreshCw, group: 'Actions', roles: ['ADMIN', 'STAFF'], run: () => (setPick('renew'), setQuery('')) },
      { id: 'workout', label: 'Create Workout', icon: Dumbbell, group: 'Actions', roles: ['ADMIN', 'TRAINER'], run: () => (setPick('workout'), setQuery('')) },
      { id: 'measure', label: 'Add Measurement', icon: Ruler, group: 'Actions', roles: ['ADMIN', 'TRAINER'], run: () => (setPick('measurement'), setQuery('')) },
      { id: 'expense', label: 'Add Expense', icon: Receipt, group: 'Actions', roles: ['ADMIN'], run: done(actions.addExpense) },
      { id: 'report', label: 'Generate Report', icon: FileBarChart, group: 'Actions', roles: ['ADMIN', 'STAFF'], run: done(() => navigate('/reports')) },
      { id: 'settings', label: 'Open Settings', icon: Settings, group: 'Actions', roles: ['ADMIN'], run: done(() => navigate('/settings')) },
      { id: 'theme', label: resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: MoonStar, group: 'Actions', run: done(() => setTheme(resolved === 'dark' ? 'light' : 'dark')) },
      { id: 'logout', label: 'Sign out', icon: LogOut, group: 'Actions', run: done(logout) },
      ...navFor(role).map((item) => ({ id: `nav${item.to}`, label: item.label, icon: item.icon, group: 'Go to' as const, run: done(() => navigate(item.to)) })),
    ]
    const q = debounced.toLowerCase()
    const filtered = commands.filter((c) => (!c.roles || c.roles.includes(role)) && (!q || c.label.toLowerCase().includes(q)))
    return [...memberEntries, ...filtered]
  }, [members, pick, role, debounced, actions, navigate, onClose, logout, resolved, setTheme])

  useEffect(() => setActive(0), [entries.length, pick])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, entries.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      entries[active]?.run()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (pick) {
        setPick(null)
        setQuery('')
      } else onClose()
    } else if (event.key === 'Backspace' && !query && pick) {
      setPick(null)
    }
  }

  let lastGroup = ''
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-start justify-center p-3 pt-[10vh] sm:p-6 sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 animate-fade-in bg-neutral-950/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-xl animate-pop-in overflow-hidden rounded-3xl border border-line bg-surface shadow-pop" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          {pick ? (
            <button type="button" onClick={() => setPick(null)} className="rounded-lg p-1 text-muted hover:bg-hover" aria-label="Back to commands">
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <Search className="size-5 shrink-0 text-faint" aria-hidden />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pick ? PICK_LABELS[pick] : 'Search or type a command...'}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `palette-${entries[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {loading ? <Spinner className="text-muted" /> : <Kbd>Esc</Kbd>}
        </div>
        <div ref={listRef} id="palette-list" role="listbox" className="scrollbar-thin max-h-[55vh] overflow-y-auto p-2">
          {entries.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-muted">
              {pick ? (debounced.length < 2 ? 'Type at least 2 letters to find a member.' : `No members match “${debounced}”.`) : `No results for “${debounced}”.`}
            </p>
          )}
          {entries.map((entry, index) => {
            const header = entry.group !== lastGroup ? entry.group : null
            lastGroup = entry.group
            const Icon = entry.icon ?? Users
            return (
              <div key={entry.id}>
                {header && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{header}</p>}
                <button
                  id={`palette-${entry.id}`}
                  data-index={index}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={entry.run}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', index === active ? 'bg-hover' : '')}
                >
                  {entry.member ? (
                    <Avatar name={entry.member.name} size="sm" />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-lg bg-subtle text-ink-2 ring-1 ring-line">
                      <Icon className="size-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{entry.label}</span>
                    {entry.hint && <span className="block truncate text-[12px] text-muted">{entry.hint}</span>}
                  </span>
                  {entry.member && <StatusBadge status={entry.member.membership.status} size="sm" />}
                  {index === active && (entry.member ? <CornerDownLeft className="size-4 text-faint" /> : <ArrowRight className="size-4 text-faint" />)}
                </button>
              </div>
            )
          })}
        </div>
        <div className="hidden items-center gap-4 border-t border-line bg-subtle px-4 py-2.5 text-[12px] text-muted sm:flex">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> {pick ? 'back' : 'close'}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
