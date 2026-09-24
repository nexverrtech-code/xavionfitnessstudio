import { Pencil, Plus, Power, Tags, Users } from 'lucide-react'
import { useState } from 'react'
import { PlanDialog } from '@/components/billing/PlanDialog'
import { Pill, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { PageHeader, Segmented } from '@/components/ui/Navigation'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { plansApi } from '@/services/endpoints'
import type { Plan } from '@/types'
import { cn } from '@/utils/cn'
import { formatMoney, perMonthPaise, planDurationLabel } from '@/utils/format'

type Filter = 'ACTIVE' | 'INACTIVE' | 'ALL'

/** Admin-defined plans (Monthly, Quarterly, Half Yearly, Yearly or custom). Plans are never
 *  deleted — an unused plan is deactivated so past memberships keep their history. */
export default function MembershipPlansPage() {
  useDocumentTitle('Membership Plans')
  const toast = useToast()
  const plans = useApi('plans:all:stats', () => plansApi.list({ include_inactive: true, stats: true }))
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined)
  const [toggling, setToggling] = useState<Plan | null>(null)
  const [filter, setFilter] = useState<Filter>('ACTIVE')
  const all = plans.data?.items ?? []
  const shown = all.filter((p) => filter === 'ALL' || p.status === filter)

  const toggle = async () => {
    if (!toggling) return
    const next = toggling.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    try {
      await plansApi.update(toggling.id, {
        name: toggling.name,
        duration_days: toggling.duration_days,
        price: toggling.price,
        description: toggling.description,
        status: next,
      })
      invalidate('plans')
      toast.success(next === 'ACTIVE' ? `${toggling.name} is available again` : `${toggling.name} deactivated`)
    } catch (error) {
      toast.fromError(error)
      throw error
    }
  }

  return (
    <div>
      <PageHeader
        title="Membership Plans"
        description="Plans members can buy. Changing a price affects new payments only."
        actions={
          <Button icon={Plus} onClick={() => setEditing(null)}>
            New plan
          </Button>
        }
      />
      <Segmented
        className="mb-4"
        label="Show plans"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'ACTIVE', label: 'Active', count: all.filter((p) => p.status === 'ACTIVE').length },
          { value: 'INACTIVE', label: 'Inactive', count: all.filter((p) => p.status === 'INACTIVE').length },
          { value: 'ALL', label: 'All', count: all.length },
        ]}
      />
      {plans.error && !plans.data ? (
        <Card>
          <ErrorState error={plans.error} onRetry={plans.reload} />
        </Card>
      ) : plans.loading && !plans.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading plans">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : !shown.length ? (
        <Card>
          <EmptyState
            icon={Tags}
            title={all.length ? 'No plans here' : 'No plans yet'}
            description={
              all.length
                ? 'Try another filter.'
                : 'Create your membership plans — for example Monthly (30 days), Quarterly (90 days), Half Yearly (180 days) or Yearly (365 days).'
            }
            action={
              !all.length && (
                <Button icon={Plus} onClick={() => setEditing(null)}>
                  New plan
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((plan) => {
            const monthly = perMonthPaise(plan.price, plan.duration_days)
            return (
              <Card key={plan.id} className={cn('flex flex-col p-5', plan.status === 'INACTIVE' && 'bg-subtle')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-ink">{plan.name}</p>
                    <p className="text-[13px] text-muted">
                      {planDurationLabel(plan.duration_days)} · {plan.duration_days} days
                    </p>
                  </div>
                  <StatusBadge status={plan.status} size="sm" />
                </div>
                <p className="mt-4 text-3xl font-bold tracking-tight text-ink">{formatMoney(plan.price)}</p>
                {monthly !== null && <p className="text-[13px] text-muted">≈ {formatMoney(monthly)} / month</p>}
                {plan.description && <p className="mt-3 line-clamp-3 text-sm text-ink-2">{plan.description}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                  <Pill icon={Users} tone="slate">
                    {plan.active_members} active member{plan.active_members === 1 ? '' : 's'}
                  </Pill>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                  <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(plan)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={Power} onClick={() => setToggling(plan)}>
                    {plan.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <PlanDialog open={editing !== undefined} onClose={() => setEditing(undefined)} plan={editing ?? null} />
      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        onConfirm={toggle}
        tone={toggling?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={toggling?.status === 'ACTIVE' ? `Deactivate ${toggling?.name}?` : `Activate ${toggling?.name}?`}
        confirmLabel={toggling?.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
        message={
          toggling?.status === 'ACTIVE'
            ? 'Members can no longer buy this plan. Current memberships on it continue until they end.'
            : 'The plan becomes available for new payments and renewals again.'
        }
      />
    </div>
  )
}
