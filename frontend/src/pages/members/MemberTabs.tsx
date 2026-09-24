import {
  Archive,
  ArchiveRestore,
  BadgeIndianRupee,
  CalendarCheck2,
  Copy,
  Download,
  Dumbbell,
  KeyRound,
  LineChart,
  MoreVertical,
  Pencil,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  Ruler,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { PaymentDetailDialog } from '@/components/billing/PaymentDetailDialog'
import { RefundDialog } from '@/components/billing/RefundDialog'
import { MemberPicker } from '@/components/members/MemberPicker'
import { AttendanceCalendar } from '@/components/members/AttendanceCalendar'
import { ACCESS_LABEL, accessState } from '@/components/members/AppAccessDialog'
import { MetricTiles } from '@/components/training/MetricTiles'
import { WorkoutBuilder } from '@/components/training/WorkoutBuilder'
import { WorkoutPlanCard } from '@/components/training/WorkoutPlanCard'
import { Pill, StatusBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader, KeyValue } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback'
import { Menu } from '@/components/ui/Menu'
import { Pagination } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useReceipt } from '@/hooks/useReceipt'
import { membersApi, membershipsApi, progressApi, workoutsApi } from '@/services/endpoints'
import type { ActivityEvent, Measurement, MemberListItem, MemberWorkspace, Metric, Payment, Workout } from '@/types'
import { formatDate, formatMoney, formatTime, METHOD_LABELS, relativeTime, todayISO } from '@/utils/format'
import { METRIC_META } from '@/utils/metrics'

const ProgressChart = lazy(() => import('@/components/charts/ProgressChart'))
const HISTORY_METRICS: Metric[] = ['weight', 'body_fat', 'chest', 'waist', 'arm', 'thigh']

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

interface TabProps {
  member: MemberWorkspace
  staff: boolean
}

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  ATTENDANCE: CalendarCheck2,
  MEMBERSHIP: RefreshCw,
  MEASUREMENT: Ruler,
  WORKOUT: Dumbbell,
  NOTIFICATION: Receipt,
  PAYMENT: BadgeIndianRupee,
}

export function ActivityList({ items, limit }: { items: ActivityEvent[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items
  if (!shown.length) return <EmptyState compact icon={LineChart} title="No activity yet" description="Payments, visits and workouts will show up here." />
  return (
    <ol className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-line">
      {shown.map((event, index) => {
        const Icon = ACTIVITY_ICONS[event.type] ?? Receipt
        return (
          <li key={`${event.type}-${event.ref}-${index}`} className="relative">
            <span className="absolute -left-6 top-0 flex size-6 items-center justify-center rounded-full bg-surface ring-1 ring-line">
              <Icon className="size-3.5 text-muted" aria-hidden />
            </span>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-ink-2">{event.title}</p>
              <div className="shrink-0 text-right">
                {event.amount !== undefined && <p className="tabular text-sm font-semibold text-ink">{formatMoney(event.amount)}</p>}
                <p className="text-[12px] text-faint">{relativeTime(event.at)}</p>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// -- Overview --------------------------------------------------------------------------------
export function OverviewTab({ member, staff, onManageAccess }: TabProps & { onManageAccess?: () => void }) {
  const activity = useApi(`member:${member.id}:activity`, () => membersApi.activity(member.id))
  const access = accessState(member.app)

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card>
          <CardHeader title="Profile" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 pb-5 sm:grid-cols-2">
            <KeyValue label="Phone" value={member.phone} />
            <KeyValue label="Email" value={member.email} />
            <KeyValue label="Gender" value={member.gender ? member.gender[0] + member.gender.slice(1).toLowerCase() : null} />
            <KeyValue label="Date of birth" value={member.date_of_birth ? formatDate(member.date_of_birth) : null} />
            <KeyValue label="Joined" value={formatDate(member.joining_date)} />
            <KeyValue label="Trainer" value={member.trainer?.name} />
            <KeyValue label="Emergency contact" value={member.emergency_contact} />
            <KeyValue label="Address" value={member.address} className="sm:col-span-2" />
          </dl>
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <div className="px-5 pb-5">{activity.loading && !activity.data ? <SkeletonRows rows={3} /> : <ActivityList items={activity.data?.items ?? []} limit={6} />}</div>
        </Card>
      </div>
      <div className="space-y-4 lg:col-span-2">
        {staff && (
          <Card>
            <CardHeader
              icon={KeyRound}
              title="Member app access"
              action={<Pill tone={ACCESS_LABEL[access].tone}>{ACCESS_LABEL[access].label}</Pill>}
            />
            <div className="space-y-3 px-5 pb-5">
              <p className="text-[13px] text-muted">
                {access === 'none'
                  ? 'No login yet — the member can’t open the app until you give access.'
                  : access === 'off'
                    ? 'Turned off — the member can’t sign in.'
                    : access === 'pending'
                      ? `Signs in with ${member.app.login}. Waiting for their first sign-in.`
                      : `Signs in with ${member.app.login}. ${member.app.last_login_at ? `Last signed in ${relativeTime(member.app.last_login_at)}.` : 'Hasn’t signed in yet.'}`}
              </p>
              <Button size="sm" variant={access === 'none' || access === 'off' ? 'primary' : 'secondary'} icon={KeyRound} onClick={onManageAccess}>
                {access === 'none' ? 'Give app access' : access === 'off' ? 'Turn access back on' : 'Manage app access'}
              </Button>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Membership timeline" />
          <div className="space-y-3 px-5 pb-5 text-sm">
            {member.pending_payment && (
              <div className="rounded-xl bg-info-50 px-3.5 py-3 text-info-800 dark:bg-info-500/10 dark:text-info-200">
                <p className="font-semibold">
                  {member.pending_payment.plan_name} · {formatMoney(member.pending_payment.amount)} awaiting verification
                </p>
                <p className="text-[13px] opacity-80">
                  UTR {member.pending_payment.transaction_reference ?? '—'} · check it in Payments → Pending UPI.
                </p>
              </div>
            )}
            {member.membership.current ? (
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-semibold text-ink">{member.membership.current.plan_name}</span>
                  <span className="block text-[13px] text-muted">
                    {formatDate(member.membership.current.start_date)} → {formatDate(member.membership.current.end_date)}
                  </span>
                </span>
                <StatusBadge status={member.membership.current.status} size="sm" />
              </div>
            ) : (
              <p className="text-muted">{member.membership.expiry_date ? `Expired on ${formatDate(member.membership.expiry_date)}` : 'No membership yet.'}</p>
            )}
            {member.membership.upcoming && (
              <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
                <span>
                  <span className="font-semibold text-ink">{member.membership.upcoming.plan_name}</span>
                  <span className="block text-[13px] text-muted">Starts {formatDate(member.membership.upcoming.start_date)}</span>
                </span>
                <StatusBadge status="UPCOMING" size="sm" />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

// -- Membership ------------------------------------------------------------------------------
export function MembershipTab({ member, staff }: TabProps) {
  const { user } = useAuth()
  const toast = useToast()
  const actions = useActions()
  const history = useApi(`member:${member.id}:memberships`, () => membersApi.memberships(member.id))
  const [cancelling, setCancelling] = useState<number | null>(null)
  const items = history.data?.items ?? []
  return (
    <Card>
      <CardHeader
        title="Membership history"
        description="Every plan this member has bought, newest first"
        action={
          staff && (
            <Button size="sm" icon={RefreshCw} onClick={() => actions.collectPayment({ memberId: member.id })}>
              {member.membership.expiry_date ? 'Renew' : 'Add membership'}
            </Button>
          )
        }
      />
      {history.error ? (
        <ErrorState compact error={history.error} onRetry={history.reload} />
      ) : (
        <DataList
          rows={history.loading && !history.data ? undefined : items}
          loading={history.loading}
          rowKey={(m) => m.id}
          columns={[
            { key: 'plan', header: 'Plan', cell: (m) => <span className="font-semibold text-ink">{m.plan_name}</span> },
            { key: 'period', header: 'Period', cell: (m) => `${formatDate(m.start_date)} → ${formatDate(m.end_date)}` },
            { key: 'days', header: 'Days', align: 'right', cell: (m) => <span className="tabular">{daysBetween(m.start_date, m.end_date) + 1}</span> },
            ...(staff ? [{ key: 'amount', header: 'Paid', align: 'right' as const, cell: (m: (typeof items)[number]) => <span className="tabular">{formatMoney(m.amount)}</span> }] : []),
            { key: 'status', header: 'Status', cell: (m) => <StatusBadge status={m.status} size="sm" /> },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (m) =>
                user?.role === 'ADMIN' && m.status !== 'CANCELLED' && m.status !== 'EXPIRED' ? (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(m.id)} className="text-danger-600">
                    Cancel
                  </Button>
                ) : null,
            },
          ]}
          mobile={(m) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{m.plan_name}</p>
                <p className="text-[13px] text-muted">
                  {formatDate(m.start_date)} → {formatDate(m.end_date)}
                </p>
              </div>
              <StatusBadge status={m.status} size="sm" />
            </div>
          )}
          empty={<EmptyState compact icon={Wallet} title="No memberships yet" description="Record a payment to activate the first membership." />}
        />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancel this membership?"
        message="The member's expiry date will be recalculated. The payment record is kept; record a refund on the payment if money is returned."
        confirmLabel="Cancel membership"
        onConfirm={async () => {
          try {
            await membershipsApi.cancel(cancelling!)
            invalidate(`member:${member.id}`, 'members', 'memberships', 'dashboard')
            toast.success('Membership cancelled')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
    </Card>
  )
}

// -- Payments --------------------------------------------------------------------------------
export function PaymentsTab({ member }: TabProps) {
  const { hasRole } = useAuth()
  const actions = useActions()
  const receipt = useReceipt()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Payment | null>(null)
  const [refunding, setRefunding] = useState<Payment | null>(null)
  const payments = useApi(`member:${member.id}:payments:${page}`, () => membersApi.payments(member.id, { page, limit: 10 }), { keepPrevious: true })
  return (
    <Card>
      <CardHeader
        title="Payments"
        description={member.stats.total_paid !== undefined ? `${formatMoney(member.stats.total_paid)} paid in total (net of refunds)` : undefined}
        action={
          <Button size="sm" icon={Wallet} onClick={() => actions.collectPayment({ memberId: member.id })}>
            Record payment
          </Button>
        }
      />
      {payments.error && !payments.data ? (
        <ErrorState compact error={payments.error} onRetry={payments.reload} />
      ) : (
        <DataList
          rows={payments.data?.items}
          loading={payments.loading}
          rowKey={(p) => p.id}
          onRowClick={setOpen}
          columns={[
            {
              key: 'number',
              header: 'Payment',
              cell: (p) => (
                <span className="block whitespace-nowrap">
                  <span className="tabular block text-[13px] font-semibold text-ink">{p.payment_number}</span>
                  <span className="block text-[12px] text-muted">{formatDate(p.payment_date)}</span>
                </span>
              ),
            },
            { key: 'plan', header: 'Plan', cell: (p) => p.plan_name ?? '—' },
            { key: 'method', header: 'Method', cell: (p) => METHOD_LABELS[p.payment_method] },
            { key: 'ref', header: 'Reference', className: 'hidden xl:table-cell', cell: (p) => <span className="tabular text-[12px]">{p.transaction_reference ?? '—'}</span> },
            { key: 'amount', header: 'Amount', align: 'right', cell: (p) => <span className="tabular font-semibold text-ink">{formatMoney(p.amount)}</span> },
            { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} size="sm" /> },
            {
              key: 'receipt',
              header: <span className="sr-only">Receipt</span>,
              align: 'right',
              cell: (p) =>
                p.status === 'PAID' || p.status === 'REFUNDED' ? (
                  <IconButton
                    icon={Download}
                    label={`Download receipt ${p.receipt_number ?? ''}`}
                    size="icon-sm"
                    disabled={receipt.busy === p.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      void receipt.download(p)
                    }}
                  />
                ) : null,
            },
          ]}
          mobile={(p) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="tabular font-semibold text-ink">{formatMoney(p.amount)}</p>
                <p className="truncate text-[13px] text-muted">
                  {p.payment_number} · {METHOD_LABELS[p.payment_method]} · {formatDate(p.payment_date, { withYear: false })}
                </p>
              </div>
              <StatusBadge status={p.status} size="sm" />
            </div>
          )}
          empty={<EmptyState compact icon={Wallet} title="No payments yet" description="Payments recorded for this member will appear here." />}
        />
      )}
      {payments.data && payments.data.pages > 1 && (
        <div className="border-t border-line px-4">
          <Pagination page={page} pages={payments.data.pages} total={payments.data.total} limit={payments.data.limit} onPage={setPage} />
        </div>
      )}
      <PaymentDetailDialog
        payment={open}
        onClose={() => setOpen(null)}
        receiptBusy={!!open && receipt.busy === open.id}
        onReceipt={receipt.download}
        onRefund={
          hasRole('ADMIN')
            ? (p) => {
                setOpen(null)
                setRefunding(p)
              }
            : undefined
        }
      />
      <RefundDialog payment={refunding} onClose={() => setRefunding(null)} />
    </Card>
  )
}

// -- Attendance ------------------------------------------------------------------------------
export function AttendanceTab({ member }: TabProps) {
  const actions = useActions()
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const history = useApi(`member:${member.id}:attendance:${month}`, () => membersApi.attendance(member.id, month), { keepPrevious: true })
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Visits"
          description={`${member.stats.visits_this_month} this month · ${member.stats.visits_total} total`}
          action={
            <Button size="sm" variant="soft" icon={CalendarCheck2} onClick={() => actions.markAttendance({ id: member.id, name: member.name })}>
              Mark today
            </Button>
          }
        />
        <div className="px-5 pb-5">
          {history.data ? <AttendanceCalendar month={month} visits={history.data.items} onMonth={setMonth} /> : <Skeleton className="h-64 rounded-xl" />}
        </div>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader title="Check-in log" />
        {history.error && !history.data ? (
          <ErrorState compact error={history.error} onRetry={history.reload} />
        ) : (
          <DataList
            rows={history.data?.items}
            loading={history.loading}
            rowKey={(v) => v.id}
            columns={[
              { key: 'date', header: 'Date', cell: (v) => formatDate(v.date, { weekday: true, withYear: false }) },
              { key: 'in', header: 'Check-in', cell: (v) => formatTime(v.check_in) },
              { key: 'out', header: 'Check-out', cell: (v) => (v.check_out ? formatTime(v.check_out) : '—') },
              {
                key: 'method',
                header: 'Method',
                cell: (v) => (
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
                    {v.method === 'QR' ? <QrCode className="size-3.5 text-muted" aria-hidden /> : <CalendarCheck2 className="size-3.5 text-muted" aria-hidden />}
                    {v.method === 'QR' ? 'QR scan' : 'Manual'}
                  </span>
                ),
              },
            ]}
            mobile={(v) => (
              <div className="flex justify-between text-sm">
                <span className="font-medium text-ink">{formatDate(v.date, { weekday: true, withYear: false })}</span>
                <span className="text-muted">
                  {formatTime(v.check_in)}
                  {v.check_out && ` → ${formatTime(v.check_out)}`} · {v.method === 'QR' ? 'QR' : 'Manual'}
                </span>
              </div>
            )}
            empty={<EmptyState compact icon={CalendarCheck2} title="No visits this month" description="Check-ins from the QR scanner appear here instantly." />}
          />
        )}
      </Card>
    </div>
  )
}

// -- Workout ---------------------------------------------------------------------------------
export function WorkoutTab({ member }: TabProps) {
  const toast = useToast()
  const workouts = useApi(`member:${member.id}:workouts`, () => membersApi.workouts(member.id))
  const [editing, setEditing] = useState<Workout | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Workout | null>(null)
  const [copying, setCopying] = useState<Workout | null>(null)
  const [target, setTarget] = useState<MemberListItem | null>(null)
  const [copyBusy, setCopyBusy] = useState(false)

  const toggleArchive = async (workout: Workout) => {
    try {
      await workoutsApi.update(workout.id, {
        title: workout.title,
        day_label: workout.day_label,
        notes: workout.notes,
        status: workout.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
        exercises: workout.exercises.map(({ exercise_name, sets, reps, weight, rest_seconds, notes }) => ({ exercise_name, sets, reps, weight, rest_seconds, notes })),
      })
      invalidate(`member:${member.id}`, 'workouts')
      toast.success(workout.status === 'ACTIVE' ? 'Workout archived' : 'Workout restored')
    } catch (error) {
      toast.fromError(error)
    }
  }

  const items = workouts.data?.items ?? []
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{items.filter((w) => w.status === 'ACTIVE').length} active plan(s)</p>
        <Button icon={Plus} onClick={() => setEditing('new')}>
          Create workout
        </Button>
      </div>
      {workouts.loading && !workouts.data ? (
        <SkeletonRows rows={2} />
      ) : workouts.error ? (
        <Card>
          <ErrorState compact error={workouts.error} onRetry={workouts.reload} />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={Dumbbell}
            title="No workout plan yet"
            description="Build a plan in under a minute — start from a template and adjust sets, reps and weights."
            action={
              <Button icon={Plus} onClick={() => setEditing('new')}>
                Create workout
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((workout) => (
            <WorkoutPlanCard
              key={workout.id}
              workout={workout}
              actions={
                <Menu
                  label={`Actions for ${workout.title}`}
                  trigger={({ toggle }) => <IconButton icon={MoreVertical} label="Workout actions" size="icon-sm" onClick={toggle} />}
                  items={[
                    { label: 'Edit', icon: Pencil, onSelect: () => setEditing(workout) },
                    { label: 'Copy to another member', icon: Copy, onSelect: () => setCopying(workout) },
                    { label: workout.status === 'ACTIVE' ? 'Archive' : 'Restore', icon: workout.status === 'ACTIVE' ? Archive : ArchiveRestore, onSelect: () => toggleArchive(workout) },
                    'divider',
                    { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setDeleting(workout) },
                  ]}
                />
              }
            />
          ))}
        </div>
      )}
      <WorkoutBuilder open={editing !== null} onClose={() => setEditing(null)} memberId={member.id} memberName={member.name} workout={editing === 'new' ? null : editing} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this workout?"
        message={`“${deleting?.title}” will be removed for ${member.name}. Archive it instead to keep a record.`}
        confirmLabel="Delete workout"
        onConfirm={async () => {
          try {
            await workoutsApi.remove(deleting!.id)
            invalidate(`member:${member.id}`, 'workouts')
            toast.success('Workout deleted')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
      <Dialog
        open={!!copying}
        onClose={() => (setCopying(null), setTarget(null))}
        title="Copy workout"
        description={copying ? `Give “${copying.title}” to another member. You can adjust it afterwards.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => (setCopying(null), setTarget(null))}>
              Cancel
            </Button>
            <Button
              icon={Copy}
              loading={copyBusy}
              disabled={!target}
              onClick={async () => {
                if (!copying || !target) return
                setCopyBusy(true)
                try {
                  await workoutsApi.copy(copying.id, target.id)
                  invalidate(`member:${target.id}`, 'workouts')
                  toast.success(`Copied to ${target.name}`)
                  setCopying(null)
                  setTarget(null)
                } catch (error) {
                  toast.fromError(error)
                } finally {
                  setCopyBusy(false)
                }
              }}
            >
              Copy
            </Button>
          </>
        }
      >
        <MemberPicker value={target} onChange={setTarget} autoFocus />
      </Dialog>
    </div>
  )
}

// -- Progress --------------------------------------------------------------------------------
export function ProgressTab({ member }: TabProps) {
  const toast = useToast()
  const actions = useActions()
  const progress = useApi(`member:${member.id}:progress`, () => progressApi.forMember(member.id))
  const [deleting, setDeleting] = useState<Measurement | null>(null)
  const data = progress.data
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{data ? `${data.history.length} measurement(s)` : ' '}</p>
        <Button icon={Ruler} onClick={() => actions.addMeasurement({ id: member.id, name: member.name })}>
          Add measurement
        </Button>
      </div>
      {progress.loading && !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : progress.error ? (
        <Card>
          <ErrorState compact error={progress.error} onRetry={progress.reload} />
        </Card>
      ) : !data?.history.length ? (
        <Card>
          <EmptyState
            icon={Ruler}
            title="No measurements yet"
            description="Record weight, body fat and measurements to track progress over time."
            action={
              <Button icon={Ruler} onClick={() => actions.addMeasurement({ id: member.id, name: member.name })}>
                Add measurement
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <MetricTiles latest={data.latest} change={data.change} bmi={data.bmi} />
          <Card>
            <CardHeader title="Progress chart" description="Pick a measurement to see how it changed" />
            <div className="px-3 pb-4 sm:px-5">
              <Suspense fallback={<Skeleton className="h-60 rounded-xl" />}>
                <ProgressChart history={data.history} />
              </Suspense>
            </div>
          </Card>
          <Card>
            <CardHeader title="Measurement history" />
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] font-semibold uppercase tracking-wide text-faint">
                    <th className="px-4 py-2.5">Date</th>
                    {HISTORY_METRICS.map((m) => (
                      <th key={m} className="px-3 py-2.5 text-right">
                        {METRIC_META[m].label}
                      </th>
                    ))}
                    <th className="px-4 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.history.map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-2.5 font-medium text-ink">{formatDate(h.date)}</td>
                      {HISTORY_METRICS.map((m) => (
                        <td key={m} className="tabular px-3 py-2.5 text-right text-ink-2">
                          {h[m] ?? '—'}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right">
                        <IconButton icon={Trash2} label="Delete measurement" size="icon-sm" onClick={() => setDeleting(h)} className="hover:text-danger-600" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this measurement?"
        message={deleting ? `The entry from ${formatDate(deleting.date)} will be removed.` : ''}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await progressApi.remove(deleting!.id)
            invalidate(`member:${member.id}`, 'progress')
            toast.success('Measurement deleted')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
    </div>
  )
}

// -- Activity --------------------------------------------------------------------------------
export function ActivityTab({ member }: TabProps) {
  const activity = useApi(`member:${member.id}:activity`, () => membersApi.activity(member.id))
  return (
    <Card>
      <CardHeader title="Activity" description="Payments, memberships, visits, workouts and messages" />
      <div className="px-5 pb-5">
        {activity.loading && !activity.data ? (
          <SkeletonRows rows={5} />
        ) : activity.error ? (
          <ErrorState compact error={activity.error} onRetry={activity.reload} />
        ) : (
          <ActivityList items={activity.data?.items ?? []} />
        )}
      </div>
    </Card>
  )
}

