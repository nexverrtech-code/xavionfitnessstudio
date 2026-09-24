import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { trainersApi } from '@/services/endpoints'
import { trainerSchema, type TrainerValues } from '@/schemas/member'
import type { Trainer } from '@/types'
import { applyServerErrors } from '@/utils/forms'
import { todayISO } from '@/utils/format'

export function TrainerDialog({ open, onClose, trainer }: { open: boolean; onClose: () => void; trainer?: Trainer | null }) {
  const toast = useToast()
  const { register, handleSubmit, reset, setError, formState } = useForm<TrainerValues>({ resolver: zodResolver(trainerSchema) })
  useEffect(() => {
    if (!open) return
    reset(
      trainer
        ? { name: trainer.name, phone: trainer.phone, email: trainer.email ?? '', specialization: trainer.specialization ?? '', joining_date: trainer.joining_date ?? '' }
        : { name: '', phone: '', email: '', specialization: '', joining_date: todayISO() },
    )
  }, [open, trainer, reset])

  const submit = handleSubmit(async (v) => {
    const body = { name: v.name, phone: v.phone, email: v.email || null, specialization: v.specialization || null, joining_date: v.joining_date || null }
    try {
      if (trainer) await trainersApi.update(trainer.id, body)
      else await trainersApi.create(body)
      invalidate('trainers', trainer ? `trainer:${trainer.id}` : 'trainer:')
      toast.success(trainer ? 'Trainer updated' : 'Trainer added')
      onClose()
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={trainer ? 'Edit trainer' : 'Add trainer'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="trainer-form" loading={formState.isSubmitting}>
            {trainer ? 'Save' : 'Add trainer'}
          </Button>
        </>
      }
    >
      <form id="trainer-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <TextField label="Full name" required error={formState.errors.name?.message} {...register('name')} data-autofocus />
        <TextField label="Mobile number" required type="tel" inputMode="tel" error={formState.errors.phone?.message} {...register('phone')} />
        <TextField label="Email" type="email" hint="Used as the trainer's login." error={formState.errors.email?.message} {...register('email')} />
        <TextField label="Specialization" placeholder="Strength, HIIT, Yoga…" error={formState.errors.specialization?.message} {...register('specialization')} />
        <TextField label="Joining date" type="date" max={todayISO()} wrapperClassName="sm:col-span-2" {...register('joining_date')} />
      </form>
    </Dialog>
  )
}
