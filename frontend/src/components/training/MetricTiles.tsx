import { TrendingDown, TrendingUp } from 'lucide-react'
import type { Metric } from '@/types'
import { formatDate } from '@/utils/format'
import { METRIC_META, METRIC_ORDER } from '@/utils/metrics'

export function MetricTiles({ latest, change, bmi }: { latest: Partial<Record<Metric, { value: number; date: string }>>; change: Partial<Record<Metric, number>>; bmi: number | null }) {
  const shown = METRIC_ORDER.filter((m) => latest[m])
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {shown.map((m) => {
        const delta = change[m]
        const Icon = delta !== undefined && delta < 0 ? TrendingDown : TrendingUp
        return (
          <div key={m} className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
            <p className="text-[12px] font-medium text-muted">{METRIC_META[m].label}</p>
            <p className="mt-1 text-xl font-bold text-ink">
              {latest[m]!.value}
              <span className="ml-1 text-[13px] font-medium text-muted">{METRIC_META[m].unit}</span>
            </p>
            {delta !== undefined && delta !== 0 ? (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                <Icon className="size-3.5" aria-hidden />
                <span className="tabular font-semibold text-ink-2">
                  {delta > 0 ? '+' : ''}
                  {delta}
                </span>{' '}
                vs previous
              </p>
            ) : (
              <p className="mt-0.5 text-[12px] text-faint">{formatDate(latest[m]!.date)}</p>
            )}
          </div>
        )
      })}
      {bmi && (
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
          <p className="text-[12px] font-medium text-muted">BMI</p>
          <p className="mt-1 text-xl font-bold text-ink">{bmi}</p>
          <p className="mt-0.5 text-[12px] text-faint">From latest height & weight</p>
        </div>
      )}
    </div>
  )
}
