import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Download,
  Landmark,
  QrCode,
  Smartphone,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { MemberPicker } from '@/components/members/MemberPicker'
import { QRCode } from '@/components/qr/QRCode'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Feedback'
import { TextField, TextareaField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { idempotencyKey } from '@/services/api'
import { downloadReceipt } from '@/services/documents'
import { membersApi, membershipsApi, paymentsApi, plansApi } from '@/services/endpoints'
import { collectSchema, type CollectValues } from '@/schemas/billing'
import type { MemberListItem, MembershipPreview, PaymentMethod, RecordPaymentResult, UpiDetails } from '@/types'
import { cn } from '@/utils/cn'
import { applyServerErrors } from '@/utils/forms'
import {
  addDaysISO,
  daysLeftLabel,
  formatDate,
  formatMoney,
  METHOD_LABELS,
  paiseToRupees,
  planDurationLabel,
  rupeesToPaise,
  todayISO,
} from '@/utils/format'

export interface CollectPaymentOptions {
  memberId?: number | null
  planId?: number | null
}

interface CollectPaymentDialogProps extends CollectPaymentOptions {
  open: boolean
  onClose: () => void
  onDone?: (result: RecordPaymentResult) => void
}

const METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: 'CASH', label: 'Cash', icon: Banknote },
  { value: 'UPI', label: 'UPI', icon: Smartphone },
  { value: 'BANK_TRANSFER', label: 'Bank', icon: Landmark },
  { value: 'CARD_MANUAL', label: 'Card', icon: CreditCard },
]

const REFERENCE: Record<PaymentMethod, { label: string; placeholder: string; hint?: string }> = {
  CASH: { label: 'Receipt book no.', placeholder: 'Optional' },
  UPI: { label: 'UTR / UPI reference', placeholder: '12-digit UTR from the UPI app', hint: 'Check the credit in the gym’s UPI app before confirming.' },
  BANK_TRANSFER: { label: 'Bank reference', placeholder: 'UTR / IMPS / NEFT reference', hint: 'Check the bank statement before confirming.' },
  CARD_MANUAL: { label: 'Card slip / approval no.', placeholder: 'Optional', hint: 'Card payments are taken on the gym’s own terminal — this app never sees card details.' },
}

function upiUri(details: UpiDetails, amountPaise: number): string {
  const params = new URLSearchParams({ pa: details.vpa, pn: details.payee_name, am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: details.note })
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`
}

const EMPTY: CollectValues = { plan_id: '', amount: '', payment_method: 'CASH', transaction_reference: '', payment_date: '', start_date: '', notes: '' }

/** Record money the gym has received: the payment is PAID and the membership activates at once. */
export function CollectPaymentDialog({ open, onClose, memberId, planId, onDone }: CollectPaymentDialogProps) {
  const toast = useToast()
  const [member, setMember] = useState<MemberListItem | null>(null)
  const [step, setStep] = useState<'form' | 'review' | 'done'>('form')
  const [preview, setPreview] = useState<MembershipPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [upi, setUpi] = useState<UpiDetails | null>(null)
  const [result, setResult] = useState<RecordPaymentResult | null>(null)
  const [downloading, setDownloading] = useState(false)
  // One key per dialog opening: a retried or double-clicked submit never records twice.
  const key = useMemo(() => (open ? idempotencyKey() : ''), [open])

  const plans = useApi(open ? 'plans:active' : null, () => plansApi.list())
  const preset = useApi(open && memberId ? `member:${memberId}` : null, () => membersApi.get(memberId!))

  const form = useForm<CollectValues>({ resolver: zodResolver(collectSchema), defaultValues: EMPTY })
  const { register, handleSubmit, setValue, reset, setError, clearErrors, trigger, formState } = form
  const values = useWatch({ control: form.control })

  useEffect(() => {
    if (!open) return
    reset({ ...EMPTY, plan_id: planId ? String(planId) : '' })
    setMember(null)
    setStep('form')
    setPreview(null)
    setUpi(null)
    setMoreOpen(false)
    setResult(null)
  }, [open, planId, reset])

  // Member passed in from a workspace / renewals list.
  useEffect(() => {
    const w = preset.data
    if (!w || !memberId) return
    setMember({
      id: w.id,
      member_code: w.member_code,
      name: w.name,
      phone: w.phone,
      email: w.email,
      status: w.status,
      joining_date: w.joining_date,
      has_app: w.app.enabled,
      trainer: w.trainer,
      membership: { status: w.membership.status, expiry_date: w.membership.expiry_date, days_left: w.membership.days_left, plan_name: w.membership.latest?.plan_name ?? null },
    })
    if (!planId && w.membership.latest?.plan_id) setValue('plan_id', String(w.membership.latest.plan_id))
  }, [preset.data, memberId, planId, setValue])

  const activePlans = plans.data?.items ?? []
  const selectedPlan = activePlans.find((p) => String(p.id) === values.plan_id)

  // Plan change -> default the amount to the plan price.
  useEffect(() => {
    if (selectedPlan) setValue('amount', paiseToRupees(selectedPlan.price), { shouldValidate: false })
    setUpi(null)
  }, [selectedPlan, setValue])

  // Dates computed by the server with the same rule it uses when activating.
  useEffect(() => {
    if (!open || !member || !selectedPlan) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    membershipsApi
      .preview(member.id, selectedPlan.id)
      .then((data) => !cancelled && setPreview(data))
      .catch(() => !cancelled && setPreview(null))
      .finally(() => !cancelled && setPreviewLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, member, selectedPlan])

  const customStart = values.start_date || ''
  const period = selectedPlan
    ? customStart
      ? { start: customStart, end: addDaysISO(customStart, selectedPlan.duration_days - 1) }
      : preview
        ? { start: preview.start_date, end: preview.end_date }
        : null
    : null

  const amountPaise = rupeesToPaise(values.amount ?? '')
  const method = (values.payment_method ?? 'CASH') as PaymentMethod
  const suspended = member?.status === 'SUSPENDED'

  const loadQr = async () => {
    if (!member || !selectedPlan) return
    try {
      setUpi(await paymentsApi.upi(member.id, selectedPlan.id))
    } catch (error) {
      toast.fromError(error)
    }
  }

  const goReview = async () => {
    if (!member) {
      toast.error('Choose a member first')
      return
    }
    if (await trigger()) setStep('review')
  }

  const submit = handleSubmit(async (v) => {
    if (!member) return
    try {
      const response = await paymentsApi.record(
        {
          member_id: member.id,
          plan_id: Number(v.plan_id),
          payment_method: v.payment_method,
          amount: rupeesToPaise(v.amount),
          transaction_reference: v.transaction_reference.replace(/\s/g, '') || null,
          payment_date: v.payment_date || null,
          start_date: v.start_date || null,
          notes: v.notes.trim() || null,
        },
        key,
      )
      setResult(response)
      setStep('done')
      invalidate('members', `member:${member.id}`, 'payments', 'memberships', 'dashboard', 'notifications')
      onDone?.(response)
    } catch (error) {
      setStep('form')
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  const receipt = async () => {
    if (!result) return
    setDownloading(true)
    try {
      await downloadReceipt(await paymentsApi.receipt(result.payment.id))
    } catch (error) {
      toast.fromError(error)
    } finally {
      setDownloading(false)
    }
  }

  const title = step === 'done' ? 'Payment recorded' : member?.membership.expiry_date ? 'Renew membership' : 'Add membership'

  const footer =
    step === 'done' ? (
      <>
        <Button variant="secondary" icon={Download} loading={downloading} onClick={receipt}>
          Receipt (PDF)
        </Button>
        <Button onClick={onClose} data-autofocus>
          Done
        </Button>
      </>
    ) : step === 'review' ? (
      <>
        <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep('form')} disabled={formState.isSubmitting}>
          Back
        </Button>
        <Button variant="success" icon={CheckCircle2} loading={formState.isSubmitting} onClick={submit} data-autofocus>
          Confirm {formatMoney(amountPaise)} received
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button iconRight={ArrowRight} onClick={goReview} disabled={!member || suspended}>
          Review
        </Button>
      </>
    )

  return (
    <Dialog open={open} onClose={formState.isSubmitting ? () => undefined : onClose} title={title} size="lg" footer={footer}>
      {step === 'done' && result ? (
        <div className="flex flex-col items-center py-4 text-center" role="status">
          <div className="flex size-16 items-center justify-center rounded-full bg-success-50 text-success-600 ring-8 ring-success-50/60 dark:bg-success-500/10 dark:ring-success-500/5">
            <CheckCircle2 className="size-8" aria-hidden />
          </div>
          <p className="mt-4 text-2xl font-bold text-ink">{formatMoney(result.payment.amount)}</p>
          <p className="mt-1 text-sm text-muted">
            {member?.name} · {METHOD_LABELS[result.payment.payment_method]}
          </p>
          <p className="tabular mt-0.5 text-[13px] text-muted">
            {result.payment.payment_number}
            {result.payment.receipt_number && ` · Receipt ${result.payment.receipt_number}`}
          </p>
          {result.membership && (
            <div className="mt-5 w-full rounded-2xl border border-line bg-subtle p-4 text-left">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{result.membership.plan_name}</p>
                <StatusBadge status={result.membership.status} />
              </div>
              <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-2">
                <CalendarRange className="size-4 text-muted" aria-hidden />
                {formatDate(result.membership.start_date)} → {formatDate(result.membership.end_date)}
              </p>
            </div>
          )}
          {result.replayed && <p className="mt-3 text-[13px] text-muted">This payment was already recorded — no duplicate was created.</p>}
        </div>
      ) : step === 'review' && member ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">Check the details. Confirm only after the money has been received.</p>
          <dl className="divide-y divide-line rounded-2xl border border-line">
            {[
              ['Member', `${member.name} · ${member.member_code}`],
              ...(selectedPlan ? [['Plan', `${selectedPlan.name} · ${planDurationLabel(selectedPlan.duration_days)}`]] : []),
              ...(period ? [['Membership', `${formatDate(period.start)} → ${formatDate(period.end)}`]] : []),
              ['Amount', formatMoney(amountPaise)],
              ['Method', METHOD_LABELS[method]],
              ...(values.transaction_reference ? [['Reference', values.transaction_reference.replace(/\s/g, '')]] : []),
              ...(values.payment_date && values.payment_date !== todayISO() ? [['Received on', formatDate(values.payment_date)]] : []),
              ...(values.notes ? [['Notes', values.notes]] : []),
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-right text-sm font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {selectedPlan && amountPaise < selectedPlan.price && (
            <p className="rounded-xl bg-warning-50 px-3 py-2 text-[13px] text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
              Discount of {formatMoney(selectedPlan.price - amountPaise)} on the plan price.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={(e) => e.preventDefault()} className="space-y-5" noValidate>
          {memberId && !member ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : memberId && member ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-subtle px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{member.name}</p>
                <p className="text-[13px] text-muted">
                  {member.member_code} · {daysLeftLabel(member.membership.days_left)}
                </p>
              </div>
              <StatusBadge status={member.membership.status} />
            </div>
          ) : (
            <MemberPicker value={member} onChange={setMember} autoFocus />
          )}

          {suspended && (
            <p role="alert" className="rounded-xl bg-warning-50 px-3 py-2 text-[13px] font-medium text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
              This member is suspended. Reactivate the member before recording a payment.
            </p>
          )}

          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-2">
              Plan <span className="text-danger-500">*</span>
            </p>
            {plans.loading ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-[76px] rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Plan">
                {activePlans.map((plan) => {
                  const selected = String(plan.id) === values.plan_id
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setValue('plan_id', String(plan.id), { shouldValidate: true })}
                      className={cn(
                        'cursor-pointer rounded-xl border p-3.5 text-left transition-colors duration-150',
                        selected ? 'border-primary bg-subtle ring-2 ring-primary/20' : 'border-line hover:border-line-strong hover:bg-hover',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">{plan.name}</span>
                        <span className="tabular text-sm font-bold text-ink">{formatMoney(plan.price)}</span>
                      </span>
                      <span className="mt-1 block text-[12px] text-muted">{planDurationLabel(plan.duration_days)}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {formState.errors.plan_id && <p className="mt-1.5 text-[13px] font-medium text-danger-600 dark:text-danger-400">{formState.errors.plan_id.message}</p>}

            {selectedPlan && member && (
              <div className="mt-3 rounded-xl border border-dashed border-line-strong bg-subtle px-4 py-3">
                {!period || (previewLoading && !customStart) ? (
                  <Skeleton className="h-5 w-2/3" />
                ) : (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                    <CalendarRange className="size-4 text-muted" aria-hidden />
                    <span className="font-semibold text-ink">
                      {formatDate(period.start)} → {formatDate(period.end)}
                    </span>
                    <span className="text-muted">
                      {customStart ? '· custom start date' : preview?.is_renewal ? '· continues from the current expiry' : '· starts today'}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>

          <TextField
            label="Amount received"
            required
            inputMode="decimal"
            leading="₹"
            error={formState.errors.amount?.message}
            hint={selectedPlan ? `Plan price ${formatMoney(selectedPlan.price)} — lower it for a discount.` : undefined}
            {...register('amount')}
          />

          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-2">Payment method</p>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Payment method">
              {METHODS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => {
                    // Each method has its own reference rule; drop a message that belonged to the old one.
                    setValue('payment_method', value)
                    clearErrors('transaction_reference')
                  }}
                  className={cn(
                    'flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-[13px] font-semibold transition-colors duration-150',
                    method === value ? 'border-primary bg-subtle text-ink ring-2 ring-primary/20' : 'border-line text-ink-2 hover:bg-hover',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <TextField
            label={REFERENCE[method].label}
            required={method === 'UPI' || method === 'BANK_TRANSFER'}
            placeholder={REFERENCE[method].placeholder}
            inputMode={method === 'UPI' ? 'numeric' : undefined}
            error={formState.errors.transaction_reference?.message}
            hint={REFERENCE[method].hint}
            {...register('transaction_reference')}
          />

          {method === 'UPI' && selectedPlan && member && (
            <div className="rounded-2xl border border-line p-4">
              {!upi ? (
                <Button variant="soft" icon={QrCode} onClick={loadQr}>
                  Show the gym’s UPI QR for {formatMoney(amountPaise)}
                </Button>
              ) : (
                <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
                  <QRCode value={upiUri(upi, amountPaise)} size={168} label={`UPI payment QR for ${formatMoney(amountPaise)}`} className="border border-line" />
                  <div>
                    <p className="text-2xl font-bold text-ink">{formatMoney(amountPaise)}</p>
                    <p className="mt-1 text-sm text-muted">to {upi.payee_name}</p>
                    <p className="mt-0.5 font-mono text-sm text-ink-2">{upi.vpa}</p>
                    <p className="mt-2 text-[13px] text-muted">The member scans with any UPI app. Enter the UTR above once the credit shows in the gym’s app.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-line">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left text-sm font-semibold text-ink-2 hover:text-ink"
            >
              More options
              <span className="flex items-center gap-2 text-[12px] font-medium text-muted">
                Payment date · Start date · Notes
                <ChevronDown className={cn('size-4 transition-transform duration-200', moreOpen && 'rotate-180')} aria-hidden />
              </span>
            </button>
            {moreOpen && (
              <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
                <TextField
                  label="Payment received on"
                  type="date"
                  min={addDaysISO(todayISO(), -60)}
                  max={todayISO()}
                  hint="Leave empty for today."
                  error={formState.errors.payment_date?.message}
                  {...register('payment_date')}
                />
                <TextField
                  label="Custom start date"
                  type="date"
                  min={addDaysISO(todayISO(), -60)}
                  max={addDaysISO(todayISO(), 90)}
                  hint="Leave empty to continue from the current expiry."
                  error={formState.errors.start_date?.message}
                  {...register('start_date')}
                />
                <TextareaField label="Notes" rows={2} wrapperClassName="sm:col-span-2" error={formState.errors.notes?.message} {...register('notes')} />
              </div>
            )}
          </div>
        </form>
      )}
    </Dialog>
  )
}
