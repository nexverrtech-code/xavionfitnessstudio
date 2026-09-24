import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

export interface TabItem<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  badge?: number
}

/** Accessible tabs (arrow keys move between tabs). */
export function Tabs<T extends string>({ items, value, onChange, className }: { items: TabItem<T>[]; value: T; onChange: (value: T) => void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const next = (index + delta + items.length) % items.length
    refs.current[next]?.focus()
    onChange(items[next].value)
  }
  return (
    <div role="tablist" className={cn('no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1', className)}>
      {items.map((item, index) => {
        const active = item.value === value
        const Icon = item.icon
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'relative inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition-colors',
              active ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:bg-hover hover:text-ink',
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            {item.label}
            {!!item.badge && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-on-primary">{item.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Filter chips; one option is always selected. */
export function Segmented<T extends string>({ options, value, onChange, className, label }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; className?: string; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
              active
                ? 'border-primary bg-primary text-on-primary shadow-sm'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-hover',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn('tabular rounded-full px-1.5 text-[11px]', active ? 'bg-white/20' : 'bg-subtle text-muted')}>{option.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

interface PaginationProps {
  page: number
  pages: number
  total: number
  limit: number
  onPage: (page: number) => void
  onLimit?: (limit: number) => void
  sizes?: number[]
}

export function Pagination({ page, pages, total, limit, onPage, onLimit, sizes = [20, 50, 100] }: PaginationProps) {
  if (total === 0) return null
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)
  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 px-1 py-3 sm:flex-row">
      <p className="text-[13px] text-muted">
        Showing <span className="tabular font-semibold text-ink">{formatNumber(from)}–{formatNumber(to)}</span> of{' '}
        <span className="tabular font-semibold text-ink">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        {onLimit && (
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <span className="hidden sm:inline">Rows</span>
            <select
              value={limit}
              onChange={(event) => onLimit(Number(event.target.value))}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] font-semibold text-ink"
              aria-label="Rows per page"
            >
              {sizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-hover disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="tabular min-w-16 text-center text-[13px] font-semibold text-ink">
          {page} / {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-hover disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  )
}

export interface Crumb {
  label: string
  to?: string
}

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  crumbs?: Crumb[]
  className?: string
}

export function PageHeader({ title, description, actions, crumbs, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1 text-[13px] text-muted">
            {crumbs.map((crumb, index) => (
              <span key={crumb.label} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-3.5 text-faint" aria-hidden />}
                {crumb.to ? (
                  <Link to={crumb.to} className="font-medium hover:text-ink">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="font-medium text-ink-2">
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        {title && <h1 className="truncate text-2xl font-bold tracking-tight text-ink sm:text-[26px]">{title}</h1>}
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
