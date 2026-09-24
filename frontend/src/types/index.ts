// API types — mirror the FastAPI responses (amounts are integer paise, dates 'YYYY-MM-DD',
// timestamps ISO UTC strings).

export type Role = 'ADMIN' | 'STAFF' | 'TRAINER' | 'MEMBER'
/** Stored member status. "Expiring" is computed from the membership (see CoverageState). */
export type MemberStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'EXPIRED'
/** A member's coverage computed by the backend from their latest paid membership. */
export type CoverageState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'NONE'
export type MembershipStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'UPCOMING' | 'CANCELLED'
export type PaymentStatus = 'PENDING' | 'PAID' | 'REJECTED' | 'FAILED' | 'REFUNDED'
export type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD_MANUAL'
export type ExpenseCategory = 'RENT' | 'ELECTRICITY' | 'SALARY' | 'EQUIPMENT' | 'MAINTENANCE' | 'MARKETING' | 'OTHER'
export type AttendanceMethod = 'QR' | 'MANUAL'
export type StorageLevel = 'HEALTHY' | 'MONITOR' | 'WARNING' | 'CRITICAL' | 'ARCHIVE_REQUIRED'
export type MemberStatusAction = 'SUSPEND' | 'REACTIVATE' | 'DEACTIVATE'

export interface Paginated<T> {
  items: T[]
  page: number
  limit: number
  total: number
  pages: number
}

export interface User {
  id: number
  name: string
  role: Role
  email: string | null
  phone: string | null
  /** What the person types to sign in (email, phone or member ID). */
  login: string | null
  member_id: number | null
  trainer_id: number | null
  status?: 'ACTIVE' | 'DISABLED'
  must_change_password: boolean
  last_login_at?: string | null
}

export type TeamUser = User

export interface AuthResponse {
  token: string
  expires_at: number
  user: User
}

export interface PublicConfig {
  gym_name: string
  currency: string
  timezone: string
  member_code_prefix: string
}

export interface CoverageInfo {
  status: CoverageState
  expiry_date: string | null
  days_left: number | null
}

export interface TrainerRef {
  id: number
  name: string
}

export interface MemberListItem {
  id: number
  member_code: string
  name: string
  phone: string
  email: string | null
  status: MemberStatus
  joining_date: string | null
  has_app: boolean
  trainer: TrainerRef | null
  membership: CoverageInfo & { plan_name: string | null }
}

export interface Membership {
  id: number
  member_id: number
  plan_id: number
  plan_name: string | null
  start_date: string
  end_date: string
  amount: number
  status: MembershipStatus
  days_left: number | null
  created_at: string | null
  member_name?: string
  member_code?: string
  phone?: string
}

export interface PendingPayment {
  id: number
  payment_number: string
  amount: number
  plan_name: string
  transaction_reference: string | null
  payment_date?: string
  created_at: string
}

export interface MemberWorkspace {
  id: number
  member_code: string
  name: string
  phone: string
  email: string | null
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null
  date_of_birth: string | null
  address: string | null
  emergency_contact: string | null
  joining_date: string
  status: MemberStatus
  trainer: TrainerRef | null
  membership: CoverageInfo & { current: Membership | null; latest: Membership | null; upcoming: Membership | null }
  pending_payment: PendingPayment | null
  stats: {
    visits_total: number
    visits_this_month: number
    last_check_in: string | null
    active_workouts: number
    latest_weight: number | null
    latest_measured_at: string | null
    total_paid?: number
    last_payment_date?: string | null
  }
  app: { enabled: boolean; login: string | null; last_login_at: string | null; must_change_password: boolean }
  created_at: string
}

/** A temporary password is shown once; the person must change it at first sign-in. */
export interface Credentials {
  login: string
  temporary_password: string
  user_id?: number
}

export interface Refund {
  amount: number
  method: PaymentMethod
  reference: string | null
  reason: string
  date: string
}

export interface Payment {
  id: number
  payment_number: string
  receipt_number: string | null
  member_id: number
  member_name?: string | null
  member_code?: string | null
  plan_id: number
  plan_name: string | null
  membership_id: number | null
  membership: { start_date: string; end_date: string } | null
  amount: number
  payment_method: PaymentMethod
  transaction_reference: string | null
  status: PaymentStatus
  payment_date: string
  verified_by_name: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  refund: Refund | null
}

export interface PaymentList extends Paginated<Payment> {
  paid_total?: number
  pending_amount?: number
}

export interface PaymentSummary {
  today: number
  week: number
  month: number
  month_count: number
  month_refunds: number
}

export interface RecordPaymentResult {
  payment: Payment
  membership: Membership | null
  member: { id: number } & Partial<CoverageInfo>
  replayed: boolean
}

export interface Receipt {
  gym: { name: string; address: string; phone: string; email: string }
  receipt_number: string
  payment_number: string
  member_code: string
  member_name: string
  plan_name: string
  amount: number
  payment_method: PaymentMethod
  transaction_reference: string | null
  payment_date: string
  membership_start: string | null
  membership_end: string | null
  status: PaymentStatus
  verified_at: string | null
  refund: Refund | null
}

export interface Plan {
  id: number
  name: string
  duration_days: number
  price: number
  description: string | null
  status: 'ACTIVE' | 'INACTIVE'
  active_members: number
  created_at?: string
}

export interface Trainer {
  id: number
  name: string
  phone: string
  email: string | null
  specialization: string | null
  joining_date: string | null
  status: 'ACTIVE' | 'INACTIVE'
  member_count: number
  has_login: boolean
  login: string | null
  last_login_at?: string | null
  created_at?: string
}

export interface MembershipPreview {
  member_id: number
  plan: { id: number; name: string; duration_days: number; price: number }
  start_date: string
  end_date: string
  is_renewal: boolean
  current: CoverageInfo
}

export interface UpiDetails {
  vpa: string
  payee_name: string
  amount: number
  note: string
  uri: string
}

export type ScanResultCode =
  | 'CHECKED_IN'
  | 'ALREADY_CHECKED_IN'
  | 'CHECKED_OUT'
  | 'ALREADY_CHECKED_OUT'
  | 'EXPIRED'
  | 'NO_MEMBERSHIP'
  | 'NOT_STARTED'
  | 'SUSPENDED'
  | 'INACTIVE'
  | 'INVALID'
  | 'NOT_FOUND'
  | 'MULTIPLE'

export interface ScanResult {
  result: ScanResultCode
  ok: boolean
  message: string
  member?: { id: number; member_code: string; name: string }
  membership?: CoverageInfo & { plan_name: string | null }
  time?: string
  check_in?: string
  attendance_id?: number
  matches?: { id: number; member_code: string; name: string }[]
}

export interface AttendanceEntry {
  id: number
  member_id: number
  member_name: string
  member_code: string
  phone: string
  date: string
  check_in: string
  check_out: string | null
  method: AttendanceMethod
}

export interface AttendanceLog extends Paginated<AttendanceEntry> {
  checked_out: number
  date: string
}

export interface AttendanceHistory {
  from: string
  to: string
  count: number
  items: { id: number; date: string; check_in: string; check_out: string | null; method: AttendanceMethod }[]
}

export interface Exercise {
  id?: number
  position?: number
  exercise_name: string
  sets: number | null
  reps: string | null
  weight: number | null
  rest_seconds: number | null
  notes: string | null
}

export interface Workout {
  id: number
  member_id: number
  member_name?: string
  member_code?: string
  trainer_id: number | null
  trainer_name: string | null
  title: string
  day_label: string | null
  notes: string | null
  status: 'ACTIVE' | 'ARCHIVED'
  created_at: string | null
  updated_at: string | null
  exercises: Exercise[]
}

export interface WorkoutListItem {
  id: number
  member_id: number
  member_name: string
  member_code: string
  trainer_name: string | null
  title: string
  day_label: string | null
  status: 'ACTIVE' | 'ARCHIVED'
  exercise_count: number
  updated_at: string | null
}

export const METRICS = ['weight', 'height', 'body_fat', 'chest', 'waist', 'arm', 'thigh'] as const
export type Metric = (typeof METRICS)[number]

export interface Measurement extends Partial<Record<Metric, number | null>> {
  id: number
  member_id: number
  /** Gym-local date of the measurement. */
  date: string
  recorded_at: string
  member_name?: string
  member_code?: string
}

export interface Progress {
  history: Measurement[]
  latest: Partial<Record<Metric, { value: number; date: string }>>
  change: Partial<Record<Metric, number>>
  bmi: number | null
}

export interface Expense {
  id: number
  category: ExpenseCategory
  amount: number
  description: string | null
  expense_date: string
  created_by_name: string | null
  created_at: string | null
}

export interface ExpenseList extends Paginated<Expense> {
  total_amount: number
  by_category: { category: ExpenseCategory; total: number; count: number }[]
}

export interface AnnounceResult {
  members: number
  delivered: number
  /** Members without the app can't receive in-app notifications. */
  without_app: number
}

export interface NotificationItem {
  id: number
  type: string
  message: string
  status: 'UNREAD' | 'READ'
  created_at: string
  read_at: string | null
  user_name?: string
  member_id?: number | null
  member_code?: string | null
  audience?: Role
}

export interface DashboardSummary {
  date: string
  members: {
    total: number
    active: number
    expired: number
    inactive: number
    suspended: number
    expiring: number
    joined_this_month: number
  }
  attendance: { today: number; yesterday: number }
  revenue: { today: number; month: number; month_payments: number; month_refunds: number; previous_month_same_period: number }
  pending_payments: { count: number; amount: number }
  expenses: { month: number }
  net_revenue: number
  storage?: { percent: number; level: StorageLevel; as_of: string }
}

export interface DashboardCharts {
  revenue_trend: { month: string; revenue: number; expenses?: number; payments: number }[]
  membership_trend: { month: string; new: number; renewals: number }[]
  attendance_trend: { date: string; visits: number }[]
  payment_methods: { method: PaymentMethod; count: number; amount: number }[]
  plan_distribution: { plan: string; members: number }[]
}

export interface ActivityEvent {
  type: string
  at: string | null
  title: string
  member_id?: number | null
  amount?: number
  status?: string
  ref?: number
}

export interface RenewalDue extends CoverageInfo {
  member_id: number
  member_code: string
  name: string
  phone: string
  plan_id: number | null
  plan_name: string | null
  has_pending_payment: boolean
  account_status: MemberStatus
}

export interface GymSettings {
  gym_name: string
  gym_address: string
  gym_phone: string
  gym_email: string
  currency: string
  member_code_prefix: string
  upi_enabled: boolean
  upi_id: string
  upi_name: string
  reminders_enabled: boolean
  notify_payment: boolean
  notify_activation: boolean
  notify_renewal: boolean
  notify_trainer: boolean
  attendance_checkout: boolean
  attendance_grace_days: number
  attendance_cooldown_minutes: number
  notification_retention_days: number
  archive_after_months: number
  storage_alerts_enabled: boolean
}

export interface PortalOverview {
  member: { id: number; member_code: string; name: string; status: MemberStatus; trainer_name: string | null }
  membership: CoverageInfo & { current: Membership | null; upcoming: Membership | null; latest: Membership | null }
  pending_payment: PendingPayment | null
  attendance: {
    this_month: number
    last_check_in: string | null
    checked_in_today: boolean
    last_14_days: { date: string; visited: boolean }[]
  }
  latest_payment: {
    id: number
    payment_number: string
    amount: number
    payment_method: PaymentMethod
    status: PaymentStatus
    payment_date: string
  } | null
  current_workout: { id: number; title: string; day_label: string | null; exercises: number } | null
  recent_notification: { id: number; type: string; message: string; status: 'UNREAD' | 'READ'; created_at: string } | null
  unread_notifications: number
}

export interface MemberProfile {
  id: number
  member_code: string
  name: string
  phone: string
  email: string | null
  gender: string | null
  date_of_birth: string | null
  address: string | null
  emergency_contact: string | null
  joining_date: string
  status: MemberStatus
  trainer_name: string | null
}

export interface TrainerOverview {
  assigned_members: number
  active_members: number
  expiring_members: number
  today_sessions: {
    id: number
    member_id: number
    name: string
    member_code: string
    check_in: string
    check_out: string | null
    method: AttendanceMethod
  }[]
  week_attendance: number
  active_workouts: number
  alerts: { member_id: number; name: string; member_code: string; kind: 'NO_WORKOUT' | 'MEASURE' | 'EXPIRING'; message: string }[]
}

// -- reports (rendered to CSV / PDF in the browser) --------------------------------------------
export type ReportKind = 'members' | 'memberships' | 'payments' | 'attendance' | 'expenses'

export interface ReportData {
  kind: ReportKind
  title: string
  gym_name: string
  from: string
  to: string
  generated_at: string
  summary: Record<string, unknown>
  truncated: boolean
  row_cap: number
  rows: Record<string, string | number | null>[]
}

// -- storage & backups --------------------------------------------------------------------------
export interface StorageTable {
  table: string
  rows: number
  estimated_bytes: number
  rows_per_day: number | null
  dataset: string | null
  oldest: string | null
}

export interface StorageOverview {
  used_bytes: number
  limit_bytes: number
  remaining_bytes: number
  percent: number
  status: StorageLevel
  thresholds: { below: number | null; status: StorageLevel }[]
  as_of: string
  measured_at: string
  growth_bytes_per_day: number
  days_until_warning: number | null
  tables: StorageTable[]
  archive_suggestion: { before: string; archive_after_months: number; candidates: { table: string; dataset: string; oldest: string }[] }
  history: { date: string; bytes: number }[]
  d1: { plan_limit_bytes: number; time_travel_days: number; free_daily_rows_read: number; free_daily_rows_written: number }
}

export type BackupStatus = 'CREATED' | 'VERIFIED' | 'ARCHIVING' | 'ARCHIVED' | 'CANCELLED' | 'COMPLETED'

export interface BackupRecord {
  id: number
  kind: 'BACKUP' | 'RESTORE' | 'TIME_TRAVEL'
  status: BackupStatus
  datasets: string[]
  period_from: string | null
  period_to: string | null
  record_count: number
  file_name: string | null
  checksum: string | null
  notes: string | null
  created_by_name: string | null
  created_at: string
  verified_by_name: string | null
  verified_at: string | null
  archived_by_name: string | null
  archived_at: string | null
  archived_count: number
}

export interface BackupTable {
  table: string
  dataset: string
  file: string
  columns: string[]
  types: Record<string, 'int' | 'real' | 'text'>
  rows: number
  archivable: boolean
}

export interface BackupManifest {
  backup: BackupRecord
  tables: BackupTable[]
  eligible_for_archive?: Record<string, number>
}

export interface BackupOptions {
  datasets: { key: string; label: string }[]
  always_included: { key: string; label: string }[]
  latest_archivable_date: string
  export_page_size: number
}

export interface ArchiveProgress {
  status: BackupStatus
  done: boolean
  paused: string | null
  removed_now: number
  archived_count: number
}

export interface RestoreCheckResult {
  table: string
  checked: number
  existing: number[]
}

export interface RestoreApplyResult {
  table: string
  received: number
  inserted: number
  skipped: number
}

export interface TimeTravelResult {
  restored_to: string
  bookmark: string | null
  previous_bookmark: string | null
  message: string | null
}

export interface TimeTravelInfo {
  retention_days: number
  earliest: string
  api_enabled: boolean
  database_name: string
  cli_command: string
}

export interface ApiErrorShape {
  status: number
  code: string
  message: string
  fields?: Record<string, string>
}
