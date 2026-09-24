import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { progressApi, type MeasurementInput } from '@/services/endpoints'
import { measurementSchema, type MeasurementValues } from '@/schemas/training'
import { applyServerErrors } from '@/utils/forms'
import { todayISO } from '@/utils/format'

const FIELDS: { name: Exclude<keyof MeasurementValues, 'date'>; label: string; unit: string }[] = [
  { name: 'weight', label: 'Weight', unit: 'kg' },
  { name: 'height', label: 'Height', unit: 'cm' },
  { name: 'body_fat', label: 'Body fat', unit: '%' },
  { name: 'chest', label: 'Chest', unit: 'cm' },
  { name: 'waist', label: 'Waist', unit: 'cm' },
  { name: 'arm', label: 'Arm', unit: 'cm' },
  { name: 'thigh', label: 'Thigh', unit: 'cm' },
]

export function MeasurementDialog({ open, onClose, memberId, memberName }: { open: boolean; onClose: () => void; memberId: number | null; memberName?: string }) {
  const toast = useToast()
  const { register, handleSubmit, reset, setError, formState } = useForm<MeasurementValues>({ resolver: zodResolver(measurementSchema) })

  useEffect(() => {
    if (open)
      reset({ date: todayISO(), weight: '', height: '', body_fat: '', chest: '', waist: '', arm: '', thigh: '' })
  }, [open, reset])

  const submit = handleSubmit(async (values) => {
    if (!memberId) return
    const body: MeasurementInput = { date: values.date || null }
    for (const field of FIELDS) {
      const raw = String(values[field.name] ?? '').trim()
      body[field.name] = raw === '' ? null : Number(raw)
    }
    try {
      await progressApi.record(memberId, body)
      invalidate(`member:${memberId}`, 'progress')
      toast.success('Measurements saved')
      onClose()
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add measurement"
      description={memberName}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="measurement-form" loading={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="measurement-form" onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-3" noValidate>
        <TextField label="Date" type="date" max={todayISO()} wrapperClassName="col-span-2 sm:col-span-3" {...register('date')} />
        {FIELDS.map((field, index) => (
          <TextField
            key={field.name}
            label={field.label}
            inputMode="decimal"
            trailing={field.unit}
            error={formState.errors[field.name]?.message}
            {...register(field.name)}
            {...(index === 0 ? { 'data-autofocus': true } : {})}
          />
        ))}
      </form>
    </Dialog>
  )
}
