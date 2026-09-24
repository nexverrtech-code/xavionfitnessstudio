import {
  AlertOctagon,
  ArrowRight,
  BadgeIndianRupee,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  Dumbbell,
  FileBarChart,
  Hourglass,
  IndianRupee,
  LineChart,
  Receipt,
  RefreshCw,
  RotateCcw,
  ScanLine,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { RejectPaymentDialog } from '@/components/billing/RejectPaymentDialog'
import { StatusBadge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, StatCard } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Menu'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { dashboardApi, membershipsApi, paymentsApi } from '@/services/endpoints'
import type { ActivityEvent, Payment, StorageLevel } from '@/types'
import { cn } from '@/utils/cn'
import { daysLeftLabel, firstName, formatMoney, formatNumber, greeting, relativeTime } from '@/utils/format'

const Charts = lazy(() => import('@/components/charts/DashboardCharts'))

const NEUTRAL_ICON = 'bg-subtle text-ink-2 ring-1 ring-line'
const ACTIVITY_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  MEMBER_JOINED: { icon: UserPlus, label: 'New member' },
  PAYMENT_RECEIVED: { icon: BadgeIndianRupee, label: 'Payment' },
  PAYMENT_PENDING: { icon: Hourglass, label: 'Awaiting verification' },
  REFUND: { icon: RotateCcw, label: 'Refund' },
  MEMBERSHIP: { icon: RefreshCw, label: 'Membership' },
  ATTENDANCE: { icon: CalendarCheck2, label: 'Check-in' },
  TRAINER_ASSIGNED: { icon: Dumbbell, label: 'Trainer' },
  EXPENSE: { icon: Receipt, label: 'Expense' },
}

function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  if (!previous) return <span>{label}</span>
  const change = Math.round(((current - previous) / previous) * 100)
  const up = change >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={cn('size-3.5', up ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400')} aria-hidden />
      <span className="font-semibold text-ink-2">
        {up ? '+' : ''}
        {change}%
      </span>
      <span>{label}</span>
    </span>
  )
}

function ActivityFeed({ items, loading }: { items?: ActivityEvent[]; loading: boolean }) {
  if (loading && !items) return <SkeletonRows rows={5} className="px-5 pb-5" />
  if (!items?.length) return <EmptyState compact icon={LineChart} title="No activity yet" description="New members, payments and check-ins will appear here." />
  return (
    <ol className="space-y-1 px-3 pb-3">
      {items.map((event, index) => {
        const meta = ACTIVITY_ICONS[event.type] ?? ACTIVITY_ICONS.ATTENDANCE
        const content = (
          <>
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', NEUTRAL_ICON)} title={meta.label}>
              <meta.icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{event.title}</span>
            <span className="shrink-0 text-[12px] text-faint">{relativeTime(event.at)}</span>
          </>
        )
        return (
          <li key={`${event.type}-${index}`}>
            {event.member_id ? (
              <Link to={`/members/${event.member_id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-hover">
                {content}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-2 py-2">{content}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function PendingVerifications() {
  const toast = useToast()
  const pending = useApi('payments:pending:dashboard', () => paymentsApi.pending({ limit: 5 }))
  const [rejecting, setRejecting] = useState<Payment | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const approve = async (payment: Payment) => {
    setBusy(payment.id)
    try {
      const result = await paymentsApi.approve(payment.id)
      toast.success(result.already_processed ? 'Already approved' : 'Payment approved', { description: `${payment.member_name}'s membership is active.` })
      invalidate('payments', 'dashboard', 'members', 'memberships', 'notifications', `member:${payment.member_id}`)
    } catch (error) {
      toast.fromError(error)
    } finally {
      setBusy(null)
    }
  }

  const items = pending.data?.items ?? []
  return (
    <Card>
      <CardHeader
        icon={Hourglass}
        title="UPI payments to verify"
        description={pending.data ? `${pending.data.total} pending · ${formatMoney(pending.data.pending_amount ?? 0)}` : 'Match the UTR with your bank statement'}
        action={
          <ButtonLink to="/payments?tab=pending" variant="ghost" size="sm">
            View all
          </ButtonLink>
        }
      />
      {pending.loading && !pending.data ? (
        <SkeletonRows rows={3} className="px-5 pb-5" />
      ) : pending.error ? (
        <ErrorState compact error={pending.error} onRetry={pending.reload} />
      ) : !items.length ? (
        <EmptyState compact icon={CheckCircle2} title="All caught up" description="There are no UPI payments waiting for verification." />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{payment.member_name}</p>
                <p className="truncate text-[12px] text-muted">
                  {formatMoney(payment.amount)} · {payment.plan_name ?? 'Payment'} · UTR <span className="tabular">{payment.transaction_reference}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setRejecting(payment)}>
                  Reject
                </Button>
                <Button size="sm" variant="success" icon={CheckCircle2} loading={busy === payment.id} onClick={() => approve(payment)}>
                  Approve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <RejectPaymentDialog payment={rejecting} onClose={() => setRejecting(null)} />
    </Card>
  )
}

function RenewalsDue() {
  const actions = useActions()
  const renewals = useApi('memberships:renewals:dashboard', () => membershipsApi.renewals({ window: 'upcoming', limit: 6 }))
  const items = renewals.data?.items ?? []
  return (
    <Card>
      <CardHeader
        icon={CalendarClock}
        title="Expiring this week"
        description={renewals.data ? `${renewals.data.total} member${renewals.data.total === 1 ? '' : 's'} to renew` : 'Members whose plan ends within 7 days'}
        action={
          <ButtonLink to="/memberships" variant="ghost" size="sm">
            View all
          </ButtonLink>
        }
      />
      {renewals.loading && !renewals.data ? (
        <SkeletonRows rows={3} className="px-5 pb-5" />
      ) : !items.length ? (
        <EmptyState
          compact
          icon={CheckCircle2}
          title="No expiring memberships."
          description="There are no memberships expiring within the selected period."
          action={
            <ButtonLink to="/members?status=ACTIVE" size="sm">
              View Active Members
            </ButtonLink>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.member_id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={item.name} size="sm" />
              <Link to={`/members/${item.member_id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink hover:underline">{item.name}</p>
                <p className="truncate text-[12px] text-muted">
                  {item.plan_name ?? 'Membership'} · {daysLeftLabel(item.days_left)}
                </p>
              </Link>
              {item.has_pending_payment ? (
                <StatusBadge status="PENDING" size="sm" label="Payment pending" />
              ) : (
                <Button size="sm" variant="soft" icon={RefreshCw} onClick={() => actions.collectPayment({ memberId: item.member_id, planId: item.plan_id })}>
                  Renew
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const ALERT_LEVELS: StorageLevel[] = ['WARNING', 'CRITICAL', 'ARCHIVE_REQUIRED']

function StorageAlert({ percent, level }: { percent: number; level: StorageLevel }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-warning-300 bg-warning-50 px-4 py-3 text-warning-900 sm:flex-row sm:items-center dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-100">
      <DatabaseBackup className="size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          Database storage is at {percent}% <StatusBadge status={level} size="sm" />
        </p>
        <p className="text-[13px] opacity-90">Download a backup of old records, then archive them to free space. Nothing is removed until you confirm.</p>
      </div>
      <ButtonLink to="/data-backup" size="sm" variant="secondary">
        Open Data &amp; Backup
      </ButtonLink>
    </div>
  )
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard')
  const { user } = useAuth()
  const actions = useActions()
  const navigate = useNavigate()
  const admin = user?.role === 'ADMIN'
  const summary = useApi('dashboard:summary', () => dashboardApi.summary())
  // Trends move slowly and are the heaviest read; reuse them for 5 minutes (writes still invalidate).
  const charts = useApi('dashboard:charts', () => dashboardApi.charts(6), { freshMs: 300_000 })
  const activity = useApi('dashboard:activity', () => dashboardApi.activity())
  const s = summary.data
  const loading = summary.loading && !s

  const quickActions: { label: string; icon: LucideIcon; onClick: () => void; show?: boolean; primary?: boolean }[] = [
    { label: 'Add member', icon: UserPlus, onClick: actions.addMember, primary: true },
    { label: 'Record payment', icon: Wallet, onClick: () => actions.collectPayment() },
    { label: 'Scan attendance', icon: ScanLine, onClick: () => navigate('/attendance') },
    { label: 'Add expense', icon: Receipt, onClick: actions.addExpense, show: admin },
    { label: 'Reports', icon: FileBarChart, onClick: () => navigate('/reports') },
  ]

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
            {greeting()}, {firstName(user?.name)}
          </h1>
          <p className="mt-1 text-sm text-muted">Here's what's happening in your gym today.</p>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {quickActions
            .filter((a) => a.show !== false)
            .map((a) => (
              <Button key={a.label} variant={a.primary ? 'primary' : 'secondary'} icon={a.icon} onClick={a.onClick} className="shrink-0">
                {a.label}
              </Button>
            ))}
        </div>
      </section>

      {admin && s?.storage && ALERT_LEVELS.includes(s.storage.level) && <StorageAlert percent={s.storage.percent} level={s.storage.level} />}

      {summary.error && !s ? (
        <Card>
          <ErrorState error={summary.error} onRetry={summary.reload} />
        </Card>
      ) : (
        <section aria-label="Key metrics" className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', admin ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
          <StatCard label="Total Members" icon={Users} value={formatNumber(s?.members.total)} hint={s ? `+${s.members.joined_this_month} joined this month` : undefined} loading={loading} to="/members" />
          <StatCard label="Active Members" icon={CheckCircle2} tone="green" value={formatNumber(s?.members.active)} hint={s ? `${formatNumber(s.members.inactive)} inactive · ${formatNumber(s.members.suspended)} suspended` : undefined} loading={loading} to="/members?status=ACTIVE" />
          <StatCard label="Expiring Soon" icon={CalendarClock} tone="amber" value={formatNumber(s?.members.expiring)} hint="Within 7 days" loading={loading} to="/members?status=EXPIRING" />
          <StatCard label="Expired Members" icon={AlertOctagon} tone="red" value={formatNumber(s?.members.expired)} hint="Win them back" loading={loading} to="/members?status=EXPIRED" />
          <StatCard
            label="Today's Attendance"
            icon={CalendarCheck2}
            tone="blue"
            value={formatNumber(s?.attendance.today)}
            hint={s ? <Delta current={s.attendance.today} previous={s.attendance.yesterday} label="vs yesterday" /> : undefined}
            loading={loading}
            to="/attendance?tab=log"
          />
          <StatCard label="Today's Revenue" icon={IndianRupee} tone="green" value={formatMoney(s?.revenue.today)} loading={loading} to="/payments?range=today" />
          <StatCard
            label="Monthly Revenue"
            icon={BadgeIndianRupee}
            value={formatMoney(s?.revenue.month)}
            hint={s ? <Delta current={s.revenue.month} previous={s.revenue.previous_month_same_period} label="vs last month" /> : undefined}
            loading={loading}
            to="/payments?range=month"
          />
          <StatCard
            label="Pending Payments"
            icon={Hourglass}
            tone="blue"
            value={formatNumber(s?.pending_payments.count)}
            hint={s ? `${formatMoney(s.pending_payments.amount)} to verify` : undefined}
            loading={loading}
            to="/payments?tab=pending"
          />
          {admin && (
            <>
              <StatCard label="Monthly Expenses" icon={Receipt} tone="red" value={formatMoney(s?.expenses?.month)} loading={loading} to="/expenses" />
              <StatCard
                label="Net Revenue"
                icon={TrendingUp}
                tone={(s?.net_revenue ?? 0) >= 0 ? 'green' : 'red'}
                value={formatMoney(s?.net_revenue)}
                hint="Revenue − expenses, this month"
                loading={loading}
              />
              <StatCard
                label="Database storage"
                icon={DatabaseBackup}
                tone="slate"
                value={s?.storage ? `${s.storage.percent}% used` : '—'}
                hint={s?.storage ? <StatusBadge status={s.storage.level} size="sm" /> : 'Open Data & Backup'}
                loading={loading}
                to="/data-backup"
              />
            </>
          )}
        </section>
      )}

      <Suspense
        fallback={
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-[330px] rounded-2xl lg:col-span-2" />
            <Skeleton className="h-[330px] rounded-2xl" />
          </div>
        }
      >
        {charts.data ? (
          <Charts data={charts.data} showExpenses={admin} refreshing={charts.refreshing} />
        ) : charts.error ? (
          <Card>
            <ErrorState error={charts.error} onRetry={charts.reload} />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-[330px] rounded-2xl lg:col-span-2" />
            <Skeleton className="h-[330px] rounded-2xl" />
          </div>
        )}
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-3">
        <RenewalsDue />
        <PendingVerifications />
        <Card>
          <CardHeader title="Recent activity" description="The latest across your gym" />
          <ActivityFeed items={activity.data?.items} loading={activity.loading} />
        </Card>
      </div>
      <p className="flex items-center justify-center gap-2 pb-2 text-[12px] text-faint">
        <ArrowRight className="size-3" aria-hidden /> Press <kbd className="font-sans font-semibold">Ctrl K</kbd> anywhere to search members or run a command
      </p>
    </div>
  )
}
