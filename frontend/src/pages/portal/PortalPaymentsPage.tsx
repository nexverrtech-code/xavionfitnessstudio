import { Download, Wallet } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { Pagination } from '@/components/ui/Navigation'
import { useApi } from '@/hooks/useApi'
import { useReceipt } from '@/hooks/useReceipt'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import { formatDate, formatMoney, METHOD_LABELS } from '@/utils/format'

export default function PortalPaymentsPage() {
  useDocumentTitle('Payments')
  const [page, setPage] = useState(1)
  const payments = useApi(`portal:payments:${page}`, () => portalApi.payments({ page, limit: 20 }), { keepPrevious: true })
  const receipt = useReceipt('member')
  const items = payments.data?.items ?? []
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Payments</h1>
      {payments.loading && !payments.data ? (
        <SkeletonRows rows={4} />
      ) : payments.error && !payments.data ? (
        <ErrorState error={payments.error} onRetry={payments.reload} />
      ) : !items.length ? (
        <Card>
          <EmptyState icon={Wallet} title="No payments yet" description="Your membership payments and receipts will appear here." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {items.map((p) => {
              const hasReceipt = p.status === 'PAID' || p.status === 'REFUNDED'
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-ink">{formatMoney(p.amount)}</p>
                    <p className="truncate text-[13px] text-muted">
                      {p.plan_name ?? 'Membership'} · {METHOD_LABELS[p.payment_method]}
                    </p>
                    <p className="tabular text-[12px] text-faint">
                      {p.payment_number} · {formatDate(p.payment_date)}
                    </p>
                    {p.refund && <p className="text-[12px] text-muted">{formatMoney(p.refund.amount)} refunded on {formatDate(p.refund.date)}</p>}
                    {p.status === 'PENDING' && <p className="text-[12px] text-muted">Waiting for the gym to verify your UTR.</p>}
                  </div>
                  <StatusBadge status={p.status} size="sm" />
                  {hasReceipt && (
                    <IconButton icon={Download} label={`Download receipt ${p.receipt_number ?? ''}`} disabled={receipt.busy === p.id} onClick={() => receipt.download(p)} />
                  )}
                </li>
              )
            })}
          </ul>
          {payments.data && payments.data.pages > 1 && (
            <div className="border-t border-line px-4">
              <Pagination page={page} pages={payments.data.pages} total={payments.data.total} limit={payments.data.limit} onPage={setPage} />
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
