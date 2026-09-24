import { createBrowserRouter, Outlet } from 'react-router'
import type { Role } from '@/types'
import { HomeRedirect, lazyPage, RequireRole } from './guards'

const AppLayout = lazyPage(() => import('@/layouts/AppLayout'))
const PortalLayout = lazyPage(() => import('@/layouts/PortalLayout'))

const LoginPage = lazyPage(() => import('@/pages/auth/LoginPage'))
const SetupPage = lazyPage(() => import('@/pages/auth/SetupPage'))
const ChangePasswordPage = lazyPage(() => import('@/pages/auth/ChangePasswordPage'))
const NotFoundPage = lazyPage(() => import('@/pages/NotFoundPage'))

const DashboardPage = lazyPage(() => import('@/pages/dashboard/DashboardPage'))
const TrainerDashboardPage = lazyPage(() => import('@/pages/trainer/TrainerDashboardPage'))
const MembersPage = lazyPage(() => import('@/pages/members/MembersPage'))
const MemberWorkspacePage = lazyPage(() => import('@/pages/members/MemberWorkspacePage'))
const MembershipPlansPage = lazyPage(() => import('@/pages/plans/MembershipPlansPage'))
const MembershipsPage = lazyPage(() => import('@/pages/memberships/MembershipsPage'))
const PaymentsPage = lazyPage(() => import('@/pages/payments/PaymentsPage'))
const AttendancePage = lazyPage(() => import('@/pages/attendance/AttendancePage'))
const TrainersPage = lazyPage(() => import('@/pages/trainers/TrainersPage'))
const TrainerDetailPage = lazyPage(() => import('@/pages/trainers/TrainerDetailPage'))
const WorkoutsPage = lazyPage(() => import('@/pages/workouts/WorkoutsPage'))
const ProgressPage = lazyPage(() => import('@/pages/progress/ProgressPage'))
const NotificationsPage = lazyPage(() => import('@/pages/notifications/NotificationsPage'))
const ExpensesPage = lazyPage(() => import('@/pages/expenses/ExpensesPage'))
const ReportsPage = lazyPage(() => import('@/pages/reports/ReportsPage'))
const DataBackupPage = lazyPage(() => import('@/pages/backup/DataBackupPage'))
const SettingsPage = lazyPage(() => import('@/pages/settings/SettingsPage'))

const PortalHomePage = lazyPage(() => import('@/pages/portal/PortalHomePage'))
const PortalMembershipPage = lazyPage(() => import('@/pages/portal/PortalMembershipPage'))
const PortalRenewPage = lazyPage(() => import('@/pages/portal/PortalRenewPage'))
const PortalQrPage = lazyPage(() => import('@/pages/portal/PortalQrPage'))
const PortalAttendancePage = lazyPage(() => import('@/pages/portal/PortalAttendancePage'))
const PortalWorkoutPage = lazyPage(() => import('@/pages/portal/PortalWorkoutPage'))
const PortalProgressPage = lazyPage(() => import('@/pages/portal/PortalProgressPage'))
const PortalPaymentsPage = lazyPage(() => import('@/pages/portal/PortalPaymentsPage'))
const PortalNotificationsPage = lazyPage(() => import('@/pages/portal/PortalNotificationsPage'))
const PortalProfilePage = lazyPage(() => import('@/pages/portal/PortalProfilePage'))

const ADMIN: Role[] = ['ADMIN']
const STAFF: Role[] = ['ADMIN', 'STAFF']
const TEAM: Role[] = ['ADMIN', 'STAFF', 'TRAINER']

const guard = (roles: Role[], element: React.ReactNode) => <RequireRole roles={roles}>{element}</RequireRole>

export const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/account/password', element: guard(['ADMIN', 'STAFF', 'TRAINER', 'MEMBER'], <ChangePasswordPage />) },
  {
    element: guard(TEAM, <AppLayout />),
    children: [
      { path: '/dashboard', element: guard(STAFF, <DashboardPage />) },
      { path: '/trainer', element: guard(['TRAINER'], <TrainerDashboardPage />) },
      { path: '/members', element: <MembersPage /> },
      { path: '/members/:memberId', element: <MemberWorkspacePage /> },
      { path: '/membership-plans', element: guard(ADMIN, <MembershipPlansPage />) },
      { path: '/memberships', element: guard(STAFF, <MembershipsPage />) },
      { path: '/payments', element: guard(STAFF, <PaymentsPage />) },
      { path: '/attendance', element: <AttendancePage /> },
      { path: '/trainers', element: guard(ADMIN, <TrainersPage />) },
      { path: '/trainers/:trainerId', element: guard(ADMIN, <TrainerDetailPage />) },
      { path: '/workouts', element: guard(['ADMIN', 'TRAINER'], <WorkoutsPage />) },
      { path: '/progress', element: guard(['ADMIN', 'TRAINER'], <ProgressPage />) },
      { path: '/notifications', element: guard(ADMIN, <NotificationsPage />) },
      { path: '/expenses', element: guard(ADMIN, <ExpensesPage />) },
      { path: '/reports', element: guard(STAFF, <ReportsPage />) },
      { path: '/data-backup', element: guard(ADMIN, <DataBackupPage />) },
      { path: '/settings', element: guard(ADMIN, <SettingsPage />) },
    ],
  },
  {
    path: '/portal',
    element: guard(['MEMBER'], <PortalLayout />),
    children: [
      { index: true, element: <PortalHomePage /> },
      { path: 'membership', element: <PortalMembershipPage /> },
      { path: 'renew', element: <PortalRenewPage /> },
      { path: 'qr', element: <PortalQrPage /> },
      { path: 'attendance', element: <PortalAttendancePage /> },
      { path: 'workout', element: <PortalWorkoutPage /> },
      { path: 'progress', element: <PortalProgressPage /> },
      { path: 'payments', element: <PortalPaymentsPage /> },
      { path: 'notifications', element: <PortalNotificationsPage /> },
      { path: 'profile', element: <PortalProfilePage /> },
    ],
  },
  { path: '*', element: <Outlet />, children: [{ path: '*', element: <NotFoundPage /> }] },
])
