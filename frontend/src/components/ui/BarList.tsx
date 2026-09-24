import { formatNumber } from '@/utils/format'

interface BarListItem {
  key: string
  label: string
  value: number
  display: string
}

/** Ranked horizontal bars in plain HTML: one series, one colour, value + share at the end. */
export function BarList({ items, empty = 'No data yet.' }: { items: BarListItem[]; empty?: string }) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const max = Math.max(1, ...items.map((item) => item.value))
  if (!items.length || total === 0) return <p className="px-1 py-6 text-center text-sm text-muted">{empty}</p>
  return (
    <ul className="space-y-3.5">
      {items.map((item) => {
        const share = Math.round((item.value / total) * 100)
        return (
          <li key={item.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-ink-2">{item.label}</span>
              <span className="shrink-0">
                <span className="tabular font-semibold text-ink">{item.display}</span>
                <span className="tabular ml-2 text-[12px] text-muted">{formatNumber(share)}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-subtle ring-1 ring-inset ring-line/60" role="presentation">
              <div className="h-full rounded-full bg-viz-1" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
