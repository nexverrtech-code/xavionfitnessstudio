import { CalendarCheck2, Eye, MoreVertical, RefreshCw, Search, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { StatusBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataList, type Column } from '@/components/ui/DataList'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { Avatar, Menu } from '@/components/ui/Menu'
import { PageHeader, Pagination, Segmented } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { useDebounce, useDocumentTitle } from '@/hooks/useUtilities'
import { membersApi, trainersApi } from '@/services/endpoints'
import type { MemberListItem } from '@/types'
import { cn } from '@/utils/cn'
import { daysLeftLabel, formatDate, formatNumber } from '@/utils/format'
import { KEYS, readStorage, writeStorage } from '@/utils/storage'

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRING', label: 'Expiring' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'INACTIVE', label: 'Inactive' },
] as const

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'code', label: 'Member ID' },
]

export default function MembersPage() {
  useDocumentTitle('Members')
  const { user } = useAuth()
  const actions = useActions()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const staff = user?.role === 'ADMIN' || user?.role === 'STAFF'
  const rawStatus = params.get('status') ?? 'ALL'
  const status = STATUS_OPTIONS.some((o) => o.value === rawStatus) ? rawStatus : 'ALL'
  const rawSort = params.get('sort') ?? 'newest'
  const sort = SORTS.some((o) => o.value === rawSort) ? rawSort : 'newest'
  const trainer = params.get('trainer') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? 1))
  const limit = Number(params.get('limit') ?? readStorage(KEYS.pageSize) ?? 20)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const debounced = useDebounce(query.trim(), 300)

  const update = (changes: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || (key === 'status' && value === 'ALL') || (key === 'page' && value === 1)) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) update({ q: debounced || null, page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const query_ = { q: params.get('q') ?? undefined, status: status === 'ALL' ? undefined : status, sort, trainer_id: trainer || undefined, page, limit }
  const key = `members:list:${JSON.stringify(query_)}`
  const list = useApi(key, () => membersApi.list(query_), { keepPrevious: true })
  const trainers = useApi(staff ? 'trainers:active' : null, () => trainersApi.list('ACTIVE'))

  const filtered = !!(params.get('q') || status !== 'ALL' || trainer)
  const columns: Column<MemberListItem>[] = [
    {
      key: 'member',
      header: 'Member',
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={m.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{m.name}</p>
            <p className="truncate text-[12px] text-muted">
              <span className="tabular font-semibold text-ink-2 xl:hidden">{m.member_code} · </span>
              {m.email ?? `Joined ${formatDate(m.joining_date)}`}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'code', header: 'Member ID', className: 'hidden xl:table-cell', cell: (m) => <span className="tabular whitespace-nowrap text-[13px] font-semibold text-ink-2">{m.member_code}</span> },
    { key: 'phone', header: 'Phone', cell: (m) => <span className="tabular whitespace-nowrap">{m.phone}</span> },
    {
      key: 'membership',
      header: 'Membership',
      cell: (m) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={m.membership.status} size="sm" />
          {m.membership.plan_name && <span className="text-[12px] text-muted">{m.membership.plan_name}</span>}
        </div>
      ),
    },
    {
      key: 'expiry',
      header: 'Expiry',
      cell: (m) =>
        m.membership.expiry_date ? (
          <div>
            <p className="tabular whitespace-nowrap text-ink">{formatDate(m.membership.expiry_date)}</p>
            <p className={cn('whitespace-nowrap text-[12px]', (m.membership.days_left ?? 0) < 0 ? 'text-danger-600 dark:text-danger-400' : (m.membership.days_left ?? 99) <= 7 ? 'text-warning-700 dark:text-warning-400' : 'text-muted')}>
              {daysLeftLabel(m.membership.days_left)}
            </p>
          </div>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    { key: 'trainer', header: 'Trainer', className: 'hidden xl:table-cell', cell: (m) => m.trainer?.name ?? <span className="text-faint">—</span> },
    { key: 'status', header: 'Status', cell: (m) => <StatusBadge status={m.status} size="sm" /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (m) => (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Menu
            label={`Actions for ${m.name}`}
            trigger={({ toggle }) => <IconButton icon={MoreVertical} label={`Actions for ${m.name}`} size="icon-sm" onClick={toggle} />}
            items={[
              { label: 'Open workspace', icon: Eye, onSelect: () => navigate(`/members/${m.id}`) },
              { label: m.membership.expiry_date ? 'Renew membership' : 'Add membership', icon: RefreshCw, onSelect: () => actions.collectPayment({ memberId: m.id }), hidden: !staff },
              { label: 'Mark attendance', icon: CalendarCheck2, onSelect: () => void actions.markAttendance({ id: m.id, name: m.name }) },
            ]}
          />
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Members"
        description={list.data ? `${formatNumber(list.data.total)} ${filtered ? 'matching' : 'total'} members` : user?.role === 'TRAINER' ? 'Your assigned members' : 'Everyone registered at your gym'}
        actions={
          staff && (
            <Button icon={UserPlus} onClick={actions.addMember}>
              Add Member
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, member ID or email"
              aria-label="Search members"
              className={cn(inputClasses, 'h-11 pl-10 pr-10')}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:bg-hover" aria-label="Clear search">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {staff && (
              <select
                value={trainer}
                onChange={(event) => update({ trainer: event.target.value || null, page: 1 })}
                aria-label="Filter by trainer"
                className={cn(inputClasses, 'h-11 w-full sm:w-44')}
              >
                <option value="">All trainers</option>
                {(trainers.data?.items ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <select value={sort} onChange={(event) => update({ sort: event.target.value, page: 1 })} aria-label="Sort members" className={cn(inputClasses, 'h-11 w-full sm:w-40')}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Segmented label="Membership status" options={[...STATUS_OPTIONS]} value={status as (typeof STATUS_OPTIONS)[number]['value']} onChange={(value) => update({ status: value, page: 1 })} />
      </div>

      <Card className={cn('overflow-hidden transition-opacity', list.refreshing && list.data && 'opacity-70')}>
        {list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <DataList
            rows={list.data?.items}
            loading={list.loading}
            columns={columns}
            rowKey={(m) => m.id}
            onRowClick={(m) => navigate(`/members/${m.id}`)}
            mobile={(m) => (
              <div className="flex items-center gap-3">
                <Avatar name={m.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{m.name}</p>
                  <p className="truncate text-[13px] text-muted">
                    {m.member_code} · {m.phone}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-muted">{m.membership.expiry_date ? `${m.membership.plan_name ?? 'Plan'} · ${daysLeftLabel(m.membership.days_left)}` : 'No membership yet'}</p>
                </div>
                <StatusBadge status={m.status === 'ACTIVE' ? m.membership.status : m.status} size="sm" />
              </div>
            )}
            empty={
              filtered ? (
                <EmptyState
                  icon={Search}
                  title="No members match your filters"
                  description="Try a different name, phone number or member ID, or clear the filters."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery('')
                        setParams(new URLSearchParams(), { replace: true })
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title={user?.role === 'TRAINER' ? 'No members assigned yet' : 'No members yet'}
                  description={user?.role === 'TRAINER' ? 'Members assigned to you by the front desk will appear here.' : 'Add your first member to start tracking memberships, payments and attendance.'}
                  action={
                    staff && (
                      <Button icon={UserPlus} onClick={actions.addMember}>
                        Add Member
                      </Button>
                    )
                  }
                />
              )
            }
          />
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line px-4">
            <Pagination
              page={list.data.page}
              pages={list.data.pages}
              total={list.data.total}
              limit={list.data.limit}
              onPage={(p) => update({ page: p })}
              onLimit={(l) => {
                writeStorage(KEYS.pageSize, String(l))
                update({ limit: l, page: 1 })
              }}
            />
          </div>
        )}
      </Card>
    </div>
  )
}
