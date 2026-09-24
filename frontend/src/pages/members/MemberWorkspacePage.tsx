import {
  Activity,
  BadgeIndianRupee,
  Ban,
  CalendarCheck2,
  CalendarClock,
  CircleCheck,
  ClipboardList,
  Dumbbell,
  KeyRound,
  LayoutGrid,
  LineChart,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  PauseCircle,
  QrCode,
  RefreshCw,
  RotateCcw,
  Ruler,
  Scale,
  UserCog,
  Wallet,
} from 'lucide-react'
import type { MemberStatusAction } from '@/types'
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { AssignTrainerDialog } from '@/components/members/AssignTrainerDialog'
import { ACCESS_LABEL, AppAccessDialog, accessState } from '@/components/members/AppAccessDialog'
import { MemberFormDialog } from '@/components/members/MemberFormDialog'
import { QRCode } from '@/components/qr/QRCode'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, StatCard } from '@/components/ui/Card'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { ErrorState, PageLoader } from '@/components/ui/Feedback'
import { Avatar, Menu } from '@/components/ui/Menu'
import { PageHeader, Tabs, type TabItem } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { membersApi } from '@/services/endpoints'
import type { MemberWorkspace } from '@/types'
import { cn } from '@/utils/cn'
import { daysLeftLabel, formatDate, formatMoney, relativeTime, todayISO } from '@/utils/format'
import { ActivityTab, AttendanceTab, MembershipTab, OverviewTab, PaymentsTab, ProgressTab, WorkoutTab } from './MemberTabs'

type Tab = 'overview' | 'membership' | 'payments' | 'attendance' | 'workout' | 'progress' | 'activity'

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

function MembershipCard({ member, staff, onRenew }: { member: MemberWorkspace; staff: boolean; onRenew: () => void }) {
  const current = member.membership.current ?? member.membership.latest
  const days = member.membership.days_left
  const status = member.membership.status
  let progress = 0
  if (current?.start_date && current.end_date) {
    const total = daysBetween(current.start_date, current.end_date) + 1
    progress = Math.min(100, Math.max(0, (daysBetween(current.start_date, todayISO()) / total) * 100))
  }
  const tone =
    status === 'EXPIRED' ? 'from-danger-600 to-danger-800' : status === 'EXPIRING' ? 'from-warning-500 to-warning-600' : status === 'NONE' ? 'from-neutral-600 to-neutral-800' : 'from-neutral-800 to-hero'
  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-card', tone)}>
      <div className="bg-grid absolute inset-0 opacity-40" aria-hidden />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/70">{current?.plan_name ?? 'No membership'}</p>
            <p className="mt-2 text-4xl font-bold tracking-tight">{days === null ? '—' : days < 0 ? 'Expired' : days}</p>
            <p className="text-sm text-white/80">{days === null ? 'Add a plan to activate' : days < 0 ? daysLeftLabel(days) : days === 1 ? 'day remaining' : 'days remaining'}</p>
          </div>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-bold ring-1 ring-white/25">
            {status === 'NONE' ? 'NO PLAN' : status}
          </span>
        </div>
        {current?.start_date && (
          <>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Membership period used">
              <div className="h-full rounded-full bg-volt" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[12px] text-white/75">
              <span>{formatDate(current.start_date)}</span>
              <span>Expires {formatDate(member.membership.expiry_date)}</span>
            </div>
          </>
        )}
        {member.membership.upcoming && (
          <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-[13px]">
            Renewed: {member.membership.upcoming.plan_name} starts {formatDate(member.membership.upcoming.start_date)}
          </p>
        )}
        {member.pending_payment && (
          <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-[13px]">
            UPI payment awaiting verification · {member.pending_payment.plan_name} · {formatMoney(member.pending_payment.amount)}
          </p>
        )}
        {staff && (
          <button type="button" onClick={onRenew} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-ink hover:bg-white/90">
            <RefreshCw className="size-4" aria-hidden /> {member.membership.expiry_date ? 'Renew membership' : 'Add membership'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function MemberWorkspacePage() {
  const { memberId } = useParams()
  const id = Number(memberId)
  const { user } = useAuth()
  const toast = useToast()
  const actions = useActions()
  const [params, setParams] = useSearchParams()
  const staff = user?.role === 'ADMIN' || user?.role === 'STAFF'
  const coach = user?.role === 'ADMIN' || user?.role === 'TRAINER'
  const workspace = useApi(Number.isFinite(id) ? `member:${id}` : null, () => membersApi.get(id))
  const member = workspace.data
  useDocumentTitle(member?.name ?? 'Member')

  const [dialog, setDialog] = useState<'edit' | 'access' | 'trainer' | 'qr' | 'suspend' | 'deactivate' | 'activate' | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const tab = (params.get('tab') as Tab) || 'overview'

  if (workspace.loading && !member) return <PageLoader />
  if (!member) return <ErrorState error={workspace.error} onRetry={workspace.reload} />

  const setTab = (value: Tab) => {
    const next = new URLSearchParams(params)
    if (value === 'overview') next.delete('tab')
    else next.set('tab', value)
    setParams(next, { replace: true })
  }

  const tabs: TabItem<Tab>[] = [
    { value: 'overview', label: 'Overview', icon: LayoutGrid },
    { value: 'membership', label: 'Membership', icon: ClipboardList },
    ...(staff ? [{ value: 'payments' as Tab, label: 'Payments', icon: Wallet, badge: member.pending_payment ? 1 : undefined }] : []),
    { value: 'attendance', label: 'Attendance', icon: CalendarCheck2 },
    ...(coach
      ? [
          { value: 'workout' as Tab, label: 'Workout', icon: Dumbbell },
          { value: 'progress' as Tab, label: 'Progress', icon: LineChart },
        ]
      : []),
    { value: 'activity', label: 'Activity', icon: Activity },
  ]

  const openQr = async () => {
    setDialog('qr')
    try {
      setQr((await membersApi.qr(member.id)).payload)
    } catch (error) {
      toast.fromError(error)
    }
  }

  const setStatus = async (action: MemberStatusAction) => {
    try {
      const result = await membersApi.setStatus(member.id, action)
      invalidate(`member:${member.id}`, 'members', 'dashboard')
      toast.success(
        action === 'REACTIVATE' ? `Member reactivated · ${result.status.toLowerCase()}` : action === 'SUSPEND' ? 'Member suspended' : 'Member deactivated',
      )
    } catch (error) {
      toast.fromError(error)
      throw error
    }
  }

  const tabProps = { member, staff }
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Members', to: '/members' }, { label: member.member_code }]} title="" className="mb-3 sm:mb-4" />

      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={member.name} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight text-ink">{member.name}</h1>
                {(member.status === 'SUSPENDED' || member.status === 'INACTIVE') && <StatusBadge status={member.status} />}
                <StatusBadge status={member.membership.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                <span className="tabular font-semibold text-ink-2">{member.member_code}</span>
                <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                  <Phone className="size-3.5" aria-hidden />
                  {member.phone}
                </a>
                <span className="inline-flex items-center gap-1.5">
                  <UserCog className="size-3.5" aria-hidden />
                  {member.trainer?.name ?? 'No trainer'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {staff && (
              <>
                <Button icon={RefreshCw} onClick={() => actions.collectPayment({ memberId: member.id })} disabled={member.status === 'SUSPENDED'}>
                  {member.membership.expiry_date ? 'Renew' : 'Add membership'}
                </Button>
              </>
            )}
            <Button variant="secondary" icon={CalendarCheck2} onClick={() => actions.markAttendance({ id: member.id, name: member.name })}>
              Mark Attendance
            </Button>
            <Menu
              label="More actions"
              trigger={({ toggle, open }) => (
                <Button variant="secondary" icon={MoreHorizontal} onClick={toggle} aria-expanded={open}>
                  More
                </Button>
              )}
              items={[
                { label: 'Assign trainer', icon: UserCog, onSelect: () => setDialog('trainer'), hidden: !staff },
                { label: 'Create workout', icon: Dumbbell, onSelect: () => actions.createWorkout({ id: member.id, name: member.name }), hidden: !coach },
                { label: 'Add measurement', icon: Ruler, onSelect: () => actions.addMeasurement({ id: member.id, name: member.name }), hidden: !coach },
                { label: 'Send in-app message', icon: MessageSquare, onSelect: () => actions.sendNotification({ id: member.id, name: member.name }), hidden: user?.role !== 'ADMIN' },
                { label: 'Show QR code', icon: QrCode, onSelect: openQr, hidden: !staff },
                { label: 'Edit profile', icon: Pencil, onSelect: () => setDialog('edit'), hidden: !staff },
                { label: 'Member app access', icon: KeyRound, onSelect: () => setDialog('access'), hidden: !staff },
                'divider',
                { label: 'Reactivate', icon: CircleCheck, onSelect: () => setDialog('activate'), hidden: !staff || (member.status !== 'SUSPENDED' && member.status !== 'INACTIVE') },
                { label: 'Suspend', icon: PauseCircle, onSelect: () => setDialog('suspend'), hidden: !staff || member.status === 'SUSPENDED' },
                { label: 'Deactivate', icon: Ban, tone: 'danger', onSelect: () => setDialog('deactivate'), hidden: !staff || member.status === 'INACTIVE' },
              ]}
            />
          </div>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <MembershipCard member={member} staff={staff} onRenew={() => actions.collectPayment({ memberId: member.id })} />
        <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-3">
          <StatCard label="Visits this month" icon={CalendarCheck2} tone="blue" value={member.stats.visits_this_month} hint={`${member.stats.visits_total} total visits`} />
          <StatCard label="Last check-in" icon={CalendarClock} tone="slate" value={member.stats.last_check_in ? relativeTime(member.stats.last_check_in) : '—'} hint={member.stats.last_check_in ? 'Most recent visit' : 'No visits yet'} />
          {staff ? (
            <StatCard
              label="Total paid"
              icon={BadgeIndianRupee}
              tone="green"
              value={formatMoney(member.stats.total_paid)}
              hint={member.pending_payment ? '1 payment awaiting verification' : member.stats.last_payment_date ? `Last paid ${formatDate(member.stats.last_payment_date)}` : 'No payments yet'}
            />
          ) : (
            <StatCard label="Membership" icon={ClipboardList} tone="green" value={daysLeftLabel(member.membership.days_left)} />
          )}
          <StatCard
            label="Latest weight"
            icon={Scale}
            tone="amber"
            value={member.stats.latest_weight ? `${member.stats.latest_weight} kg` : '—'}
            hint={member.stats.latest_measured_at ? `Measured ${relativeTime(member.stats.latest_measured_at)}` : 'No measurements'}
          />
          <StatCard label="Workout plans" icon={Dumbbell} tone="brand" value={member.stats.active_workouts} hint="Active plans" />
          <StatCard label="Member since" icon={RotateCcw} tone="slate" value={formatDate(member.joining_date, { withYear: true })} hint={`Member app: ${ACCESS_LABEL[accessState(member.app)].label.toLowerCase()}`} />
        </div>
      </div>

      <Tabs items={tabs} value={tab} onChange={setTab} className="mb-4" />
      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab {...tabProps} onManageAccess={() => setDialog('access')} />}
        {tab === 'membership' && <MembershipTab {...tabProps} />}
        {tab === 'payments' && staff && <PaymentsTab {...tabProps} />}
        {tab === 'attendance' && <AttendanceTab {...tabProps} />}
        {tab === 'workout' && coach && <WorkoutTab {...tabProps} />}
        {tab === 'progress' && coach && <ProgressTab {...tabProps} />}
        {tab === 'activity' && <ActivityTab {...tabProps} />}
      </div>

      <MemberFormDialog open={dialog === 'edit'} onClose={() => setDialog(null)} member={member} onManageAccess={() => setDialog('access')} />
      <AppAccessDialog open={dialog === 'access'} onClose={() => setDialog(null)} member={member} />
      <AssignTrainerDialog open={dialog === 'trainer'} onClose={() => setDialog(null)} memberId={member.id} currentTrainerId={member.trainer?.id ?? null} />
      <Dialog
        open={dialog === 'qr'}
        onClose={() => (setDialog(null), setQr(null))}
        title="Member QR code"
        description={`${member.name} · ${member.member_code}`}
        size="sm"
        footer={
          <Button
            variant="secondary"
            icon={RotateCcw}
            onClick={async () => {
              try {
                setQr((await membersApi.resetQr(member.id)).payload)
                toast.success('New QR issued', { description: 'The old QR code no longer works.' })
              } catch (error) {
                toast.fromError(error)
              }
            }}
          >
            Issue new QR
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-2">
          {qr ? <QRCode value={qr} size={220} label={`Attendance QR for ${member.name}`} className="border border-line p-2" /> : <div className="skeleton size-[220px] rounded-2xl" />}
          <p className="text-center text-[13px] text-muted">Members also have this QR in their app. Issue a new one if a code is lost or shared.</p>
        </div>
      </Dialog>
      <ConfirmDialog
        open={dialog === 'suspend'}
        onClose={() => setDialog(null)}
        title={`Suspend ${member.name}?`}
        message="Suspended members can't check in or pay until you reactivate them. Their membership dates are not changed."
        confirmLabel="Suspend"
        onConfirm={() => setStatus('SUSPEND')}
      />
      <ConfirmDialog
        open={dialog === 'deactivate'}
        onClose={() => setDialog(null)}
        title={`Deactivate ${member.name}?`}
        message="Deactivated members can't check in. Nothing is deleted — history is kept and you can reactivate them later."
        confirmLabel="Deactivate"
        onConfirm={() => setStatus('DEACTIVATE')}
      />
      <ConfirmDialog
        open={dialog === 'activate'}
        onClose={() => setDialog(null)}
        title={`Reactivate ${member.name}?`}
        message="Their status is recalculated from their memberships: active if a membership covers today, otherwise expired or inactive."
        confirmLabel="Reactivate"
        tone="primary"
        onConfirm={() => setStatus('REACTIVATE')}
      />
    </div>
  )
}
