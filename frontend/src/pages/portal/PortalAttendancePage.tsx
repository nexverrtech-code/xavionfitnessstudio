import { CalendarCheck2 } from 'lucide-react'
import { useState } from 'react'
import { AttendanceCalendar } from '@/components/members/AttendanceCalendar'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import { formatDate, formatTime, todayISO } from '@/utils/format'

export default function PortalAttendancePage() {
  useDocumentTitle('Attendance')
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const history = useApi(`portal:attendance:${month}`, () => portalApi.attendance(month), { keepPrevious: true })
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Attendance</h1>
      {history.error && !history.data ? (
        <ErrorState error={history.error} onRetry={history.reload} />
      ) : (
        <>
          <Card className="p-5">{history.data ? <AttendanceCalendar month={month} visits={history.data.items} onMonth={setMonth} /> : <Skeleton className="h-72 rounded-xl" />}</Card>
          <Card>
            <CardHeader title="Visits" description={history.data ? `${history.data.count} this month` : undefined} />
            {history.data && history.data.items.length === 0 ? (
              <EmptyState compact icon={CalendarCheck2} title="No visits this month" description="Scan your QR at the front desk when you arrive." />
            ) : (
              <ul className="divide-y divide-line">
                {(history.data?.items ?? []).map((v) => (
                  <li key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="font-medium text-ink">{formatDate(v.date, { weekday: true, withYear: false })}</span>
                    <span className="tabular text-muted">
                      {formatTime(v.check_in)}
                      {v.check_out && ` → ${formatTime(v.check_out)}`}
                    </span>
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
