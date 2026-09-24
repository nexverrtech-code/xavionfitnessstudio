import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextareaField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Navigation'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { paymentsApi } from '@/services/endpoints'
import { rejectSchema, type RejectValues } from '@/schemas/billing'
import type { Payment } from '@/types'
import { formatMoney } from '@/utils/format'

const QUICK_REASONS: Record<RejectValues['status'], string[]> = {
  REJECTED: ['UTR not found in the bank statement', 'Amount received does not match', 'Duplicate submission'],
  FAILED: ['The UPI app shows the payment failed', 'Money was returned to the member'],
}

/** A pending UPI payment that can't be matched is REJECTED (or FAILED); no membership starts. */
export function RejectPaymentDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const toast = useToast()
  const { register, handleSubmit, reset, setValue, control, formState } = useForm<RejectValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: '', status: 'REJECTED' },
  })
  const status = useWatch({ control, name: 'status' })
  useEffect(() => {
    if (payment) reset({ reason: '', status: 'REJECTED' })
  }, [payment, reset])

  const submit = handleSubmit(async ({ reason, status: outcome }) => {
    if (!payment) return
    try {
      const result = await paymentsApi.reject(payment.id, reason, outcome)
      invalidate('payments', 'dashboard', 'members', `member:${payment.member_id}`)
      if (result.already_processed) toast.info('This payment was already closed.')
      else toast.success(outcome === 'FAILED' ? 'Marked as failed' : 'Payment rejected', { description: 'The member sees the reason in their app.' })
      onClose()
    } catch (error) {
      toast.fromError(error)
    }
  })

  return (
    <Dialog
      open={!!payment}
      onClose={onClose}
      title="Close this payment"
      description={payment ? `${payment.member_name} · ${formatMoney(payment.amount)} · UTR ${payment.transaction_reference ?? '—'}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="reject-form" loading={formState.isSubmitting}>
            {status === 'FAILED' ? 'Mark as failed' : 'Reject payment'}
          </Button>
        </>
      }
    >
      <form id="reject-form" onSubmit={submit} className="space-y-4" noValidate>
        <Segmented
          label="Outcome"
          value={status}
          onChange={(value) => setValue('status', value)}
          options={[
            { value: 'REJECTED', label: 'Rejected — not received' },
            { value: 'FAILED', label: 'Failed — payment failed' },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_REASONS[status].map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => setValue('reason', reason, { shouldValidate: true })}
              className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover"
            >
              {reason}
            </button>
          ))}
        </div>
        <TextareaField label="Reason shown to the member" required rows={3} error={formState.errors.reason?.message} {...register('reason')} data-autofocus />
        <p className="text-[13px] text-muted">No membership is created. The member can submit a new payment from their app.</p>
      </form>
    </Dialog>
  )
}
