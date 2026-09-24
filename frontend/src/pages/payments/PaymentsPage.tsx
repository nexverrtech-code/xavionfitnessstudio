import { BadgeCheck, CalendarDays, CheckCircle2, Download, Hourglass, IndianRupee, MoreHorizontal, RotateCcw, Search, Wallet, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PaymentDetailDialog } from '@/components/billing/PaymentDetailDialog'
import { RefundDialog } from '@/components/billing/RefundDialog'
import { RejectPaymentDialog } from '@/components/billing/RejectPaymentDialog'
import { StatusBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, StatCard } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { PageHeader, Pagination, Segmented, Tabs } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useReceipt } from '@/hooks/useReceipt'
import { useDebounce, useDocumentTitle } from '@/hooks/useUtilities'
import { paymentsApi } from '@/services/endpoints'
import type { Payment } from '@/types'
import { cn } from '@/utils/cn'
import { formatDate, formatDateTime, formatMoney, METHOD_LABELS, relativeTime, todayISO } from '@/utils/format'

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom dates' },
] as const
type Range = (typeof RANGES)[number]['value']

const STATUSES = [
  { value: 'PAID', label: 'Paid' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'FAILED', label: 'Failed' },
]

function History({ onOpen }: { onOpen: (payment: Payment) => void }) {
  const { hasRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const receipt = useReceipt()
  const [refunding, setRefunding] = useState<Payment | null>(null)
  const range = (RANGES.some((r) => r.value === params.get('range')) ? params.get('range') : 'month') as Range
  const status = params.get('status') ?? ''
  const method = params.get('method') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Number(params.get('page') ?? 1)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const debounced = useDebounce(query.trim(), 300)

  const update = (changes: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '' || (k === 'page' && v === 1)) next.delete(k)
      else next.set(k, String(v))
    }
    setParams(next, { replace: true })
  }
  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) update({ q: debounced || null, page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const filters = {
    period: range === 'all' ? undefined : range,
    from: range === 'custom' ? from || undefined : undefined,
    to: range === 'custom' ? to || undefined : undefined,
    status: status || undefined,
    method: method || undefined,
    q: params.get('q') || undefined,
    page,
    limit: 25,
  }
  const list = useApi(`payments:list:${JSON.stringify(filters)}`, () => paymentsApi.list(filters), { keepPrevious: true })
  const canRefund = hasRole('ADMIN')

  const rowActions = (p: Payment) => {
    const hasReceipt = p.status === 'PAID' || p.status === 'REFUNDED'
    if (!hasReceipt) return null
    return (
      <Menu
        label={`Actions for ${p.payment_number}`}
        trigger={({ toggle }) => (
          <IconButton
            icon={MoreHorizontal}
            label={`Actions for ${p.payment_number}`}
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation()
              toggle()
            }}
          />
        )}
        items={[
          { label: receipt.busy === p.id ? 'Preparing receipt…' : 'Download receipt', icon: Download, onSelect: () => receipt.download(p), disabled: receipt.busy === p.id },
          { label: 'Record refund', icon: RotateCcw, onSelect: () => setRefunding(p), hidden: !canRefund || p.status !== 'PAID', tone: 'danger' },
        ]}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <Segmented label="Date range" options={[...RANGES]} value={range} onChange={(v) => update({ range: v === 'month' ? null : v, page: 1 })} />
        <div className="flex flex-col gap-2 lg:flex-row">
          {range === 'custom' && (
            <div className="flex gap-2">
              <input type="date" value={from} max={to || todayISO()} onChange={(e) => update({ from: e.target.value, page: 1 })} aria-label="From date" className={cn(inputClasses, 'h-11 lg:w-40')} />
              <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => update({ to: e.target.value, page: 1 })} aria-label="To date" className={cn(inputClasses, 'h-11 lg:w-40')} />
            </div>
          )}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search payment no., UTR, member name or ID" aria-label="Search payments" className={cn(inputClasses, 'h-11 pl-10')} />
          </div>
          <div className="flex gap-2">
            <select value={status} onChange={(e) => update({ status: e.target.value || null, page: 1 })} aria-label="Status" className={cn(inputClasses, 'h-11 lg:w-36')}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select value={method} onChange={(e) => update({ method: e.target.value || null, page: 1 })} aria-label="Method" className={cn(inputClasses, 'h-11 lg:w-40')}>
              <option value="">All methods</option>
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Card className={cn('overflow-hidden transition-opacity', list.refreshing && list.data && 'opacity-70')} aria-busy={list.refreshing || undefined}>
        {list.data && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-subtle px-4 py-3 text-sm">
            <span className="text-muted">
              {list.data.total} payment{list.data.total === 1 ? '' : 's'}
            </span>
            <span className="text-muted">
              Received (net of refunds) <span className="tabular font-semibold text-ink">{formatMoney(list.data.paid_total ?? 0)}</span>
            </span>
          </div>
        )}
        {list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <DataList
            rows={list.data?.items}
            loading={list.loading}
            rowKey={(p) => p.id}
            onRowClick={onOpen}
            columns={[
              {
                key: 'number',
                header: 'Payment',
                cell: (p) => (
                  <span className="block whitespace-nowrap">
                    <span className="tabular block text-[13px] font-semibold text-ink">{p.payment_number}</span>
                    <span className="block text-[12px] text-muted">{formatDate(p.payment_date)}</span>
                  </span>
                ),
              },
              {
                key: 'member',
                header: 'Member',
                cell: (p) => (
                  <Link to={`/members/${p.member_id}`} className="block min-w-0" onClick={(e) => e.stopPropagation()}>
                    <span className="block truncate font-semibold text-ink hover:underline">{p.member_name}</span>
                    <span className="block text-[12px] text-muted">{p.member_code}</span>
                  </Link>
                ),
              },
              { key: 'plan', header: 'Plan', cell: (p) => p.plan_name ?? '—' },
              { key: 'method', header: 'Method', cell: (p) => METHOD_LABELS[p.payment_method] },
              { key: 'ref', header: 'Reference', className: 'hidden xl:table-cell', cell: (p) => <span className="tabular text-[13px]">{p.transaction_reference ?? '—'}</span> },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                cell: (p) => (
                  <span className="block">
                    <span className="tabular block font-semibold text-ink">{formatMoney(p.amount)}</span>
                    {p.refund && <span className="tabular block text-[12px] text-muted">−{formatMoney(p.refund.amount)} refunded</span>}
                  </span>
                ),
              },
              { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} size="sm" /> },
              { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: (p) => <div onClick={(e) => e.stopPropagation()}>{rowActions(p)}</div> },
            ]}
            mobile={(p) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{p.member_name}</p>
                  <p className="truncate text-[12px] text-muted">
                    {p.payment_number} · {METHOD_LABELS[p.payment_method]} · {formatDate(p.payment_date, { withYear: false })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular font-semibold text-ink">{formatMoney(p.amount)}</p>
                  <StatusBadge status={p.status} size="sm" />
                </div>
              </div>
            )}
            empty={<EmptyState icon={CalendarDays} title="No payments in this period" description="Try another date range or clear the filters." />}
          />
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line px-4">
            <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={(p) => update({ page: p })} />
          </div>
        )}
      </Card>
      <RefundDialog payment={refunding} onClose={() => setRefunding(null)} />
    </div>
  )
}

function PendingQueue() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const pending = useApi(`payments:pending:${page}`, () => paymentsApi.pending({ page, limit: 25 }), { keepPrevious: true })
  const [rejecting, setRejecting] = useState<Payment | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const approve = async (payment: Payment) => {
    setBusy(payment.id)
    try {
      const result = await paymentsApi.approve(payment.id)
      toast.success(result.already_processed ? 'Already approved' : 'Payment approved', {
        description: result.membership
          ? `${payment.member_name}'s ${result.membership.plan_name} runs ${formatDate(result.membership.start_date)} – ${formatDate(result.membership.end_date)}.`
          : undefined,
      })
      invalidate('payments', 'dashboard', 'members', 'memberships', 'notifications', `member:${payment.member_id}`)
    } catch (error) {
      toast.fromError(error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-info-200 bg-info-50 px-4 py-3 text-sm text-info-900 dark:border-info-500/20 dark:bg-info-500/10 dark:text-info-100">
        <p className="font-semibold">Check the bank or UPI app before approving</p>
        <p className="mt-0.5 text-[13px] opacity-90">
          Match each 12-digit UTR and amount with the gym’s statement. A membership starts only when you approve — never just because a UTR was submitted.
        </p>
      </div>
      <Card className={cn('overflow-hidden', pending.refreshing && pending.data && 'opacity-80')}>
        {pending.error && !pending.data ? (
          <ErrorState error={pending.error} onRetry={pending.reload} />
        ) : (
          <DataList
            rows={pending.data?.items}
            loading={pending.loading}
            rowKey={(p) => p.id}
            columns={[
              {
                key: 'member',
                header: 'Member',
                cell: (p) => (
                  <Link to={`/members/${p.member_id}`} className="block">
                    <span className="block font-semibold text-ink hover:underline">{p.member_name}</span>
                    <span className="block text-[12px] text-muted">
                      {p.member_code} · {p.plan_name ?? 'Payment'}
                    </span>
                  </Link>
                ),
              },
              { key: 'amount', header: 'Amount', align: 'right', cell: (p) => <span className="tabular font-semibold text-ink">{formatMoney(p.amount)}</span> },
              { key: 'utr', header: 'UTR', cell: (p) => <span className="tabular text-[15px] font-semibold tracking-wide text-ink">{p.transaction_reference}</span> },
              {
                key: 'date',
                header: 'Submitted',
                cell: (p) => (
                  <span className="block">
                    <span className="block" title={formatDateTime(p.created_at)}>
                      {relativeTime(p.created_at)}
                    </span>
                    <span className="tabular block text-[12px] text-muted">{p.payment_number}</span>
                  </span>
                ),
              },
              { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} size="sm" /> },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (p) => (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setRejecting(p)}>
                      Reject
                    </Button>
                    <Button size="sm" variant="success" icon={CheckCircle2} loading={busy === p.id} onClick={() => approve(p)}>
                      Approve
                    </Button>
                  </div>
                ),
              },
            ]}
            mobile={(p) => (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{p.member_name}</p>
                    <p className="text-[12px] text-muted">
                      {p.plan_name} · {relativeTime(p.created_at)}
                    </p>
                  </div>
                  <p className="tabular text-base font-bold text-ink">{formatMoney(p.amount)}</p>
                </div>
                <p className="rounded-lg bg-subtle px-3 py-2 text-sm">
                  UTR <span className="tabular font-semibold tracking-wide text-ink">{p.transaction_reference}</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" icon={XCircle} onClick={() => setRejecting(p)}>
                    Reject
                  </Button>
                  <Button variant="success" icon={CheckCircle2} loading={busy === p.id} onClick={() => approve(p)}>
                    Approve
                  </Button>
                </div>
              </div>
            )}
            empty={<EmptyState icon={BadgeCheck} title="All caught up" description="No UPI payments are waiting for verification." />}
          />
        )}
        {pending.data && pending.data.pages > 1 && (
          <div className="border-t border-line px-4">
            <Pagination page={page} pages={pending.data.pages} total={pending.data.total} limit={pending.data.limit} onPage={setPage} />
          </div>
        )}
      </Card>
      <RejectPaymentDialog payment={rejecting} onClose={() => setRejecting(null)} />
    </div>
  )
}

export default function PaymentsPage() {
  useDocumentTitle('Payments')
  const actions = useActions()
  const { hasRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'pending' ? 'pending' : 'history'
  const summary = useApi('payments:summary', () => paymentsApi.summary())
  const pendingCount = useApi('payments:pending:count', () => paymentsApi.pending({ limit: 1 }))
  const receipt = useReceipt()
  const [open, setOpen] = useState<Payment | null>(null)
  const [refunding, setRefunding] = useState<Payment | null>(null)

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Desk payments and Direct UPI — every rupee with its payment number"
        actions={
          <Button icon={Wallet} onClick={() => actions.collectPayment()}>
            Record payment
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today" icon={IndianRupee} tone="green" value={formatMoney(summary.data?.today)} loading={summary.loading && !summary.data} />
        <StatCard label="This week" icon={IndianRupee} value={formatMoney(summary.data?.week)} loading={summary.loading && !summary.data} />
        <StatCard
          label="This month"
          icon={IndianRupee}
          value={formatMoney(summary.data?.month)}
          hint={summary.data ? `${summary.data.month_count} payments${summary.data.month_refunds ? ` · ${formatMoney(summary.data.month_refunds)} refunded` : ''}` : undefined}
          loading={summary.loading && !summary.data}
        />
        <StatCard
          label="Awaiting verification"
          icon={Hourglass}
          tone="blue"
          value={pendingCount.data?.total ?? '—'}
          hint={pendingCount.data ? `${formatMoney(pendingCount.data.pending_amount ?? 0)} to check` : undefined}
          loading={pendingCount.loading && !pendingCount.data}
          to="/payments?tab=pending"
        />
      </div>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams()
          if (v === 'pending') next.set('tab', 'pending')
          setParams(next, { replace: true })
        }}
        items={[
          { value: 'history', label: 'All payments', icon: CalendarDays },
          { value: 'pending', label: 'Pending UPI', icon: Hourglass, badge: pendingCount.data?.total || undefined },
        ]}
      />
      {tab === 'history' ? <History onOpen={setOpen} /> : <PendingQueue />}
      <PaymentDetailDialog
        payment={open}
        onClose={() => setOpen(null)}
        receiptBusy={!!open && receipt.busy === open.id}
        onReceipt={receipt.download}
        onRefund={
          hasRole('ADMIN')
            ? (p) => {
                setOpen(null)
                setRefunding(p)
              }
            : undefined
        }
      />
      <RefundDialog payment={refunding} onClose={() => setRefunding(null)} />
    </div>
  )
}
