import { zodResolver } from '@hookform/resolvers/zod'
import { ShieldCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router'
import { LogoMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageLoader } from '@/components/ui/Feedback'
import { TextField } from '@/components/ui/Field'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { setupSchema, type SetupValues } from '@/schemas/auth'
import { authApi } from '@/services/endpoints'
import { applyServerErrors } from '@/utils/forms'

export default function SetupPage() {
  useDocumentTitle('Set up your gym')
  const { user, applySession } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const status = useApi('setup:status', () => authApi.setupStatus())
  const { register, handleSubmit, setError, formState } = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { setup_token: '', name: '', email: '', password: '', confirm_password: '' },
  })

  if (user) return <Navigate to="/" replace />
  if (status.loading) return <PageLoader />

  const submit = handleSubmit(async (values) => {
    try {
      const auth = await authApi.setupAdmin({ setup_token: values.setup_token, name: values.name, email: values.email.trim().toLowerCase(), password: values.password })
      applySession(auth)
      toast.success('Admin account created', { description: 'Next: add your plans and your UPI ID in Settings.' })
      navigate('/settings', { replace: true })
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  const available = status.data?.needs_setup && status.data.setup_enabled
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <LogoMark className="mb-6 size-10" />
        <Card className="p-6 sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">Create the admin account</h1>
          {!available ? (
            <div className="mt-3 space-y-3 text-sm text-muted">
              <p>
                {status.data?.needs_setup
                  ? 'First-run setup is disabled. Set a SETUP_TOKEN Worker secret, or create the admin with scripts/create_admin.py.'
                  : 'This gym is already set up.'}
              </p>
              <Link to="/login" className="font-semibold text-accent-700 hover:underline dark:text-accent-300">
                Go to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <TextField label="Setup token" required type="password" autoComplete="off" hint="The SETUP_TOKEN secret configured on the API Worker." error={formState.errors.setup_token?.message} {...register('setup_token')} autoFocus />
              <TextField label="Your name" required error={formState.errors.name?.message} {...register('name')} />
              <TextField label="Email (used to sign in)" required type="email" autoComplete="username" error={formState.errors.email?.message} {...register('email')} />
              <TextField label="Password" required type="password" autoComplete="new-password" error={formState.errors.password?.message} {...register('password')} />
              <TextField label="Confirm password" required type="password" autoComplete="new-password" error={formState.errors.confirm_password?.message} {...register('confirm_password')} />
              <Button type="submit" size="lg" fullWidth loading={formState.isSubmitting}>
                Create admin
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
