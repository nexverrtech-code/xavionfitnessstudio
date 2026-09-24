import { ClipboardList } from 'lucide-react'
import { MembershipHero } from '@/components/portal/MembershipHero'
import { StatusBadge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import { formatDate, formatMoney } from '@/utils/format'

export default function PortalMembershipPage() {
  useDocumentTitle('Membership')
  const data = useApi('portal:membership', () => portalApi.membership())
  const pending = useApi('portal:pending', () => portalApi.pending())
  if (data.error && !data.data) return <ErrorState error={data.error} onRetry={data.reload} />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Membership</h1>
      {data.data ? <MembershipHero membership={data.data.membership} pending={pending.data?.payment ?? null} /> : <Skeleton className="h-60 rounded-3xl" />}
      <Card>
        <CardHeader title="History" />
        {data.data && !data.data.history.length ? (
          <EmptyState compact icon={ClipboardList} title="No memberships yet" description="Your plans will be listed here." />
        ) : (
          <ul className="divide-y divide-line">
            {(data.data?.history ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{m.plan_name}</p>
                  <p className="text-[13px] text-muted">
                    {formatDate(m.start_date)} → {formatDate(m.end_date)} · {formatMoney(m.amount)}
                  </p>
                </div>
                <StatusBadge status={m.status} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
