import { Suspense } from 'react'
import { RouterProvider } from 'react-router'
import { LogoMark } from '@/components/brand/Logo'
import { AuthProvider } from '@/contexts/AuthContext'
import { ConfigProvider } from '@/contexts/ConfigContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { router } from '@/routes'

function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading SmartGym">
      <LogoMark className="size-12 animate-pulse" />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfigProvider>
          <AuthProvider>
            <Suspense fallback={<BootScreen />}>
              <RouterProvider router={router} />
            </Suspense>
          </AuthProvider>
        </ConfigProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
