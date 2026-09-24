import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

/** Determinate progress with visible text, announced to screen readers. */
export function ProgressBar({ value, max, label, detail }: { value: number; max: number; label: string; detail?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink-2">{label}</span>
        <span className="tabular text-muted">{detail ?? `${formatNumber(value)} / ${formatNumber(max)} · ${percent}%`}</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-subtle ring-1 ring-inset ring-line"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export interface Step {
  key: string
  label: string
}

/** "Step 2 of 4" indicator for multi-step flows. */
export function Stepper({ steps, current, done = [] }: { steps: Step[]; current: string; done?: string[] }) {
  const index = steps.findIndex((s) => s.key === current)
  return (
    <nav aria-label="Progress">
      <p className="sr-only">
        Step {index + 1} of {steps.length}: {steps[index]?.label}
      </p>
      <ol className="flex items-center gap-2" aria-hidden>
        {steps.map((step, i) => {
          const complete = done.includes(step.key) || i < index
          const active = step.key === current
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ring-1',
                  complete ? 'bg-primary text-on-primary ring-primary' : active ? 'bg-surface text-ink ring-2 ring-primary' : 'bg-subtle text-muted ring-line',
                )}
              >
                {complete ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('hidden truncate text-[13px] font-semibold sm:block', active ? 'text-ink' : 'text-muted')}>{step.label}</span>
              {i < steps.length - 1 && <span className={cn('h-px min-w-3 flex-1', complete ? 'bg-primary' : 'bg-line')} />}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[13px] font-semibold text-ink sm:hidden">
        Step {index + 1} of {steps.length} · {steps[index]?.label}
      </p>
    </nav>
  )
}
