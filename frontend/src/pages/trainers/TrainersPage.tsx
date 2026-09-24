import { CircleCheck, KeyRound, Mail, MoreVertical, Pencil, Phone, Plus, UserCog, UserX, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { TrainerDialog } from '@/components/trainers/TrainerDialog'
import { useTrainerActions } from '@/components/trainers/useTrainerActions'
import { Pill, StatusBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { Avatar, Menu } from '@/components/ui/Menu'
import { PageHeader, Segmented } from '@/components/ui/Navigation'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { trainersApi } from '@/services/endpoints'
import type { Trainer } from '@/types'
import { cn } from '@/utils/cn'

export default function TrainersPage() {
  useDocumentTitle('Trainers')
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE')
  const trainers = useApi(`trainers:list:${status}`, () => trainersApi.list(status === 'ALL' ? undefined : status))
  const [editing, setEditing] = useState<Trainer | null | undefined>(undefined)
  const actions = useTrainerActions()
  const items = trainers.data?.items ?? []

  return (
    <div>
      <PageHeader
        title="Trainers"
        description="Your coaching team and the members they look after"
        actions={
          <Button icon={Plus} onClick={() => setEditing(null)}>
            Add trainer
          </Button>
        }
      />
      <Segmented
        className="mb-4"
        label="Trainer status"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'ACTIVE', label: 'Active' },
          { value: 'INACTIVE', label: 'Inactive' },
          { value: 'ALL', label: 'All' },
        ]}
      />
      {trainers.loading && !trainers.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : trainers.error ? (
        <Card>
          <ErrorState error={trainers.error} onRetry={trainers.reload} />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={UserCog}
            title={status === 'INACTIVE' ? 'No inactive trainers' : 'No trainers yet'}
            description="Add trainers to assign members, build workouts and track progress."
            action={
              <Button icon={Plus} onClick={() => setEditing(null)}>
                Add trainer
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((trainer) => (
            <Card key={trainer.id} className={cn('flex flex-col p-5', trainer.status === 'INACTIVE' && 'opacity-75')}>
              <div className="flex items-start gap-3">
                <Avatar name={trainer.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <Link to={`/trainers/${trainer.id}`} className="block truncate text-[15px] font-semibold text-ink hover:underline">
                    {trainer.name}
                  </Link>
                  <p className="truncate text-[13px] text-muted">{trainer.specialization ?? 'Trainer'}</p>
                </div>
                <Menu
                  label={`Actions for ${trainer.name}`}
                  trigger={({ toggle }) => <IconButton icon={MoreVertical} label="Trainer actions" size="icon-sm" onClick={toggle} />}
                  items={[
                    { label: 'Edit', icon: Pencil, onSelect: () => setEditing(trainer) },
                    { label: trainer.has_login ? 'Reset login password' : 'Create login', icon: KeyRound, onSelect: () => actions.createLogin(trainer), hidden: trainer.status !== 'ACTIVE' },
                    'divider',
                    trainer.status === 'ACTIVE'
                      ? { label: 'Deactivate', icon: UserX, tone: 'danger', onSelect: () => actions.toggle(trainer) }
                      : { label: 'Activate', icon: CircleCheck, onSelect: () => actions.toggle(trainer) },
                  ]}
                />
              </div>
              <div className="mt-4 space-y-1.5 text-sm text-ink-2">
                <a href={`tel:${trainer.phone}`} className="flex items-center gap-2 hover:text-ink">
                  <Phone className="size-4 text-muted" aria-hidden />
                  <span className="tabular">{trainer.phone}</span>
                </a>
                {trainer.email && (
                  <p className="flex items-center gap-2 truncate">
                    <Mail className="size-4 text-muted" aria-hidden />
                    <span className="truncate">{trainer.email}</span>
                  </p>
                )}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <Pill icon={Users} tone="violet">
                  {trainer.member_count} member{trainer.member_count === 1 ? '' : 's'}
                </Pill>
                {trainer.status === 'ACTIVE' ? <Pill tone={trainer.has_login ? 'green' : 'slate'} icon={KeyRound}>{trainer.has_login ? 'Has login' : 'No login'}</Pill> : <StatusBadge status="INACTIVE" size="sm" />}
                <Link to={`/trainers/${trainer.id}`} className="ml-auto text-[13px] font-semibold text-accent-700 hover:underline dark:text-accent-300">
                  View members →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
      <TrainerDialog open={editing !== undefined} onClose={() => setEditing(undefined)} trainer={editing ?? null} />
      {actions.dialogs}
    </div>
  )
}
