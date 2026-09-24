import { Suspense, useState } from 'react'
import { Outlet } from 'react-router'
import { OfflineBanner, PageLoader } from '@/components/ui/Feedback'
import { ActionsProvider } from '@/contexts/ActionsContext'
import { MobileNav, MoreSheet, Sidebar, Topbar } from './AppChrome'

/** Admin / staff / trainer shell. */
export default function AppLayout() {
  const [more, setMore] = useState(false)
  return (
    <ActionsProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-h-dvh flex-col lg:pl-64">
        <OfflineBanner />
        <Topbar onMore={() => setMore(true)} />
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <MobileNav onMore={() => setMore(true)} />
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </ActionsProvider>
  )
}
