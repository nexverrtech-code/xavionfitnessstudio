import { ArrowRight, Hourglass, RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import type { CoverageInfo, Membership } from '@/types'
import { cn } from '@/utils/cn'
import { formatDate, todayISO } from '@/utils/format'

interface HeroProps {
  membership: CoverageInfo & { current: Membership | null; upcoming: Membership | null; latest: Membership | null }
  /** A UPI payment the member submitted that the gym hasn't verified yet. */
  pending?: { plan_name: string | null } | null
  showRenew?: boolean
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** The member's membership card — the first thing they see in the app. */
export function MembershipHero({ membership, pending = null, showRenew = true }: HeroProps) {
  const plan = membership.current ?? membership.latest
  const days = membership.days_left
  const status = membership.status
  const expired = status === 'EXPIRED'
  const none = status === 'NONE'
  const daysAgo = expired && membership.expiry_date ? daysBetween(membership.expiry_date, todayISO()) : 0
  let progress = 0
  if (plan?.start_date && plan.end_date) {
    const total = daysBetween(plan.start_date, plan.end_date) + 1
    progress = Math.min(100, Math.max(0, (daysBetween(plan.start_date, todayISO()) / total) * 100))
  }
  return (
    <div className={cn('relative overflow-hidden rounded-3xl p-5 text-white shadow-pop sm:p-6', expired ? 'bg-hero-danger' : 'bg-hero')}>
      <div className="bg-grid absolute inset-0 opacity-50" aria-hidden />
      <div className={cn('absolute -right-16 -top-16 size-56 rounded-full blur-3xl', expired ? 'bg-danger-500/40' : 'bg-accent-500/50')} aria-hidden />
      <div className={cn('absolute -bottom-20 -left-10 size-48 rounded-full blur-3xl', expired ? 'bg-warning-500/20' : 'bg-volt/25')} aria-hidden />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/70">{plan?.plan_name ? `${plan.plan_name} Membership` : 'No membership yet'}</p>
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1',
              status === 'ACTIVE' && 'bg-volt text-on-volt ring-volt',
              status === 'EXPIRING' && 'bg-warning-400 text-warning-950 ring-warning-300',
              expired && 'bg-danger-500 text-white ring-danger-400',
              none && 'bg-white/10 text-white ring-white/20',
            )}
          >
            {none ? 'INACTIVE' : status}
          </span>
        </div>
        <div className="mt-4 flex items-end gap-2">
          {expired ? (
            <span className="text-5xl font-bold leading-none tracking-tight">Expired</span>
          ) : days === 0 ? (
            <>
              <span className="text-6xl font-bold leading-none tracking-tight">Today</span>
              <span className="pb-1.5 text-base font-semibold text-white/80">is your last day</span>
            </>
          ) : (
            <>
              <span className="text-6xl font-bold leading-none tracking-tight">{days ?? '—'}</span>
              <span className="pb-1.5 text-base font-semibold text-white/80">{days === null ? 'Choose a plan' : days === 1 ? 'Day Remaining' : 'Days Remaining'}</span>
            </>
          )}
        </div>
        <p className="mt-2 text-sm text-white/75">
          {membership.expiry_date
            ? expired
              ? `Ended ${formatDate(membership.expiry_date)}${daysAgo > 0 ? ` · ${daysAgo === 1 ? '1 day' : `${daysAgo} days`} ago` : ''}`
              : `Expires ${formatDate(membership.expiry_date)}`
            : 'Start training today — pick a plan that suits you.'}
        </p>
        {plan?.start_date && !expired && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Membership used" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gradient-to-r from-volt to-success-300" style={{ width: `${progress}%` }} />
          </div>
        )}
        {membership.upcoming && (
          <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[13px]">
            Renewed ✓ {membership.upcoming.plan_name} starts {formatDate(membership.upcoming.start_date)}
          </p>
        )}
        {pending ? (
          <Link to="/portal/renew" className="mt-4 flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold ring-1 ring-white/15">
            <Hourglass className="size-4 text-volt" aria-hidden />
            {pending.plan_name ? `${pending.plan_name} payment` : 'Payment'} awaiting verification
            <ArrowRight className="ml-auto size-4" aria-hidden />
          </Link>
        ) : (
          showRenew && (
            <Link to="/portal/renew" className="mt-5 inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-[15px] font-bold text-hero shadow-lg transition hover:bg-volt active:scale-[0.98]">
              <RefreshCw className="size-4" aria-hidden />
              {none ? 'Choose a plan' : 'Renew now'}
            </Link>
          )
        )}
      </div>
    </div>
  )
}
