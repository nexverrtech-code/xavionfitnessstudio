import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { StatusBadge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Menu'
import { useDebounce } from '@/hooks/useUtilities'
import { membersApi } from '@/services/endpoints'
import type { MemberListItem } from '@/types'
import { cn } from '@/utils/cn'

interface MemberPickerProps {
  value: MemberListItem | null
  onChange: (member: MemberListItem | null) => void
  label?: string
  autoFocus?: boolean
  error?: string
}

/** Debounced, index-backed member search (name prefix, phone, member ID, email). */
export function MemberPicker({ value, onChange, label = 'Member', autoFocus, error }: MemberPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounce(query.trim(), 250)
  const inputId = useId()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([])
      return
    }
    const controller = new AbortController()
    setLoading(true)
    membersApi
      .search(debounced, controller.signal)
      .then((data) => {
        setResults(data.items)
        setActive(0)
      })
      .catch(() => undefined)
      .finally(() => !controller.signal.aborted && setLoading(false))
    return () => controller.abort()
  }, [debounced])

  if (value) {
    return (
      <div>
        {label && <p className="mb-1.5 text-[13px] font-semibold text-ink-2">{label}</p>}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-subtle p-3">
          <Avatar name={value.name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{value.name}</p>
            <p className="truncate text-[13px] text-muted">
              {value.member_code} · {value.phone}
            </p>
          </div>
          <StatusBadge status={value.membership.status} size="sm" />
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink"
            aria-label="Change member"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  const open = debounced.length >= 2
  return (
    <div className="relative">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-semibold text-ink-2">
          {label}
          <span className="ml-0.5 text-danger-500" aria-hidden>
            *
          </span>
        </label>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={inputRef}
          id={inputId}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((i) => Math.min(i + 1, results.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (event.key === 'Enter' && results[active]) {
              event.preventDefault()
              onChange(results[active])
              setQuery('')
            }
          }}
          placeholder="Search by name, phone or member ID"
          className={cn(inputClasses, 'h-11 pl-10 pr-10')}
          autoComplete="off"
        />
        {loading && <Spinner className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" />}
      </div>
      {error && <p className="mt-1.5 text-[13px] font-medium text-danger-600">{error}</p>}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
          {results.length === 0 && !loading && <li className="px-3 py-6 text-center text-sm text-muted">No members match “{debounced}”.</li>}
          {results.map((member, index) => (
            <li key={member.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onChange(member)
                  setQuery('')
                }}
                className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left', index === active && 'bg-hover')}
              >
                <Avatar name={member.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{member.name}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {member.member_code} · {member.phone}
                  </span>
                </span>
                <StatusBadge status={member.membership.status} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
