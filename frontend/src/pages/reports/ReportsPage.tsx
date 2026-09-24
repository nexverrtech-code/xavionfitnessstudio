import { CalendarCheck2, ClipboardList, Eye, FileSpreadsheet, FileText, Receipt, Users, Wallet, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { inputClasses } from '@/components/ui/Field'
import { PageHeader, Segmented } from '@/components/ui/Navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { displayCell, downloadReport, REPORT_COLUMNS, reportSummary } from '@/services/documents'
import { reportsApi } from '@/services/endpoints'
import type { ReportData, ReportKind } from '@/types'
import { cn } from '@/utils/cn'
import { addDaysISO, formatDate, formatNumber, todayISO } from '@/utils/format'

interface ReportDef {
  kind: ReportKind
  title: string
  description: string
  icon: LucideIcon
  adminOnly?: boolean
  basis: string
}

const REPORTS: ReportDef[] = [
  { kind: 'members', title: 'Member report', description: 'Members who joined in the period, with status, trainer and membership end date.', icon: Users, basis: 'By joining date' },
  { kind: 'memberships', title: 'Membership report', description: 'Memberships that started in the period, per plan, with renewals and value.', icon: ClipboardList, basis: 'By start date' },
  { kind: 'payments', title: 'Payment report', description: 'Every payment with its number, method, UTR, status, refund and who verified it.', icon: Wallet, basis: 'By payment date' },
  { kind: 'attendance', title: 'Attendance report', description: 'Each check-in, with daily, weekly and monthly totals.', icon: CalendarCheck2, basis: 'By visit date' },
  { kind: 'expenses', title: 'Expense report', description: 'Expenses by category with totals.', icon: Receipt, adminOnly: true, basis: 'By expense date' },
]

type Range = 'month' | 'last' | 'quarter' | 'year' | 'custom'
const PREVIEW_ROWS = 50
const MAX_DAYS = 731

function resolve(range: Range, from: string, to: string): [string, string] {
  const today = todayISO()
  const monthStart = `${today.slice(0, 7)}-01`
  switch (range) {
    case 'month':
      return [monthStart, today]
    case 'last': {
      const end = addDaysISO(monthStart, -1)
      return [`${end.slice(0, 7)}-01`, end]
    }
    case 'quarter':
      return [addDaysISO(today, -89), today]
    case 'year':
      return [addDaysISO(today, -364), today]
    default:
      return [from || monthStart, to || today]
  }
}

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

function ReportPreview({ report }: { report: ReportData }) {
  const columns = REPORT_COLUMNS[report.kind]
  const { stats, breakdown } = reportSummary(report)
  const rows = report.rows.slice(0, PREVIEW_ROWS)
  return (
    <div className="space-y-4 px-5 pb-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((item) => (
          <div key={item.label} className="rounded-xl border border-line bg-subtle px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{item.label}</dt>
            <dd className="tabular mt-0.5 truncate text-base font-bold text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
      {breakdown.length > 0 && (
        <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          {breakdown.map((item) => (
            <li key={item.label} className="flex justify-between gap-3 border-b border-line py-1.5">
              <span className="font-medium text-ink-2">{item.label}</span>
              <span className="tabular text-right text-muted">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
      {report.truncated && (
        <p role="status" className="rounded-xl bg-warning-50 px-3 py-2 text-[13px] text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
          This period has more than {formatNumber(report.row_cap)} rows. Downloads include the first {formatNumber(report.row_cap)} — choose a shorter period for everything.
        </p>
      )}
      {rows.length ? (
        <div className="scrollbar-thin overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <caption className="sr-only">
              {report.title} preview, first {rows.length} of {report.rows.length} rows
            </caption>
            <thead>
              <tr className="border-b border-line bg-subtle">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn('whitespace-nowrap px-3 py-2 font-semibold text-muted', c.format === 'money' ? 'text-right' : 'text-left')}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('whitespace-nowrap px-3 py-2 text-ink-2', c.format === 'money' && 'tabular text-right')}>
                      {displayCell(row[c.key], c.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState compact icon={FileText} title="No records in this period" description="Try a longer period." />
      )}
      {report.rows.length > PREVIEW_ROWS && (
        <p className="text-center text-[12px] text-muted">
          Showing {PREVIEW_ROWS} of {formatNumber(report.rows.length)} rows — download the CSV or PDF for all of them.
        </p>
      )}
    </div>
  )
}

export default function ReportsPage() {
  useDocumentTitle('Reports')
  const { user } = useAuth()
  const toast = useToast()
  const [range, setRange] = useState<Range>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<ReportKind | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [start, end] = resolve(range, from, to)
  const invalid = start > end ? 'The start date must be before the end date.' : days(start, end) > MAX_DAYS ? 'Choose a period of up to 2 years.' : null
  const reports = REPORTS.filter((r) => !r.adminOnly || user?.role === 'ADMIN')
  const key = (kind: ReportKind) => `reports:${kind}:${start}:${end}`
  // Reports are fetched only when asked for, and reused for 2 minutes (they read many rows).
  const preview = useApi(selected && !invalid ? key(selected) : null, () => reportsApi.get(selected!, start, end), { freshMs: 120_000 })

  useEffect(() => {
    if (invalid) setSelected(null)
  }, [invalid])

  const download = async (kind: ReportKind, format: 'csv' | 'pdf') => {
    if (invalid) return
    setBusy(`${kind}:${format}`)
    try {
      const data = selected === kind && preview.data ? preview.data : await reportsApi.get(kind, start, end)
      await downloadReport(data, format)
      toast.success(`${format.toUpperCase()} ready`, { description: `${formatNumber(data.rows.length)} rows · ${formatDate(data.from)} – ${formatDate(data.to)}` })
    } catch (error) {
      toast.fromError(error, "We couldn't create the report. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const current = reports.find((r) => r.kind === selected)
  return (
    <div>
      <PageHeader title="Reports" description="Built on demand from live data and saved on your device — nothing is stored on the server" />
      <Card className="mb-5 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          label="Report period"
          value={range}
          onChange={setRange}
          options={[
            { value: 'month', label: 'This month' },
            { value: 'last', label: 'Last month' },
            { value: 'quarter', label: 'Last 90 days' },
            { value: 'year', label: 'Last 12 months' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {range === 'custom' ? (
            <>
              <input type="date" value={from} max={to || todayISO()} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className={cn(inputClasses, 'h-10 w-40')} />
              <span>to</span>
              <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} aria-label="To date" className={cn(inputClasses, 'h-10 w-40')} />
            </>
          ) : (
            <span className="tabular">
              {formatDate(start)} – {formatDate(end)}
            </span>
          )}
        </div>
      </Card>
      {invalid && (
        <p role="alert" className="mb-4 rounded-xl bg-danger-50 px-3.5 py-2.5 text-sm font-medium text-danger-700 dark:bg-danger-500/10 dark:text-danger-300">
          {invalid}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map(({ kind, title, description, icon: Icon, basis }) => (
          <Card key={kind} className={cn('flex flex-col p-5 transition-shadow', selected === kind && 'ring-2 ring-primary')}>
            <span className="flex size-11 items-center justify-center rounded-xl bg-subtle text-ink-2 ring-1 ring-line">
              <Icon className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-[15px] font-semibold text-ink">{title}</h2>
            <p className="mt-1 flex-1 text-sm text-muted">{description}</p>
            <p className="mt-3 text-[12px] font-medium text-faint">{basis}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button variant={selected === kind ? 'primary' : 'secondary'} size="sm" icon={Eye} disabled={!!invalid} onClick={() => setSelected(kind)} aria-pressed={selected === kind}>
                View
              </Button>
              <Button variant="secondary" size="sm" icon={FileText} loading={busy === `${kind}:pdf`} disabled={!!invalid || (!!busy && busy !== `${kind}:pdf`)} onClick={() => download(kind, 'pdf')}>
                PDF
              </Button>
              <Button variant="secondary" size="sm" icon={FileSpreadsheet} loading={busy === `${kind}:csv`} disabled={!!invalid || (!!busy && busy !== `${kind}:csv`)} onClick={() => download(kind, 'csv')}>
                CSV
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {current && !invalid && (
        <Card className="mt-5" aria-busy={preview.loading || undefined}>
          <CardHeader
            title={current.title}
            description={`${formatDate(start)} – ${formatDate(end)} · ${current.basis.toLowerCase()}`}
            action={
              preview.data && (
                <>
                  <Button size="sm" variant="secondary" icon={FileText} loading={busy === `${current.kind}:pdf`} onClick={() => download(current.kind, 'pdf')}>
                    PDF
                  </Button>
                  <Button size="sm" icon={FileSpreadsheet} loading={busy === `${current.kind}:csv`} onClick={() => download(current.kind, 'csv')}>
                    CSV
                  </Button>
                </>
              )
            }
          />
          {preview.error && !preview.data ? (
            <ErrorState compact error={preview.error} onRetry={preview.reload} />
          ) : preview.data ? (
            <ReportPreview report={preview.data} />
          ) : (
            <div className="space-y-3 px-5 pb-5" role="status" aria-label="Loading report">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-48 rounded-xl" />
            </div>
          )}
        </Card>
      )}
      <p className="mt-5 text-center text-[12px] text-faint">
        CSV opens in Excel or Google Sheets; PDF is ready to print. Up to {formatNumber(10_000)} rows per report.
      </p>
    </div>
  )
}
