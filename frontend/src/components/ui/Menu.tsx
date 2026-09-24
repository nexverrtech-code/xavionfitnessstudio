import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '@/hooks/useUtilities'
import { cn } from '@/utils/cn'
import { initials } from '@/utils/format'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  tone?: 'danger'
  disabled?: boolean
  hidden?: boolean
}

export function Menu({ trigger, items, align = 'right', label }: { trigger: (props: { open: boolean; toggle: () => void }) => ReactNode; items: (MenuItem | 'divider')[]; align?: 'left' | 'right'; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useClickOutside(ref, close, open)

  useEffect(() => {
    if (!open) return
    const first = ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const nodes = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
      const index = nodes.indexOf(document.activeElement as HTMLButtonElement)
      const next = nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]
      next?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const visible = items.filter((item) => item === 'divider' || !item.hidden)
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'absolute z-50 mt-2 min-w-52 animate-pop-in rounded-2xl border border-line bg-surface p-1.5 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {visible.map((item, index) =>
            item === 'divider' ? (
              <div key={`d${index}`} className="my-1 h-px bg-line" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium outline-none disabled:opacity-40',
                  item.tone === 'danger' ? 'text-danger-600 hover:bg-danger-50 focus:bg-danger-50 dark:hover:bg-danger-500/10' : 'text-ink-2 hover:bg-hover focus:bg-hover',
                )}
              >
                {item.icon && <item.icon className="size-4 shrink-0" aria-hidden />}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** Initials avatar — SmartGym stores no photos. */
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const sizes = { sm: 'size-8 text-[11px]', md: 'size-10 text-sm', lg: 'size-12 text-base', xl: 'size-16 text-xl' }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-hero font-bold text-volt shadow-sm ring-1 ring-black/5 dark:ring-white/10',
        sizes[size],
        className,
      )}
    >
      {initials(name) || '?'}
    </span>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-subtle px-1.5 font-sans text-[11px] font-semibold text-muted', className)}>
      {children}
    </kbd>
  )
}
