import { CheckCheck } from 'lucide-react'
import { InboxList, useInbox } from '@/components/notifications/Inbox'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAction, useDocumentTitle } from '@/hooks/useUtilities'

export default function PortalNotificationsPage() {
  useDocumentTitle('Notifications')
  const inbox = useInbox()
  const markAll = useAction(inbox.markAll)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Notifications</h1>
          <p className="text-sm text-muted">{inbox.unread ? `${inbox.unread} unread` : 'You’re all caught up'}</p>
        </div>
        {inbox.unread > 0 && (
          <Button size="sm" variant="secondary" icon={CheckCheck} loading={markAll.loading} onClick={() => markAll.run()}>
            Mark all read
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        <InboxList inbox={inbox} />
      </Card>
    </div>
  )
}
