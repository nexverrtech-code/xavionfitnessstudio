import { Bell, CalendarCheck2, ChevronRight, CreditCard, Dumbbell, LineChart, QrCode, RefreshCw, User, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { MembershipHero } from '@/components/portal/MembershipHero'
import { StatusBadge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import { cn } from '@/utils/cn'
import { firstName, formatDate, formatMoney, METHOD_LABELS, relativeTime } from '@/utils/format'

const NEUTRAL = 'bg-surface text-ink ring-1 ring-line'
const ACTIONS: { to: string; label: string; icon: LucideIcon; tone: string }[] = [
  { to: '/portal/renew', label: 'Renew', icon: RefreshCw, tone: 'bg-primary text-on-primary' },
  { to: '/portal/qr', label: 'My QR', icon: QrCode, tone: 'bg-hero text-volt' },
  { to: '/portal/attendance', label: 'Attendance', icon: CalendarCheck2, tone: NEUTRAL },
  { to: '/portal/workout', label: 'Workout', icon: Dumbbell, tone: NEUTRAL },
  { to: '/portal/progress', label: 'Progress', icon: LineChart, tone: NEUTRAL },
  { to: '/portal/payments', label: 'Payments', icon: CreditCard, tone: NEUTRAL },
  { to: '/portal/notifications', label: 'Alerts', icon: Bell, tone: NEUTRAL },
  { to: '/portal/profile', label: 'Profile', icon: User, tone: NEUTRAL },
]

function Tile({ to, title, children, icon: Icon }: { to: string; title: string; children: React.ReactNode; icon: LucideIcon }) {
  return (
    <Link to={to} className="block">
      <Card className="h-full p-4 transition hover:-translate-y-0.5 hover:shadow-pop">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            <Icon className="size-4" aria-hidden /> {title}
          </span>
          <ChevronRight className="size-4 text-faint" aria-hidden />
        </div>
        <div className="mt-2">{children}</div>
      </Card>
    </Link>
  )
}

export default function PortalHomePage() {
  useDocumentTitle('Home')
  const overview = useApi('portal:overview', () => portalApi.overview())
  const o = overview.data
  if (overview.error && !o) return <ErrorState error={overview.error} onRetry={overview.reload} />
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-ink">
          Hello, {o ? firstName(o.member.name) : '…'}
        </h1>
        <p className="text-sm text-muted">{o?.attendance.checked_in_today ? 'Great work — you checked in today.' : "Let's make today count."}</p>
      </div>

      {o ? <MembershipHero membership={o.membership} pending={o.pending_payment} /> : <Skeleton className="h-64 rounded-3xl" />}

      <nav aria-label="Quick actions" className="grid grid-cols-4 gap-3">
        {ACTIONS.map(({ to, label, icon: Icon, tone }) => (
          <Link key={to} to={to} className="group flex flex-col items-center gap-1.5 text-center">
            <span className={cn('flex size-14 items-center justify-center rounded-2xl shadow-card transition group-hover:-translate-y-0.5 group-active:scale-95', tone)}>
              <Icon className="size-6" aria-hidden />
            </span>
            <span className="text-[12px] font-semibold text-ink-2">{label}</span>
          </Link>
        ))}
      </nav>

      {o ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile to="/portal/attendance" title="This month" icon={CalendarCheck2}>
            <p className="text-2xl font-bold text-ink">
              {o.attendance.this_month} <span className="text-sm font-medium text-muted">visit{o.attendance.this_month === 1 ? '' : 's'}</span>
            </p>
            <div className="mt-3 flex gap-1" aria-label="Last 14 days">
              {o.attendance.last_14_days.map((d) => (
                <span key={d.date} title={`${formatDate(d.date)}: ${d.visited ? 'visited' : 'no visit'}`} className={cn('h-6 flex-1 rounded-md', d.visited ? 'bg-accent-500' : 'bg-subtle ring-1 ring-inset ring-line')} />
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted">Last visit {o.attendance.last_check_in ? relativeTime(o.attendance.last_check_in) : '—'}</p>
          </Tile>
          <Tile to="/portal/workout" title="Current workout" icon={Dumbbell}>
            {o.current_workout ? (
              <>
                <p className="text-lg font-bold text-ink">{o.current_workout.title}</p>
                <p className="text-sm text-muted">
                  {o.current_workout.exercises} exercises{o.current_workout.day_label && ` · ${o.current_workout.day_label}`}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">No workout assigned yet. Ask your trainer for a plan.</p>
            )}
            {o.member.trainer_name && <p className="mt-2 text-[12px] text-muted">Trainer: {o.member.trainer_name}</p>}
          </Tile>
          <Tile to="/portal/payments" title="Latest payment" icon={CreditCard}>
            {o.latest_payment ? (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-bold text-ink">{formatMoney(o.latest_payment.amount)}</p>
                  <p className="text-[12px] text-muted">
                    {METHOD_LABELS[o.latest_payment.payment_method]} · {formatDate(o.latest_payment.payment_date)}
                  </p>
                </div>
                <StatusBadge status={o.latest_payment.status} size="sm" />
              </div>
            ) : (
              <p className="text-sm text-muted">No payments yet.</p>
            )}
          </Tile>
          <Tile to="/portal/notifications" title={o.unread_notifications ? `Notifications · ${o.unread_notifications} unread` : 'Notifications'} icon={Bell}>
            {o.recent_notification ? (
              <>
                <p className="line-clamp-2 text-sm text-ink-2">{o.recent_notification.message}</p>
                <p className="mt-1 text-[12px] text-muted">{relativeTime(o.recent_notification.created_at)}</p>
              </>
            ) : (
              <p className="text-sm text-muted">You're all caught up.</p>
            )}
          </Tile>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}
    </div>
  )
}
