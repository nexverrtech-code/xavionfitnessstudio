import {
  BadgeCheck,
  BadgeIndianRupee,
  Ban,
  CalendarClock,
  Database,
  Hand,
  Megaphone,
  RefreshCw,
  RotateCcw,
  UserCog,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

/** In-app notification types (the only delivery channel). */
export const NOTIFICATION_TYPES: Record<string, { label: string; icon: LucideIcon }> = {
  MEMBERSHIP_ACTIVATED: { label: 'Membership activated', icon: BadgeCheck },
  MEMBERSHIP_RENEWED: { label: 'Membership renewed', icon: RefreshCw },
  PAYMENT_RECEIVED: { label: 'Payment received', icon: BadgeIndianRupee },
  PAYMENT_REJECTED: { label: 'Payment rejected', icon: Ban },
  PAYMENT_REFUNDED: { label: 'Refund recorded', icon: RotateCcw },
  EXPIRY_7D: { label: 'Expires in 7 days', icon: CalendarClock },
  EXPIRY_3D: { label: 'Expires in 3 days', icon: CalendarClock },
  EXPIRY_1D: { label: 'Expires tomorrow', icon: CalendarClock },
  MEMBERSHIP_EXPIRED: { label: 'Membership expired', icon: XCircle },
  TRAINER_ASSIGNED: { label: 'Trainer assigned', icon: UserCog },
  WELCOME: { label: 'Welcome', icon: Hand },
  ANNOUNCEMENT: { label: 'Announcement', icon: Megaphone },
  STORAGE_ALERT: { label: 'Storage alert', icon: Database },
}

export function notificationMeta(type: string): { label: string; icon: LucideIcon } {
  return NOTIFICATION_TYPES[type] ?? { label: type.replace(/_/g, ' ').toLowerCase(), icon: Megaphone }
}
