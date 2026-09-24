import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, SelectField, TextField, TextareaField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { paymentsApi } from '@/services/endpoints'
import { PAYMENT_METHODS, refundSchema, type RefundValues } from '@/schemas/billing'
import type { Payment } from '@/types'
import { applyServerErrors } from '@/utils/forms'
import { formatDate, formatMoney, METHOD_LABELS, paiseToRupees, rupeesToPaise, todayISO } from '@/utils/format'

/** Record a refund the gym has already paid back (SmartGym never moves money). Admin only. */
export function RefundDialog({ payment, onClose, onDone }: { payment: Payment | null; onClose: () => void; onDone?: (payment: Payment) => void }) {
  const toast = useToast()
  const { register, handleSubmit, reset, setError, control, formState } = useForm<RefundValues>({ resolver: zodResolver(refundSchema) })
  const amount = useWatch({ control, name: 'amount' })
  const cancel = useWatch({ control, name: 'cancel_membership' })

  useEffect(() => {
    if (!payment) return
    reset({
      amount: paiseToRupees(payment.amount),
      refund_method: payment.payment_method,
      refund_reference: '',
      refund_reason: '',
      refund_date: todayISO(),
      cancel_membership: true,
    })
  }, [payment, reset])

  const submit = handleSubmit(async (values) => {
    if (!payment) return
    const paise = rupeesToPaise(values.amount)
    if (paise > payment.amount) {
      setError('amount', { message: `At most ${formatMoney(payment.amount)}` })
      return
    }
    try {
      const result = await paymentsApi.refund(payment.id, {
        amount: paise,
        refund_method: values.refund_method,
        refund_reference: values.refund_reference.replace(/\s/g, '') || null,
        refund_reason: values.refund_reason.trim(),
        refund_date: values.refund_date || null,
        cancel_membership: values.cancel_membership,
      })
      invalidate('payments', 'dashboard', 'members', 'memberships', `member:${payment.member_id}`)
      toast.success('Refund recorded', { description: `${formatMoney(paise)} · ${payment.payment_number}` })
      onDone?.(result.payment)
      onClose()
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  const partial = payment ? rupeesToPaise(amount ?? '') < payment.amount : false
  return (
    <Dialog
      open={!!payment}
      onClose={formState.isSubmitting ? () => undefined : onClose}
      title="Record a refund"
      description={payment ? `${payment.payment_number} · ${payment.member_name} · ${formatMoney(payment.amount)} paid ${formatDate(payment.payment_date)}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="refund-form" loading={formState.isSubmitting}>
            Record refund
          </Button>
        </>
      }
    >
      <form id="refund-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <p className="rounded-xl bg-subtle px-3 py-2 text-[13px] text-ink-2 sm:col-span-2">
          Pay the money back first (cash, UPI or bank), then record it here. The payment keeps its history and is marked refunded.
        </p>
        <TextField
          label="Refund amount"
          required
          inputMode="decimal"
          leading="₹"
          hint={partial ? 'Partial refund' : 'Full refund'}
          error={formState.errors.amount?.message}
          {...register('amount')}
          data-autofocus
        />
        <SelectField
          label="Refunded by"
          required
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
          error={formState.errors.refund_method?.message}
          {...register('refund_method')}
        />
        <TextField label="Refund reference" placeholder="Optional — UTR or receipt no." error={formState.errors.refund_reference?.message} {...register('refund_reference')} />
        <TextField
          label="Refunded on"
          type="date"
          min={payment?.payment_date}
          max={todayISO()}
          error={formState.errors.refund_date?.message}
          {...register('refund_date')}
        />
        <TextareaField label="Reason" required rows={2} wrapperClassName="sm:col-span-2" error={formState.errors.refund_reason?.message} {...register('refund_reason')} />
        {payment?.membership_id && (
          <div className="sm:col-span-2">
            <Checkbox
              label="Cancel the membership bought with this payment"
              description={
                cancel
                  ? 'The member’s status is recalculated from their other memberships.'
                  : 'The membership stays active (e.g. a discount given after payment).'
              }
              {...register('cancel_membership')}
            />
          </div>
        )}
      </form>
    </Dialog>
  )
}
