import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/utils/cn'
import { Button } from './Button'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

let openCount = 0

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** "drawer" slides in from the right on desktop; both become bottom sheets on phones. */
  variant?: 'modal' | 'drawer'
  dismissible?: boolean
  initialFocus?: string
}

const SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', variant = 'modal', dismissible = true, initialFocus }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    openCount += 1
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current
      const target = (initialFocus && panel?.querySelector<HTMLElement>(initialFocus)) || panel?.querySelector<HTMLElement>('[data-autofocus]') || panel?.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus()
    }, 30)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation()
        onCloseRef.current()
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      openCount -= 1
      if (openCount <= 0) document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open, dismissible, initialFocus])

  if (!open) return null
  const drawer = variant === 'drawer'

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 animate-fade-in bg-neutral-950/45 backdrop-blur-[2px]" onClick={dismissible ? onClose : undefined} aria-hidden />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex',
          drawer ? 'items-end sm:items-stretch sm:justify-end' : 'items-end justify-center sm:items-center sm:p-6',
        )}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            'pointer-events-auto flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface shadow-pop',
            'animate-sheet-up rounded-t-3xl border-t border-line sm:border',
            drawer
              ? 'sm:h-full sm:max-h-none sm:w-[520px] sm:max-w-[92vw] sm:animate-drawer-in sm:rounded-none sm:rounded-l-3xl'
              : cn('sm:animate-pop-in sm:rounded-3xl', SIZES[size]),
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button type="button" onClick={onClose} className="-mr-1.5 rounded-xl p-2 text-muted hover:bg-hover hover:text-ink" aria-label="Close">
                <X className="size-5" aria-hidden />
              </button>
            )}
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
          {footer && <div className="pb-safe flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-subtle px-5 py-3.5 sm:flex-row sm:justify-end sm:px-6">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<unknown> | unknown
  title: string
  message: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  children?: ReactNode
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'danger', children }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch {
      /* caller shows the toast; keep the dialog open */
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={confirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{message}</div>
      {children}
    </Dialog>
  )
}
