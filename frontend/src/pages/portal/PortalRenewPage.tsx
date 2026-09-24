import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Check, CheckCircle2, Copy, ExternalLink, Hourglass, ShieldCheck, Sparkles, Store, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { QRCode } from '@/components/qr/QRCode'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { isApiError } from '@/services/api'
import { portalApi } from '@/services/endpoints'
import { utrSchema, type UtrValues } from '@/schemas/billing'
import type { Plan, UpiDetails } from '@/types'
import { cn } from '@/utils/cn'
import { addDaysISO, formatDate, formatDateTime, formatMoney, perMonthPaise, planDurationLabel, todayISO } from '@/utils/format'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-hover"
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** Direct UPI renewal: pay the gym's UPI ID, submit the 12-digit UTR, the gym verifies it.
 *  Nothing activates until staff approve — a UTR alone never starts a membership. */
export default function PortalRenewPage() {
  useDocumentTitle('Renew')
  const toast = useToast()
  const plans = useApi('portal:plans', () => portalApi.plans())
  const pending = useApi('portal:pending', () => portalApi.pending())
  const overview = useApi('portal:overview', () => portalApi.overview())
  const [plan, setPlan] = useState<Plan | null>(null)
  const [step, setStep] = useState<'plan' | 'pay' | 'done'>('plan')
  const [upi, setUpi] = useState<UpiDetails | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const { register, handleSubmit, setError, formState } = useForm<UtrValues>({ resolver: zodResolver(utrSchema), defaultValues: { utr: '' } })

  if ((plans.loading && !plans.data) || (pending.loading && !pending.data)) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading plans">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    )
  }
  if (plans.error || pending.error) return <ErrorState error={plans.error ?? pending.error} onRetry={() => (plans.reload(), pending.reload())} />

  const expiry = overview.data?.membership.expiry_date
  const startsOn = expiry && expiry >= todayISO() ? addDaysISO(expiry, 1) : todayISO()
  const waiting = pending.data?.payment

  if (waiting && step !== 'done') {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Renew membership</h1>
        <Card className="p-6 text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-info-50 text-info-600 dark:bg-info-500/10 dark:text-info-300">
            <Hourglass className="size-8" aria-hidden />
          </span>
          <h2 className="mt-4 text-xl font-bold text-ink">Payment under verification</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            The gym is checking your UPI payment. Your membership starts once it is approved — you’ll get a notification here.
          </p>
          <dl className="mx-auto mt-5 max-w-sm divide-y divide-line rounded-2xl border border-line text-left text-sm">
            {[
              ['Plan', waiting.plan_name ?? '—'],
              ['Amount', formatMoney(waiting.amount)],
              ['UTR', waiting.transaction_reference ?? '—'],
              ['Payment no.', waiting.payment_number],
              ['Submitted', formatDateTime(waiting.created_at)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 px-4 py-3">
                <dt className="text-muted">{label}</dt>
                <dd className="tabular text-right font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13px] text-muted">Taking longer than a day? Show this screen at the front desk.</p>
          <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
            <Button variant="ghost" icon={Undo2} onClick={() => setWithdrawing(true)}>
              Withdraw submission
            </Button>
            <ButtonLink to="/portal" variant="secondary">
              Back to home
            </ButtonLink>
          </div>
        </Card>
        <ConfirmDialog
          open={withdrawing}
          onClose={() => setWithdrawing(false)}
          title="Withdraw this payment?"
          message="Use this if you picked the wrong plan or entered the wrong UTR. If money left your account, contact the front desk — they can check it with the UTR."
          confirmLabel="Withdraw"
          onConfirm={async () => {
            try {
              await portalApi.withdraw()
              invalidate('portal')
              toast.success('Submission withdrawn')
            } catch (error) {
              toast.fromError(error)
              throw error
            }
          }}
        />
      </div>
    )
  }

  if (step === 'done') {
    return (
      <Card className="p-6 text-center" role="status">
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-300">
          <CheckCircle2 className="size-8" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-bold text-ink">Payment submitted</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Thanks! The gym will check your UTR and activate your {plan?.name} membership. You’ll get a notification once it’s approved.
        </p>
        <ButtonLink to="/portal" variant="primary" className="mt-6">
          Done
        </ButtonLink>
      </Card>
    )
  }

  const planList = plans.data?.items ?? []
  const bestValue = planList.reduce<Plan | null>((best, p) => (!best || p.price / p.duration_days < best.price / best.duration_days ? p : best), null)

  const continueToPay = async () => {
    if (!plan) return
    setBusy(true)
    setUnavailable(null)
    try {
      setUpi(await portalApi.upi(plan.id))
      setStep('pay')
    } catch (error) {
      if (isApiError(error) && error.status === 409) setUnavailable(error.message)
      else toast.fromError(error)
    } finally {
      setBusy(false)
    }
  }

  const submitUtr = handleSubmit(async ({ utr }) => {
    if (!plan) return
    try {
      await portalApi.submitRenewal(plan.id, utr.replace(/\s/g, ''))
      invalidate('portal')
      setStep('done')
    } catch (error) {
      // Show the server's message in full (e.g. "This transaction reference has already been submitted.").
      if (isApiError(error) && (error.fields?.utr || error.status === 409 || error.status === 422)) setError('utr', { message: error.message })
      else toast.fromError(error)
    }
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {step === 'pay' && (
          <button
            type="button"
            onClick={() => setStep('plan')}
            className="-ml-2 flex size-11 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-ink"
            aria-label="Back to plans"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{step === 'plan' ? 'Choose your plan' : 'Pay with UPI'}</h1>
          <p className="text-sm text-muted">
            {step === 'plan'
              ? expiry && expiry >= todayISO()
                ? `Your new plan starts ${formatDate(startsOn)}, right after your current one ends.`
                : 'Your plan starts once the gym confirms your payment.'
              : plan
                ? `${plan.name} · ${formatMoney(plan.price)}`
                : ''}
          </p>
        </div>
      </div>

      {step === 'plan' &&
        (planList.length === 0 ? (
          <Card>
            <EmptyState icon={Sparkles} title="No plans available" description="Please ask the front desk about membership options." />
          </Card>
        ) : (
          <div className="space-y-3" role="radiogroup" aria-label="Plans">
            {planList.map((p) => {
              const selected = plan?.id === p.id
              const monthly = perMonthPaise(p.price, p.duration_days)
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPlan(p)}
                  className={cn(
                    'relative w-full cursor-pointer rounded-3xl border-2 bg-surface p-5 text-left shadow-card transition-[border-color,box-shadow,transform] duration-150 active:scale-[0.99]',
                    selected ? 'border-primary ring-4 ring-primary/15' : 'border-line hover:border-line-strong',
                  )}
                >
                  {bestValue?.id === p.id && planList.length > 1 && (
                    <span className="absolute -top-2.5 right-4 rounded-full bg-volt px-2.5 py-0.5 text-[11px] font-bold text-on-volt">BEST VALUE</span>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-ink">{p.name}</p>
                      <p className="text-sm text-muted">
                        {planDurationLabel(p.duration_days)}
                        {monthly !== null && ` · ≈ ${formatMoney(monthly)}/month`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-ink">{formatMoney(p.price)}</p>
                      <span
                        className={cn(
                          'ml-auto mt-1 flex size-6 items-center justify-center rounded-full border-2',
                          selected ? 'border-primary bg-primary text-on-primary' : 'border-line-strong',
                        )}
                      >
                        {selected && <Check className="size-3.5" aria-hidden />}
                      </span>
                    </div>
                  </div>
                  {p.description && <p className="mt-2 text-sm text-ink-2">{p.description}</p>}
                </button>
              )
            })}
            {unavailable && (
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <Store className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                  <div>
                    <p className="font-semibold text-ink">Pay at the front desk</p>
                    <p className="mt-0.5 text-sm text-muted">{unavailable}</p>
                  </div>
                </div>
              </Card>
            )}
            <Button size="lg" fullWidth disabled={!plan} loading={busy} onClick={continueToPay} className="h-14 rounded-2xl text-base">
              Continue to payment
            </Button>
            <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[12px] text-muted">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> You pay the gym directly with UPI. We never ask for card details or your UPI PIN.
            </p>
          </div>
        ))}

      {step === 'pay' && plan && upi && (
        <div className="space-y-4">
          <Card className="p-5 text-center">
            <p className="text-sm font-medium text-muted">Pay exactly</p>
            <p className="text-4xl font-bold tracking-tight text-ink">{formatMoney(upi.amount)}</p>
            <div className="mx-auto mt-4 w-fit rounded-3xl border border-line bg-white p-3">
              <QRCode value={upi.uri} size={216} label={`UPI QR code to pay ${formatMoney(upi.amount)} to ${upi.payee_name}`} />
            </div>
            <p className="mt-3 text-sm text-ink-2">
              to <span className="font-semibold">{upi.payee_name}</span>
            </p>
            <div className="mt-1 flex items-center justify-center gap-1">
              <code className="text-sm font-semibold text-ink">{upi.vpa}</code>
              <CopyButton value={upi.vpa} />
            </div>
            <a
              href={upi.uri}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-bold text-on-primary shadow-card transition-colors hover:bg-primary-hover sm:hidden"
            >
              <ExternalLink className="size-4" aria-hidden /> Open UPI app
            </a>
            <p className="mt-3 text-[12px] text-muted">Scan with any UPI app, or tap “Open UPI app” on this phone. Note: {upi.note}</p>
          </Card>
          <Card className="p-5">
            <form onSubmit={submitUtr} className="space-y-4" noValidate>
              <TextField
                label="UTR / UPI reference number"
                required
                inputMode="numeric"
                autoComplete="off"
                placeholder="12-digit number"
                maxLength={16}
                hint="In your UPI app, open the payment and look for UPI Ref. No. or UTR."
                error={formState.errors.utr?.message}
                {...register('utr')}
              />
              <Button type="submit" size="lg" fullWidth loading={formState.isSubmitting} className="h-14 rounded-2xl text-base">
                I’ve paid — send for verification
              </Button>
              <p className="text-center text-[12px] text-muted">Only submit after the payment succeeds in your UPI app.</p>
            </form>
          </Card>
          <Link to="/portal" className="block py-2 text-center text-sm font-semibold text-muted hover:text-ink">
            Cancel
          </Link>
        </div>
      )}
    </div>
  )
}
