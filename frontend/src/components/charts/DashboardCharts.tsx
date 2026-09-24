import { useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarList } from '@/components/ui/BarList'
import { Card, CardHeader } from '@/components/ui/Card'
import type { DashboardCharts as ChartsData } from '@/types'
import { cn } from '@/utils/cn'
import { formatDate, formatMoney, formatMonth, formatNumber, METHOD_LABELS } from '@/utils/format'

/*
 * Chart specs (dataviz method): one y-axis per chart, 2px lines, ~10% area washes,
 * <=24px bars with 4px rounded ends and a 2px surface gap between stacked segments,
 * solid hairline grid, text in ink tokens (never the series colour), a legend for 2+
 * series, a crosshair/per-bar tooltip, and a table view for every chart.
 */

const AXIS_TICK = { fill: 'var(--color-muted)', fontSize: 12 }
const SERIES = { a: 'var(--color-viz-1)', b: 'var(--color-viz-2)' }

interface TooltipRow {
  key: string
  label: string
  value: string
  color: string
}

function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-40 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-pop">
      <p className="mb-1.5 text-[12px] font-medium text-muted">{title}</p>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <span className="h-0.5 w-3 rounded-full" style={{ background: row.color }} aria-hidden />
            {row.label}
          </span>
          <span className="tabular text-[13px] font-semibold text-ink">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

function Legend({ items }: { items: { label: string; color: string; shape?: 'line' | 'rect' }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
          <span className={item.shape === 'rect' ? 'size-2.5 rounded-[3px]' : 'h-0.5 w-3.5 rounded-full'} style={{ background: item.color }} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function ChartCard({
  title,
  description,
  legend,
  chart,
  table,
  className,
}: {
  title: string
  description?: string
  legend?: ReactNode
  chart: ReactNode
  table: { headers: string[]; rows: (string | number)[][] }
  className?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={title}
        description={description}
        action={
          <div className="flex rounded-lg bg-subtle p-0.5 text-[12px] font-semibold" role="group" aria-label={`${title} view`}>
            {(['chart', 'table'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn('rounded-md px-2.5 py-1 capitalize', view === v ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />
      {legend && view === 'chart' && <div className="px-5 pb-2">{legend}</div>}
      <div className="px-2 pb-4 sm:px-3">
        {view === 'chart' ? (
          chart
        ) : (
          <div className="scrollbar-thin max-h-[260px] overflow-auto px-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {table.headers.map((h, i) => (
                    <th key={h} scope="col" className={cn('py-2 text-[12px] font-semibold uppercase tracking-wide text-faint', i === 0 ? 'text-left' : 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, i) => (
                      <td key={i} className={cn('tabular py-2 text-ink-2', i === 0 ? 'text-left' : 'text-right font-medium text-ink')}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

const compactMoney = (paise: number) => formatMoney(paise, { compact: true })

export function RevenueTrendChart({ data, showExpenses, className }: { data: ChartsData['revenue_trend']; showExpenses: boolean; className?: string }) {
  const legend = showExpenses ? (
    <Legend
      items={[
        { label: 'Revenue', color: SERIES.a },
        { label: 'Expenses', color: SERIES.b },
      ]}
    />
  ) : undefined
  return (
    <ChartCard
      title="Revenue trend"
      description={showExpenses ? 'Confirmed payments vs recorded expenses, by month' : 'Confirmed payments by month'}
      legend={legend}
      className={className}
      table={{
        headers: showExpenses ? ['Month', 'Revenue', 'Expenses', 'Payments'] : ['Month', 'Revenue', 'Payments'],
        rows: data.map((d) =>
          showExpenses ? [formatMonth(d.month), formatMoney(d.revenue), formatMoney(d.expenses ?? 0), d.payments] : [formatMonth(d.month), formatMoney(d.revenue), d.payments],
        ),
      }}
      chart={
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-viz-grid)" />
            <XAxis dataKey="month" tickFormatter={formatMonth} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-line-strong)' }} dy={6} />
            <YAxis tickFormatter={compactMoney} tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} />
            <Tooltip
              cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={formatMonth(String(label))}
                    rows={payload.map((p) => ({ key: String(p.dataKey), label: p.dataKey === 'revenue' ? 'Revenue' : 'Expenses', value: formatMoney(Number(p.value)), color: String(p.color) }))}
                  />
                ) : null
              }
            />
            <Area type="monotone" dataKey="revenue" stroke={SERIES.a} strokeWidth={2} fill={SERIES.a} fillOpacity={0.1} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }} />
            {showExpenses && (
              <Area type="monotone" dataKey="expenses" stroke={SERIES.b} strokeWidth={2} fill={SERIES.b} fillOpacity={0.08} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      }
    />
  )
}

export function MembershipTrendChart({ data }: { data: ChartsData['membership_trend'] }) {
  return (
    <ChartCard
      title="Membership trend"
      description="Memberships started each month"
      legend={
        <Legend
          items={[
            { label: 'New', color: SERIES.a, shape: 'rect' },
            { label: 'Renewals', color: SERIES.b, shape: 'rect' },
          ]}
        />
      }
      table={{ headers: ['Month', 'New', 'Renewals'], rows: data.map((d) => [formatMonth(d.month), d.new, d.renewals]) }}
      chart={
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-viz-grid)" />
            <XAxis dataKey="month" tickFormatter={formatMonth} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-line-strong)' }} dy={6} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: 'var(--color-hover)' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={formatMonth(String(label))}
                    rows={payload.map((p) => ({ key: String(p.dataKey), label: p.dataKey === 'new' ? 'New' : 'Renewals', value: formatNumber(Number(p.value)), color: String(p.color) }))}
                  />
                ) : null
              }
            />
            <Bar dataKey="new" stackId="m" fill={SERIES.a} maxBarSize={24} stroke="var(--color-surface)" strokeWidth={2} />
            <Bar dataKey="renewals" stackId="m" fill={SERIES.b} maxBarSize={24} radius={[4, 4, 0, 0]} stroke="var(--color-surface)" strokeWidth={2} />
          </BarChart>
        </ResponsiveContainer>
      }
    />
  )
}

export function AttendanceTrendChart({ data }: { data: ChartsData['attendance_trend'] }) {
  const total = data.reduce((sum, d) => sum + d.visits, 0)
  return (
    <ChartCard
      title="Attendance trend"
      description={`${formatNumber(total)} check-ins in the last 30 days`}
      table={{ headers: ['Date', 'Check-ins'], rows: [...data].reverse().map((d) => [formatDate(d.date, { withYear: false }), d.visits]) }}
      chart={
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-viz-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(d, { withYear: false })}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line-strong)' }}
              interval={6}
              dy={6}
            />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              cursor={{ fill: 'var(--color-hover)' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={formatDate(String(label), { weekday: true })}
                    rows={[{ key: 'visits', label: 'Check-ins', value: formatNumber(Number(payload[0].value)), color: SERIES.a }]}
                  />
                ) : null
              }
            />
            <Bar dataKey="visits" fill={SERIES.a} maxBarSize={16} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      }
    />
  )
}

/** The dashboard's chart grid — loaded lazily so Recharts never blocks the first paint. */
export default function DashboardChartGrid({ data, showExpenses, refreshing }: { data: ChartsData; showExpenses: boolean; refreshing?: boolean }) {
  return (
    <div className={cn('space-y-4 transition-opacity', refreshing && 'opacity-70')}>
      <div className="grid gap-4 lg:grid-cols-3">
        <RevenueTrendChart data={data.revenue_trend} showExpenses={showExpenses} className="lg:col-span-2" />
        <Card>
          <CardHeader title="Payment methods" description="Share of this month's revenue" />
          <div className="px-5 pb-5">
            <BarList
              items={data.payment_methods.map((m) => ({ key: m.method, label: METHOD_LABELS[m.method] ?? m.method, value: m.amount, display: formatMoney(m.amount) }))}
              empty="No payments this month yet."
            />
          </div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <AttendanceTrendChart data={data.attendance_trend} />
        <MembershipTrendChart data={data.membership_trend} />
        <Card>
          <CardHeader title="Plan distribution" description="Members on each plan right now" />
          <div className="px-5 pb-5">
            <BarList
              items={data.plan_distribution.map((p) => ({ key: p.plan, label: p.plan, value: p.members, display: `${formatNumber(p.members)} members` }))}
              empty="No active memberships yet."
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
