import { LineChart, Ruler } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PickMemberDialog } from '@/components/members/PickMemberDialog'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Menu'
import { PageHeader, Pagination } from '@/components/ui/Navigation'
import { useActions } from '@/contexts/ActionsContext'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { progressApi } from '@/services/endpoints'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/format'

const fmt = (value: number | null | undefined, unit: string) => (value === null || value === undefined ? '—' : `${value} ${unit}`)

export default function ProgressPage() {
  useDocumentTitle('Progress')
  const actions = useActions()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [picking, setPicking] = useState(false)
  const list = useApi(`progress:recent:${page}`, () => progressApi.recent({ page, limit: 20 }), { keepPrevious: true })
  return (
    <div>
      <PageHeader
        title="Progress"
        description="Latest body measurements across your members"
        actions={
          <Button icon={Ruler} onClick={() => setPicking(true)}>
            Add measurement
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
            rowKey={(m) => m.id}
            onRowClick={(m) => navigate(`/members/${m.member_id}?tab=progress`)}
            columns={[
              {
                key: 'member',
                header: 'Member',
                cell: (m) => (
                  <Link to={`/members/${m.member_id}?tab=progress`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2.5">
                    <Avatar name={m.member_name ?? '?'} size="sm" />
                    <span>
                      <span className="block font-semibold text-ink hover:underline">{m.member_name}</span>
                      <span className="block text-[12px] text-muted">{m.member_code}</span>
                    </span>
                  </Link>
                ),
              },
              { key: 'date', header: 'Date', cell: (m) => formatDate(m.date) },
              { key: 'weight', header: 'Weight', align: 'right', cell: (m) => <span className="tabular">{fmt(m.weight, 'kg')}</span> },
              { key: 'fat', header: 'Body fat', align: 'right', cell: (m) => <span className="tabular">{fmt(m.body_fat, '%')}</span> },
              { key: 'waist', header: 'Waist', align: 'right', cell: (m) => <span className="tabular">{fmt(m.waist, 'cm')}</span> },
              { key: 'chest', header: 'Chest', align: 'right', className: 'hidden xl:table-cell', cell: (m) => <span className="tabular">{fmt(m.chest, 'cm')}</span> },
              { key: 'arm', header: 'Arm', align: 'right', className: 'hidden xl:table-cell', cell: (m) => <span className="tabular">{fmt(m.arm, 'cm')}</span> },
            ]}
            mobile={(m) => (
              <div className="flex items-center gap-3">
                <Avatar name={m.member_name ?? '?'} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{m.member_name}</p>
                  <p className="text-[12px] text-muted">{formatDate(m.date)}</p>
                </div>
                <span className="tabular text-sm font-semibold text-ink">{fmt(m.weight, 'kg')}</span>
              </div>
            )}
            empty={
              <EmptyState
                icon={LineChart}
                title="No measurements yet"
                description="Record weight, body fat and measurements to track member progress."
                action={
                  <Button icon={Ruler} onClick={() => setPicking(true)}>
                    Add measurement
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
      <PickMemberDialog open={picking} onClose={() => setPicking(false)} title="Add measurement for…" actionLabel="Continue" onPick={(m) => actions.addMeasurement({ id: m.id, name: m.name })} />
    </div>
  )
}
