import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Skeleton } from './Feedback'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}

interface DataListProps<T> {
  rows: T[] | undefined
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  /** Compact card used below the md breakpoint instead of a cramped table. */
  mobile: (row: T) => ReactNode
  onRowClick?: (row: T) => void
  loading?: boolean
  empty?: ReactNode
  skeletonRows?: number
  className?: string
}

/** Responsive list: a table on tablets/desktops, touch-friendly cards on phones. */
export function DataList<T>({ rows, columns, rowKey, mobile, onRowClick, loading, empty, skeletonRows = 6, className }: DataListProps<T>) {
  if (loading && !rows) {
    return (
      <div className={cn('divide-y divide-line', className)} role="status" aria-label="Loading">
        {Array.from({ length: skeletonRows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    )
  }
  if (!rows || rows.length === 0) return <>{empty}</>

  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')
  return (
    <div className={className}>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn('whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint', align(column.align), column.className)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter') onRowClick(row)
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-hover focus-visible:bg-hover')}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-4 py-3 align-middle text-ink-2', align(column.align), column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            {onRowClick ? (
              <button type="button" onClick={() => onRowClick(row)} className="block w-full px-4 py-3.5 text-left active:bg-hover">
                {mobile(row)}
              </button>
            ) : (
              <div className="px-4 py-3.5">{mobile(row)}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
