import { AlertTriangle, CheckCircle2, Info, WifiOff, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'offline'

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

interface ToastOptions {
  description?: string
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface ToastApi {
  success: (title: string, options?: ToastOptions) => void
  error: (title: string, options?: ToastOptions) => void
  info: (title: string, options?: ToastOptions) => void
  warning: (title: string, options?: ToastOptions) => void
  /** Shows the right message for an API error (offline / network / validation / server). */
  fromError: (error: unknown, fallback?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle, offline: WifiOff }
const TONES = {
  success: 'text-success-600 dark:text-success-400',
  error: 'text-danger-600 dark:text-danger-400',
  info: 'text-accent-700 dark:text-accent-300',
  warning: 'text-warning-600 dark:text-warning-400',
  offline: 'text-neutral-500',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (kind: ToastKind, title: string, options: ToastOptions = {}) => {
      const id = ++counter.current
      setToasts((list) => [...list.slice(-3), { id, kind, title, description: options.description, action: options.action }])
      const duration = options.duration ?? (kind === 'error' || kind === 'offline' ? 6000 : 3800)
      window.setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, o) => push('success', t, o),
      error: (t, o) => push('error', t, o),
      info: (t, o) => push('info', t, o),
      warning: (t, o) => push('warning', t, o),
      fromError: (error, fallback = 'Something went wrong. Please try again.') => {
        const e = error as { code?: string; message?: string } | undefined
        if (e?.code === 'CANCELLED') return
        if (e?.code === 'OFFLINE') push('offline', "You're offline.", { description: 'Reconnect to continue.' })
        else push('error', e?.message || fallback)
      },
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6 lg:bottom-6"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.kind]
          return (
            <div
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 pr-2.5 shadow-pop"
            >
              <Icon className={cn('mt-0.5 size-5 shrink-0', TONES[toast.kind])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-sm text-muted">{toast.description}</p>}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action!.onClick()
                      dismiss(toast.id)
                    }}
                    className="mt-1.5 text-sm font-semibold text-accent-700 hover:underline dark:text-accent-300"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-lg p-1 text-faint hover:bg-hover hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="size-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
