import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
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
import { StatusBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Menu'
import { PageHeader, Pagination, Tabs } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { attendanceApi } from '@/services/endpoints'
import type { AttendanceEntry, ScanResult } from '@/types'
import { cn } from '@/utils/cn'
import { beep } from '@/utils/feedback'
import { daysLeftLabel, formatDate, formatTime, todayISO } from '@/utils/format'

const SUBTITLES: Record<string, string> = {
  CHECKED_IN: 'Welcome in!',
  ALREADY_CHECKED_IN: 'No duplicate entry was created.',
  CHECKED_OUT: 'See you next time!',
  ALREADY_CHECKED_OUT: 'This visit is already complete.',
  EXPIRED: 'Please renew membership.',
}

const RESULT_STYLE: Record<string, { icon: LucideIcon; tone: string; ring: string; title?: string }> = {
  CHECKED_IN: { icon: CheckCircle2, tone: 'bg-success-600', ring: 'ring-success-600/20', title: 'Attendance Marked' },
  ALREADY_CHECKED_IN: { icon: Clock3, tone: 'bg-warning-500', ring: 'ring-warning-500/20', title: 'Already checked in' },
  CHECKED_OUT: { icon: LogOut, tone: 'bg-info-600', ring: 'ring-info-600/20', title: 'Checked out' },
  ALREADY_CHECKED_OUT: { icon: LogOut, tone: 'bg-neutral-600', ring: 'ring-neutral-600/20', title: 'Already checked out' },
  EXPIRED: { icon: XCircle, tone: 'bg-danger-600', ring: 'ring-danger-600/20', title: 'Membership Expired' },
  NO_MEMBERSHIP: { icon: XCircle, tone: 'bg-danger-600', ring: 'ring-danger-600/20', title: 'No active membership' },
  NOT_STARTED: { icon: Clock3, tone: 'bg-info-600', ring: 'ring-info-600/20', title: 'Membership not started' },
  SUSPENDED: { icon: PauseCircle, tone: 'bg-warning-600', ring: 'ring-warning-600/20', title: 'Membership on hold' },
  INACTIVE: { icon: UserX, tone: 'bg-neutral-600', ring: 'ring-neutral-600/20', title: 'Inactive member' },
  INVALID: { icon: ShieldAlert, tone: 'bg-danger-600', ring: 'ring-danger-600/20', title: 'Invalid QR code' },
  NOT_FOUND: { icon: Search, tone: 'bg-neutral-600', ring: 'ring-neutral-600/20', title: 'Member not found' },
  MULTIPLE: { icon: AlertTriangle, tone: 'bg-warning-500', ring: 'ring-warning-500/20', title: 'Pick the member' },
}

interface RecentScan {
  key: number
  result: ScanResult
  at: number
}

function ResultCard({ result, busy, onAgain, onPick, onRenew }: { result: ScanResult | null; busy: boolean; onAgain: () => void; onPick: (id: number) => void; onRenew?: (memberId: number) => void }) {
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
        <p className="mt-1 max-w-xs text-sm text-muted">Scan a member QR, use a USB scanner, or type a member ID or phone number.</p>
      </Card>
    )
  }
  const style = RESULT_STYLE[result.result] ?? RESULT_STYLE.NOT_FOUND
  const Icon = style.icon
  const blocked = !result.ok
  return (
    <Card className={cn('overflow-hidden ring-4', style.ring)} aria-live="assertive">
      <div className={cn('flex items-center gap-4 px-5 py-5 text-white', style.tone)}>
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <Icon className="size-8" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight">
            {result.ok && result.result === 'CHECKED_IN' ? '✓ ' : ''}
            {style.title ?? result.message}
          </p>
          <p className="mt-0.5 text-sm text-white/90">{SUBTITLES[result.result] ?? result.message}</p>
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
              <dt className="text-[12px] font-medium text-muted">{result.result === 'CHECKED_OUT' ? 'Check-out time' : 'Check-in time'}</dt>
              <dd className="mt-0.5 text-base font-semibold text-ink">{result.time ? formatTime(result.time) : '—'}</dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-[12px] font-medium text-muted">Membership Status</dt>
              <dd className="mt-1">{result.membership ? <StatusBadge status={result.membership.status} /> : '—'}</dd>
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
  const today = useApi(`attendance:log:${todayISO()}:count`, () => attendanceApi.log({ date: todayISO(), limit: 1 }))
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    if (today.data) setCount(today.data.total)
  }, [today.data])

  const handle = useCallback(
    async (run: () => Promise<ScanResult>) => {
      setBusy(true)
      try {
        const scanned = await run()
        setResult(scanned)
        setRecent((list) => [{ key: Date.now() + Math.random(), result: scanned, at: Date.now() }, ...list].slice(0, 8))
        beep(scanned.result === 'CHECKED_IN' || scanned.result === 'CHECKED_OUT' ? 'success' : scanned.ok ? 'warning' : 'error')
        if (scanned.result === 'CHECKED_IN') setCount((c) => (c ?? 0) + 1)
        if (scanned.member) invalidate(`member:${scanned.member.id}`)
        invalidate('dashboard', 'attendance:log')
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
              className={cn(inputClasses, 'h-12 flex-1 text-base')}
            />
            <Button type="submit" size="lg" icon={ScanLine} loading={busy} disabled={!code.trim()}>
              Check in
            </Button>
          </form>
          <p className="mt-2 text-[12px] text-muted">Repeat scans never create duplicates. {count !== null && <span className="font-semibold text-ink-2">{count} check-ins today.</span>}</p>
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
                    <span className={cn('flex size-7 items-center justify-center rounded-lg text-white', style.tone)}>
                      <style.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                      <span className="font-semibold text-ink">{scan.result.member?.name ?? style.title}</span> · {style.title}
                    </span>
                    <span className="text-[12px] text-faint">{new Date(scan.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
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

function LogTab() {
  const { user } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const day = params.get('date') ?? todayISO()
  const [page, setPage] = useState(1)
  const log = useApi(`attendance:log:${day}:${page}`, () => attendanceApi.log({ date: day, page, limit: 50 }), { keepPrevious: true })
  const [removing, setRemoving] = useState<AttendanceEntry | null>(null)
  const canDelete = user?.role === 'ADMIN' || (user?.role === 'STAFF' && day === todayISO())
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={day}
            max={todayISO()}
            onChange={(event) => {
              setPage(1)
              const next = new URLSearchParams(params)
              next.set('date', event.target.value || todayISO())
              setParams(next, { replace: true })
            }}
            aria-label="Date"
            className={cn(inputClasses, 'h-10 w-44')}
          />
          <span className="text-sm text-muted">{formatDate(day, { weekday: true })}</span>
        </div>
        {log.data && (
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink">{log.data.total}</span> check-ins · {log.data.checked_out} checked out
          </p>
        )}
      </div>
      {log.error && !log.data ? (
        <ErrorState error={log.error} onRetry={log.reload} />
      ) : (
        <DataList
          rows={log.data?.items}
          loading={log.loading}
          rowKey={(a) => a.id}
          columns={[
            {
              key: 'member',
              header: 'Member',
              cell: (a) => (
                <Link to={`/members/${a.member_id}`} className="flex items-center gap-3">
                  <Avatar name={a.member_name} size="sm" />
                  <span>
                    <span className="block font-semibold text-ink hover:underline">{a.member_name}</span>
                    <span className="block text-[12px] text-muted">{a.member_code}</span>
                  </span>
                </Link>
              ),
            },
            { key: 'phone', header: 'Phone', cell: (a) => <span className="tabular">{a.phone}</span> },
            { key: 'in', header: 'Check-in', cell: (a) => <span className="tabular font-medium text-ink">{formatTime(a.check_in)}</span> },
            { key: 'out', header: 'Check-out', cell: (a) => (a.check_out ? <span className="tabular">{formatTime(a.check_out)}</span> : <span className="text-faint">—</span>) },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (a) => (canDelete ? <IconButton icon={Trash2} label={`Remove ${a.member_name}'s check-in`} size="icon-sm" onClick={() => setRemoving(a)} className="hover:text-danger-600" /> : null),
            },
          ]}
          mobile={(a) => (
            <div className="flex items-center gap-3">
              <Avatar name={a.member_name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{a.member_name}</p>
                <p className="text-[12px] text-muted">{a.member_code}</p>
              </div>
              <span className="tabular text-sm text-ink-2">
                {formatTime(a.check_in)}
                {a.check_out && ` → ${formatTime(a.check_out)}`}
              </span>
            </div>
          )}
          empty={<EmptyState icon={CalendarCheck2} title="No check-ins on this day" description="Scanned QR codes show up here instantly." />}
        />
      )}
      {log.data && log.data.pages > 1 && (
        <div className="border-t border-line px-4">
          <Pagination page={page} pages={log.data.pages} total={log.data.total} limit={log.data.limit} onPage={setPage} />
        </div>
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this check-in?"
        message={removing ? `${removing.member_name}'s check-in at ${formatTime(removing.check_in)} will be deleted.` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await attendanceApi.remove(removing!.id)
            invalidate('attendance', 'dashboard', `member:${removing!.member_id}`)
            toast.success('Check-in removed')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
    </Card>
  )
}

export default function AttendancePage() {
  useDocumentTitle('Attendance')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'log' ? 'log' : 'scan'
  return (
    <div>
      <PageHeader title="Attendance" description="Scan member QR codes at the door — one tap, no duplicates" />
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
