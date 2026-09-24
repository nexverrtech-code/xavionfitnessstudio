import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { isApiError } from '@/services/api'

/**
 * Show server-side validation messages inline on the matching fields.
 * Returns true when at least one field error was applied (so callers can skip a toast).
 */
export function applyServerErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fieldMap: Record<string, string> = {}): boolean {
  if (!isApiError(error) || !error.fields) return false
  let applied = false
  for (const [field, message] of Object.entries(error.fields)) {
    const name = (fieldMap[field] ?? field) as Path<T>
    if (!name || name === 'request') continue
    setError(name, { type: 'server', message })
    applied = true
  }
  return applied
}

export const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}
