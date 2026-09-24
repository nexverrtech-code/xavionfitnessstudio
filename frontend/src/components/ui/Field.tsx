import { ChevronDown } from 'lucide-react'
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export const inputClasses = cn(
  'block w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink shadow-card outline-none sm:text-sm',
  'placeholder:text-faint transition-[border-color,box-shadow] duration-150',
  'focus:border-accent-500 focus:ring-4 focus:ring-accent-500/15',
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-70',
  'aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus:ring-danger-500/15',
)

interface FieldShellProps {
  id: string
  label?: string
  required?: boolean
  hint?: ReactNode
  error?: string
  className?: string
  children: ReactNode
  labelAction?: ReactNode
}

export function FieldShell({ id, label, required, hint, error, className, children, labelAction }: FieldShellProps) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
            {label}
            {required && (
              <span className="ml-0.5 text-danger-500" aria-hidden>
                *
              </span>
            )}
            {required && <span className="sr-only"> (required)</span>}
          </label>
          {labelAction}
        </div>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] font-medium text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type Common = { label?: string; hint?: ReactNode; error?: string; wrapperClassName?: string; labelAction?: ReactNode }

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement>, Common {
  ref?: Ref<HTMLInputElement>
  leading?: ReactNode
  trailing?: ReactNode
}

export function TextField({ label, hint, error, required, wrapperClassName, labelAction, leading, trailing, className, id, ref, ...props }: TextFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell id={fieldId} label={label} required={required} hint={hint} error={error} className={wrapperClassName} labelAction={labelAction}>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted">{leading}</span>}
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(inputClasses, 'h-11', !!leading && 'pl-8', !!trailing && 'pr-12', className)}
          {...props}
        />
        {trailing && <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted">{trailing}</span>}
      </div>
    </FieldShell>
  )
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, Common {
  ref?: Ref<HTMLTextAreaElement>
}

export function TextareaField({ label, hint, error, required, wrapperClassName, labelAction, className, id, rows = 3, ref, ...props }: TextareaFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell id={fieldId} label={label} required={required} hint={hint} error={error} className={wrapperClassName} labelAction={labelAction}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cn(inputClasses, 'resize-none py-2.5', className)}
        {...props}
      />
    </FieldShell>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement>, Common {
  ref?: Ref<HTMLSelectElement>
  options: { value: string | number; label: string; disabled?: boolean }[]
  placeholder?: string
}

export function SelectField({ label, hint, error, required, wrapperClassName, labelAction, options, placeholder, className, id, ref, ...props }: SelectFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell id={fieldId} label={label} required={required} hint={hint} error={error} className={wrapperClassName} labelAction={labelAction}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(inputClasses, 'h-11 appearance-none pr-10', className)}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </FieldShell>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  id?: string
}

export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  const autoId = useId()
  const switchId = id ?? autoId
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={switchId} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-line-strong',
        )}
      >
        <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  )
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: string
  ref?: Ref<HTMLInputElement>
}

export function Checkbox({ label, description, className, id, ref, ...props }: CheckboxProps) {
  const autoId = useId()
  const boxId = id ?? autoId
  return (
    <label htmlFor={boxId} className={cn('flex cursor-pointer items-start gap-3 rounded-xl py-1.5', className)}>
      <input
        ref={ref}
        id={boxId}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-md border-line-strong accent-accent-600"
        {...props}
      />
      <span className="min-w-0">
        <span className="text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted">{description}</span>}
      </span>
    </label>
  )
}
