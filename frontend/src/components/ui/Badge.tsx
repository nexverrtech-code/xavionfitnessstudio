import {
  Archive,
  Ban,
  BadgeCheck,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  Eye,
  Gauge,
  Hourglass,
  Lock,
  Mail,
  MinusCircle,
  OctagonAlert,
  PauseCircle,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet' | 'orange'

const TONE_CLASSES: Record<Tone, string> = {
  green: 'bg-success-50 text-success-700 ring-success-600/15 dark:bg-success-500/10 dark:text-success-300 dark:ring-success-400/20',
  amber: 'bg-warning-50 text-warning-800 ring-warning-600/20 dark:bg-warning-500/10 dark:text-warning-300 dark:ring-warning-400/20',
  red: 'bg-danger-50 text-danger-700 ring-danger-600/15 dark:bg-danger-500/10 dark:text-danger-300 dark:ring-danger-400/20',
  blue: 'bg-info-50 text-info-700 ring-info-600/15 dark:bg-info-500/10 dark:text-info-300 dark:ring-info-400/20',
  slate: 'bg-neutral-100 text-neutral-700 ring-neutral-500/15 dark:bg-neutral-500/15 dark:text-neutral-300 dark:ring-neutral-400/15',
  violet: 'bg-accent-50 text-accent-800 ring-accent-600/15 dark:bg-accent-500/15 dark:text-accent-200 dark:ring-accent-400/20',
  orange: 'bg-warning-50 text-warning-700 ring-warning-600/15 dark:bg-warning-500/10 dark:text-warning-300 dark:ring-warning-400/20',
}

const STATUS: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  // members & memberships
  ACTIVE: { label: 'Active', tone: 'green', icon: CheckCircle2 },
  EXPIRING: { label: 'Expiring', tone: 'amber', icon: Clock3 },
  EXPIRED: { label: 'Expired', tone: 'red', icon: XCircle },
  NONE: { label: 'No plan', tone: 'slate', icon: CircleDashed },
  UPCOMING: { label: 'Upcoming', tone: 'blue', icon: CalendarClock },
  CANCELLED: { label: 'Cancelled', tone: 'slate', icon: Ban },
  SUSPENDED: { label: 'Suspended', tone: 'orange', icon: PauseCircle },
  INACTIVE: { label: 'Inactive', tone: 'slate', icon: MinusCircle },
  // payments
  PENDING: { label: 'Pending', tone: 'blue', icon: Hourglass },
  PAID: { label: 'Paid', tone: 'green', icon: BadgeCheck },
  FAILED: { label: 'Failed', tone: 'red', icon: TriangleAlert },
  REJECTED: { label: 'Rejected', tone: 'red', icon: Ban },
  REFUNDED: { label: 'Refunded', tone: 'violet', icon: RotateCcw },
  // notifications & accounts
  UNREAD: { label: 'Unread', tone: 'blue', icon: Mail },
  READ: { label: 'Read', tone: 'slate', icon: Eye },
  DISABLED: { label: 'Disabled', tone: 'slate', icon: Lock },
  ARCHIVED: { label: 'Archived', tone: 'slate', icon: Archive },
  // backups
  CREATED: { label: 'Created', tone: 'slate', icon: CircleDashed },
  VERIFIED: { label: 'Verified', tone: 'green', icon: ShieldCheck },
  ARCHIVING: { label: 'Archiving', tone: 'amber', icon: Hourglass },
  COMPLETED: { label: 'Completed', tone: 'green', icon: CheckCheck },
  // storage levels
  HEALTHY: { label: 'Healthy', tone: 'green', icon: CheckCircle2 },
  MONITOR: { label: 'Monitor', tone: 'blue', icon: Gauge },
  WARNING: { label: 'Warning', tone: 'amber', icon: TriangleAlert },
  CRITICAL: { label: 'Critical', tone: 'orange', icon: CircleAlert },
  ARCHIVE_REQUIRED: { label: 'Archive required', tone: 'red', icon: OctagonAlert },
}

/** Status is always shown as icon + text + colour — never colour alone. */
export function StatusBadge({ status, label, className, size = 'md' }: { status: string; label?: string; className?: string; size?: 'sm' | 'md' }) {
  const meta = STATUS[status] ?? { label: status, tone: 'slate' as Tone, icon: CircleDashed }
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} aria-hidden />
      {label ?? meta.label}
    </span>
  )
}

export function Pill({ children, tone = 'slate', className, icon: Icon }: { children: ReactNode; tone?: Tone; className?: string; icon?: LucideIcon }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', TONE_CLASSES[tone], className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  )
}
