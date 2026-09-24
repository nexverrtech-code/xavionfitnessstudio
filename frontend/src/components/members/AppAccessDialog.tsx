import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldOff, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Pill } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, TextField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { isApiError } from '@/services/api'
import { membersApi } from '@/services/endpoints'
import type { Credentials, MemberWorkspace } from '@/types'
import { cn } from '@/utils/cn'
import { firstName, relativeTime } from '@/utils/format'
import { CredentialsView } from './CredentialsDialog'

export type AccessState = 'none' | 'pending' | 'active' | 'off'

/** Where the member's app login stands: never set up, waiting for first sign-in, in use, or turned off. */
export function accessState(app: MemberWorkspace['app']): AccessState {
  if (!app.login) return 'none'
  if (!app.enabled) return 'off'
  return app.must_change_password ? 'pending' : 'active'
}

export const ACCESS_LABEL: Record<AccessState, { label: string; tone: 'slate' | 'blue' | 'green' | 'red' }> = {
  none: { label: 'Not set up', tone: 'slate' },
  pending: { label: 'Waiting for first sign-in', tone: 'blue' },
  active: { label: 'Active', tone: 'green' },
  off: { label: 'Turned off', tone: 'red' },
}

function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (password.length > 128) return 'Use at most 128 characters.'
  if (/^\d+$/.test(password) || /^[A-Za-z]+$/.test(password)) return 'Mix letters with numbers or symbols.'
  return null
}

type Mode = 'generate' | 'custom'

/** Everything about a member's app login in one place. The member can't open the app until
 *  staff give access here (or when adding the member). */
export function AppAccessDialog({ member, open, onClose }: { member: MemberWorkspace | null; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('generate')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mustChange, setMustChange] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingOff, setConfirmingOff] = useState(false)
  const [result, setResult] = useState<Credentials | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('generate')
    setPassword('')
    setShowPassword(false)
    setMustChange(true)
    setError(null)
    setConfirmingOff(false)
    setResult(null)
  }, [open])

  if (!member) return null
  const state = accessState(member.app)
  const first = firstName(member.name)
  const giving = state === 'none' || state === 'off'

  const save = async () => {
    setError(null)
    if (mode === 'custom') {
      const problem = passwordProblem(password)
      if (problem) {
        setError(problem)
        return
      }
    }
    setBusy(true)
    try {
      const credentials = await membersApi.enableApp(
        member.id,
        mode === 'custom' ? { password, must_change_password: mustChange } : {},
      )
      invalidate(`member:${member.id}`, 'members')
      setResult(credentials)
      toast.success(giving ? `${first} can now open the member app` : 'New password saved', {
        description: giving ? undefined : `${first} was signed out of the app on every device.`,
      })
    } catch (e) {
      if (isApiError(e) && e.fields?.password) setError(e.fields.password)
      else toast.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    try {
      await membersApi.disableApp(member.id)
      invalidate(`member:${member.id}`, 'members')
      toast.success('App access turned off', { description: `${first} is signed out and can't open the member app.` })
      onClose()
    } catch (e) {
      toast.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  const status = ACCESS_LABEL[state]
  const detail = {
    none: `${first} can’t open the member app yet. Give access to create their login.`,
    pending: `${first} has a login but hasn’t signed in and chosen their own password yet.`,
    active: member.app.last_login_at ? `Last signed in ${relativeTime(member.app.last_login_at)}.` : 'Hasn’t signed in yet.',
    off: `${first} can’t sign in. Give access again to turn it back on with a new password.`,
  }[state]

  const footer = result ? (
    <Button onClick={onClose} data-autofocus>
      Done
    </Button>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button icon={KeyRound} loading={busy && !confirmingOff} onClick={save} disabled={confirmingOff}>
        {giving ? 'Give app access' : mode === 'generate' ? 'Create new password' : 'Save password'}
      </Button>
    </>
  )

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={result ? (giving ? 'App access ready' : 'New password ready') : 'Member app access'}
      description={`${member.name} · ${member.member_code}`}
      footer={footer}
    >
      {result ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink" role="status">
            <CheckCircle2 className="size-5 text-success-600" aria-hidden />
            {first} can sign in to the member app with these details.
          </p>
          <CredentialsView credentials={result} kind="member" name={member.name} />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-line bg-subtle p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-2 ring-1 ring-line">
              <Smartphone className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink">Member app</p>
                <Pill tone={status.tone}>{status.label}</Pill>
              </div>
              <p className="mt-1 text-[13px] text-muted">{detail}</p>
              {state !== 'none' && (
                <p className="mt-1 text-[13px] text-muted">
                  Signs in with <span className="tabular font-semibold text-ink-2">{member.member_code}</span>
                  {member.phone ? ' or their phone number' : ''}
                  {member.email ? ' or email' : ''}.
                </p>
              )}
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">{giving ? 'Password for the member app' : 'Set a new password'}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Password">
              {(
                [
                  { value: 'generate', title: 'One-time password', text: `We create one now. ${first} chooses their own at first sign-in.` },
                  { value: 'custom', title: 'Type a password', text: `You choose it and tell ${first} in person.` },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  onClick={() => (setMode(option.value), setError(null))}
                  className={cn(
                    'cursor-pointer rounded-xl border p-3.5 text-left transition-colors duration-150',
                    mode === option.value ? 'border-primary bg-subtle ring-2 ring-primary/20' : 'border-line hover:border-line-strong hover:bg-hover',
                  )}
                >
                  <span className="block text-sm font-semibold text-ink">{option.title}</span>
                  <span className="mt-0.5 block text-[12px] text-muted">{option.text}</span>
                </button>
              ))}
            </div>
            {mode === 'custom' && (
              <div className="mt-4 space-y-3">
                <TextField
                  label="Password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => (setPassword(e.target.value), setError(null))}
                  error={error ?? undefined}
                  hint="At least 8 characters, with letters and numbers or symbols."
                  className="pr-12"
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  }
                  data-autofocus
                />
                <Checkbox
                  label={`Ask ${first} to change it at first sign-in`}
                  description="Recommended, so only the member knows their password."
                  checked={mustChange}
                  onChange={(e) => setMustChange(e.target.checked)}
                />
              </div>
            )}
            {error && mode === 'generate' && (
              <p role="alert" className="mt-2 text-[13px] font-medium text-danger-600 dark:text-danger-400">
                {error}
              </p>
            )}
            {!giving && <p className="mt-3 text-[13px] text-muted">Saving a new password signs {first} out of the app on every device.</p>}
          </fieldset>

          {!giving && (
            <div className="border-t border-line pt-4">
              {confirmingOff ? (
                <div role="alert" className="rounded-2xl border border-danger-200 bg-danger-50 p-4 dark:border-danger-500/30 dark:bg-danger-500/10">
                  <p className="text-sm font-semibold text-danger-800 dark:text-danger-200">Turn off {first}’s app access?</p>
                  <p className="mt-1 text-[13px] text-danger-800/90 dark:text-danger-200/90">
                    They are signed out everywhere and can’t open the member app until you give access again. Their membership, payments and history are kept.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setConfirmingOff(false)} disabled={busy}>
                      Keep access
                    </Button>
                    <Button size="sm" variant="danger" icon={ShieldOff} loading={busy} onClick={turnOff}>
                      Turn off access
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" size="sm" icon={ShieldOff} className="text-danger-600 dark:text-danger-400" onClick={() => setConfirmingOff(true)}>
                  Turn off app access
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
