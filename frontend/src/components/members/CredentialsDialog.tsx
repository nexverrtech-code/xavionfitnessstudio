import { Check, Copy, KeyRound, MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useConfig } from '@/contexts/ConfigContext'
import type { Credentials } from '@/types'

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false // clipboard blocked
  }
}

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-subtle px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</p>
        <p className={secret ? 'mt-0.5 truncate font-mono text-[17px] font-semibold tracking-wide text-ink' : 'mt-0.5 truncate text-[15px] font-semibold text-ink'}>{value}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? Check : Copy}
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** The app address, login and (one-time) password, with a ready-to-send message. */
export function CredentialsView({ credentials, kind = 'member', name }: { credentials: Credentials; kind?: 'member' | 'staff'; name?: string }) {
  const config = useConfig()
  const [copied, setCopied] = useState(false)
  const address = window.location.origin
  const temp = credentials.temporary_password
  const mustChange = credentials.must_change_password ?? !!temp
  const greeting = name ? `Hi ${name.trim().split(/\s+/)[0]},` : 'Hello,'
  const message = [
    `${greeting} your ${config.gym_name || 'gym'} ${kind === 'member' ? 'member app' : 'staff'} login is ready.`,
    `Open: ${address}`,
    `Login: ${credentials.login}`,
    temp ? `Password: ${temp}` : 'Password: as given at the front desk',
    mustChange ? 'You will be asked to choose your own password when you sign in.' : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="space-y-2.5">
      <CopyRow label="App address" value={address} />
      <CopyRow label="Login" value={credentials.login} secret />
      {temp ? (
        <CopyRow label="One-time password" value={temp} secret />
      ) : (
        <div className="rounded-xl border border-line bg-subtle px-4 py-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-faint">Password</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">The password you typed</p>
        </div>
      )}
      <p className="flex items-start gap-2 pt-1 text-[13px] text-muted">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {temp ? 'Shown only once. ' : ''}
          {mustChange ? 'They choose their own password at first sign-in.' : 'They can keep this password or change it later in the app.'}
          {kind === 'member' ? ' Members can also sign in with their phone number.' : ''}
        </span>
      </p>
      <Button
        variant="secondary"
        fullWidth
        icon={copied ? Check : MessageSquareText}
        onClick={async () => {
          if (await copyText(message)) {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }
        }}
      >
        {copied ? 'Message copied' : 'Copy message to send'}
      </Button>
    </div>
  )
}

export function CredentialsDialog({
  credentials,
  onClose,
  title = 'Login ready',
  subject,
  kind = 'member',
}: {
  credentials: Credentials | null
  onClose: () => void
  title?: string
  subject?: string
  kind?: 'member' | 'staff'
}) {
  return (
    <Dialog
      open={!!credentials}
      onClose={onClose}
      title={title}
      description={subject ? `Share these with ${subject}.` : undefined}
      size="sm"
      footer={
        <Button onClick={onClose} data-autofocus>
          Done
        </Button>
      }
    >
      {credentials && <CredentialsView credentials={credentials} kind={kind} name={kind === 'member' ? subject : undefined} />}
    </Dialog>
  )
}
