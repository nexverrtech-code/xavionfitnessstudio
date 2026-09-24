import {
  Banknote,
  BellRing,
  Building2,
  CalendarCheck2,
  CreditCard,
  Database,
  KeyRound,
  Landmark,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plus,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CredentialsDialog } from '@/components/members/CredentialsDialog'
import { QRCode } from '@/components/qr/QRCode'
import { Pill, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataList } from '@/components/ui/DataList'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorState, PageLoader } from '@/components/ui/Feedback'
import { SelectField, Switch, TextField, TextareaField } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { PageHeader, Tabs } from '@/components/ui/Navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useConfigActions } from '@/contexts/ConfigContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, setCached, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { isApiError } from '@/services/api'
import { settingsApi, usersApi } from '@/services/endpoints'
import type { Credentials, GymSettings, TeamUser } from '@/types'
import { cn } from '@/utils/cn'
import { relativeTime } from '@/utils/format'

type Tab = 'gym' | 'payments' | 'notifications' | 'attendance' | 'data' | 'team' | 'appearance'

/** Local draft of a settings section; only changed keys are sent to the API. */
function useDraft(settings: GymSettings, keys: (keyof GymSettings)[]) {
  const pick = () => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Partial<GymSettings>
  const [draft, setDraft] = useState<Partial<GymSettings>>(pick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(pick()), [settings])
  const changed = Object.fromEntries(keys.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(settings[k])).map((k) => [k, draft[k]])) as Partial<GymSettings>
  const set = <K extends keyof GymSettings>(key: K, value: GymSettings[K]) => setDraft((d) => ({ ...d, [key]: value }))
  return { draft, set, changed, dirty: Object.keys(changed).length > 0, reset: () => setDraft(pick()) }
}

function SaveBar({ dirty, onSave, onReset, saving }: { dirty: boolean; onSave: () => void; onReset: () => void; saving: boolean }) {
  return (
    <div className="flex justify-end gap-2 border-t border-line bg-subtle px-5 py-3">
      <Button variant="ghost" onClick={onReset} disabled={!dirty || saving}>
        Discard
      </Button>
      <Button onClick={onSave} disabled={!dirty} loading={saving}>
        Save changes
      </Button>
    </div>
  )
}

function useSave() {
  const toast = useToast()
  const { applyConfig } = useConfigActions()
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = async (changes: Partial<GymSettings>) => {
    setSaving(true)
    setErrors({})
    try {
      const fresh = await settingsApi.update(changes)
      // Use what the server saved everywhere at once: this screen, the header, page titles,
      // the member app and money formatting — without a re-read that could meet an older copy.
      setCached('settings', fresh)
      applyConfig({ gym_name: fresh.gym_name, currency: fresh.currency, member_code_prefix: fresh.member_code_prefix })
      invalidate('dashboard', 'storage', 'reports')
      toast.success('Settings saved', { description: 'gym_name' in changes ? `Now showing “${fresh.gym_name}” everywhere.` : undefined })
    } catch (error) {
      if (isApiError(error) && error.fields) setErrors(error.fields)
      toast.fromError(error)
    } finally {
      setSaving(false)
    }
  }
  return { save, saving, errors }
}

/** Whole-number field bound to a settings key, clamped to the API's allowed range on blur. */
function NumberSetting({ label, hint, value, min, max, error, onChange, suffix }: { label: string; hint: ReactNode; value: number | undefined; min: number; max: number; error?: string; onChange: (value: number) => void; suffix?: string }) {
  const [text, setText] = useState(String(value ?? ''))
  useEffect(() => setText(String(value ?? '')), [value])
  return (
    <TextField
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      trailing={suffix}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isInteger(n)) onChange(n)
      }}
      onBlur={() => {
        const n = Math.min(max, Math.max(min, Math.round(Number(text) || min)))
        setText(String(n))
        onChange(n)
      }}
      hint={hint}
      error={error}
    />
  )
}

function GymTab({ settings }: { settings: GymSettings }) {
  const { draft, set, changed, dirty, reset } = useDraft(settings, ['gym_name', 'gym_address', 'gym_phone', 'gym_email', 'currency', 'member_code_prefix'])
  const { save, saving, errors } = useSave()
  return (
    <Card>
      <CardHeader
        icon={Building2}
        title="Gym profile"
        description="The gym name shows on every screen, browser tabs, the installed app, receipts, reports, backups and member messages."
      />
      <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
        <TextField label="Gym name" required value={draft.gym_name ?? ''} onChange={(e) => set('gym_name', e.target.value)} error={errors.gym_name} />
        <TextField label="Phone" value={draft.gym_phone ?? ''} onChange={(e) => set('gym_phone', e.target.value)} error={errors.gym_phone} />
        <TextField label="Email" type="email" value={draft.gym_email ?? ''} onChange={(e) => set('gym_email', e.target.value)} error={errors.gym_email} />
        <SelectField
          label="Currency"
          value={draft.currency ?? 'INR'}
          onChange={(e) => set('currency', e.target.value)}
          hint="UPI always charges in INR."
          options={['INR', 'USD', 'AED', 'GBP', 'EUR', 'SGD'].map((c) => ({ value: c, label: c }))}
        />
        <TextareaField label="Address" rows={2} wrapperClassName="sm:col-span-2" value={draft.gym_address ?? ''} onChange={(e) => set('gym_address', e.target.value)} error={errors.gym_address} />
        <TextField
          label="Member ID prefix"
          value={draft.member_code_prefix ?? ''}
          onChange={(e) => set('member_code_prefix', e.target.value.toUpperCase())}
          hint={`New members get IDs like ${(draft.member_code_prefix || 'GYM').toUpperCase()}000123`}
          error={errors.member_code_prefix}
        />
      </div>
      <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => save(changed)} />
    </Card>
  )
}

function PaymentsTab({ settings }: { settings: GymSettings }) {
  const { draft, set, changed, dirty, reset } = useDraft(settings, ['upi_enabled', 'upi_id', 'upi_name'])
  const { save, saving, errors } = useSave()
  const previewUri = draft.upi_id ? `upi://pay?pa=${encodeURIComponent(draft.upi_id)}&pn=${encodeURIComponent(draft.upi_name || settings.gym_name)}&cu=INR` : ''
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={Smartphone} title="Direct UPI" description="Members pay your UPI ID from any UPI app and submit the 12-digit UTR. Staff approve it after checking the credit." />
        <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <Switch label="Accept Direct UPI in the member app" description="Shows your UPI QR on the renewal screen." checked={!!draft.upi_enabled} onChange={(v) => set('upi_enabled', v)} />
            <TextField label="UPI ID" required={!!draft.upi_enabled} placeholder="yourgym@okaxis" value={draft.upi_id ?? ''} onChange={(e) => set('upi_id', e.target.value.trim())} error={errors.upi_id} />
            <TextField label="Payee name" placeholder={settings.gym_name} value={draft.upi_name ?? ''} onChange={(e) => set('upi_name', e.target.value)} hint="Shown as the payee in UPI apps." error={errors.upi_name} />
          </div>
          {previewUri && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-subtle p-4">
              <QRCode value={previewUri} size={148} label="UPI QR preview" />
              <p className="text-[12px] text-muted">Preview (no amount)</p>
            </div>
          )}
        </div>
        <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => save(changed)} />
      </Card>
      <Card>
        <CardHeader icon={ShieldCheck} title="How payments work" description="No payment gateway, no fees, no card data" />
        <ul className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          {[
            { icon: Banknote, title: 'Cash at the desk', text: 'Staff record it; the membership starts immediately.' },
            { icon: Smartphone, title: 'UPI', text: 'At the desk (staff enter the UTR) or from the member app (pending until approved).' },
            { icon: Landmark, title: 'Bank transfer', text: 'Recorded with the bank reference.' },
            { icon: CreditCard, title: 'Card (manual)', text: 'Taken on your own card terminal; the app stores only the slip number — never card details.' },
          ].map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3 rounded-xl border border-line p-3.5">
              <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              <span>
                <span className="block text-sm font-semibold text-ink">{title}</span>
                <span className="block text-[13px] text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function NotificationsTab({ settings }: { settings: GymSettings }) {
  const { draft, set, changed, dirty, reset } = useDraft(settings, ['reminders_enabled', 'notify_payment', 'notify_activation', 'notify_renewal', 'notify_trainer'])
  const { save, saving } = useSave()
  return (
    <Card>
      <CardHeader icon={BellRing} title="In-app notifications" description="Shown in the member app. No SMS, WhatsApp or email is sent." />
      <div className="grid gap-x-8 px-5 pb-5 lg:grid-cols-2">
        <div className="divide-y divide-line">
          <Switch
            label="Expiry reminders"
            description="Each morning: 7, 3 and 1 day before a membership ends, and once after it ends. Never twice in a day."
            checked={!!draft.reminders_enabled}
            onChange={(v) => set('reminders_enabled', v)}
          />
          <Switch label="Payment confirmation" description="When a payment is recorded or approved." checked={!!draft.notify_payment} onChange={(v) => set('notify_payment', v)} />
        </div>
        <div className="divide-y divide-line">
          <Switch label="Membership activated" checked={!!draft.notify_activation} onChange={(v) => set('notify_activation', v)} />
          <Switch label="Membership renewed" checked={!!draft.notify_renewal} onChange={(v) => set('notify_renewal', v)} />
          <Switch label="Trainer assigned" checked={!!draft.notify_trainer} onChange={(v) => set('notify_trainer', v)} />
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => save(changed)} />
    </Card>
  )
}

function AttendanceTab({ settings }: { settings: GymSettings }) {
  const { draft, set, changed, dirty, reset } = useDraft(settings, ['attendance_checkout', 'attendance_cooldown_minutes', 'attendance_grace_days'])
  const { save, saving, errors } = useSave()
  return (
    <Card>
      <CardHeader icon={CalendarCheck2} title="Attendance" description="How QR scans behave at the front desk" />
      <div className="divide-y divide-line px-5 pb-5">
        <Switch label="Record check-out on a second scan" description="A later scan the same day records the check-out time." checked={!!draft.attendance_checkout} onChange={(v) => set('attendance_checkout', v)} />
        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <NumberSetting
            label="Minutes before a check-out counts"
            min={1}
            max={240}
            suffix="min"
            value={draft.attendance_cooldown_minutes}
            onChange={(v) => set('attendance_cooldown_minutes', v)}
            hint="Scans closer together are treated as duplicates (1–240)."
            error={errors.attendance_cooldown_minutes}
          />
          <NumberSetting
            label="Grace days after expiry"
            min={0}
            max={7}
            suffix="days"
            value={draft.attendance_grace_days}
            onChange={(v) => set('attendance_grace_days', v)}
            hint="Allow entry for a few days after a membership ends (0–7)."
            error={errors.attendance_grace_days}
          />
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => save(changed)} />
    </Card>
  )
}

function DataTab({ settings }: { settings: GymSettings }) {
  const { draft, set, changed, dirty, reset } = useDraft(settings, ['notification_retention_days', 'archive_after_months', 'storage_alerts_enabled'])
  const { save, saving, errors } = useSave()
  return (
    <Card id="retention">
      <CardHeader icon={Database} title="Data retention" description="Keeps the database small on Cloudflare D1's free plan" />
      <div className="divide-y divide-line px-5 pb-5">
        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <NumberSetting
            label="Keep notifications for"
            min={30}
            max={730}
            suffix="days"
            value={draft.notification_retention_days}
            onChange={(v) => set('notification_retention_days', v)}
            hint="Older in-app notifications are removed automatically (30–730). This is the only data cleaned up automatically."
            error={errors.notification_retention_days}
          />
          <NumberSetting
            label="Suggest archiving records older than"
            min={6}
            max={120}
            suffix="months"
            value={draft.archive_after_months}
            onChange={(v) => set('archive_after_months', v)}
            hint="Only a suggestion on the Data & Backup page (6–120). Nothing is archived without your backup and confirmation."
            error={errors.archive_after_months}
          />
        </div>
        <Switch
          label="Storage alerts"
          description="A daily in-app alert to admins while the database is at 80% or more of the free-plan limit."
          checked={!!draft.storage_alerts_enabled}
          onChange={(v) => set('storage_alerts_enabled', v)}
        />
        <p className="pt-4 text-[13px] text-muted">
          Payments, memberships and member records are never removed automatically.{' '}
          <Link to="/data-backup" className="font-semibold text-ink underline-offset-2 hover:underline">
            Open Data &amp; Backup
          </Link>
        </p>
      </div>
      <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => save(changed)} />
    </Card>
  )
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/

function TeamUserDialog({ user, open, onClose, onCreated }: { user: TeamUser | null; open: boolean; onClose: () => void; onCreated: (credentials: Credentials) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'STAFF' | 'ADMIN'>('STAFF')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(user?.name ?? '')
    setEmail(user?.email ?? '')
    setPhone(user?.phone ?? '')
    setRole(user?.role === 'ADMIN' ? 'ADMIN' : 'STAFF')
    setErrors({})
  }, [open, user])

  const submit = async () => {
    const problems: Record<string, string> = {}
    if (name.trim().length < 2) problems.name = 'Enter the name'
    if (!email.trim() && !phone.trim()) problems.email = 'Add an email or phone number to sign in with'
    if (email.trim() && !EMAIL.test(email.trim())) problems.email = 'Enter a valid email address'
    setErrors(problems)
    if (Object.keys(problems).length) return
    setBusy(true)
    const body = { name: name.trim(), email: email.trim().toLowerCase() || null, phone: phone.trim() || null }
    try {
      if (user) {
        await usersApi.update(user.id, body)
        toast.success('Account updated')
      } else {
        const created = await usersApi.create({ ...body, role })
        onCreated({ login: created.login, temporary_password: created.temporary_password })
      }
      invalidate('users')
      onClose()
    } catch (error) {
      if (isApiError(error) && error.fields) setErrors(error.fields)
      else toast.fromError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? 'Edit team account' : 'Add team member'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit}>
            {user ? 'Save' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} data-autofocus />
        <TextField label="Email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} hint="Used to sign in. Add a phone number instead if they have no email." />
        <TextField label="Phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
        {!user && (
          <SelectField
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'STAFF' | 'ADMIN')}
            hint="A one-time password is created; they choose their own at first sign-in."
            options={[
              { value: 'STAFF', label: 'Front desk — members, memberships, payments, attendance, basic reports' },
              { value: 'ADMIN', label: 'Admin — everything, including settings, expenses and backups' },
            ]}
          />
        )}
      </div>
    </Dialog>
  )
}

function TeamTab() {
  const { user } = useAuth()
  const toast = useToast()
  const team = useApi('users:team', () => usersApi.list())
  const [editing, setEditing] = useState<TeamUser | null | undefined>(undefined)
  const [credentials, setCredentials] = useState<Credentials | null>(null)

  const resetPassword = async (u: TeamUser) => {
    try {
      setCredentials(await usersApi.resetPassword(u.id))
      invalidate('users')
    } catch (error) {
      toast.fromError(error)
    }
  }
  const toggle = async (u: TeamUser) => {
    try {
      await usersApi.setStatus(u.id, u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')
      invalidate('users')
      toast.success(u.status === 'ACTIVE' ? 'Account disabled' : 'Account enabled')
    } catch (error) {
      toast.fromError(error)
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={Users}
        title="Team accounts"
        description="Admins have full access; front-desk staff handle members, memberships, payments, attendance and basic reports. Trainer logins are managed on each trainer."
        action={
          <Button size="sm" icon={Plus} onClick={() => setEditing(null)}>
            Add user
          </Button>
        }
      />
      {team.error ? (
        <ErrorState compact error={team.error} onRetry={team.reload} />
      ) : (
        <DataList
          rows={team.data?.items}
          loading={team.loading}
          rowKey={(u) => u.id}
          columns={[
            { key: 'name', header: 'Name', cell: (u) => <span className="font-semibold text-ink">{u.name}</span> },
            {
              key: 'login',
              header: 'Signs in with',
              cell: (u) => (
                <span className="block">
                  <span className="block">{u.email ?? u.phone ?? '—'}</span>
                  {u.email && u.phone && <span className="block text-[12px] text-muted">{u.phone}</span>}
                </span>
              ),
            },
            { key: 'role', header: 'Role', cell: (u) => <Pill tone={u.role === 'ADMIN' ? 'violet' : 'slate'}>{u.role === 'ADMIN' ? 'Admin' : 'Front desk'}</Pill> },
            { key: 'last', header: 'Last sign-in', cell: (u) => (u.must_change_password ? 'Waiting for first sign-in' : u.last_login_at ? relativeTime(u.last_login_at) : 'Never') },
            { key: 'status', header: 'Status', cell: (u) => <StatusBadge status={u.status ?? 'ACTIVE'} size="sm" /> },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (u) =>
                u.id === user?.id ? (
                  <span className="text-[12px] text-faint">You</span>
                ) : (
                  <Menu
                    label={`Actions for ${u.name}`}
                    trigger={({ toggle: open }) => (
                      <Button size="sm" variant="ghost" onClick={open}>
                        Manage
                      </Button>
                    )}
                    items={[
                      { label: 'Edit details', icon: Pencil, onSelect: () => setEditing(u) },
                      { label: 'Reset password', icon: KeyRound, onSelect: () => void resetPassword(u) },
                      'divider',
                      { label: u.status === 'ACTIVE' ? 'Disable account' : 'Enable account', tone: u.status === 'ACTIVE' ? 'danger' : undefined, onSelect: () => void toggle(u) },
                    ]}
                  />
                ),
            },
          ]}
          mobile={(u) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{u.name}</p>
                <p className="truncate text-[12px] text-muted">
                  {u.email ?? u.phone} · {u.role === 'ADMIN' ? 'Admin' : 'Front desk'}
                </p>
              </div>
              <StatusBadge status={u.status ?? 'ACTIVE'} size="sm" />
            </div>
          )}
        />
      )}
      <TeamUserDialog user={editing ?? null} open={editing !== undefined} onClose={() => setEditing(undefined)} onCreated={setCredentials} />
      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} title="Account ready" subject="your team member" />
    </Card>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const options: { value: 'light' | 'dark' | 'system'; label: string; icon: typeof Sun; description: string }[] = [
    { value: 'light', label: 'Light', icon: Sun, description: 'Bright and clean' },
    { value: 'dark', label: 'Dark', icon: Moon, description: 'Easy on the eyes at night' },
    { value: 'system', label: 'System', icon: Monitor, description: 'Follow this device' },
  ]
  return (
    <Card>
      <CardHeader icon={Palette} title="Appearance" description="Saved on this device only" />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
        {options.map(({ value, label, icon: Icon, description }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={cn(
              'cursor-pointer rounded-2xl border p-4 text-left transition-colors duration-150',
              theme === value ? 'border-primary bg-subtle ring-2 ring-primary/20' : 'border-line hover:bg-hover',
            )}
          >
            <Icon className="size-5 text-ink-2" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-ink">{label}</p>
            <p className="text-[13px] text-muted">{description}</p>
          </button>
        ))}
      </div>
    </Card>
  )
}

export default function SettingsPage() {
  useDocumentTitle('Settings')
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'gym'
  const settings = useApi('settings', () => settingsApi.get())
  const tabs: { value: Tab; label: string; icon: typeof Building2 }[] = [
    { value: 'gym', label: 'Gym', icon: Building2 },
    { value: 'payments', label: 'Payments', icon: CreditCard },
    { value: 'notifications', label: 'Notifications', icon: BellRing },
    { value: 'attendance', label: 'Attendance', icon: CalendarCheck2 },
    { value: 'data', label: 'Data retention', icon: Database },
    { value: 'team', label: 'Team', icon: Users },
    { value: 'appearance', label: 'Appearance', icon: Palette },
  ]
  let body: ReactNode
  if (tab === 'appearance') body = <AppearanceTab />
  else if (tab === 'team') body = <TeamTab />
  else if (settings.loading && !settings.data) body = <PageLoader />
  else if (!settings.data) body = <ErrorState error={settings.error} onRetry={settings.reload} />
  else if (tab === 'payments') body = <PaymentsTab settings={settings.data} />
  else if (tab === 'notifications') body = <NotificationsTab settings={settings.data} />
  else if (tab === 'attendance') body = <AttendanceTab settings={settings.data} />
  else if (tab === 'data') body = <DataTab settings={settings.data} />
  else body = <GymTab settings={settings.data} />
  return (
    <div>
      <PageHeader title="Settings" description="Your gym’s profile, payments, notifications and data rules" />
      <Tabs className="mb-4" items={tabs} value={tab} onChange={(v) => setParams(v === 'gym' ? {} : { tab: v }, { replace: true })} />
      {body}
    </div>
  )
}
