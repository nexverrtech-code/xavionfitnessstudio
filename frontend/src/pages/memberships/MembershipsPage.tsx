import { Ban, BellRing, CalendarClock, ClipboardList, Phone, RefreshCw, Tags } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { StatusBadge } from '@/components/ui/Badge'
import { Button, ButtonLink, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Menu'
import { PageHeader, Pagination, Segmented, Tabs } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { membershipsApi, plansApi } from '@/services/endpoints'
import type { Membership, Plan } from '@/types'
import { cn } from '@/utils/cn'
import { daysLeftLabel, formatDate, formatMoney } from '@/utils/format'

function RenewalsTab() {
  const actions = useActions()
  const { hasRole } = useAuth()
  const admin = hasRole('ADMIN')
  const [windowKind, setWindowKind] = useState<'upcoming' | 'expired'>('upcoming')
  const [page, setPage] = useState(1)
  const renewals = useApi(`memberships:renewals:${windowKind}:${page}`, () => membershipsApi.renewals({ window: windowKind, page, limit: 20 }), { keepPrevious: true })
  return (
    <div className="space-y-4">
      <Segmented
        label="Renewal window"
        value={windowKind}
        onChange={(v) => {
          setWindowKind(v)
          setPage(1)
        }}
        options={[
          { value: 'upcoming', label: 'Expiring in 7 days' },
          { value: 'expired', label: 'Expired in last 30 days' },
        ]}
      />
      <Card className={cn('overflow-hidden', renewals.refreshing && renewals.data && 'opacity-80')}>
        {renewals.error && !renewals.data ? (
          <ErrorState error={renewals.error} onRetry={renewals.reload} />
        ) : (
          <DataList
            rows={renewals.data?.items}
            loading={renewals.loading}
            rowKey={(r) => r.member_id}
            columns={[
              {
                key: 'member',
                header: 'Member',
                cell: (r) => (
                  <Link to={`/members/${r.member_id}`} className="flex items-center gap-3">
                    <Avatar name={r.name} size="sm" />
                    <span>
                      <span className="block font-semibold text-ink hover:underline">{r.name}</span>
                      <span className="block text-[12px] text-muted">{r.member_code}</span>
                    </span>
                  </Link>
                ),
              },
              {
                key: 'phone',
                header: 'Phone',
                cell: (r) => (
                  <a href={`tel:${r.phone}`} className="tabular inline-flex items-center gap-1.5 hover:text-ink">
                    <Phone className="size-3.5" aria-hidden />
                    {r.phone}
                  </a>
                ),
              },
              { key: 'plan', header: 'Plan', cell: (r) => r.plan_name ?? '—' },
              {
                key: 'expiry',
                header: 'Expiry',
                cell: (r) => (
                  <span className="whitespace-nowrap">
                    {formatDate(r.expiry_date)} <span className="text-muted">· {daysLeftLabel(r.days_left)}</span>
                  </span>
                ),
              },
              { key: 'status', header: 'Status', cell: (r) => (r.has_pending_payment ? <StatusBadge status="PENDING" size="sm" label="Payment pending" /> : <StatusBadge status={r.status} size="sm" />) },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (r) => (
                  <div className="flex justify-end gap-2">
                    {admin && (
                      <IconButton icon={BellRing} label={`Message ${r.name}`} size="icon-sm" variant="secondary" onClick={() => actions.sendNotification({ id: r.member_id, name: r.name })} />
                    )}
                    <Button size="sm" icon={RefreshCw} onClick={() => actions.collectPayment({ memberId: r.member_id, planId: r.plan_id })} disabled={r.has_pending_payment}>
                      Renew
                    </Button>
                  </div>
                ),
              },
            ]}
            mobile={(r) => (
              <div className="flex items-center gap-3">
                <Avatar name={r.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{r.name}</p>
                  <p className="truncate text-[12px] text-muted">
                    {r.plan_name} · {daysLeftLabel(r.days_left)}
                  </p>
                </div>
                <Button size="sm" icon={RefreshCw} onClick={() => actions.collectPayment({ memberId: r.member_id, planId: r.plan_id })} disabled={r.has_pending_payment}>
                  Renew
                </Button>
              </div>
            )}
            empty={
              <EmptyState
                icon={CalendarClock}
                title={windowKind === 'upcoming' ? 'No expiring memberships.' : 'No recently expired memberships.'}
                description={windowKind === 'upcoming' ? 'There are no memberships expiring within the selected period.' : 'Everyone who expired in the last 30 days has renewed.'}
                action={
                  <Link to="/members?status=ACTIVE" className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-card hover:bg-hover">
                    View Active Members
                  </Link>
                }
              />
            }
          />
        )}
        {renewals.data && renewals.data.pages > 1 && (
          <div className="border-t border-line px-4">
            <Pagination page={page} pages={renewals.data.pages} total={renewals.data.total} limit={renewals.data.limit} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  )
}

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRING', label: 'Expiring' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

function AllMembershipsTab({ plans, admin }: { plans: Plan[]; admin: boolean }) {
  const toast = useToast()
  const [cancelling, setCancelling] = useState<Membership | null>(null)
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]['value']>('ALL')
  const [planId, setPlanId] = useState('')
  const [page, setPage] = useState(1)
  const params = { status: status === 'ALL' ? undefined : status, plan_id: planId || undefined, page, limit: 20 }
  const list = useApi(`memberships:list:${JSON.stringify(params)}`, () => membershipsApi.list(params), { keepPrevious: true })
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented label="Status" options={[...STATUS_FILTERS]} value={status} onChange={(v) => (setStatus(v), setPage(1))} />
        <select value={planId} onChange={(e) => (setPlanId(e.target.value), setPage(1))} aria-label="Plan" className={cn(inputClasses, 'h-10 lg:w-48')}>
          <option value="">All plans</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <Card className={cn('overflow-hidden', list.refreshing && list.data && 'opacity-80')}>
        {list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <DataList
            rows={list.data?.items}
            loading={list.loading}
            rowKey={(m) => m.id}
            columns={[
              {
                key: 'member',
                header: 'Member',
                cell: (m) => (
                  <Link to={`/members/${m.member_id}`}>
                    <span className="block font-semibold text-ink hover:underline">{m.member_name}</span>
                    <span className="block text-[12px] text-muted">{m.member_code}</span>
                  </Link>
                ),
              },
              { key: 'plan', header: 'Plan', cell: (m) => m.plan_name },
              { key: 'start', header: 'Start', cell: (m) => <span className="whitespace-nowrap">{m.start_date ? formatDate(m.start_date) : '—'}</span> },
              { key: 'end', header: 'End', cell: (m) => <span className="whitespace-nowrap">{m.end_date ? formatDate(m.end_date) : '—'}</span> },
              { key: 'amount', header: 'Paid', align: 'right', cell: (m) => <span className="tabular">{formatMoney(m.amount)}</span> },
              { key: 'status', header: 'Status', cell: (m) => <StatusBadge status={m.status} size="sm" /> },
              ...(admin
                ? [
                    {
                      key: 'actions',
                      header: <span className="sr-only">Actions</span>,
                      align: 'right' as const,
                      cell: (m: Membership) =>
                        m.status !== 'CANCELLED' && m.status !== 'EXPIRED' ? (
                          <IconButton icon={Ban} label={`Cancel ${m.member_name}'s ${m.plan_name}`} size="icon-sm" onClick={() => setCancelling(m)} />
                        ) : null,
                    },
                  ]
                : []),
            ]}
            mobile={(m) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{m.member_name}</p>
                  <p className="truncate text-[12px] text-muted">
                    {m.plan_name} · {formatDate(m.start_date, { withYear: false })} → {formatDate(m.end_date)}
                  </p>
                </div>
                <StatusBadge status={m.status} size="sm" />
              </div>
            )}
            empty={<EmptyState icon={ClipboardList} title="No memberships found" description="Try a different status or plan filter." />}
          />
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line px-4">
            <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={setPage} />
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Cancel this membership?"
        confirmLabel="Cancel membership"
        message={
          cancelling && (
            <>
              <p>
                {cancelling.member_name}’s {cancelling.plan_name} ({formatDate(cancelling.start_date)} → {formatDate(cancelling.end_date)}) will be cancelled and
                their status recalculated. The payment stays on record.
              </p>
              <p className="mt-2 text-muted">To return money as well, record a refund on the payment instead.</p>
            </>
          )
        }
        onConfirm={async () => {
          if (!cancelling) return
          try {
            await membershipsApi.cancel(cancelling.id)
            invalidate('memberships', 'members', 'dashboard', `member:${cancelling.member_id}`)
            toast.success('Membership cancelled')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
    </div>
  )
}

export default function MembershipsPage() {
  useDocumentTitle('Memberships')
  const { user } = useAuth()
  const admin = user?.role === 'ADMIN'
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'all' ? 'all' : 'renewals'
  const plans = useApi('plans:all', () => plansApi.list({ include_inactive: true }))
  return (
    <div>
      <PageHeader
        title="Memberships"
        description="Renewals due and every membership, created only from confirmed payments"
        actions={
          admin && (
            <ButtonLink to="/membership-plans" icon={Tags}>
              Membership plans
            </ButtonLink>
          )
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => setParams(v === 'renewals' ? {} : { tab: v }, { replace: true })}
        items={[
          { value: 'renewals', label: 'Renewals due', icon: CalendarClock },
          { value: 'all', label: 'All memberships', icon: ClipboardList },
        ]}
      />
      {tab === 'renewals' ? <RenewalsTab /> : <AllMembershipsTab plans={plans.data?.items ?? []} admin={admin} />}
    </div>
  )
}
