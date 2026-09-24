import { AlertTriangle, Check, Clock3, Copy, History, RotateCcw, Terminal } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorState, Skeleton } from '@/components/ui/Feedback'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { storageApi } from '@/services/endpoints'
import type { TimeTravelResult } from '@/types'
import { formatDateTime } from '@/utils/format'

/** "YYYY-MM-DDTHH:mm" in this device's time zone, for <input type="datetime-local">. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-2 rounded-xl border border-line bg-subtle p-3">
      <Terminal className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <code className="min-w-0 flex-1 break-all text-[13px] text-ink-2">{command}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(command).catch(() => undefined)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink"
        aria-label="Copy command"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  )
}

export function TimeTravelPanel() {
  const toast = useToast()
  const info = useApi('storage:time-travel', () => storageApi.timeTravel(), { freshMs: 60_000 })
  const [when, setWhen] = useState('')
  const [stage, setStage] = useState<'idle' | 'warning' | 'confirm'>('idle')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TimeTravelResult | null>(null)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  if (info.error && !info.data) return <ErrorState error={info.error} onRetry={info.reload} />
  if (!info.data) return <Skeleton className="h-80 rounded-2xl" />
  const data = info.data
  const earliest = new Date(data.earliest)
  const chosen = when ? new Date(when) : null
  const valid = !!chosen && !Number.isNaN(chosen.getTime()) && chosen >= earliest && chosen < new Date()
  const unix = chosen && valid ? Math.floor(chosen.getTime() / 1000) : null
  const command = data.cli_command.replace('<UNIX_SECONDS>', unix ? String(unix) : '<UNIX_SECONDS>')

  const restore = async () => {
    if (!chosen || typed !== 'RESTORE') return
    setBusy(true)
    try {
      const outcome = await storageApi.timeTravelRestore(chosen.toISOString())
      setResult(outcome)
      setStage('idle')
      invalidate('backups', 'storage')
      toast.success('Database restored', { description: `Back to ${formatDateTime(outcome.restored_to)}.` })
    } catch (error) {
      toast.fromError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div role="note" className="flex gap-3 rounded-2xl border border-danger-200 bg-danger-50 p-4 text-danger-900 dark:border-danger-500/30 dark:bg-danger-500/10 dark:text-danger-100">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="text-sm">
          <p className="font-bold">WARNING — this replaces the entire database</p>
          <p className="mt-1">
            Cloudflare D1 Time Travel puts the whole database back to how it was at the moment you choose. Everything recorded after that moment — payments, check-ins, new
            members, notes — is lost from the live database. Download a backup first. Use this only to recover from a serious mistake.
          </p>
        </div>
      </div>

      {result ? (
        <Card className="p-5" role="status">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <History className="size-5 text-muted" aria-hidden /> Database restored to {formatDateTime(result.restored_to)}
          </p>
          {result.previous_bookmark && (
            <p className="mt-2 text-sm text-muted">
              To undo this restore, give Cloudflare this bookmark: <code className="break-all text-ink-2">{result.previous_bookmark}</code>
            </p>
          )}
          <Button className="mt-4" icon={RotateCcw} onClick={() => window.location.reload()}>
            Reload SmartGym
          </Button>
        </Card>
      ) : (
        <Card>
          <CardHeader
            icon={Clock3}
            title="D1 Time Travel"
            description={`Any moment in the last ${data.retention_days} days, back to ${formatDateTime(data.earliest)}. Admins only.`}
          />
          <div className="space-y-4 px-5 pb-5">
            <TextField
              label="Restore the database to"
              type="datetime-local"
              value={when}
              min={toLocalInput(earliest)}
              max={toLocalInput(new Date())}
              onChange={(e) => setWhen(e.target.value)}
              hint={`In this device’s time zone (${zone}).`}
              error={when && !valid ? `Choose a moment between ${formatDateTime(data.earliest)} and now.` : undefined}
              wrapperClassName="sm:max-w-sm"
            />
            {data.api_enabled ? (
              <Button variant="danger" icon={History} disabled={!valid} onClick={() => (setTyped(''), setStage('warning'))}>
                Restore database…
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-ink-2">
                  In-app restore isn’t configured (it needs a Cloudflare API token as a Worker secret). Run this on a computer with the SmartGym project and Wrangler:
                </p>
                <CopyCommand command={command} />
              </div>
            )}
          </div>
        </Card>
      )}

      <Dialog
        open={stage === 'warning'}
        onClose={() => setStage('idle')}
        title="WARNING"
        description="This cannot be undone from SmartGym."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStage('idle')} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setStage('confirm')}>
              Continue
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          The whole database will return to <strong className="text-ink">{chosen && valid ? formatDateTime(chosen.toISOString()) : '—'}</strong>. Every change made after that
          moment will be lost for everyone using SmartGym.
        </p>
      </Dialog>

      <Dialog
        open={stage === 'confirm'}
        onClose={busy ? () => undefined : () => setStage('idle')}
        title="Type RESTORE to confirm"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStage('idle')} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} disabled={typed !== 'RESTORE'} onClick={restore}>
              Restore database
            </Button>
          </>
        }
      >
        <TextField
          label="Confirmation"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="RESTORE"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          hint="Type the word in capital letters."
          data-autofocus
        />
      </Dialog>
    </div>
  )
}
