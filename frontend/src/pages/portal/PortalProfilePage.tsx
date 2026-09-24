import { zodResolver } from '@hookform/resolvers/zod'
import { ClipboardList, KeyRound, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, KeyValue } from '@/components/ui/Card'
import { ErrorState, Skeleton } from '@/components/ui/Feedback'
import { TextField, TextareaField } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Menu'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import { profileSchema, type ProfileValues } from '@/schemas/member'
import { cn } from '@/utils/cn'
import { applyServerErrors } from '@/utils/forms'
import { formatDate } from '@/utils/format'

export default function PortalProfilePage() {
  useDocumentTitle('Profile')
  const { logout } = useAuth()
  const toast = useToast()
  const { theme, setTheme } = useTheme()
  const profile = useApi('portal:profile', () => portalApi.profile())
  const { register, handleSubmit, reset, setError, formState } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) })
  useEffect(() => {
    if (profile.data) reset({ email: profile.data.email ?? '', address: profile.data.address ?? '', emergency_contact: profile.data.emergency_contact ?? '' })
  }, [profile.data, reset])

  const submit = handleSubmit(async (values) => {
    try {
      await portalApi.updateProfile({ email: values.email || null, address: values.address || null, emergency_contact: values.emergency_contact || null })
      invalidate('portal')
      toast.success('Profile updated')
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  if (profile.error && !profile.data) return <ErrorState error={profile.error} onRetry={profile.reload} />
  const p = profile.data
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Profile</h1>
      <Card className="flex items-center gap-4 p-5">
        {p ? <Avatar name={p.name} size="xl" /> : <Skeleton className="size-16 rounded-full" />}
        <div className="min-w-0">
          <p className="truncate text-xl font-bold text-ink">{p?.name ?? '…'}</p>
          <p className="tabular text-sm text-muted">{p?.member_code}</p>
          {p?.trainer_name && <p className="text-[13px] text-muted">Trainer: {p.trainer_name}</p>}
        </div>
      </Card>
      {p && (
        <Card>
          <CardHeader title="Details" description="Contact the front desk to change your name or phone number" />
          <dl className="grid grid-cols-2 gap-4 px-5 pb-5">
            <KeyValue label="Phone" value={p.phone} />
            <KeyValue label="Member since" value={formatDate(p.joining_date)} />
            <KeyValue label="Date of birth" value={p.date_of_birth ? formatDate(p.date_of_birth) : null} />
            <KeyValue label="Gender" value={p.gender ? p.gender[0] + p.gender.slice(1).toLowerCase() : null} />
          </dl>
        </Card>
      )}
      <Card>
        <CardHeader title="Contact info" />
        <form onSubmit={submit} className="space-y-4 px-5 pb-5" noValidate>
          <TextField label="Email" type="email" error={formState.errors.email?.message} {...register('email')} />
          <TextField label="Emergency contact" placeholder="Name & phone" error={formState.errors.emergency_contact?.message} {...register('emergency_contact')} />
          <TextareaField label="Address" rows={2} error={formState.errors.address?.message} {...register('address')} />
          <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
            Save
          </Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="App" />
        <div className="space-y-3 px-5 pb-5">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
            {([
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
              ['system', 'System', Monitor],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn('flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold', theme === value ? 'border-accent-600 bg-accent-50 text-accent-800 dark:bg-accent-500/15 dark:text-accent-200' : 'border-line text-ink-2')}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <Link to="/portal/membership" className="flex h-12 items-center gap-3 rounded-xl border border-line px-4 text-sm font-semibold text-ink-2 hover:bg-hover">
            <ClipboardList className="size-4" aria-hidden /> Membership history
          </Link>
          <Link to="/account/password" className="flex h-12 items-center gap-3 rounded-xl border border-line px-4 text-sm font-semibold text-ink-2 hover:bg-hover">
            <KeyRound className="size-4" aria-hidden /> Change password
          </Link>
          <Button variant="secondary" icon={LogOut} fullWidth size="lg" onClick={logout} className="text-danger-600">
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  )
}
