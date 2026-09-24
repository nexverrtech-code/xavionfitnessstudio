import { Check, UserCog } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SkeletonRows } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Menu'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useAction } from '@/hooks/useUtilities'
import { membersApi, trainersApi } from '@/services/endpoints'
import { cn } from '@/utils/cn'

export function AssignTrainerDialog({ open, onClose, memberId, currentTrainerId }: { open: boolean; onClose: () => void; memberId: number | null; currentTrainerId?: number | null }) {
  const toast = useToast()
  const [selected, setSelected] = useState<number | null>(currentTrainerId ?? null)
  const trainers = useApi(open ? 'trainers:active' : null, () => trainersApi.list('ACTIVE'))
  useEffect(() => {
    if (open) setSelected(currentTrainerId ?? null)
  }, [open, currentTrainerId])

  const save = useAction(async () => {
    if (!memberId) return
    try {
      await membersApi.assignTrainer(memberId, selected)
      invalidate(`member:${memberId}`, 'members', 'trainers')
      toast.success(selected ? 'Trainer assigned' : 'Trainer removed')
      onClose()
    } catch (error) {
      toast.fromError(error)
    }
  })

  const options = [{ id: null as number | null, name: 'No trainer', specialization: 'Member trains independently', member_count: undefined as number | undefined }, ...(trainers.data?.items ?? [])]
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign trainer"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.run()} loading={save.loading} disabled={selected === (currentTrainerId ?? null)}>
            Save
          </Button>
        </>
      }
    >
      {trainers.loading ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="space-y-2" role="radiogroup" aria-label="Trainer">
          {options.map((trainer) => {
            const active = selected === trainer.id
            return (
              <button
                key={trainer.id ?? 'none'}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(trainer.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                  active ? 'border-accent-600 bg-accent-50/60 dark:bg-accent-500/10' : 'border-line hover:bg-hover',
                )}
              >
                {trainer.id ? (
                  <Avatar name={trainer.name} size="md" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-full bg-subtle text-muted">
                    <UserCog className="size-5" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{trainer.name}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {trainer.specialization ?? 'Trainer'}
                    {trainer.member_count !== undefined && ` · ${trainer.member_count} members`}
                  </span>
                </span>
                {active && <Check className="size-5 text-accent-700" aria-hidden />}
              </button>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
