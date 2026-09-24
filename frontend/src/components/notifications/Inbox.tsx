import { Bell } from 'lucide-react'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { notificationsApi } from '@/services/endpoints'
import type { NotificationItem } from '@/types'
import { cn } from '@/utils/cn'
import { relativeTime } from '@/utils/format'
import { notificationMeta } from '@/utils/notifications'

/** The signed-in person's in-app notifications (members, trainers, staff and admins alike). */
export function useInbox(enabled = true) {
  const toast = useToast()
  const inbox = useApi(enabled ? 'inbox' : null, () => notificationsApi.inbox(), { freshMs: 30_000 })
  const refresh = () => invalidate('inbox', 'portal:overview')
  const markAll = async () => {
    try {
      await notificationsApi.readAll()
      inbox.setData((data) => data && { unread: 0, items: data.items.map((n) => ({ ...n, status: 'READ' as const })) })
      refresh()
    } catch (error) {
      toast.fromError(error)
    }
  }
  const markOne = async (item: NotificationItem) => {
    if (item.status === 'READ') return
    inbox.setData((data) => data && { unread: Math.max(0, data.unread - 1), items: data.items.map((n) => (n.id === item.id ? { ...n, status: 'READ' as const } : n)) })
    try {
      await notificationsApi.read(item.id)
      invalidate('portal:overview')
    } catch {
      refresh()
    }
  }
  return { ...inbox, unread: inbox.data?.unread ?? 0, markAll, markOne }
}

export function InboxList({ inbox, compact }: { inbox: ReturnType<typeof useInbox>; compact?: boolean }) {
  if (inbox.loading && !inbox.data) return <SkeletonRows rows={compact ? 3 : 4} className={compact ? 'p-3' : undefined} />
  if (inbox.error && !inbox.data) return <ErrorState compact error={inbox.error} onRetry={inbox.reload} />
  const items = inbox.data?.items ?? []
  if (!items.length) return <EmptyState compact icon={Bell} title="No notifications yet" description="Reminders, payment updates and announcements appear here." />
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => {
        const { label, icon: Icon } = notificationMeta(n.type)
        const unread = n.status === 'UNREAD'
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => void inbox.markOne(n)}
              className={cn(
                'flex w-full cursor-pointer gap-3 px-4 py-3.5 text-left transition-colors hover:bg-hover',
                unread && 'bg-subtle',
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-2 ring-1 ring-line">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</span>
                  {unread && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-on-primary">
                      New<span className="sr-only"> — unread</span>
                    </span>
                  )}
                </span>
                <span className={cn('mt-0.5 block text-sm', unread ? 'font-medium text-ink' : 'text-ink-2')}>{n.message}</span>
                <span className="mt-0.5 block text-[12px] text-faint">{relativeTime(n.created_at)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
