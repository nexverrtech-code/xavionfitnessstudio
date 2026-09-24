import { Suspense } from 'react'
import { RouterProvider } from 'react-router'
import { LogoMark } from '@/components/brand/Logo'
import { AuthProvider } from '@/contexts/AuthContext'
import { ConfigProvider, useConfig } from '@/contexts/ConfigContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { router } from '@/routes'

function BootScreen() {
  const { gym_name } = useConfig()
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label={gym_name ? `Loading ${gym_name}` : 'Loading'}>
      <LogoMark className="size-12 animate-pulse" />
    </div>
  )
}

/** A new currency re-renders every screen, so amounts everywhere switch at once. */
function AppRouter() {
  const { currency } = useConfig()
  return <RouterProvider key={currency} router={router} />
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfigProvider>
          <AuthProvider>
            <Suspense fallback={<BootScreen />}>
              <AppRouter />
            </Suspense>
          </AuthProvider>
        </ConfigProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
