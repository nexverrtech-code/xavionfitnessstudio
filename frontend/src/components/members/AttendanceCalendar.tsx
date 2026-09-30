import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/Button'
import type { AttendanceDay } from '@/types'
import { cn } from '@/utils/cn'
import { formatTime, todayISO } from '@/utils/format'

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

function dayLabel(day: AttendanceDay | undefined): string {
  if (!day) return 'no visit'
  const count = day.visits?.length ?? 1
  return `${count} visit${count === 1 ? '' : 's'}, first at ${formatTime(day.check_in)}`
}

/** Month grid: a filled day = present (however many visits); a small number = visits that day. */
export function AttendanceCalendar({ month, days, onMonth }: { month: string; days: AttendanceDay[]; onMonth: (month: string) => void }) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const offset = (first.getUTCDay() + 6) % 7 // Monday first
  const present = new Map(days.map((d) => [d.date, d]))
  const today = todayISO()
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
  const isCurrent = month >= today.slice(0, 7)
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <IconButton icon={ChevronLeft} label="Previous month" size="icon-sm" onClick={() => onMonth(shiftMonth(month, -1))} />
        <p className="text-sm font-semibold text-ink">
          {label} · <span className="text-muted">{days.length} day{days.length === 1 ? '' : 's'}</span>
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
        {Array.from({ length }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, '0')}`
          const day = present.get(iso)
          const visits = day?.visits?.length ?? 0
          return (
            <span
              key={iso}
              role="gridcell"
              aria-label={`${i + 1}: ${dayLabel(day)}`}
              title={day ? dayLabel(day) : undefined}
              className={cn(
                'relative flex aspect-square items-center justify-center rounded-lg text-[12px] font-semibold',
                day ? 'bg-volt font-semibold text-on-volt' : iso > today ? 'text-faint/60' : 'bg-subtle text-muted',
                iso === today && 'ring-2 ring-accent-400 ring-offset-2 ring-offset-surface',
              )}
            >
              {i + 1}
              {visits > 1 && (
                <span className="absolute right-0.5 top-0.5 rounded-full bg-ink/80 px-1 text-[9px] font-bold leading-[14px] text-canvas" aria-hidden>
                  {visits}
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
