import { Archive, Database, Gauge, HardDrive, RefreshCw, TrendingUp } from 'lucide-react'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, StatCard } from '@/components/ui/Card'
import { ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useToast } from '@/contexts/ToastContext'
import { useApi } from '@/hooks/useApi'
import { useAction } from '@/hooks/useUtilities'
import { storageApi } from '@/services/endpoints'
import type { StorageLevel, StorageOverview } from '@/types'
import { cn } from '@/utils/cn'
import { addDaysISO, formatBytes, formatDate, formatNumber, relativeTime } from '@/utils/format'

export const TABLE_LABELS: Record<string, string> = {
  members: 'Members',
  memberships: 'Memberships',
  payments: 'Payments',
  refunds: 'Refunds',
  attendance: 'Attendance',
  expenses: 'Expenses',
  workout_plans: 'Workout plans',
  workout_exercises: 'Workout exercises',
  body_measurements: 'Body measurements',
  notifications: 'Notifications',
  users: 'User accounts',
  trainers: 'Trainers',
  membership_plans: 'Membership plans',
  settings: 'Settings',
  backups: 'Backup history',
  storage_snapshots: 'Storage history',
  roles: 'Roles',
}

const LEVELS: { level: StorageLevel; range: string }[] = [
  { level: 'HEALTHY', range: 'below 70%' },
  { level: 'MONITOR', range: '70–80%' },
  { level: 'WARNING', range: '80–90%' },
  { level: 'CRITICAL', range: '90–95%' },
  { level: 'ARCHIVE_REQUIRED', range: 'above 95%' },
]

const FILL: Record<StorageLevel, string> = {
  HEALTHY: 'bg-success-500',
  MONITOR: 'bg-info-500',
  WARNING: 'bg-warning-500',
  CRITICAL: 'bg-warning-600',
  ARCHIVE_REQUIRED: 'bg-danger-500',
}

export interface BackupPrefill {
  from: string
  to: string
  datasets: string[]
}

function UsageBar({ data }: { data: StorageOverview }) {
  const percent = Math.min(100, data.percent)
  return (
    <div>
      <div
        className="relative h-4 overflow-hidden rounded-full bg-subtle ring-1 ring-inset ring-line"
        role="progressbar"
        aria-label="Database storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(data.percent * 10) / 10}
        aria-valuetext={`${data.percent}% used, status ${data.status.toLowerCase().replace('_', ' ')}`}
      >
        <div className={cn('h-full rounded-full', FILL[data.status])} style={{ width: `${percent > 0 ? Math.max(percent, 0.8) : 0}%` }} />
        {[70, 80, 90, 95].map((mark) => (
          <span key={mark} className="absolute inset-y-0 w-0.5 bg-surface" style={{ left: `${mark}%` }} aria-hidden />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint tabular" aria-hidden>
        <span>0%</span>
        <span>100% · {formatBytes(data.limit_bytes)}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted">
        {LEVELS.map(({ level, range }) => (
          <li key={level} className={cn('flex items-center gap-1.5', level === data.status && 'font-semibold text-ink')}>
            <span className={cn('size-2 rounded-full', FILL[level])} aria-hidden />
            {level === 'ARCHIVE_REQUIRED' ? 'Archive required' : level[0] + level.slice(1).toLowerCase()} {range}
            {level === data.status && <span className="sr-only">(current)</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StoragePanel({ onStartBackup }: { onStartBackup: (prefill: BackupPrefill) => void }) {
  const toast = useToast()
  const storage = useApi('storage', () => storageApi.overview(), { freshMs: 60_000 })
  const refresh = useAction(async () => {
    try {
      const fresh = await storageApi.refresh()
      storage.setData(() => fresh)
      toast.success('Storage measured')
    } catch (error) {
      toast.fromError(error)
    }
  })
  const data = storage.data
  if (storage.error && !data) return <ErrorState error={storage.error} onRetry={storage.reload} />
  if (!data) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading storage">
        <Skeleton className="h-48 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }
  const tables = [...data.tables].sort((a, b) => b.estimated_bytes - a.estimated_bytes)
  const biggest = Math.max(1, ...tables.map((t) => t.estimated_bytes))
  const suggestion = data.archive_suggestion
  const oldest = suggestion.candidates.map((c) => c.oldest).sort()[0]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={Database}
          title="Database storage"
          description={`Cloudflare D1 · measured ${relativeTime(data.measured_at)}`}
          action={
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={refresh.loading} onClick={() => refresh.run()}>
              Measure now
            </Button>
          }
        />
        <div className="space-y-4 px-5 pb-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-ink">
              <span className="text-3xl font-bold tracking-tight">{formatBytes(data.used_bytes)}</span>
              <span className="ml-2 text-sm text-muted">of {formatBytes(data.limit_bytes)} used</span>
            </p>
            <div className="flex items-center gap-2">
              <span className="tabular text-lg font-bold text-ink">{data.percent}%</span>
              <StatusBadge status={data.status} />
            </div>
          </div>
          <UsageBar data={data} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Used" icon={HardDrive} tone="slate" value={formatBytes(data.used_bytes)} hint={`${data.percent}% of the limit`} />
        <StatCard label="Remaining" icon={Gauge} tone="slate" value={formatBytes(data.remaining_bytes)} hint="Before the free-plan limit" />
        <StatCard
          label="Growth"
          icon={TrendingUp}
          tone="slate"
          value={data.growth_bytes_per_day > 0 ? `${formatBytes(data.growth_bytes_per_day)}/day` : '—'}
          hint={data.history.length < 3 ? 'Needs a few days of history' : 'Average of recent days'}
        />
        <StatCard
          label="Until 80% (warning)"
          icon={Archive}
          tone="slate"
          value={data.days_until_warning === null ? '—' : `${formatNumber(data.days_until_warning)} days`}
          hint={data.days_until_warning === null ? 'No growth trend yet' : 'At the current growth rate'}
        />
      </div>

      {suggestion.candidates.length > 0 && (
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-ink">Records older than {formatDate(suggestion.before)} can be archived</p>
              <p className="mt-0.5 text-sm text-muted">
                {suggestion.candidates.map((c) => `${TABLE_LABELS[c.table] ?? c.table} (since ${formatDate(c.oldest)})`).join(' · ')}. Back them up first, then archive.
              </p>
            </div>
            <Button
              icon={Archive}
              onClick={() =>
                onStartBackup({ from: oldest ?? suggestion.before, to: addDaysISO(suggestion.before, -1), datasets: [...new Set(suggestion.candidates.map((c) => c.dataset))] })
              }
            >
              Back up &amp; archive
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="What uses the space" description="Estimated from row counts — the database reports one total size" />
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-line bg-subtle text-left text-[12px] font-semibold uppercase tracking-wide text-faint">
                <th scope="col" className="px-5 py-2.5">Table</th>
                <th scope="col" className="px-3 py-2.5 text-right">Rows</th>
                <th scope="col" className="px-3 py-2.5">Estimated size</th>
                <th scope="col" className="px-3 py-2.5 text-right">New rows / day</th>
                <th scope="col" className="px-5 py-2.5">Oldest record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tables.map((t) => (
                <tr key={t.table}>
                  <td className="px-5 py-2.5">
                    <span className="font-medium text-ink">{TABLE_LABELS[t.table] ?? t.table}</span>
                    {t.dataset && <span className="ml-2 text-[12px] text-muted">in backups</span>}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{formatNumber(t.rows)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-subtle" aria-hidden>
                        <div className="h-full rounded-full bg-viz-1" style={{ width: `${Math.max(2, (t.estimated_bytes / biggest) * 100)}%` }} />
                      </div>
                      <span className="tabular text-ink-2">{formatBytes(t.estimated_bytes)}</span>
                    </div>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{t.rows_per_day === null ? '—' : formatNumber(t.rows_per_day)}</td>
                  <td className="px-5 py-2.5 text-ink-2">{t.oldest ? formatDate(t.oldest) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-center text-[12px] text-faint">
        Cloudflare D1 free plan: {formatBytes(data.d1.plan_limit_bytes)} per database · Time Travel keeps {data.d1.time_travel_days} days ·{' '}
        {formatNumber(data.d1.free_daily_rows_read)} rows read and {formatNumber(data.d1.free_daily_rows_written)} rows written per day.
      </p>
    </div>
  )
}
