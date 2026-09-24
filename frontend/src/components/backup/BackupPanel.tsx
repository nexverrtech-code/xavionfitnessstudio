import { Archive, ArchiveRestore, CheckCircle2, Clock3, DatabaseBackup, Download, FileArchive, FileCheck2, History, Play, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { Checkbox, TextField } from '@/components/ui/Field'
import { useConfig } from '@/contexts/ConfigContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { BackupFileError, buildBackup, readBackup } from '@/services/backup'
import { backupsApi } from '@/services/endpoints'
import type { ArchiveProgress, BackupManifest, BackupOptions, BackupRecord } from '@/types'
import { cn } from '@/utils/cn'
import { saveBlob } from '@/utils/download'
import { formatDate, formatDateTime, formatNumber, todayISO } from '@/utils/format'
import { ProgressBar, Stepper, type Step } from './Progress'
import { TABLE_LABELS, type BackupPrefill } from './StoragePanel'

const STEPS: Step[] = [
  { key: 'choose', label: 'Choose data' },
  { key: 'download', label: 'Download' },
  { key: 'verify', label: 'Verify file' },
  { key: 'archive', label: 'Archive & remove' },
]

/** Every screen that changes after records are archived or restored. */
export const DATA_KEYS = ['payments', 'memberships', 'attendance', 'members', 'member:', 'expenses', 'notifications', 'workouts', 'progress', 'dashboard', 'storage', 'backups', 'reports', 'inbox', 'portal']

function Alert({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [children])
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800 outline-none dark:border-danger-500/30 dark:bg-danger-500/10 dark:text-danger-200">
      {children}
    </div>
  )
}

function lastYear(): [string, string] {
  const year = Number(todayISO().slice(0, 4)) - 1
  return [`${year}-01-01`, `${year}-12-31`]
}

function archivable(manifest: BackupManifest, options: BackupOptions): boolean {
  const b = manifest.backup
  return !!b.period_to && b.period_to <= options.latest_archivable_date && manifest.tables.some((t) => t.archivable && t.rows > 0)
}

function ChooseStep({ options, prefill, onCreated }: { options: BackupOptions; prefill: BackupPrefill | null; onCreated: (m: BackupManifest) => void }) {
  const toast = useToast()
  const [datasets, setDatasets] = useState<string[]>(() => prefill?.datasets ?? options.datasets.map((d) => d.key))
  const [[from, to], setPeriod] = useState<[string, string]>(() => (prefill ? [prefill.from, prefill.to] : lastYear()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!prefill) return
    setDatasets(prefill.datasets)
    setPeriod([prefill.from, prefill.to])
  }, [prefill])
  const tooRecent = to > options.latest_archivable_date

  const create = async () => {
    setError(null)
    if (!datasets.length) return setError('Choose at least one kind of data.')
    if (!from || !to || from > to) return setError('Choose a valid period — the start must be on or before the end.')
    setBusy(true)
    try {
      const manifest = await backupsApi.create({ datasets, period_from: from, period_to: to })
      invalidate('backups')
      toast.success('Backup prepared', { description: `${formatNumber(manifest.backup.record_count)} records — now download the file.` })
      onCreated(manifest)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert>{error}</Alert>}
      <fieldset>
        <legend className="text-sm font-semibold text-ink">What to back up</legend>
        <p className="mt-0.5 text-[13px] text-muted">Members are always included — every other record points to a member.</p>
        <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
          {options.datasets.map((d) => (
            <Checkbox
              key={d.key}
              label={d.label}
              checked={datasets.includes(d.key)}
              onChange={(e) => setDatasets((list) => (e.target.checked ? [...list, d.key] : list.filter((k) => k !== d.key)))}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Period</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: 'Last year', value: lastYear() },
            { label: 'Everything archivable', value: ['2000-01-01', options.latest_archivable_date] as [string, string] },
            { label: 'This year so far', value: [`${todayISO().slice(0, 4)}-01-01`, todayISO()] as [string, string] },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setPeriod(preset.value)}
              aria-pressed={from === preset.value[0] && to === preset.value[1]}
              className={cn(
                'h-9 cursor-pointer rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
                from === preset.value[0] && to === preset.value[1] ? 'border-primary bg-primary text-on-primary' : 'border-line text-ink-2 hover:bg-hover',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:max-w-md sm:grid-cols-2">
          <TextField label="From" type="date" value={from} max={to || todayISO()} onChange={(e) => setPeriod([e.target.value, to])} />
          <TextField label="To" type="date" value={to} min={from} max={todayISO()} onChange={(e) => setPeriod([from, e.target.value])} />
        </div>
        {tooRecent && (
          <p className="mt-2 flex items-start gap-2 text-[13px] text-muted">
            <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
            Records after {formatDate(options.latest_archivable_date)} can be backed up but not archived — the last 60 days always stay in the database.
          </p>
        )}
      </fieldset>
      <Button icon={DatabaseBackup} loading={busy} onClick={create}>
        Prepare backup
      </Button>
    </div>
  )
}

function Summary({ manifest }: { manifest: BackupManifest }) {
  const b = manifest.backup
  const files = new Map<string, number>()
  for (const t of manifest.tables) files.set(t.file, (files.get(t.file) ?? 0) + t.rows)
  return (
    <div className="rounded-2xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FileArchive className="size-4 text-muted" aria-hidden /> {b.file_name}
        </p>
        <StatusBadge status={b.status} size="sm" />
      </div>
      <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Period</dt>
          <dd className="text-right text-ink">{b.period_from && b.period_to ? `${formatDate(b.period_from)} – ${formatDate(b.period_to)}` : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Records</dt>
          <dd className="tabular text-right text-ink">{formatNumber(b.record_count)}</dd>
        </div>
      </dl>
      <ul className="divide-y divide-line border-t border-line text-sm">
        {[...files].map(([file, rows]) => (
          <li key={file} className="flex justify-between gap-3 px-4 py-2">
            <span className="font-mono text-[13px] text-ink-2">{file}</span>
            <span className="tabular text-muted">
              {formatNumber(rows)} row{rows === 1 ? '' : 's'}
            </span>
          </li>
        ))}
        <li className="flex justify-between gap-3 px-4 py-2">
          <span className="font-mono text-[13px] text-ink-2">metadata.json</span>
          <span className="text-muted">checksums &amp; details</span>
        </li>
      </ul>
    </div>
  )
}

function DownloadStep({ manifest, options, onDownloaded, onSkip }: { manifest: BackupManifest; options: BackupOptions; onDownloaded: () => void; onSkip: () => void }) {
  const toast = useToast()
  const config = useConfig()
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const download = async () => {
    setError(null)
    setProgress([0, manifest.backup.record_count])
    try {
      const built = await buildBackup(manifest, { gymName: config.gym_name, pageSize: options.export_page_size, onProgress: (d, t) => setProgress([d, t]) })
      saveBlob(built.blob, built.fileName)
      toast.success(`Saved ${built.fileName}`, { description: 'Keep it somewhere safe, then verify it.' })
      onDownloaded()
    } catch (e) {
      setError((e as Error).message || "The backup couldn't be downloaded. Try again.")
    } finally {
      setProgress(null)
    }
  }
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Summary manifest={manifest} />
      {progress && <ProgressBar label="Collecting records" value={progress[0]} max={progress[1]} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={Download} loading={!!progress} onClick={download}>
          Download backup (ZIP)
        </Button>
        <button type="button" onClick={onSkip} className="cursor-pointer text-sm font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
          Already downloaded? Verify the file
        </button>
      </div>
      <p className="text-[13px] text-muted">The ZIP is built in this browser and saved to this device — it is never stored on the server.</p>
    </div>
  )
}

function VerifyStep({ manifest, onVerified }: { manifest: BackupManifest; onVerified: (m: BackupManifest) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const verify = async (file: File) => {
    setError(null)
    setBusy(true)
    try {
      const parsed = await readBackup(file)
      if (parsed.metadata.backup_id !== manifest.backup.id) {
        throw new BackupFileError(`This file is backup #${parsed.metadata.backup_id} (${parsed.metadata.file_name}). Choose ${manifest.backup.file_name}.`)
      }
      const result = await backupsApi.verify(manifest.backup.id, { file_name: file.name.slice(0, 120), checksum: parsed.checksum, counts: parsed.counts })
      invalidate('backups')
      toast.success('Backup verified', { description: `${formatNumber(Object.values(parsed.counts).reduce((a, b) => a + b, 0))} records in ${parsed.metadata.files.length} files match.` })
      onVerified(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-ink-2">
        Open the file you saved. This page re-reads it on your device, checks every file against the SHA-256 checksums in metadata.json and counts the rows — so you know the
        backup is complete before anything is removed.
      </p>
      <label
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-subtle px-6 py-8 text-center transition-colors hover:border-primary',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <FileCheck2 className="size-7 text-muted" aria-hidden />
        <span className="text-sm font-semibold text-ink">{busy ? 'Checking the file…' : `Choose ${manifest.backup.file_name}`}</span>
        <span className="text-[13px] text-muted">The file is read on this device only</span>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void verify(file)
          }}
        />
      </label>
    </div>
  )
}

function ArchiveStep({ manifest, onUpdated }: { manifest: BackupManifest; onUpdated: (m: BackupManifest) => void }) {
  const toast = useToast()
  const [confirmed, setConfirmed] = useState(false)
  const [asking, setAsking] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ArchiveProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tables = manifest.tables.filter((t) => t.archivable && t.rows > 0)
  // An upper bound: records still in use (e.g. a payment awaiting verification) are kept.
  const total = tables.reduce((sum, t) => sum + t.rows, 0)
  const resuming = manifest.backup.status === 'ARCHIVING'

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      let latest: ArchiveProgress
      do {
        latest = await backupsApi.archive(manifest.backup.id)
        setProgress(latest)
      } while (!latest.done && !latest.paused)
      invalidate(...DATA_KEYS)
      const fresh = await backupsApi.get(manifest.backup.id)
      onUpdated(fresh)
      if (latest.paused) toast.warning('Archive paused', { description: latest.paused })
      else toast.success('Archive complete', { description: `${formatNumber(latest.archived_count)} records removed from the live database.` })
    } catch (e) {
      setError((e as Error).message)
      invalidate(...DATA_KEYS)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Summary manifest={manifest} />
      <div className="rounded-2xl border border-line p-4">
        <p className="text-sm font-semibold text-ink">What will be removed from the live database</p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {tables.map((t) => (
            <li key={t.table} className="flex justify-between gap-3 border-b border-line py-1.5">
              <span className="text-ink-2">{TABLE_LABELS[t.table] ?? t.table}</span>
              <span className="tabular text-muted">up to {formatNumber(t.rows)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-muted">
          Always kept: members, payments awaiting verification, refunded payments, active workout plans and anything newer than this backup. Archived records can be restored
          from the file at any time.
        </p>
      </div>
      {(running || progress) && (
        <ProgressBar
          label={running ? 'Archiving' : progress?.done ? 'Archived' : 'Paused'}
          value={progress?.done ? Math.max(total, progress.archived_count) : (progress?.archived_count ?? manifest.backup.archived_count)}
          max={Math.max(total, progress?.archived_count ?? 0, 1)}
          detail={progress ? `${formatNumber(progress.archived_count)} removed` : undefined}
        />
      )}
      {progress?.paused && <p className="text-sm text-warning-800 dark:text-warning-300">{progress.paused}</p>}
      <Checkbox label="I have downloaded and verified this backup" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={running} />
      <Button variant="danger" icon={Archive} disabled={!confirmed || running} loading={running} onClick={() => setAsking(true)}>
        {resuming ? 'Continue archive' : 'Archive & remove'}
      </Button>
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Archive and remove these records?"
        confirmLabel="Archive & remove"
        message={
          <>
            <p>
              Up to {formatNumber(total)} records from {formatDate(manifest.backup.period_from)} – {formatDate(manifest.backup.period_to)} will be removed from the live database
              to free space.
            </p>
            <p className="mt-2 text-muted">They stay in {manifest.backup.file_name}. Use Restore to bring them back.</p>
          </>
        }
        onConfirm={() => {
          void run()
        }}
      />
    </div>
  )
}

function BackupHistory({ items, onContinue }: { items: BackupRecord[]; onContinue: (id: number) => void }) {
  if (!items.length) return <EmptyState compact icon={History} title="No backups yet" description="Backups, archives and restores are listed here." />
  return (
    <ul className="divide-y divide-line">
      {items.map((b) => {
        const Icon = b.kind === 'RESTORE' ? ArchiveRestore : b.kind === 'TIME_TRAVEL' ? Clock3 : FileArchive
        const open = b.kind === 'BACKUP' && ['CREATED', 'VERIFIED', 'ARCHIVING'].includes(b.status)
        return (
          <li key={b.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-ink-2 ring-1 ring-line">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {b.kind === 'BACKUP' ? b.file_name : b.kind === 'RESTORE' ? `Restored ${b.file_name ?? 'a backup'}` : 'Time Travel restore'}
              </p>
              <p className="text-[12px] text-muted">
                {b.kind === 'BACKUP' && b.period_from && `${formatDate(b.period_from)} – ${formatDate(b.period_to)} · `}
                {b.kind !== 'TIME_TRAVEL' && `${formatNumber(b.record_count)} records · `}
                {b.archived_count > 0 && `${formatNumber(b.archived_count)} archived · `}
                {b.created_by_name ?? 'Admin'} · {formatDateTime(b.created_at)}
              </p>
              {b.notes && <p className="mt-0.5 text-[12px] text-muted">{b.notes}</p>}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={b.status} size="sm" />
              {open && (
                <Button size="sm" variant="secondary" icon={Play} onClick={() => onContinue(b.id)}>
                  Continue
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function BackupPanel({ prefill }: { prefill: BackupPrefill | null }) {
  const toast = useToast()
  const list = useApi('backups', () => backupsApi.list())
  const [manifest, setManifest] = useState<BackupManifest | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefill) {
      setManifest(null)
      setDownloaded(false)
    }
  }, [prefill])

  const options = list.data?.options
  if (list.error && !list.data) return <ErrorState error={list.error} onRetry={list.reload} />
  if (!options) return <SkeletonRows rows={4} />

  const status = manifest?.backup.status
  const step: string = !manifest
    ? 'choose'
    : status === 'CREATED'
      ? downloaded
        ? 'verify'
        : 'download'
      : (status === 'VERIFIED' || status === 'ARCHIVING') && archivable(manifest, options)
        ? 'archive'
        : 'done'

  const open = async (id: number) => {
    try {
      setManifest(await backupsApi.get(id))
      setDownloaded(false)
      top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) {
      toast.fromError(error)
    }
  }

  return (
    <div className="space-y-4" ref={top}>
      <Card>
        <CardHeader
          icon={ShieldCheck}
          title="Back up & archive"
          description="Download a ZIP of CSV files, verify it, then optionally remove old records to free space"
          action={
            manifest &&
            (status === 'CREATED' || status === 'VERIFIED') && (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setCancelling(true)}>
                Cancel backup
              </Button>
            )
          }
        />
        <div className="space-y-5 px-5 pb-5">
          {step !== 'done' && <Stepper steps={STEPS} current={step} />}
          {step === 'choose' && <ChooseStep options={options} prefill={prefill} onCreated={(m) => (setManifest(m), setDownloaded(false))} />}
          {step === 'download' && manifest && <DownloadStep manifest={manifest} options={options} onDownloaded={() => setDownloaded(true)} onSkip={() => setDownloaded(true)} />}
          {step === 'verify' && manifest && <VerifyStep manifest={manifest} onVerified={(m) => setManifest(m)} />}
          {step === 'archive' && manifest && <ArchiveStep manifest={manifest} onUpdated={(m) => setManifest(m)} />}
          {step === 'done' && manifest && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-line bg-subtle p-4" role="status">
                {status === 'CANCELLED' ? <XCircle className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-600" aria-hidden />}
                <div>
                  <p className="font-semibold text-ink">
                    {status === 'ARCHIVED'
                      ? `Archived — ${formatNumber(manifest.backup.archived_count)} records removed`
                      : status === 'CANCELLED'
                        ? 'Backup cancelled'
                        : 'Backup verified'}
                  </p>
                  <p className="text-sm text-muted">
                    {status === 'VERIFIED'
                      ? 'This period is too recent to archive, so nothing was removed. Keep the file as your backup.'
                      : status === 'ARCHIVED'
                        ? `Keep ${manifest.backup.file_name} safe — it is the only copy of those records.`
                        : 'Nothing was removed.'}
                  </p>
                </div>
              </div>
              <Button icon={DatabaseBackup} onClick={() => setManifest(null)}>
                Start another backup
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader icon={History} title="History" description="Backups, archives, restores and Time Travel" />
        {list.loading && !list.data ? <SkeletonRows rows={3} /> : <BackupHistory items={list.data?.items ?? []} onContinue={open} />}
      </Card>

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this backup?"
        confirmLabel="Cancel backup"
        message="Nothing has been removed. You can prepare a new backup at any time."
        onConfirm={async () => {
          if (!manifest) return
          try {
            setManifest(await backupsApi.cancel(manifest.backup.id))
            invalidate('backups')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
    </div>
  )
}
