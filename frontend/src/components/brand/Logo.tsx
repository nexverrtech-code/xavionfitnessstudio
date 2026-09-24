import { useId } from 'react'
import { cn } from '@/utils/cn'

export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: a gradient defined inside a hidden (display:none) copy of the
  // logo can't be referenced by a visible one.
  const gradientId = useId()
  return (
    <svg viewBox="0 0 64 64" className={cn('size-9 shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-logo-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-logo-to)' }} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path d="M35.8 7.5 17 35.2h13.4L27 56.5l20-28.8H33.4Z" style={{ fill: 'var(--color-volt)' }} />
    </svg>
  )
}

export function Logo({ name = 'SmartGym', className, compact }: { name?: string; className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && <span className="truncate text-[17px] font-bold tracking-tight text-ink">{name}</span>}
    </span>
  )
}
