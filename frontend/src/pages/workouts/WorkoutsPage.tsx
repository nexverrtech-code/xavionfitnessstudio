import { Dumbbell, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PickMemberDialog } from '@/components/members/PickMemberDialog'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Menu'
import { PageHeader, Pagination } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { workoutsApi } from '@/services/endpoints'
import { cn } from '@/utils/cn'
import { relativeTime } from '@/utils/format'

export default function WorkoutsPage() {
  useDocumentTitle('Workouts')
  const { user } = useAuth()
  const actions = useActions()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [picking, setPicking] = useState(false)
  const list = useApi(`workouts:recent:${page}`, () => workoutsApi.recent({ page, limit: 20 }), { keepPrevious: true })
  return (
    <div>
      <PageHeader
        title="Workouts"
        description={user?.role === 'TRAINER' ? 'Plans for your assigned members' : 'Workout plans across all members'}
        actions={
          <Button icon={Plus} onClick={() => setPicking(true)}>
            Create workout
          </Button>
        }
      />
      <Card className={cn('overflow-hidden', list.refreshing && list.data && 'opacity-80')}>
        {list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <DataList
            rows={list.data?.items}
            loading={list.loading}
            rowKey={(w) => w.id}
            onRowClick={(w) => navigate(`/members/${w.member_id}?tab=workout`)}
            columns={[
              { key: 'title', header: 'Workout', cell: (w) => <span className="font-semibold text-ink">{w.title}</span> },
              {
                key: 'member',
                header: 'Member',
                cell: (w) => (
                  <Link to={`/members/${w.member_id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2.5">
                    <Avatar name={w.member_name} size="sm" />
                    <span>
                      <span className="block text-ink hover:underline">{w.member_name}</span>
                      <span className="block text-[12px] text-muted">{w.member_code}</span>
                    </span>
                  </Link>
                ),
              },
              { key: 'day', header: 'Day', cell: (w) => w.day_label ?? '—' },
              { key: 'count', header: 'Exercises', align: 'right', cell: (w) => <span className="tabular">{w.exercise_count}</span> },
              { key: 'trainer', header: 'Trainer', cell: (w) => w.trainer_name ?? '—' },
              { key: 'updated', header: 'Updated', cell: (w) => relativeTime(w.updated_at) },
              { key: 'status', header: 'Status', cell: (w) => <StatusBadge status={w.status} size="sm" /> },
            ]}
            mobile={(w) => (
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300">
                  <Dumbbell className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{w.title}</p>
                  <p className="truncate text-[12px] text-muted">
                    {w.member_name} · {w.exercise_count} exercises
                  </p>
                </div>
                <StatusBadge status={w.status} size="sm" />
              </div>
            )}
            empty={
              <EmptyState
                icon={Dumbbell}
                title="No workout plans yet"
                description="Create a plan for a member — templates make it a one-minute job."
                action={
                  <Button icon={Plus} onClick={() => setPicking(true)}>
                    Create workout
                  </Button>
                }
              />
            }
          />
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line px-4">
            <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={setPage} />
          </div>
        )}
      </Card>
      <PickMemberDialog open={picking} onClose={() => setPicking(false)} title="Create workout for…" actionLabel="Continue" onPick={(m) => actions.createWorkout({ id: m.id, name: m.name })} />
    </div>
  )
}
