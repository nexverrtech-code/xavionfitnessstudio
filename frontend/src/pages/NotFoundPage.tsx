import { Compass } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Feedback'
import { useDocumentTitle } from '@/hooks/useUtilities'

export default function NotFoundPage() {
  useDocumentTitle('Not found')
  return (
    <div className="flex min-h-[70dvh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <ButtonLink to="/" variant="primary">
            Go home
          </ButtonLink>
        }
      />
    </div>
  )
}
