import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { formatTime, todayISO } from '@/utils/format'

interface Visit {
  date: string
  check_in: string
  check_out: string | null
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

/** Month grid: a filled day = a visit. Every visit also appears in the list below it. */
export function AttendanceCalendar({ month, visits, onMonth }: { month: string; visits: Visit[]; onMonth: (month: string) => void }) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const offset = (first.getUTCDay() + 6) % 7 // Monday first
  const visited = new Map(visits.map((v) => [v.date, v]))
  const today = todayISO()
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
  const isCurrent = month >= today.slice(0, 7)
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <IconButton icon={ChevronLeft} label="Previous month" size="icon-sm" onClick={() => onMonth(shiftMonth(month, -1))} />
        <p className="text-sm font-semibold text-ink">
          {label} · <span className="text-muted">{visits.length} visit{visits.length === 1 ? '' : 's'}</span>
        </p>
        <IconButton icon={ChevronRight} label="Next month" size="icon-sm" disabled={isCurrent} onClick={() => onMonth(shiftMonth(month, 1))} />
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center" role="grid" aria-label={`Attendance in ${label}`}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="pb-1 text-[11px] font-semibold text-faint" aria-hidden>
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} aria-hidden />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, '0')}`
          const visit = visited.get(iso)
          return (
            <span
              key={iso}
              role="gridcell"
              aria-label={`${i + 1}: ${visit ? `checked in ${formatTime(visit.check_in)}` : 'no visit'}`}
              title={visit ? `Checked in ${formatTime(visit.check_in)}` : undefined}
              className={cn(
                'flex aspect-square items-center justify-center rounded-lg text-[12px] font-semibold',
                visit ? 'bg-volt font-semibold text-on-volt' : iso > today ? 'text-faint/60' : 'bg-subtle text-muted',
                iso === today && 'ring-2 ring-accent-400 ring-offset-2 ring-offset-surface',
              )}
            >
              {i + 1}
            </span>
          )
        })}
      </div>
    </div>
  )
}
