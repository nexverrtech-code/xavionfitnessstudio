import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField, TextField, TextareaField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { plansApi } from '@/services/endpoints'
import { planSchema, type PlanValues } from '@/schemas/billing'
import type { Plan } from '@/types'
import { applyServerErrors } from '@/utils/forms'
import { formatMoney, paiseToRupees, planDurationLabel, rupeesToPaise } from '@/utils/format'

const PRESETS = [
  { label: 'Monthly', days: 30 },
  { label: 'Quarterly', days: 90 },
  { label: 'Half Yearly', days: 180 },
  { label: 'Yearly', days: 365 },
]

export function PlanDialog({ open, onClose, plan }: { open: boolean; onClose: () => void; plan?: Plan | null }) {
  const toast = useToast()
  const { register, handleSubmit, reset, setValue, setError, control, formState } = useForm<PlanValues>({ resolver: zodResolver(planSchema) })
  const values = useWatch({ control })

  useEffect(() => {
    if (!open) return
    reset(
      plan
        ? { name: plan.name, duration_days: String(plan.duration_days), price: paiseToRupees(plan.price), description: plan.description ?? '', status: plan.status }
        : { name: '', duration_days: '30', price: '', description: '', status: 'ACTIVE' },
    )
  }, [open, plan, reset])

  const submit = handleSubmit(async (v) => {
    const body = { name: v.name, duration_days: Number(v.duration_days), price: rupeesToPaise(v.price), description: v.description || null, status: v.status }
    try {
      if (plan) await plansApi.update(plan.id, body)
      else await plansApi.create(body)
      invalidate('plans')
      toast.success(plan ? 'Plan updated' : 'Plan created')
      onClose()
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  const days = Number(values.duration_days)
  const price = rupeesToPaise(values.price ?? '')
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={plan ? 'Edit plan' : 'New membership plan'}
      description={plan ? 'Changes apply to new purchases; existing memberships keep their dates and price.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="plan-form" loading={formState.isSubmitting}>
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {!plan && (
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setValue('name', preset.label, { shouldValidate: true })
                  setValue('duration_days', String(preset.days), { shouldValidate: true })
                }}
                className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hover"
              >
                {preset.label} · {preset.days} days
              </button>
            ))}
          </div>
        )}
        <TextField label="Plan name" required wrapperClassName="sm:col-span-2" error={formState.errors.name?.message} {...register('name')} data-autofocus />
        <TextField
          label="Duration"
          required
          inputMode="numeric"
          trailing="days"
          hint={days > 0 ? planDurationLabel(days) : undefined}
          error={formState.errors.duration_days?.message}
          {...register('duration_days')}
        />
        <TextField
          label="Price"
          required
          inputMode="decimal"
          leading="₹"
          hint={days > 0 && price > 0 ? `≈ ${formatMoney(Math.round((price / days) * 30))} per month` : undefined}
          error={formState.errors.price?.message}
          {...register('price')}
        />
        <TextareaField label="Description" rows={2} wrapperClassName="sm:col-span-2" error={formState.errors.description?.message} {...register('description')} />
        <SelectField
          label="Status"
          wrapperClassName="sm:col-span-2"
          options={[
            { value: 'ACTIVE', label: 'Active — available for new purchases' },
            { value: 'INACTIVE', label: 'Inactive — hidden from new purchases' },
          ]}
          {...register('status')}
        />
      </form>
    </Dialog>
  )
}
