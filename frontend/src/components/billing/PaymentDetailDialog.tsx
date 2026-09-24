import { Download, RotateCcw } from 'lucide-react'
import { Link } from 'react-router'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import type { Payment } from '@/types'
import { formatDate, formatDateTime, formatMoney, METHOD_LABELS } from '@/utils/format'

interface Props {
  payment: Payment | null
  onClose: () => void
  onReceipt?: (payment: Payment) => void
  onRefund?: (payment: Payment) => void
  receiptBusy?: boolean
}

/** Everything recorded about one payment, including who verified it and any refund. */
export function PaymentDetailDialog({ payment, onClose, onReceipt, onRefund, receiptBusy }: Props) {
  if (!payment) return null
  const rows: [string, React.ReactNode][] = [
    ['Member', payment.member_name ? <Link to={`/members/${payment.member_id}`} className="font-semibold text-ink underline-offset-2 hover:underline">{payment.member_name} · {payment.member_code}</Link> : '—'],
    ['Plan', payment.plan_name ?? '—'],
    ['Membership', payment.membership ? `${formatDate(payment.membership.start_date)} → ${formatDate(payment.membership.end_date)}` : payment.status === 'PENDING' ? 'Starts after verification' : '—'],
    ['Amount', <span className="tabular font-semibold">{formatMoney(payment.amount)}</span>],
    ['Method', METHOD_LABELS[payment.payment_method] ?? payment.payment_method],
    ['Reference / UTR', payment.transaction_reference ? <span className="tabular">{payment.transaction_reference}</span> : '—'],
    ['Payment date', formatDate(payment.payment_date)],
    ['Receipt', payment.receipt_number ?? '—'],
    ['Verified by', payment.verified_by_name ? `${payment.verified_by_name} · ${formatDateTime(payment.verified_at)}` : '—'],
    ['Recorded', formatDateTime(payment.created_at)],
    ...(payment.notes ? ([['Notes', payment.notes]] as [string, React.ReactNode][]) : []),
  ]
  const canReceipt = payment.status === 'PAID' || payment.status === 'REFUNDED'
  return (
    <Dialog
      open
      onClose={onClose}
      variant="drawer"
      title={payment.payment_number}
      description={<StatusBadge status={payment.status} />}
      footer={
        <>
          {onRefund && payment.status === 'PAID' && (
            <Button variant="secondary" icon={RotateCcw} onClick={() => onRefund(payment)}>
              Record refund
            </Button>
          )}
          {onReceipt && canReceipt && (
            <Button icon={Download} loading={receiptBusy} onClick={() => onReceipt(payment)}>
              Receipt (PDF)
            </Button>
          )}
        </>
      }
    >
      <dl className="divide-y divide-line rounded-2xl border border-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="shrink-0 text-sm text-muted">{label}</dt>
            <dd className="min-w-0 text-right text-sm text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {payment.refund && (
        <div className="mt-4 rounded-2xl border border-line bg-subtle p-4">
          <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Refund recorded</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {formatMoney(payment.refund.amount)} by {METHOD_LABELS[payment.refund.method] ?? payment.refund.method} on {formatDate(payment.refund.date)}
          </p>
          {payment.refund.reference && <p className="mt-0.5 text-[13px] text-muted">Reference {payment.refund.reference}</p>}
          <p className="mt-1 text-[13px] text-ink-2">{payment.refund.reason}</p>
        </div>
      )}
    </Dialog>
  )
}
