import { QrCode, UserRoundCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AttendanceVisit } from '@/types'
import { cn } from '@/utils/cn'
import { durationLabel, formatTime } from '@/utils/format'

/** "6:02 am – 7:15 am"; an open visit ends in "now"; without a check-out only the arrival shows
 *  (older visits may come from before check-out was recorded). */
export function visitRange(visit: AttendanceVisit): string {
  const start = formatTime(visit.check_in)
  if (visit.check_out) return `${start} – ${formatTime(visit.check_out)}`
  return visit.open ? `${start} – now` : start
}

/** A member's visits on one day as small time chips, in time order. Wraps on narrow screens.
 *  Spans (not ul/li) so the chips may sit inside a tappable row button. */
export function VisitChips({ visits, className }: { visits: AttendanceVisit[]; className?: string }) {
  return (
    <span role="list" className={cn('flex flex-wrap gap-1.5', className)} aria-label={`${visits.length} visit${visits.length === 1 ? '' : 's'}`}>
      {visits.map((visit) => (
        <span
          role="listitem"
          key={visit.id}
          className={cn(
            'tabular inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[12px] font-medium ring-1 ring-inset',
            visit.open
              ? 'bg-success-50 text-success-800 ring-success-600/20 dark:bg-success-500/10 dark:text-success-300 dark:ring-success-400/20'
              : 'bg-subtle text-ink-2 ring-line',
          )}
          title={visit.check_out ? durationLabel(visit.minutes) : visit.open ? 'In the gym now' : undefined}
        >
          {visit.open && <span className="size-1.5 animate-pulse rounded-full bg-success-600" aria-hidden />}
          {visitRange(visit)}
        </span>
      ))}
    </span>
  )
}

/** Visits as a list (time, length, method) for detail views. */
export function VisitRows({ visits, action }: { visits: AttendanceVisit[]; action?: (visit: AttendanceVisit) => ReactNode }) {
  return (
    <ol className="divide-y divide-line">
      {visits.map((visit, index) => (
        <li key={visit.id} className="flex items-center gap-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-[12px] font-bold text-ink-2">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="tabular text-sm font-semibold text-ink">{visitRange(visit)}</p>
            <p className="flex items-center gap-1.5 text-[12px] text-muted">
              {visit.method === 'QR' ? <QrCode className="size-3.5" aria-hidden /> : <UserRoundCheck className="size-3.5" aria-hidden />}
              {visit.method === 'QR' ? 'QR scan' : 'Front desk'}
              {visit.check_out && <> · {durationLabel(visit.minutes)}</>}
              {visit.open && <span className="font-semibold text-success-700 dark:text-success-300"> · In the gym</span>}
            </p>
          </div>
          {action?.(visit)}
        </li>
      ))}
    </ol>
  )
}
