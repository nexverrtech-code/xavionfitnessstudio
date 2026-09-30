import {
  AlertTriangle,
  Ban,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  ListChecks,
  LogIn,
  LogOut,
  PauseCircle,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  Trash2,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CameraScanner } from '@/components/attendance/CameraScanner'
import { VisitChips, VisitRows, visitRange } from '@/components/attendance/Visits'
import { StatusBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Menu'
import { PageHeader, Pagination, Segmented, Tabs } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { attendanceApi } from '@/services/endpoints'
import type { AttendanceEntry, AttendanceVisit, ScanResult } from '@/types'
import { cn } from '@/utils/cn'
import { beep } from '@/utils/feedback'
import { daysLeftLabel, durationLabel, formatDate, formatNumber, formatTime, todayISO } from '@/utils/format'

const RESULT_STYLE: Record<string, { icon: LucideIcon; tone: string; ring: string; title: string }> = {
  CHECKED_IN: { icon: CheckCircle2, tone: 'bg-success-600', ring: 'ring-success-600/20', title: 'Attendance Marked' },
  ALREADY_CHECKED_IN: { icon: Clock3, tone: 'bg-warning-500', ring: 'ring-warning-500/20', title: 'Already checked in' },
  CHECKED_OUT: { icon: LogOut, tone: 'bg-info-600', ring: 'ring-info-600/20', title: 'Checked out' },
  ALREADY_CHECKED_OUT: { icon: LogOut, tone: 'bg-neutral-600', ring: 'ring-neutral-600/20', title: 'Already checked out' },
  NOT_CHECKED_IN: { icon: LogIn, tone: 'bg-neutral-600', ring: 'ring-neutral-600/20', title: 'Not checked in' },
  LIMIT: { icon: Ban, tone: 'bg-danger-600', ring: 'ring-danger-600/20', title: 'Daily limit reached' },
  EXPIRED: { icon: XCircle, tone: 'bg-danger-600', ring: 'ring-danger-600/20', title: 'Membership Expired' },
  NO_MEMBERSHIP: { icon: XCircle, tone: 'bg-danger-600', ring: 'ring-danger-600/20', title: 'No active membership' },
  NOT_STARTED: { icon: Clock3, tone: 'bg-info-600', ring: 'ring-info-600/20', title: 'Membership not started' },
  SUSPENDED: { icon: PauseCircle, tone: 'bg-warning-600', ring: 'ring-warning-600/20', title: 'Membership on hold' },
  INACTIVE: { icon: UserX, tone: 'bg-neutral-600', ring: 'ring-neutral-600/20', title: 'Inactive member' },
  INVALID: { icon: ShieldAlert, tone: 'bg-danger-600', ring: 'ring-danger-600/20', title: 'Invalid QR code' },
  NOT_FOUND: { icon: Search, tone: 'bg-neutral-600', ring: 'ring-neutral-600/20', title: 'Member not found' },
  MULTIPLE: { icon: AlertTriangle, tone: 'bg-warning-500', ring: 'ring-warning-500/20', title: 'Pick the member' },
}

function subtitle(result: ScanResult): string {
  switch (result.result) {
    case 'CHECKED_IN':
      return (result.visit_number ?? 1) > 1 ? `Welcome back — visit ${result.visit_number} today.` : 'Welcome in!'
    case 'CHECKED_OUT':
      return `See you next time! ${result.minutes !== undefined ? `Time in the gym: ${durationLabel(result.minutes)}.` : ''}`.trim()
    case 'ALREADY_CHECKED_IN':
    case 'ALREADY_CHECKED_OUT':
      return 'Scanned twice — nothing changed.'
    case 'EXPIRED':
      return 'Please renew membership.'
    default:
      return result.message
  }
}

interface RecentScan {
  key: number
  result: ScanResult
  at: number
}

interface DayCounts {
  members: number
  visits: number
  in_gym: number | null
}

function ResultCard({
  result,
  busy,
  onAgain,
  onPick,
  onCheckOut,
  onRenew,
}: {
  result: ScanResult | null
  busy: boolean
  onAgain: () => void
  onPick: (id: number) => void
  onCheckOut: (id: number) => void
  onRenew?: (memberId: number) => void
}) {
  const actions = useActions()
  if (busy && !result) {
    return (
      <Card className="flex min-h-72 items-center justify-center">
        <Spinner className="size-8 text-accent-700" />
      </Card>
    )
  }
  if (!result) {
    return (
      <Card className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300">
          <ScanLine className="size-8" aria-hidden />
        </span>
        <p className="mt-4 text-lg font-semibold text-ink">Ready to scan</p>
        <p className="mt-1 max-w-xs text-sm text-muted">Scan when a member arrives and again when they leave. They can come back as many times as your gym allows.</p>
      </Card>
    )
  }
  const style = RESULT_STYLE[result.result] ?? RESULT_STYLE.NOT_FOUND
  const Icon = style.icon
  const blocked = !result.ok
  const out = result.result === 'CHECKED_OUT' || result.result === 'ALREADY_CHECKED_OUT'
  return (
    <Card className={cn('overflow-hidden ring-4', style.ring)} aria-live="assertive">
      <div className={cn('flex items-center gap-4 px-5 py-5 text-white', style.tone)}>
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <Icon className="size-8" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight">
            {result.result === 'CHECKED_IN' ? '✓ ' : ''}
            {style.title}
          </p>
          <p className="mt-0.5 text-sm text-white/90">{subtitle(result)}</p>
        </div>
      </div>
      {result.member ? (
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <Avatar name={result.member.name} size="lg" />
            <div className="min-w-0 flex-1">
              <Link to={`/members/${result.member.id}`} className="block truncate text-lg font-semibold text-ink hover:underline">
                {result.member.name}
              </Link>
              <p className="tabular text-sm text-muted">{result.member.member_code}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-[12px] font-medium text-muted">{out ? 'Check-out time' : 'Check-in time'}</dt>
              <dd className="mt-0.5 text-base font-semibold text-ink">{result.time ? formatTime(result.time) : '—'}</dd>
              {out && result.check_in && <dd className="text-[12px] text-muted">In at {formatTime(result.check_in)}</dd>}
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-[12px] font-medium text-muted">Membership Status</dt>
              <dd className="mt-1">{result.membership ? <StatusBadge status={result.membership.status} /> : '—'}</dd>
              {result.visits_today !== undefined && (
                <dd className="mt-1 text-[12px] text-muted">
                  {result.visits_today} visit{result.visits_today === 1 ? '' : 's'} today
                </dd>
              )}
            </div>
            {result.membership?.expiry_date && (
              <div className="col-span-2 rounded-xl bg-subtle p-3">
                <dt className="text-[12px] font-medium text-muted">{result.membership.plan_name ?? 'Membership'}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">
                  {daysLeftLabel(result.membership.days_left)} · expires {formatDate(result.membership.expiry_date)}
                </dd>
              </div>
            )}
          </dl>
          {result.result === 'ALREADY_CHECKED_IN' && (
            <Button variant="secondary" icon={LogOut} fullWidth onClick={() => onCheckOut(result.member!.id)}>
              Check out now
            </Button>
          )}
          {blocked && onRenew && ['EXPIRED', 'NO_MEMBERSHIP'].includes(result.result) && (
            <Button variant="primary" icon={RefreshCw} fullWidth size="lg" onClick={() => onRenew(result.member!.id)}>
              Renew membership now
            </Button>
          )}
        </div>
      ) : result.matches ? (
        <ul className="divide-y divide-line">
          {result.matches.map((match) => (
            <li key={match.id}>
              <button type="button" onClick={() => onPick(match.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-hover">
                <Avatar name={match.name} size="sm" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-ink">{match.name}</span>
                  <span className="block text-[12px] text-muted">{match.member_code}</span>
                </span>
                <CalendarCheck2 className="size-4 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-2 border-t border-line bg-subtle p-3">
        <Button variant="secondary" icon={ScanLine} onClick={onAgain} data-autofocus>
          Scan Again
        </Button>
        <Button variant="secondary" icon={Search} onClick={actions.openPalette}>
          Search Member
        </Button>
      </div>
    </Card>
  )
}

function TodayCounts({ counts }: { counts: DayCounts | null }) {
  if (!counts) return null
  return (
    <p className="text-[12px] text-muted">
      <span className="font-semibold text-ink-2">{formatNumber(counts.members)}</span> member{counts.members === 1 ? '' : 's'} today ·{' '}
      {formatNumber(counts.visits)} visit{counts.visits === 1 ? '' : 's'}
      {counts.in_gym !== null && (
        <>
          {' '}
          · <span className="font-semibold text-success-700 dark:text-success-300">{formatNumber(counts.in_gym)} in the gym</span>
        </>
      )}
    </p>
  )
}

function ScanTab() {
  const { user } = useAuth()
  const actions = useActions()
  const toast = useToast()
  const staff = user?.role === 'ADMIN' || user?.role === 'STAFF'
  const inputRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [recent, setRecent] = useState<RecentScan[]>([])
  // Today's totals load once; each scan then adjusts them locally (no full reload per scan).
  const today = useApi(`attendance:today:${todayISO()}`, () => attendanceApi.log({ date: todayISO(), limit: 1 }))
  const [counts, setCounts] = useState<DayCounts | null>(null)
  useEffect(() => {
    if (today.data) setCounts({ members: today.data.members, visits: today.data.visits, in_gym: today.data.in_gym })
  }, [today.data])

  const handle = useCallback(
    async (run: () => Promise<ScanResult>) => {
      setBusy(true)
      try {
        const scanned = await run()
        setResult(scanned)
        setRecent((list) => [{ key: Date.now() + Math.random(), result: scanned, at: Date.now() }, ...list].slice(0, 8))
        beep(scanned.result === 'CHECKED_IN' || scanned.result === 'CHECKED_OUT' ? 'success' : scanned.ok ? 'warning' : 'error')
        if (scanned.result === 'CHECKED_IN') {
          setCounts((c) => c && { members: c.members + ((scanned.visit_number ?? 1) === 1 ? 1 : 0), visits: c.visits + 1, in_gym: c.in_gym === null ? null : c.in_gym + 1 })
        } else if (scanned.result === 'CHECKED_OUT') {
          setCounts((c) => c && { ...c, in_gym: c.in_gym === null ? null : Math.max(0, c.in_gym - 1) })
        }
        if (scanned.member) invalidate(`member:${scanned.member.id}`)
        // Visits change the dashboard's counts and feed; its charts refresh on their own 5-minute cycle.
        invalidate('dashboard:summary', 'dashboard:activity', 'attendance:log')
      } catch (error) {
        toast.fromError(error)
        beep('error')
      } finally {
        setBusy(false)
        setCode('')
        inputRef.current?.focus()
      }
    },
    [toast],
  )

  const submitCode = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || busy) return
    void handle(() => attendanceApi.scan(trimmed))
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <CameraScanner onCode={submitCode} />
        <Card className="p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitCode(code)
            }}
            className="flex gap-2"
          >
            <label htmlFor="scan-input" className="sr-only">
              QR code, member ID or phone
            </label>
            <input
              id="scan-input"
              ref={inputRef}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoFocus
              autoComplete="off"
              placeholder="Scan with a USB scanner, or type member ID / phone"
              className={cn(inputClasses, 'h-12 min-w-0 flex-1 text-base')}
            />
            <Button type="submit" size="lg" icon={ScanLine} loading={busy} disabled={!code.trim()}>
              Mark
            </Button>
          </form>
          <p className="mt-2 text-[12px] text-muted">Scan in, scan out — as often as members come. Double scans are ignored.</p>
          <div className="mt-1">
            <TodayCounts counts={counts} />
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <ResultCard
          result={result}
          busy={busy}
          onAgain={() => {
            setResult(null)
            inputRef.current?.focus()
          }}
          onPick={(memberId) => void handle(() => attendanceApi.mark(memberId))}
          onCheckOut={(memberId) => void handle(() => attendanceApi.mark(memberId, 'OUT'))}
          onRenew={staff ? (memberId) => actions.collectPayment({ memberId }) : undefined}
        />
        {recent.length > 0 && (
          <Card>
            <CardHeader title="Recent scans" description="This session" />
            <ul className="divide-y divide-line">
              {recent.map((scan) => {
                const style = RESULT_STYLE[scan.result.result] ?? RESULT_STYLE.NOT_FOUND
                return (
                  <li key={scan.key} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg text-white', style.tone)}>
                      <style.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                      <span className="font-semibold text-ink">{scan.result.member?.name ?? style.title}</span> · {style.title}
                    </span>
                    <span className="shrink-0 text-[12px] text-faint">{new Date(scan.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}

/** Every visit of one member on one day: remove a mistaken entry, or end a visit now. */
function VisitsDialog({ entry, canDelete, onClose }: { entry: AttendanceEntry | null; canDelete: boolean; onClose: () => void }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  useEffect(() => setConfirming(null), [entry])
  if (!entry) return null
  const done = () => {
    invalidate('attendance', 'dashboard:summary', 'dashboard:activity', `member:${entry.member_id}`)
    onClose()
  }
  const remove = async (visit: AttendanceVisit) => {
    setWorking(true)
    try {
      await attendanceApi.remove(visit.id)
      toast.success('Visit removed', { description: `${entry.member_name} · ${visitRange(visit)}` })
      done()
    } catch (error) {
      toast.fromError(error)
    } finally {
      setWorking(false)
    }
  }
  const checkOut = async () => {
    setWorking(true)
    try {
      const result = await attendanceApi.mark(entry.member_id, 'OUT')
      if (result.ok) toast.success(result.message, { description: entry.member_name })
      else toast.warning(result.message, { description: entry.member_name })
      done()
    } catch (error) {
      toast.fromError(error)
    } finally {
      setWorking(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={entry.member_name}
      description={`${formatDate(entry.date, { weekday: true })} · ${entry.visit_count} visit${entry.visit_count === 1 ? '' : 's'}${entry.minutes ? ` · ${durationLabel(entry.minutes)} in the gym` : ''}`}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {entry.in_gym && (
            <Button icon={LogOut} loading={working && confirming === null} onClick={() => void checkOut()}>
              Check out now
            </Button>
          )}
        </div>
      }
    >
      <VisitRows
        visits={entry.visits}
        action={(visit) =>
          !canDelete ? null : confirming === visit.id ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={working}>
                Keep
              </Button>
              <Button size="sm" variant="danger" loading={working} onClick={() => void remove(visit)}>
                Remove
              </Button>
            </span>
          ) : (
            <IconButton icon={Trash2} label={`Remove the visit at ${formatTime(visit.check_in)}`} size="icon-sm" onClick={() => setConfirming(visit.id)} className="hover:text-danger-600" />
          )
        }
      />
    </Dialog>
  )
}

function LogTab() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const day = params.get('date') ?? todayISO()
  const show = params.get('show') === 'in_gym' && day === todayISO() ? 'in_gym' : 'all'
  const [page, setPage] = useState(1)
  const log = useApi(`attendance:log:${day}:${show}:${page}`, () => attendanceApi.log({ date: day, show, page, limit: 50 }), { keepPrevious: true })
  const [open, setOpen] = useState<AttendanceEntry | null>(null)
  const canDelete = user?.role === 'ADMIN' || (user?.role === 'STAFF' && day === todayISO())
  const checkout = log.data?.checkout ?? true
  const setParam = (key: string, value: string | null) => {
    setPage(1)
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const data = log.data
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={day}
            max={todayISO()}
            onChange={(event) => {
              const value = event.target.value || todayISO()
              setPage(1)
              const next = new URLSearchParams(params)
              next.set('date', value)
              if (value !== todayISO()) next.delete('show')
              setParams(next, { replace: true })
            }}
            aria-label="Date"
            className={cn(inputClasses, 'h-10 w-44')}
          />
          <span className="text-sm text-muted">{formatDate(day, { weekday: true })}</span>
        </div>
        {data && (
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink">{formatNumber(data.members)}</span> member{data.members === 1 ? '' : 's'} · {formatNumber(data.visits)} visit{data.visits === 1 ? '' : 's'}
            {data.in_gym !== null && day === todayISO() && (
              <>
                {' '}
                · <span className="font-semibold text-success-700 dark:text-success-300">{formatNumber(data.in_gym)} in the gym</span>
              </>
            )}
          </p>
        )}
      </div>
      {checkout && day === todayISO() && (
        <div className="border-b border-line px-4 py-2.5">
          <Segmented
            label="Show"
            value={show}
            onChange={(value) => setParam('show', value === 'in_gym' ? 'in_gym' : null)}
            options={[
              { value: 'all', label: 'Everyone today' },
              { value: 'in_gym', label: 'In the gym now', count: data?.in_gym ?? undefined },
            ]}
          />
        </div>
      )}
      {log.error && !data ? (
        <ErrorState error={log.error} onRetry={log.reload} />
      ) : (
        <DataList
          rows={data?.items}
          loading={log.loading}
          rowKey={(a) => a.member_id}
          onRowClick={(a) => setOpen(a)}
          columns={[
            {
              key: 'member',
              header: 'Member',
              cell: (a) => (
                <Link to={`/members/${a.member_id}`} onClick={(event) => event.stopPropagation()} className="flex items-center gap-3">
                  <Avatar name={a.member_name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink hover:underline">{a.member_name}</span>
                    <span className="block text-[12px] text-muted">{a.member_code}</span>
                  </span>
                </Link>
              ),
            },
            { key: 'visits', header: 'Visits', cell: (a) => <VisitChips visits={a.visits} /> },
            ...(checkout
              ? [
                  {
                    key: 'time',
                    header: 'Time in gym',
                    cell: (a: AttendanceEntry) => (a.minutes ? <span className="tabular whitespace-nowrap">{durationLabel(a.minutes)}</span> : <span className="text-faint">—</span>),
                  },
                ]
              : []),
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right' as const,
              cell: (a) => <IconButton icon={ListChecks} label={`${a.member_name}'s visits`} size="icon-sm" onClick={(event) => { event.stopPropagation(); setOpen(a) }} />,
            },
          ]}
          mobile={(a) => (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Avatar name={a.member_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{a.member_name}</p>
                  <p className="text-[12px] text-muted">
                    {a.member_code} · {a.visit_count} visit{a.visit_count === 1 ? '' : 's'}
                    {checkout && a.minutes ? ` · ${durationLabel(a.minutes)}` : ''}
                  </p>
                </div>
                {a.in_gym && <span className="shrink-0 rounded-full bg-success-50 px-2 py-0.5 text-[11px] font-semibold text-success-700 dark:bg-success-500/10 dark:text-success-300">In gym</span>}
              </div>
              <VisitChips visits={a.visits} />
            </div>
          )}
          empty={
            show === 'in_gym' ? (
              <EmptyState icon={CalendarCheck2} title="Nobody is in the gym right now" description="Members appear here from check-in until they check out." />
            ) : (
              <EmptyState icon={CalendarCheck2} title="No visits on this day" description="Scanned QR codes show up here instantly." />
            )
          }
        />
      )}
      {data && data.pages > 1 && (
        <div className="border-t border-line px-4">
          <Pagination page={page} pages={data.pages} total={data.total} limit={data.limit} onPage={setPage} />
        </div>
      )}
      <VisitsDialog entry={open} canDelete={canDelete} onClose={() => setOpen(null)} />
    </Card>
  )
}

export default function AttendancePage() {
  useDocumentTitle('Attendance')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'log' ? 'log' : 'scan'
  return (
    <div>
      <PageHeader title="Attendance" description="Scan in, scan out — members can visit more than once a day" />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => setParams(v === 'log' ? { tab: 'log' } : {}, { replace: true })}
        items={[
          { value: 'scan', label: 'Scan QR', icon: ScanLine },
          { value: 'log', label: 'Attendance log', icon: CalendarCheck2 },
        ]}
      />
      {tab === 'scan' ? <ScanTab /> : <LogTab />}
    </div>
  )
}
