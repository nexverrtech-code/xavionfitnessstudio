import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { LogoMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { homePathFor, useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { changePasswordSchema, type ChangePasswordValues } from '@/schemas/auth'
import { authApi } from '@/services/endpoints'
import { applyServerErrors } from '@/utils/forms'

export default function ChangePasswordPage() {
  useDocumentTitle('Change password')
  const { user, applySession, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const forced = !!user?.must_change_password
  const { register, handleSubmit, setError, formState } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  })

  const submit = handleSubmit(async (values) => {
    try {
      const auth = await authApi.changePassword(values.current_password, values.new_password)
      applySession(auth)
      toast.success('Password updated', { description: 'Other devices have been signed out.' })
      navigate(homePathFor(auth.user), { replace: true })
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <LogoMark className="size-10" />
          {!forced && (
            <Link to={homePathFor(user)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
              <ArrowLeft className="size-4" aria-hidden /> Back
            </Link>
          )}
        </div>
        <Card className="p-6 sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300">
            <KeyRound className="size-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">{forced ? 'Set your new password' : 'Change password'}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {forced ? 'You signed in with a temporary password. Choose a personal one to continue.' : 'Changing your password signs you out of other devices.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <TextField
              label={forced ? 'Temporary password' : 'Current password'}
              required
              type="password"
              autoComplete="current-password"
              error={formState.errors.current_password?.message}
              {...register('current_password')}
              autoFocus
            />
            <TextField
              label="New password"
              required
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters, with letters and numbers or symbols."
              error={formState.errors.new_password?.message}
              {...register('new_password')}
            />
            <TextField label="Confirm new password" required type="password" autoComplete="new-password" error={formState.errors.confirm_password?.message} {...register('confirm_password')} />
            <Button type="submit" size="lg" fullWidth loading={formState.isSubmitting}>
              Save password
            </Button>
            {forced && (
              <Button variant="ghost" fullWidth onClick={logout}>
                Sign out instead
              </Button>
            )}
          </form>
        </Card>
      </div>
    </div>
  )
}
