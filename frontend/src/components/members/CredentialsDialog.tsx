import { Check, Copy, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import type { Credentials } from '@/types'

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-subtle px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</p>
        <p className="mt-0.5 truncate font-mono text-[17px] font-semibold tracking-wide text-ink">{value}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? Check : Copy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

export function CredentialsDialog({ credentials, onClose, title = 'Portal login created', subject }: { credentials: Credentials | null; onClose: () => void; title?: string; subject?: string }) {
  return (
    <Dialog
      open={!!credentials}
      onClose={onClose}
      title={title}
      description={`Share these with ${subject ?? 'the member'} in person. The temporary password is shown only once and must be changed at first sign-in.`}
      size="sm"
      footer={
        <Button onClick={onClose} data-autofocus>
          Done
        </Button>
      }
    >
      {credentials && (
        <div className="space-y-2.5">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            <KeyRound className="size-4 text-accent-700" aria-hidden />
            Members can also sign in with their phone number.
          </div>
          <CopyRow label="Login" value={credentials.login} />
          <CopyRow label="Temporary password" value={credentials.temporary_password} />
        </div>
      )}
    </Dialog>
  )
}
