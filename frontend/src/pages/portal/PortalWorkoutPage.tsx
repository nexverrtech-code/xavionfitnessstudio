import { Dumbbell } from 'lucide-react'
import { WorkoutPlanCard } from '@/components/training/WorkoutPlanCard'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'

export default function PortalWorkoutPage() {
  useDocumentTitle('Workout')
  const workouts = useApi('portal:workouts', () => portalApi.workouts())
  const items = workouts.data?.items ?? []
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">My workout</h1>
        <p className="text-sm text-muted">Plans from your trainer</p>
      </div>
      {workouts.loading && !workouts.data ? (
        <SkeletonRows rows={3} />
      ) : workouts.error ? (
        <ErrorState error={workouts.error} onRetry={workouts.reload} />
      ) : !items.length ? (
        <Card>
          <EmptyState icon={Dumbbell} title="No workout plan yet" description="Your trainer will add one soon — ask at the front desk if you'd like a plan." />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((workout) => (
            <WorkoutPlanCard key={workout.id} workout={workout} />
          ))}
        </div>
      )}
    </div>
  )
}
