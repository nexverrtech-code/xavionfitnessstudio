import type { Metric } from '@/types'

/** Display order and units for body measurements (the API stores plain numbers). */
export const METRIC_META: Record<Metric, { label: string; unit: string }> = {
  weight: { label: 'Weight', unit: 'kg' },
  body_fat: { label: 'Body fat', unit: '%' },
  waist: { label: 'Waist', unit: 'cm' },
  chest: { label: 'Chest', unit: 'cm' },
  arm: { label: 'Arm', unit: 'cm' },
  thigh: { label: 'Thigh', unit: 'cm' },
  height: { label: 'Height', unit: 'cm' },
}

export const METRIC_ORDER: Metric[] = ['weight', 'body_fat', 'waist', 'chest', 'arm', 'thigh', 'height']
