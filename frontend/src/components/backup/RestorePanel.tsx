import { ArchiveRestore, CheckCircle2, FileUp, RotateCcw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { readBackup, type ParsedBackup } from '@/services/backup'
import { backupsApi } from '@/services/endpoints'
import { cn } from '@/utils/cn'
import { formatDate, formatDateTime, formatNumber } from '@/utils/format'
import { DATA_KEYS } from './BackupPanel'
import { ProgressBar, Stepper, type Step } from './Progress'
import { TABLE_LABELS } from './StoragePanel'

const STEPS: Step[] = [
  { key: 'upload', label: 'Choose file' },
  { key: 'review', label: 'Check & preview' },
  { key: 'restoring', label: 'Restore' },
  { key: 'done', label: 'Done' },
]
const CHECK_BATCH = 5000
const APPLY_BATCH = 500
// The API accepts request bodies up to 256 KB; stay well below it whatever the row sizes.
const APPLY_BYTES = 180_000

/** Split rows into request-sized batches (≤ 500 rows and ≤ ~180 KB of JSON each). */
function batches(rows: Record<string, string>[]): Record<string, string>[][] {
  const encoder = new TextEncoder()
  const out: Record<string, string>[][] = []
  let current: Record<string, string>[] = []
  let bytes = 0
  for (const row of rows) {
    const size = encoder.encode(JSON.stringify(row)).length + 1
    if (current.length && (current.length >= APPLY_BATCH || bytes + size > APPLY_BYTES)) {
      out.push(current)
      current = []
      bytes = 0
    }
    current.push(row)
    bytes += size
  }
  if (current.length) out.push(current)
  return out
}

interface TablePlan {
  table: string
  inFile: number
  unreadable: number
  existing: number
  fresh: Record<string, string>[]
}

function ErrorBox({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [message])
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800 outline-none dark:border-danger-500/30 dark:bg-danger-500/10 dark:text-danger-200">
      <p className="font-semibold">This file can’t be restored</p>
      <p className="mt-0.5">{message}</p>
    </div>
  )
}

export function RestorePanel() {
  const toast = useToast()
  const [stage, setStage] = useState<'upload' | 'review' | 'restoring' | 'done'>('upload')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backup, setBackup] = useState<ParsedBackup | null>(null)
  const [plan, setPlan] = useState<TablePlan[]>([])
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [outcome, setOutcome] = useState<{ inserted: number; skipped: number } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStage('upload')
    setBackup(null)
    setPlan([])
    setError(null)
    setOutcome(null)
    if (input.current) input.current.value = ''
  }

  const check = async (file: File) => {
    setError(null)
    setBusy('Reading the backup…')
    try {
      const parsed = await readBackup(file)
      const tables: TablePlan[] = []
      for (const t of parsed.tables) {
        setBusy(`Checking ${TABLE_LABELS[t.table] ?? t.table}…`)
        const readable = t.rows.filter((r) => /^\d+$/.test(r.id ?? '') && Number(r.id) > 0)
        const existing = new Set<number>()
        const ids = readable.map((r) => Number(r.id))
        for (let i = 0; i < ids.length; i += CHECK_BATCH) {
          const result = await backupsApi.restoreCheck(t.table, ids.slice(i, i + CHECK_BATCH))
          result.existing.forEach((id) => existing.add(id))
        }
        tables.push({
          table: t.table,
          inFile: t.rows.length,
          unreadable: t.rows.length - readable.length,
          existing: existing.size,
          fresh: readable.filter((r) => !existing.has(Number(r.id))),
        })
      }
      setBackup(parsed)
      setPlan(tables)
      setStage('review')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      if (input.current) input.current.value = ''
    }
  }

  const restore = async () => {
    if (!backup) return
    const total = plan.reduce((sum, t) => sum + t.fresh.length, 0)
    setStage('restoring')
    setError(null)
    setProgress([0, total])
    let inserted = 0
    let skipped = plan.reduce((sum, t) => sum + t.existing + t.unreadable, 0)
    let done = 0
    try {
      for (const t of plan) {
        for (const batch of batches(t.fresh)) {
          const result = await backupsApi.restoreApply(t.table, batch)
          inserted += result.inserted
          skipped += result.skipped
          done += result.received
          setProgress([done, total])
        }
      }
      await backupsApi.restoreComplete({
        file_name: backup.fileName.slice(0, 120),
        backup_created_at: backup.metadata.created_at ?? null,
        inserted,
        skipped,
        datasets: backup.metadata.datasets ?? [],
      })
      invalidate(...DATA_KEYS)
      setOutcome({ inserted, skipped })
      setStage('done')
      toast.success('Restore complete', { description: `${formatNumber(inserted)} records added.` })
    } catch (e) {
      invalidate(...DATA_KEYS)
      setError(`${(e as Error).message} ${formatNumber(inserted)} records were added before this stopped — choose the file again to continue; records already added are skipped.`)
      setStage('upload')
    }
  }

  const toAdd = plan.reduce((sum, t) => sum + t.fresh.length, 0)
  const present = plan.reduce((sum, t) => sum + t.existing, 0)
  const meta = backup?.metadata

  return (
    <Card>
      <CardHeader icon={ArchiveRestore} title="Restore from a backup" description="Adds records from a SmartGym backup file. Existing records are never overwritten." />
      <div className="space-y-5 px-5 pb-5">
        <Stepper steps={STEPS} current={stage} />
        {error && <ErrorBox message={error} />}

        {stage === 'upload' && (
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-subtle px-6 py-10 text-center transition-colors hover:border-primary',
              busy && 'pointer-events-none opacity-70',
            )}
            aria-busy={!!busy || undefined}
          >
            <FileUp className="size-7 text-muted" aria-hidden />
            <span className="text-sm font-semibold text-ink">{busy ?? 'Choose a backup file (.zip)'}</span>
            <span className="max-w-sm text-[13px] text-muted">
              It is checked on this device first: every file against its checksum, every column against the backup’s layout.
            </span>
            <input
              ref={input}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void check(file)
              }}
            />
          </label>
        )}

        {stage === 'review' && backup && meta && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-subtle px-4 py-3 text-sm">
              <p className="font-semibold text-ink">{backup.fileName}</p>
              <p className="mt-0.5 text-muted">
                {meta.gym_name} · created {formatDateTime(meta.created_at)}
                {meta.created_by ? ` by ${meta.created_by}` : ''}
                {meta.period.from && meta.period.to ? ` · ${formatDate(meta.period.from)} – ${formatDate(meta.period.to)}` : ''}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-success-700 dark:text-success-300">
                <ShieldCheck className="size-4" aria-hidden /> All {meta.files.length} files match their checksums
              </p>
            </div>
            <div className="scrollbar-thin overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">What this restore will add</caption>
                <thead>
                  <tr className="border-b border-line bg-subtle text-left text-[12px] font-semibold uppercase tracking-wide text-faint">
                    <th scope="col" className="px-4 py-2.5">Data</th>
                    <th scope="col" className="px-3 py-2.5 text-right">In file</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Already in database</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Will be added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {plan.map((t) => (
                    <tr key={t.table}>
                      <td className="px-4 py-2.5 font-medium text-ink">
                        {TABLE_LABELS[t.table] ?? t.table}
                        {t.unreadable > 0 && <span className="ml-2 text-[12px] text-warning-700 dark:text-warning-300">{formatNumber(t.unreadable)} unreadable</span>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-ink-2">{formatNumber(t.inFile)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-muted">{formatNumber(t.existing)}</td>
                      <td className="tabular px-4 py-2.5 text-right font-semibold text-ink">{formatNumber(t.fresh.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-muted">
              Records already in the database are skipped, not changed. Records whose member (or payment) no longer exists are skipped too and counted in the result.
            </p>
            <div className="flex flex-wrap gap-2">
              {toAdd > 0 ? (
                <Button icon={ArchiveRestore} onClick={() => setConfirming(true)}>
                  Restore {formatNumber(toAdd)} records
                </Button>
              ) : (
                <p className="flex items-center gap-2 text-sm font-semibold text-ink" role="status">
                  <CheckCircle2 className="size-4 text-success-600" aria-hidden /> Everything in this backup is already in the database.
                </p>
              )}
              <Button variant="secondary" icon={RotateCcw} onClick={reset}>
                Choose another file
              </Button>
            </div>
          </div>
        )}

        {stage === 'restoring' && <ProgressBar label="Adding records" value={progress[0]} max={Math.max(progress[1], 1)} />}

        {stage === 'done' && outcome && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-line bg-subtle p-4" role="status">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-600" aria-hidden />
              <div>
                <p className="font-semibold text-ink">{formatNumber(outcome.inserted)} records restored</p>
                <p className="text-sm text-muted">
                  {formatNumber(outcome.skipped)} skipped ({formatNumber(present)} were already present; the rest had no matching member or payment). The restore is logged in
                  the backup history.
                </p>
              </div>
            </div>
            <Button variant="secondary" icon={RotateCcw} onClick={reset}>
              Restore another file
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        tone="primary"
        title={`Add ${formatNumber(toAdd)} records?`}
        confirmLabel="Restore"
        message={`Records from ${backup?.fileName ?? 'the backup'} that are missing from the database will be added. Nothing already there is changed or deleted.`}
        onConfirm={() => {
          void restore()
        }}
      />
    </Card>
  )
}
