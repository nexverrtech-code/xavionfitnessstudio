import type { ReactNode } from 'react'
import { StatusBadge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import type { Workout } from '@/types'
import { cn } from '@/utils/cn'
import { relativeTime } from '@/utils/format'

export function WorkoutPlanCard({ workout, actions }: { workout: Workout; actions?: ReactNode }) {
  return (
    <Card className={cn(workout.status === 'ARCHIVED' && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{workout.title}</h3>
            {workout.day_label && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted ring-1 ring-line">{workout.day_label}</span>}
            {workout.status === 'ARCHIVED' && <StatusBadge status="ARCHIVED" size="sm" />}
          </div>
          <p className="mt-0.5 text-[12px] text-muted">
            {workout.exercises.length} exercises{workout.trainer_name && ` · by ${workout.trainer_name}`} · updated {relativeTime(workout.updated_at)}
          </p>
        </div>
        {actions}
      </div>
      <ol className="mt-3 divide-y divide-line border-t border-line">
        {workout.exercises.map((e, index) => (
          <li key={e.id ?? index} className="flex items-center gap-3 px-5 py-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-50 text-[11px] font-bold text-accent-800 dark:bg-accent-500/15 dark:text-accent-200">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{e.exercise_name}</span>
            <span className="tabular shrink-0 text-sm font-semibold text-ink-2">
              {e.sets ?? '–'} × {e.reps ?? '–'}
            </span>
            <span className="tabular w-16 shrink-0 text-right text-[13px] text-muted">{e.weight ? `${e.weight} kg` : 'Body wt'}</span>
            <span className="tabular hidden w-14 shrink-0 text-right text-[12px] text-faint sm:block">{e.rest_seconds ? `${e.rest_seconds}s` : ''}</span>
          </li>
        ))}
      </ol>
      {workout.notes && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">{workout.notes}</p>}
    </Card>
  )
}
