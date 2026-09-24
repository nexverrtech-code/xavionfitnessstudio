import {
  BarChart3,
  Bell,
  CalendarCheck2,
  ClipboardList,
  DatabaseBackup,
  Dumbbell,
  FileBarChart,
  Home,
  LayoutDashboard,
  LineChart,
  QrCode,
  ReceiptIndianRupee,
  ScanLine,
  Settings,
  Tags,
  User,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
}

const TEAM: Role[] = ['ADMIN', 'STAFF']
const ALL_TEAM: Role[] = ['ADMIN', 'STAFF', 'TRAINER']

/** Sidebar order follows the product spec (§38); each role sees only what it may use. */
export const APP_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: TEAM },
  { to: '/trainer', label: 'Dashboard', icon: LayoutDashboard, roles: ['TRAINER'] },
  { to: '/members', label: 'Members', icon: Users, roles: ALL_TEAM },
  { to: '/membership-plans', label: 'Membership Plans', icon: Tags, roles: ['ADMIN'] },
  { to: '/memberships', label: 'Memberships', icon: ClipboardList, roles: TEAM },
  { to: '/payments', label: 'Payments', icon: Wallet, roles: TEAM },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck2, roles: ALL_TEAM },
  { to: '/trainers', label: 'Trainers', icon: UserCog, roles: ['ADMIN'] },
  { to: '/workouts', label: 'Workout Plans', icon: Dumbbell, roles: ['ADMIN', 'TRAINER'] },
  { to: '/progress', label: 'Progress', icon: LineChart, roles: ['ADMIN', 'TRAINER'] },
  { to: '/notifications', label: 'Notifications', icon: Bell, roles: ['ADMIN'] },
  { to: '/expenses', label: 'Expenses', icon: ReceiptIndianRupee, roles: ['ADMIN'] },
  { to: '/reports', label: 'Reports', icon: FileBarChart, roles: TEAM },
  { to: '/data-backup', label: 'Data & Backup', icon: DatabaseBackup, roles: ['ADMIN'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['ADMIN'] },
]

export function navFor(role: Role): NavItem[] {
  return APP_NAV.filter((item) => item.roles.includes(role))
}

/** Phone bottom bar: Home · Members · Scan · More */
export function bottomNavFor(role: Role): NavItem[] {
  const home = role === 'TRAINER' ? '/trainer' : '/dashboard'
  return [
    { to: home, label: 'Home', icon: Home, roles: ALL_TEAM },
    { to: '/members', label: 'Members', icon: Users, roles: ALL_TEAM },
    { to: '/attendance', label: 'Scan', icon: ScanLine, roles: ALL_TEAM },
  ]
}

export const PORTAL_NAV: NavItem[] = [
  { to: '/portal', label: 'Home', icon: Home, roles: ['MEMBER'] },
  { to: '/portal/workout', label: 'Workout', icon: Dumbbell, roles: ['MEMBER'] },
  { to: '/portal/qr', label: 'My QR', icon: QrCode, roles: ['MEMBER'] },
  { to: '/portal/progress', label: 'Progress', icon: BarChart3, roles: ['MEMBER'] },
  { to: '/portal/profile', label: 'Profile', icon: User, roles: ['MEMBER'] },
]

