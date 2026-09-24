import { AlertCircle, CalendarCheck2, CalendarClock, CheckCircle2, Dumbbell, Ruler, ScanLine, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PickMemberDialog } from '@/components/members/PickMemberDialog'
import { Pill } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, StatCard } from '@/components/ui/Card'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Menu'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { dashboardApi } from '@/services/endpoints'
import { firstName, formatTime, greeting } from '@/utils/format'

const ALERT_META = {
  NO_WORKOUT: { icon: Dumbbell, tone: 'violet' as const, action: 'workout' },
  MEASURE: { icon: Ruler, tone: 'amber' as const, action: 'progress' },
  EXPIRING: { icon: CalendarClock, tone: 'red' as const, action: 'membership' },
}

function alertSummary(alerts: { kind: string }[]): string {
  if (!alerts.length) return 'Everyone is on track'
  const count = (kind: string) => alerts.filter((a) => a.kind === kind).length
  const parts = [
    [count('MEASURE'), 'check-in due'],
    [count('NO_WORKOUT'), 'without a plan'],
    [count('EXPIRING'), 'expiring'],
  ] as const
  return parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(' · ')
}

export default function TrainerDashboardPage() {
  useDocumentTitle('Dashboard')
  const { user } = useAuth()
  const actions = useActions()
  const navigate = useNavigate()
  const overview = useApi('dashboard:trainer', () => dashboardApi.trainer())
  const [picking, setPicking] = useState<'workout' | 'measure' | null>(null)
  const o = overview.data
  const loading = overview.loading && !o

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
            {greeting()}, {firstName(user?.name)}
          </h1>
          <p className="mt-1 text-sm text-muted">Here's how your members are doing today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={Dumbbell} onClick={() => setPicking('workout')}>
            Create workout
          </Button>
          <Button variant="secondary" icon={Ruler} onClick={() => setPicking('measure')}>
            Add measurement
          </Button>
          <Button variant="secondary" icon={ScanLine} onClick={() => navigate('/attendance')}>
            Attendance
          </Button>
        </div>
      </section>

      {overview.error && !o ? (
        <Card>
          <ErrorState error={overview.error} onRetry={overview.reload} />
        </Card>
      ) : (
        <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Assigned Members" icon={Users} value={o?.assigned_members ?? 0} hint={o ? `${o.active_members} with an active plan` : undefined} loading={loading} to="/members" />
          <StatCard label="Today's Sessions" icon={CalendarCheck2} tone="blue" value={o?.today_sessions.length ?? 0} hint="Checked in today" loading={loading} />
          <StatCard label="This Week" icon={CheckCircle2} tone="green" value={o?.week_attendance ?? 0} hint="Visits by your members" loading={loading} />
          <StatCard label="Workout Plans" icon={Dumbbell} tone="brand" value={o?.active_workouts ?? 0} hint="Active plans" loading={loading} to="/workouts" />
          <StatCard label="Progress Alerts" icon={AlertCircle} tone="amber" value={o?.alerts.length ?? 0} hint={alertSummary(o?.alerts ?? [])} loading={loading} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={CalendarCheck2} title="Today's sessions" description="Your members who checked in today" />
          {loading ? (
            <SkeletonRows rows={3} className="px-5 pb-5" />
          ) : !o?.today_sessions.length ? (
            <EmptyState compact icon={CalendarCheck2} title="No check-ins yet today" description="Members appear here as soon as they scan in at the front desk." />
          ) : (
            <ul className="divide-y divide-line">
              {o.today_sessions.map((s) => (
                <li key={s.id}>
                  <Link to={`/members/${s.member_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-hover">
                    <Avatar name={s.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{s.name}</span>
                      <span className="block text-[12px] text-muted">{s.member_code}</span>
                    </span>
                    <span className="tabular text-sm text-ink-2">
                      {formatTime(s.check_in)}
                      {s.check_out && ` → ${formatTime(s.check_out)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={AlertCircle} title="Progress alerts" description="Members who need a plan, a check-in or a renewal nudge" />
          {loading ? (
            <SkeletonRows rows={3} className="px-5 pb-5" />
          ) : !o?.alerts.length ? (
            <EmptyState compact icon={CheckCircle2} title="Everyone is on track" description="All your members have workouts and recent measurements." />
          ) : (
            <ul className="divide-y divide-line">
              {o.alerts.map((alert, index) => {
                const meta = ALERT_META[alert.kind]
                return (
                  <li key={`${alert.member_id}-${alert.kind}-${index}`}>
                    <Link to={`/members/${alert.member_id}?tab=${meta.action}`} className="flex items-center gap-3 px-5 py-3 hover:bg-hover">
                      <Avatar name={alert.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{alert.name}</span>
                        <span className="block text-[12px] text-muted">{alert.member_code}</span>
                      </span>
                      <Pill tone={meta.tone} icon={meta.icon}>
                        {alert.message}
                      </Pill>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
      <PickMemberDialog
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={picking === 'workout' ? 'Create workout for…' : 'Add measurement for…'}
        actionLabel="Continue"
        onPick={(m) => (picking === 'workout' ? actions.createWorkout({ id: m.id, name: m.name }) : actions.addMeasurement({ id: m.id, name: m.name }))}
      />
    </div>
  )
}
