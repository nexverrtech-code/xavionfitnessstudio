import type { LucideIcon } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/utils/cn'
import { Skeleton } from './Feedback'

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ title, description, action, icon: Icon, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pb-3 pt-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-2 ring-1 ring-line">
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

const STAT_TONES = {
  brand: 'bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300',
  green: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-300',
  amber: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300',
  red: 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-300',
  blue: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-300',
  slate: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-500/15 dark:text-neutral-300',
}

interface StatCardProps {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: keyof typeof STAT_TONES
  hint?: ReactNode
  to?: string
  loading?: boolean
  className?: string
}

export function StatCard({ label, value, icon: Icon, tone = 'brand', hint, to, loading, className }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <span className={cn('flex size-8 items-center justify-center rounded-lg', STAT_TONES[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <div className="mt-2 truncate text-[22px] font-bold tracking-tight text-ink sm:text-2xl lg:text-[22px] 2xl:text-2xl">{value}</div>
      )}
      {hint && !loading && <div className="mt-1 truncate text-[12px] text-muted">{hint}</div>}
    </>
  )
  const classes = cn('block rounded-2xl border border-line bg-surface p-4 shadow-card', className)
  if (to) {
    return (
      <Link to={to} className={cn(classes, 'transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop')}>
        {body}
      </Link>
    )
  }
  return <div className={classes}>{body}</div>
}

export function KeyValue({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-ink">{value || '—'}</dd>
    </div>
  )
}
