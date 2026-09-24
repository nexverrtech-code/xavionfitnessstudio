import { KeyRound, Mail, Pencil, Phone, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { MemberPicker } from '@/components/members/MemberPicker'
import { TrainerDialog } from '@/components/trainers/TrainerDialog'
import { Pill, StatusBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Menu'
import { PageHeader, Pagination } from '@/components/ui/Navigation'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { membersApi, trainersApi } from '@/services/endpoints'
import type { MemberListItem } from '@/types'
import { daysLeftLabel, formatDate } from '@/utils/format'
import { useTrainerActions } from '@/components/trainers/useTrainerActions'

export default function TrainerDetailPage() {
  const { trainerId } = useParams()
  const id = Number(trainerId)
  const toast = useToast()
  const trainer = useApi(`trainer:${id}`, () => trainersApi.get(id))
  const [page, setPage] = useState(1)
  const members = useApi(`trainer:${id}:members:${page}`, () => trainersApi.members(id, { page, limit: 20 }), { keepPrevious: true })
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [picked, setPicked] = useState<MemberListItem[]>([])
  const [current, setCurrent] = useState<MemberListItem | null>(null)
  const [saving, setSaving] = useState(false)
  const actions = useTrainerActions()
  useDocumentTitle(trainer.data?.name ?? 'Trainer')

  if (trainer.loading && !trainer.data) return <PageLoader />
  if (!trainer.data) return <ErrorState error={trainer.error} onRetry={trainer.reload} />
  const t = trainer.data

  const assign = async () => {
    setSaving(true)
    try {
      const result = await trainersApi.assignMembers(t.id, picked.map((m) => m.id))
      invalidate(`trainer:${t.id}`, 'trainers', 'members')
      toast.success(`${result.assigned} member${result.assigned === 1 ? '' : 's'} assigned to ${t.name}`)
      setAssigning(false)
      setPicked([])
    } catch (error) {
      toast.fromError(error)
    } finally {
      setSaving(false)
    }
  }

  const unassign = async (member: MemberListItem) => {
    try {
      await membersApi.assignTrainer(member.id, null)
      invalidate(`trainer:${t.id}`, 'trainers', 'members', `member:${member.id}`)
      toast.success(`${member.name} unassigned`)
    } catch (error) {
      toast.fromError(error)
    }
  }

  return (
    <div>
      <PageHeader crumbs={[{ label: 'Trainers', to: '/trainers' }, { label: t.name }]} title="" className="mb-3" />
      <Card className="mb-5 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={t.name} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-ink">{t.name}</h1>
                <StatusBadge status={t.status} />
              </div>
              <p className="text-sm text-muted">{t.specialization ?? 'Trainer'} · since {formatDate(t.joining_date)}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
                <a href={`tel:${t.phone}`} className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-muted" aria-hidden /> {t.phone}
                </a>
                {t.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="size-3.5 text-muted" aria-hidden /> {t.email}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {t.status === 'ACTIVE' && (
              <Button icon={UserPlus} onClick={() => setAssigning(true)}>
                Assign members
              </Button>
            )}
            <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {t.status === 'ACTIVE' && (
              <Button variant="secondary" icon={KeyRound} onClick={() => actions.createLogin(t)}>
                {t.has_login ? 'Reset login' : 'Create login'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader icon={Users} title="Assigned members" description={`${t.member_count} member${t.member_count === 1 ? '' : 's'}`} />
        {members.error && !members.data ? (
          <ErrorState compact error={members.error} onRetry={members.reload} />
        ) : (
          <DataList
            rows={members.data?.items}
            loading={members.loading}
            rowKey={(m) => m.id}
            columns={[
              {
                key: 'member',
                header: 'Member',
                cell: (m) => (
                  <Link to={`/members/${m.id}`} className="flex items-center gap-3">
                    <Avatar name={m.name} size="sm" />
                    <span>
                      <span className="block font-semibold text-ink hover:underline">{m.name}</span>
                      <span className="block text-[12px] text-muted">{m.member_code}</span>
                    </span>
                  </Link>
                ),
              },
              { key: 'phone', header: 'Phone', cell: (m) => <span className="tabular">{m.phone}</span> },
              { key: 'membership', header: 'Membership', cell: (m) => <StatusBadge status={m.membership.status} size="sm" /> },
              { key: 'expiry', header: 'Expiry', cell: (m) => daysLeftLabel(m.membership.days_left) },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (m) => <IconButton icon={UserMinus} label={`Unassign ${m.name}`} size="icon-sm" onClick={() => unassign(m)} />,
              },
            ]}
            mobile={(m) => (
              <div className="flex items-center gap-3">
                <Avatar name={m.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{m.name}</p>
                  <p className="text-[12px] text-muted">{daysLeftLabel(m.membership.days_left)}</p>
                </div>
                <StatusBadge status={m.membership.status} size="sm" />
              </div>
            )}
            empty={
              <EmptyState
                compact
                icon={Users}
                title="No members assigned"
                description="Assign members so this trainer can build their workouts and track progress."
                action={
                  t.status === 'ACTIVE' && (
                    <Button icon={UserPlus} onClick={() => setAssigning(true)}>
                      Assign members
                    </Button>
                  )
                }
              />
            }
          />
        )}
        {members.data && members.data.pages > 1 && (
          <div className="border-t border-line px-4">
            <Pagination page={page} pages={members.data.pages} total={members.data.total} limit={members.data.limit} onPage={setPage} />
          </div>
        )}
      </Card>

      <TrainerDialog open={editing} onClose={() => setEditing(false)} trainer={t} />
      <Dialog
        open={assigning}
        onClose={() => (setAssigning(false), setPicked([]))}
        title={`Assign members to ${t.name}`}
        description="Search and add members. Members already assigned to another trainer will move to this trainer."
        footer={
          <>
            <Button variant="secondary" onClick={() => (setAssigning(false), setPicked([]))}>
              Cancel
            </Button>
            <Button icon={UserPlus} loading={saving} disabled={!picked.length} onClick={assign}>
              Assign {picked.length || ''}
            </Button>
          </>
        }
      >
        <MemberPicker
          value={current}
          label="Add member"
          autoFocus
          onChange={(member) => {
            if (member && !picked.some((p) => p.id === member.id)) setPicked((list) => [...list, member])
            setCurrent(null)
          }}
        />
        {picked.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {picked.map((m) => (
              <Pill key={m.id} tone="violet">
                {m.name}
                <button type="button" onClick={() => setPicked((list) => list.filter((p) => p.id !== m.id))} aria-label={`Remove ${m.name}`} className="-mr-1 rounded-full p-0.5 hover:bg-accent-100">
                  <X className="size-3" />
                </button>
              </Pill>
            ))}
          </div>
        )}
      </Dialog>
      {actions.dialogs}
    </div>
  )
}
