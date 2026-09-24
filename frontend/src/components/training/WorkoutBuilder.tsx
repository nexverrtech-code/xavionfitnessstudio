import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { Button, IconButton } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { workoutsApi } from '@/services/endpoints'
import { emptyExercise, workoutPayload, workoutSchema, type ExerciseValues, type WorkoutValues } from '@/schemas/training'
import type { Workout } from '@/types'
import { applyServerErrors } from '@/utils/forms'

// Client-side starting points (no storage): trainers adjust sets/reps/weights per member.
const TEMPLATES: Record<string, [string, string, string, string, string][]> = {
  'Chest + Triceps': [
    ['Bench Press', '4', '10', '60', '90'],
    ['Incline Dumbbell Press', '3', '12', '20', '75'],
    ['Cable Fly', '3', '15', '15', '60'],
    ['Tricep Pushdown', '3', '12', '25', '60'],
  ],
  'Back + Biceps': [
    ['Deadlift', '4', '6', '100', '120'],
    ['Lat Pulldown', '3', '12', '50', '75'],
    ['Seated Cable Row', '3', '12', '45', '75'],
    ['Barbell Curl', '3', '10', '25', '60'],
  ],
  'Legs + Core': [
    ['Back Squat', '4', '8', '80', '120'],
    ['Leg Press', '3', '12', '150', '90'],
    ['Walking Lunges', '3', '20', '12', '60'],
    ['Plank', '3', '60s', '', '45'],
  ],
  'Full Body': [
    ['Kettlebell Swing', '4', '15', '16', '45'],
    ['Push-ups', '3', '15', '', '45'],
    ['Goblet Squat', '3', '12', '20', '60'],
    ['Rowing Machine', '3', '500m', '', '60'],
  ],
}

interface WorkoutBuilderProps {
  open: boolean
  onClose: () => void
  memberId: number | null
  memberName?: string
  workout?: Workout | null
  onSaved?: (workout: Workout) => void
}

function toValues(workout?: Workout | null): WorkoutValues {
  if (!workout) return { title: '', day_label: '', notes: '', exercises: [{ ...emptyExercise }] }
  const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v))
  return {
    title: workout.title,
    day_label: workout.day_label ?? '',
    notes: workout.notes ?? '',
    exercises: workout.exercises.map((e) => ({
      exercise_name: e.exercise_name,
      sets: str(e.sets),
      reps: e.reps ?? '',
      weight: str(e.weight),
      rest_seconds: str(e.rest_seconds),
      notes: e.notes ?? '',
    })),
  }
}

export function WorkoutBuilder({ open, onClose, memberId, memberName, workout, onSaved }: WorkoutBuilderProps) {
  const toast = useToast()
  const { register, control, handleSubmit, reset, setValue, setError, formState } = useForm<WorkoutValues>({
    resolver: zodResolver(workoutSchema),
    defaultValues: toValues(workout),
  })
  const { fields, append, remove, move, replace } = useFieldArray({ control, name: 'exercises' })

  useEffect(() => {
    if (open) reset(toValues(workout))
  }, [open, workout, reset])

  const applyTemplate = (name: string) => {
    setValue('title', name, { shouldValidate: true })
    replace(TEMPLATES[name].map(([exercise_name, sets, reps, weight, rest_seconds]): ExerciseValues => ({ exercise_name, sets, reps, weight, rest_seconds, notes: '' })))
  }

  const submit = handleSubmit(async (values) => {
    if (!memberId) return
    const payload = workoutPayload(values)
    try {
      const saved = workout
        ? await workoutsApi.update(workout.id, { ...payload, status: workout.status })
        : await workoutsApi.create({ member_id: memberId, ...payload })
      invalidate(`member:${memberId}`, 'workouts')
      toast.success(workout ? 'Workout updated' : 'Workout created')
      onSaved?.(saved)
      onClose()
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="drawer"
      title={workout ? 'Edit workout' : 'Create workout'}
      description={memberName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="workout-form" loading={formState.isSubmitting}>
            {workout ? 'Save workout' : 'Create workout'}
          </Button>
        </>
      }
    >
      <form id="workout-form" onSubmit={submit} className="space-y-4" noValidate>
        {!workout && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
              <Sparkles className="size-4 text-accent-700" aria-hidden /> Start from a template
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(TEMPLATES).map((name) => (
                <button key={name} type="button" onClick={() => applyTemplate(name)} className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:border-accent-400 hover:bg-hover">
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <TextField label="Title" required placeholder="Chest + Triceps" error={formState.errors.title?.message} {...register('title')} data-autofocus />
          <TextField label="Day" placeholder="Mon / Thu" error={formState.errors.day_label?.message} {...register('day_label')} />
        </div>

        <div className="space-y-3">
          {fields.map((field, index) => {
            const e = formState.errors.exercises?.[index]
            return (
              <div key={field.id} className="rounded-2xl border border-line bg-subtle p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-9 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-on-primary">{index + 1}</span>
                  <TextField label="Exercise" required wrapperClassName="flex-1" placeholder="Bench Press" error={e?.exercise_name?.message} {...register(`exercises.${index}.exercise_name`)} />
                  <div className="mt-7 flex gap-0.5">
                    <IconButton icon={ArrowUp} label="Move up" size="icon-sm" disabled={index === 0} onClick={() => move(index, index - 1)} />
                    <IconButton icon={ArrowDown} label="Move down" size="icon-sm" disabled={index === fields.length - 1} onClick={() => move(index, index + 1)} />
                    <IconButton icon={Trash2} label="Remove exercise" size="icon-sm" disabled={fields.length === 1} onClick={() => remove(index)} className="hover:text-danger-600" />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 pl-8">
                  <TextField label="Sets" inputMode="numeric" error={e?.sets?.message} {...register(`exercises.${index}.sets`)} />
                  <TextField label="Reps" placeholder="10" error={e?.reps?.message} {...register(`exercises.${index}.reps`)} />
                  <TextField label="Kg" inputMode="decimal" placeholder="—" error={e?.weight?.message} {...register(`exercises.${index}.weight`)} />
                  <TextField label="Rest s" inputMode="numeric" error={e?.rest_seconds?.message} {...register(`exercises.${index}.rest_seconds`)} />
                </div>
              </div>
            )
          })}
          {formState.errors.exercises?.root?.message && <p className="text-[13px] font-medium text-danger-600">{formState.errors.exercises.root.message}</p>}
          <Button variant="soft" icon={Plus} fullWidth onClick={() => append({ ...emptyExercise })} disabled={fields.length >= 40}>
            Add exercise
          </Button>
        </div>
        <TextField label="Notes" placeholder="Warm up 10 min · focus on form" {...register('notes')} />
      </form>
    </Dialog>
  )
}
