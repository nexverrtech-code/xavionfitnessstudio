import { CalendarCheck2 } from 'lucide-react'
import { useState } from 'react'
import { VisitChips } from '@/components/attendance/Visits'
import { AttendanceCalendar } from '@/components/members/AttendanceCalendar'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import { durationLabel, formatDate, todayISO } from '@/utils/format'

export default function PortalAttendancePage() {
  useDocumentTitle('Attendance')
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const history = useApi(`portal:attendance:${month}`, () => portalApi.attendance(month), { keepPrevious: true })
  const data = history.data
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Attendance</h1>
      {history.error && !data ? (
        <ErrorState error={history.error} onRetry={history.reload} />
      ) : (
        <>
          <Card className="p-4 sm:p-5">{data ? <AttendanceCalendar month={month} days={data.items} onMonth={setMonth} /> : <Skeleton className="h-72 rounded-xl" />}</Card>
          <Card>
            <CardHeader
              title="Visits"
              description={data ? `${data.days} day${data.days === 1 ? '' : 's'} present · ${data.visits} visit${data.visits === 1 ? '' : 's'}` : undefined}
            />
            {data && data.items.length === 0 ? (
              <EmptyState compact icon={CalendarCheck2} title="No visits this month" description="Scan your QR at the front desk when you arrive and when you leave." />
            ) : (
              <ul className="divide-y divide-line">
                {(data?.items ?? []).map((day) => (
                  <li key={day.date} className="space-y-2 px-4 py-3 sm:px-5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-ink">{formatDate(day.date, { weekday: true, withYear: false })}</span>
                      {day.minutes > 0 && <span className="tabular shrink-0 text-[12px] text-muted">{durationLabel(day.minutes)}</span>}
                    </div>
                    <VisitChips visits={day.visits} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
