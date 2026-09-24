import { z } from 'zod'

const optionalNumber = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max), {
      error: `${label}: enter ${min}–${max}`,
    })

export const exerciseSchema = z.object({
  exercise_name: z.string().trim().min(2, 'Exercise name is required').max(80),
  sets: optionalNumber(1, 50, 'Sets'),
  reps: z.string().trim().max(16, 'Keep reps short, e.g. 10 or 8-12'),
  weight: optionalNumber(0, 1000, 'Weight'),
  rest_seconds: optionalNumber(0, 1800, 'Rest'),
  notes: z.string().trim().max(120),
})

export const workoutSchema = z.object({
  title: z.string().trim().min(2, 'Give the workout a title, e.g. Chest + Triceps').max(80),
  day_label: z.string().trim().max(30),
  notes: z.string().trim().max(250),
  exercises: z.array(exerciseSchema).min(1, 'Add at least one exercise').max(40, 'Up to 40 exercises'),
})
export type WorkoutValues = z.infer<typeof workoutSchema>
export type ExerciseValues = z.infer<typeof exerciseSchema>

export const emptyExercise: ExerciseValues = { exercise_name: '', sets: '3', reps: '12', weight: '', rest_seconds: '60', notes: '' }

export function workoutPayload(values: WorkoutValues) {
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  return {
    title: values.title.trim(),
    day_label: values.day_label.trim() || null,
    notes: values.notes.trim() || null,
    exercises: values.exercises.map((e) => ({
      exercise_name: e.exercise_name.trim(),
      sets: num(e.sets),
      reps: e.reps.trim() || null,
      weight: num(e.weight),
      rest_seconds: num(e.rest_seconds),
      notes: e.notes.trim() || null,
    })),
  }
}

export const measurementSchema = z
  .object({
    date: z.string(),
    weight: optionalNumber(10, 400, 'Weight'),
    height: optionalNumber(50, 260, 'Height'),
    body_fat: optionalNumber(1, 75, 'Body fat'),
    chest: optionalNumber(30, 250, 'Chest'),
    waist: optionalNumber(30, 250, 'Waist'),
    arm: optionalNumber(10, 100, 'Arm'),
    thigh: optionalNumber(20, 150, 'Thigh'),
  })
  .refine((v) => [v.weight, v.height, v.body_fat, v.chest, v.waist, v.arm, v.thigh].some((x) => x.trim() !== ''), {
    error: 'Enter at least one measurement',
    path: ['weight'],
  })
export type MeasurementValues = z.infer<typeof measurementSchema>

export const notifySchema = z.object({
  message: z.string().trim().min(3, 'Write a short message').max(280, 'Keep it under 280 characters'),
})
export type NotifyValues = z.infer<typeof notifySchema>
