import { MoreVertical, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ExpenseDialog } from '@/components/operations/ExpenseDialog'
import { Pill } from '@/components/ui/Badge'
import { BarList } from '@/components/ui/BarList'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader, StatCard } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { PageHeader, Pagination, Segmented } from '@/components/ui/Navigation'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { expensesApi } from '@/services/endpoints'
import type { Expense } from '@/types'
import { cn } from '@/utils/cn'
import { addDaysISO, CATEGORY_LABELS, formatDate, formatMoney, todayISO } from '@/utils/format'

type Period = 'month' | 'last' | 'quarter' | 'custom'

function periodRange(period: Period, from: string, to: string): [string, string] {
  const today = todayISO()
  const monthStart = `${today.slice(0, 7)}-01`
  if (period === 'month') return [monthStart, today]
  if (period === 'last') {
    const lastEnd = addDaysISO(monthStart, -1)
    return [`${lastEnd.slice(0, 7)}-01`, lastEnd]
  }
  if (period === 'quarter') return [addDaysISO(today, -89), today]
  return [from || monthStart, to || today]
}

export default function ExpensesPage() {
  useDocumentTitle('Expenses')
  const toast = useToast()
  const [period, setPeriod] = useState<Period>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Expense | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [start, end] = periodRange(period, from, to)
  const params = { from: start, to: end, category: category || undefined, page, limit: 25 }
  const list = useApi(`expenses:${JSON.stringify(params)}`, () => expensesApi.list(params), { keepPrevious: true })
  const data = list.data

  return (
    <div>
      <PageHeader
        title="Expenses"
        description={`${formatDate(start)} – ${formatDate(end)}`}
        actions={
          <Button icon={Plus} onClick={() => setEditing(null)}>
            Add expense
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          label="Period"
          value={period}
          onChange={(v) => (setPeriod(v), setPage(1))}
          options={[
            { value: 'month', label: 'This month' },
            { value: 'last', label: 'Last month' },
            { value: 'quarter', label: 'Last 90 days' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {period === 'custom' && (
            <>
              <input type="date" value={from} max={to || todayISO()} onChange={(e) => (setFrom(e.target.value), setPage(1))} aria-label="From date" className={cn(inputClasses, 'h-10 w-40')} />
              <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => (setTo(e.target.value), setPage(1))} aria-label="To date" className={cn(inputClasses, 'h-10 w-40')} />
            </>
          )}
          <select value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))} aria-label="Category" className={cn(inputClasses, 'h-10 w-40')}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <StatCard label="Total expenses" icon={Receipt} tone="red" value={formatMoney(data?.total_amount)} hint={data ? `${data.total} entries` : undefined} loading={list.loading && !data} />
        <Card className="lg:col-span-2">
          <CardHeader title="By category" />
          <div className="px-5 pb-5">
            <BarList
              items={(data?.by_category ?? []).map((c) => ({ key: c.category, label: CATEGORY_LABELS[c.category], value: c.total, display: formatMoney(c.total) }))}
              empty="No expenses in this period."
            />
          </div>
        </Card>
      </div>

      <Card className={cn('overflow-hidden', list.refreshing && data && 'opacity-80')}>
        {list.error && !data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <DataList
            rows={data?.items}
            loading={list.loading}
            rowKey={(e) => e.id}
            columns={[
              { key: 'date', header: 'Date', cell: (e) => <span className="whitespace-nowrap">{formatDate(e.expense_date)}</span> },
              { key: 'category', header: 'Category', cell: (e) => <Pill tone="slate">{CATEGORY_LABELS[e.category]}</Pill> },
              { key: 'description', header: 'Description', cell: (e) => e.description ?? <span className="text-faint">—</span> },
              { key: 'by', header: 'Recorded by', className: 'hidden xl:table-cell', cell: (e) => e.created_by_name ?? '—' },
              { key: 'amount', header: 'Amount', align: 'right', cell: (e) => <span className="tabular font-semibold text-ink">{formatMoney(e.amount)}</span> },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (e) => (
                  <Menu
                    label="Expense actions"
                    trigger={({ toggle }) => <IconButton icon={MoreVertical} label="Expense actions" size="icon-sm" onClick={toggle} />}
                    items={[
                      { label: 'Edit', icon: Pencil, onSelect: () => setEditing(e) },
                      { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setDeleting(e) },
                    ]}
                  />
                ),
              },
            ]}
            mobile={(e) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{e.description ?? CATEGORY_LABELS[e.category]}</p>
                  <p className="text-[12px] text-muted">
                    {CATEGORY_LABELS[e.category]} · {formatDate(e.expense_date)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="tabular font-semibold text-ink">{formatMoney(e.amount)}</span>
                  <IconButton icon={Pencil} label="Edit expense" size="icon-sm" onClick={() => setEditing(e)} />
                </div>
              </div>
            )}
            empty={
              <EmptyState
                icon={Receipt}
                title="No expenses in this period"
                description="Record rent, electricity, salaries and more to see your net revenue."
                action={
                  <Button icon={Plus} onClick={() => setEditing(null)}>
                    Add expense
                  </Button>
                }
              />
            }
          />
        )}
        {data && data.total > 0 && (
          <div className="border-t border-line px-4">
            <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={setPage} />
          </div>
        )}
      </Card>
      <ExpenseDialog open={editing !== undefined} onClose={() => setEditing(undefined)} expense={editing ?? null} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this expense?"
        message={deleting ? `${CATEGORY_LABELS[deleting.category]} · ${formatMoney(deleting.amount)} on ${formatDate(deleting.expense_date)}` : ''}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await expensesApi.remove(deleting!.id)
            invalidate('expenses', 'dashboard')
            toast.success('Expense deleted')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
    </div>
  )
}
