import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarCheck2, Eye, EyeOff, LogIn, QrCode, ShieldCheck, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { LogoMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Checkbox, TextField } from '@/components/ui/Field'
import { homePathFor, useAuth } from '@/contexts/AuthContext'
import { useConfig } from '@/contexts/ConfigContext'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { loginSchema, type LoginValues } from '@/schemas/auth'
import { isApiError } from '@/services/api'
import { authApi } from '@/services/endpoints'

const FEATURES = [
  { icon: QrCode, title: 'QR attendance', text: 'One scan at the door. No duplicates, instant membership check.' },
  { icon: Wallet, title: 'Direct UPI + UTR', text: 'Zero gateway fees. Verify payments and activate in a click.' },
  { icon: CalendarCheck2, title: 'Automatic renewals', text: 'Reminders 7, 3 and 1 day before expiry — no follow-up calls.' },
]

export default function LoginPage() {
  useDocumentTitle('Sign in')
  const { user, login, sessionExpired } = useAuth()
  const config = useConfig()
  // Only a brand-new installation (no admin yet, SETUP_TOKEN configured) offers the setup link.
  const setup = useApi('setup:status', () => authApi.setupStatus(), { freshMs: 300_000 })
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '', remember: true },
  })

  if (user) return <Navigate to={homePathFor(user)} replace />

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const signedIn = await login(values.identifier, values.password, values.remember)
      const next = params.get('next')
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null
      navigate(signedIn.must_change_password ? '/account/password' : safeNext ?? homePathFor(signedIn), { replace: true })
    } catch (error) {
      setFormError(isApiError(error) ? error.message : 'Something went wrong. Please try again.')
    }
  })

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-hero p-12 text-white lg:flex lg:flex-col">
        <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
        <div className="absolute -left-24 top-1/3 size-96 rounded-full bg-accent-600/40 blur-3xl" aria-hidden />
        <div className="absolute -bottom-24 right-0 size-80 rounded-full bg-volt/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-10" />
          <span className="text-lg font-bold">{config.gym_name}</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold text-volt ring-1 ring-white/15">
            <ShieldCheck className="size-3.5" aria-hidden /> Gym management, made effortless
          </p>
          <h1 className="mt-5 text-[44px] font-bold leading-[1.05] tracking-tight">
            Run your gym
            <br />
            <span className="bg-gradient-to-r from-volt to-success-300 bg-clip-text text-transparent">at full speed.</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            Members, renewals, UPI payments, attendance, workouts and progress — in one fast app your front desk, trainers and members will love.
          </p>
          <ul className="mt-9 space-y-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-5 text-volt" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-sm text-white/60">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="size-11" />
            <span className="text-xl font-bold text-ink">{config.gym_name}</span>
          </div>
          <h2 className="text-[28px] font-bold tracking-tight text-ink">Welcome back</h2>
          <p className="mt-1.5 text-sm text-muted">Sign in to continue to {config.gym_name}.</p>

          {sessionExpired && !formError && (
            <p role="status" className="mt-5 rounded-xl bg-warning-50 px-3.5 py-2.5 text-sm text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
              Your session has ended. Please sign in again.
            </p>
          )}
          {formError && (
            <p role="alert" className="mt-5 rounded-xl bg-danger-50 px-3.5 py-2.5 text-sm font-medium text-danger-700 dark:bg-danger-500/10 dark:text-danger-300">
              {formError}
            </p>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <TextField
              label="Email, member ID or phone"
              required
              autoComplete="username"
              autoCapitalize="none"
              placeholder="you@gym.com · GYM000123 · 98765 43210"
              error={formState.errors.identifier?.message}
              {...register('identifier')}
              autoFocus
            />
            <TextField
              label="Password"
              required
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              error={formState.errors.password?.message}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
              {...register('password')}
            />
            <Checkbox label="Keep me signed in on this device" {...register('remember')} />
            <Button type="submit" size="lg" fullWidth icon={LogIn} loading={formState.isSubmitting}>
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-center text-[13px] text-muted">
            Forgot your password? Ask the front desk to reset it.
            {setup.data?.needs_setup && setup.data.setup_enabled && (
              <span className="mt-2 block">
                First time setting up?{' '}
                <Link to="/setup" className="font-semibold text-accent-700 hover:underline dark:text-accent-300">
                  Create the admin account
                </Link>
              </span>
            )}
          </p>
        </div>
      </main>
    </div>
  )
}
