import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Measurement, Metric } from '@/types'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/format'
import { METRIC_META } from '@/utils/metrics'

const CHARTABLE: Metric[] = ['weight', 'body_fat', 'waist', 'chest', 'arm', 'thigh']

/** One measure per chart (never a dual axis); the reader switches metric instead. */
export default function ProgressChart({ history }: { history: Measurement[] }) {
  const available = CHARTABLE.filter((metric) => history.some((h) => h[metric] !== null && h[metric] !== undefined))
  const [metric, setMetric] = useState<Metric>(available[0] ?? 'weight')
  const data = useMemo(
    () =>
      [...history]
        .filter((h) => h[metric] !== null && h[metric] !== undefined)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((h) => ({ date: h.date, value: h[metric] as number })),
    [history, metric],
  )
  const meta = METRIC_META[metric]
  if (!available.length) return null
  const values = data.map((d) => d.value)
  const pad = Math.max(1, (Math.max(...values) - Math.min(...values)) * 0.25)
  const domain: [number, number] = [Math.floor(Math.min(...values) - pad), Math.ceil(Math.max(...values) + pad)]

  return (
    <div>
      <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto" role="radiogroup" aria-label="Metric">
        {available.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={metric === m}
            onClick={() => setMetric(m)}
            className={cn(
              'h-8 shrink-0 rounded-full border px-3 text-[12px] font-semibold',
              metric === m ? 'border-primary bg-primary text-on-primary' : 'border-line text-ink-2 hover:bg-hover',
            )}
          >
            {METRIC_META[m].label}
          </button>
        ))}
      </div>
      {data.length < 2 ? (
        <p className="py-10 text-center text-sm text-muted">Add one more {meta.label.toLowerCase()} measurement to see the trend.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-viz-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(d, { withYear: false })}
              tick={{ fill: 'var(--color-muted)', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line-strong)' }}
              minTickGap={24}
              dy={6}
            />
            <YAxis domain={domain} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={40} unit={meta.unit === '%' ? '%' : ''} />
            <Tooltip
              cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                    <p className="text-[12px] text-muted">{formatDate(String(label))}</p>
                    <p className="tabular text-sm font-semibold text-ink">
                      {Number(payload[0].value).toFixed(1)} {meta.unit}
                    </p>
                  </div>
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--color-viz-1)"
              strokeWidth={2}
              fill="var(--color-viz-1)"
              fillOpacity={0.1}
              dot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)', fill: 'var(--color-viz-1)' }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--color-surface)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
