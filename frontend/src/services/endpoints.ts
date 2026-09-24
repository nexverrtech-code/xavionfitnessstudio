// One function per backend route (FastAPI under /api). Amounts are integer paise.
import type {
  ActivityEvent,
  AnnounceResult,
  ArchiveProgress,
  AttendanceHistory,
  AttendanceLog,
  AuthResponse,
  BackupManifest,
  BackupOptions,
  BackupRecord,
  Credentials,
  DashboardCharts,
  DashboardSummary,
  Expense,
  ExpenseCategory,
  ExpenseList,
  GymSettings,
  Measurement,
  MemberListItem,
  MemberProfile,
  MemberStatusAction,
  MemberWorkspace,
  Membership,
  MembershipPreview,
  NotificationItem,
  Paginated,
  Payment,
  PaymentList,
  PaymentMethod,
  PaymentSummary,
  Plan,
  PortalOverview,
  Progress,
  PublicConfig,
  Receipt,
  RecordPaymentResult,
  RenewalDue,
  ReportData,
  ReportKind,
  RestoreApplyResult,
  RestoreCheckResult,
  ScanResult,
  StorageOverview,
  TeamUser,
  TimeTravelInfo,
  TimeTravelResult,
  Trainer,
  TrainerOverview,
  UpiDetails,
  User,
  Workout,
  WorkoutListItem,
} from '@/types'
import { del, get, idempotencyKey, post, put } from './api'

type Query = Record<string, unknown>

export interface MemberInput {
  name: string
  phone: string
  email?: string | null
  gender?: string | null
  date_of_birth?: string | null
  address?: string | null
  emergency_contact?: string | null
  trainer_id?: number | null
  joining_date?: string | null
  create_app_login?: boolean
}

export interface ExerciseInput {
  exercise_name: string
  sets?: number | null
  reps?: string | null
  weight?: number | null
  rest_seconds?: number | null
  notes?: string | null
}

export interface DeskPaymentInput {
  member_id: number
  plan_id: number
  payment_method: PaymentMethod
  amount?: number | null
  transaction_reference?: string | null
  payment_date?: string | null
  start_date?: string | null
  notes?: string | null
}

export interface RefundInput {
  amount?: number | null
  refund_method: PaymentMethod
  refund_reference?: string | null
  refund_reason: string
  refund_date?: string | null
  cancel_membership: boolean
}

export interface PlanInput {
  name: string
  duration_days: number
  price: number
  description: string | null
  status: 'ACTIVE' | 'INACTIVE'
}

export interface ExpenseInput {
  category: ExpenseCategory
  amount: number
  description?: string | null
  expense_date?: string | null
}

export interface MeasurementInput {
  date?: string | null
  weight?: number | null
  height?: number | null
  body_fat?: number | null
  chest?: number | null
  waist?: number | null
  arm?: number | null
  thigh?: number | null
}

export const authApi = {
  login: (identifier: string, password: string, remember: boolean) =>
    post<AuthResponse>('/auth/login', { identifier, password, remember }),
  me: () => get<User>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    post<AuthResponse>('/auth/change-password', { current_password, new_password }),
  logoutAll: () => post<void>('/auth/logout-all'),
  publicConfig: () => get<PublicConfig>('/config'),
  setupStatus: () => get<{ needs_setup: boolean; setup_enabled: boolean }>('/auth/setup-status'),
  setupAdmin: (body: { setup_token: string; name: string; email: string; password: string }) =>
    post<AuthResponse>('/auth/setup', body),
}

export const usersApi = {
  list: () => get<{ items: TeamUser[] }>('/users'),
  create: (body: { name: string; email: string | null; phone: string | null; role: 'ADMIN' | 'STAFF' }) =>
    post<{ user: TeamUser } & Credentials>('/users', body),
  update: (id: number, body: { name: string; email: string | null; phone: string | null }) => put<TeamUser>(`/users/${id}`, body),
  setStatus: (id: number, status: 'ACTIVE' | 'DISABLED') => post<TeamUser>(`/users/${id}/status`, { status }),
  resetPassword: (id: number) => post<Credentials>(`/users/${id}/reset-password`),
}

export const settingsApi = {
  get: () => get<GymSettings>('/settings'),
  update: (changes: Partial<GymSettings>) => put<GymSettings>('/settings', changes),
}

export const membersApi = {
  search: (q: string, signal?: AbortSignal) => get<{ items: MemberListItem[] }>('/members/search', { q }, { signal }),
  list: (params: Query) => get<Paginated<MemberListItem>>('/members', params),
  create: (body: MemberInput) => post<{ member: MemberWorkspace; credentials: Credentials | null }>('/members', body),
  get: (id: number) => get<MemberWorkspace>(`/members/${id}`),
  update: (id: number, body: MemberInput & { joining_date: string }) => put<MemberWorkspace>(`/members/${id}`, body),
  setStatus: (id: number, action: MemberStatusAction) => post<{ id: number; status: string }>(`/members/${id}/status`, { action }),
  assignTrainer: (id: number, trainer_id: number | null) =>
    post<{ member_id: number; trainer: { id: number; name: string } | null }>(`/members/${id}/trainer`, { trainer_id }),
  memberships: (id: number) => get<{ items: Membership[] }>(`/members/${id}/memberships`),
  payments: (id: number, params: Query) => get<PaymentList>(`/members/${id}/payments`, params),
  attendance: (id: number, month?: string) => get<AttendanceHistory>(`/members/${id}/attendance`, { month }),
  workouts: (id: number) => get<{ items: Workout[] }>(`/members/${id}/workouts`, { include_archived: true }),
  activity: (id: number) => get<{ items: ActivityEvent[] }>(`/members/${id}/activity`),
  qr: (id: number) => get<{ member_id: number; member_code: string; name: string; payload: string }>(`/members/${id}/qr`),
  resetQr: (id: number) => post<{ member_id: number; payload: string }>(`/members/${id}/qr/reset`),
  /** Give, reset or re-enable the member's app login; without a password a one-time one is generated. */
  enableApp: (id: number, body: { password?: string | null; must_change_password?: boolean } = {}) =>
    post<Credentials>(`/members/${id}/app-access`, body),
  disableApp: (id: number) => del(`/members/${id}/app-access`),
}

export const plansApi = {
  list: (params: { include_inactive?: boolean; stats?: boolean } = {}) => get<{ items: Plan[] }>('/membership-plans', params),
  create: (body: PlanInput) => post<Plan>('/membership-plans', body),
  update: (id: number, body: PlanInput) => put<Plan>(`/membership-plans/${id}`, body),
}

export const membershipsApi = {
  list: (params: Query) => get<Paginated<Membership>>('/memberships', params),
  renewals: (params: Query) => get<Paginated<RenewalDue>>('/memberships/renewals', params),
  preview: (member_id: number, plan_id: number) => get<MembershipPreview>('/memberships/preview', { member_id, plan_id }),
  cancel: (id: number) => post<{ id: number; status: 'CANCELLED' }>(`/memberships/${id}/cancel`),
}

export const paymentsApi = {
  list: (params: Query) => get<PaymentList>('/payments', params),
  pending: (params: Query = {}) => get<PaymentList>('/payments/pending', params),
  summary: () => get<PaymentSummary>('/payments/summary'),
  get: (id: number) => get<Payment>(`/payments/${id}`),
  upi: (member_id: number, plan_id: number) => get<UpiDetails>('/payments/upi', { member_id, plan_id }),
  /** Staff record money they received; the membership activates immediately. */
  record: (body: DeskPaymentInput, key: string = idempotencyKey()) =>
    post<RecordPaymentResult>('/payments', body, { headers: { 'Idempotency-Key': key } }),
  approve: (id: number) =>
    post<{ payment: Payment; membership: Membership | null; already_processed: boolean }>(`/payments/${id}/approve`),
  reject: (id: number, reason: string, status: 'REJECTED' | 'FAILED' = 'REJECTED') =>
    post<{ payment: Payment; already_processed: boolean }>(`/payments/${id}/reject`, { reason, status }),
  refund: (id: number, body: RefundInput) => post<{ payment: Payment }>(`/payments/${id}/refund`, body),
  receipt: (id: number) => get<Receipt>(`/payments/${id}/receipt`),
}

export const trainersApi = {
  list: (status?: string) => get<{ items: Trainer[] }>('/trainers', { status }),
  get: (id: number) => get<Trainer>(`/trainers/${id}`),
  create: (body: Record<string, unknown>) => post<Trainer>('/trainers', body),
  update: (id: number, body: Record<string, unknown>) => put<Trainer>(`/trainers/${id}`, body),
  setStatus: (id: number, status: 'ACTIVE' | 'INACTIVE') => post<Trainer>(`/trainers/${id}/status`, { status }),
  members: (id: number, params: Query) => get<Paginated<MemberListItem>>(`/trainers/${id}/members`, params),
  assignMembers: (id: number, member_ids: number[]) => post<{ assigned: number }>(`/trainers/${id}/members`, { member_ids }),
  account: (id: number) => post<Credentials>(`/trainers/${id}/account`),
}

export const attendanceApi = {
  scan: (code: string) => post<ScanResult>('/attendance/scan', { code }),
  mark: (member_id: number) => post<ScanResult>('/attendance', { member_id }),
  log: (params: Query) => get<AttendanceLog>('/attendance', params),
  trend: (days = 30) => get<{ items: { date: string; visits: number }[] }>('/attendance/trend', { days }),
  remove: (id: number) => del(`/attendance/${id}`),
}

export const workoutsApi = {
  recent: (params: Query) => get<Paginated<WorkoutListItem>>('/workouts', params),
  get: (id: number) => get<Workout>(`/workouts/${id}`),
  create: (body: { member_id: number; title: string; day_label?: string | null; notes?: string | null; exercises: ExerciseInput[] }) =>
    post<Workout>('/workouts', body),
  update: (id: number, body: { title: string; day_label?: string | null; notes?: string | null; status: string; exercises: ExerciseInput[] }) =>
    put<Workout>(`/workouts/${id}`, body),
  copy: (id: number, member_id: number) => post<Workout>(`/workouts/${id}/copy`, { member_id }),
  remove: (id: number) => del(`/workouts/${id}`),
}

export const progressApi = {
  recent: (params: Query) => get<Paginated<Measurement>>('/progress', params),
  forMember: (memberId: number) => get<Progress>(`/progress/${memberId}`),
  record: (memberId: number, body: MeasurementInput) => post<Measurement>(`/progress/${memberId}`, body),
  remove: (measurementId: number) => del(`/progress/entries/${measurementId}`),
}

export const expensesApi = {
  list: (params: Query) => get<ExpenseList>('/expenses', params),
  create: (body: ExpenseInput) => post<Expense>('/expenses', body),
  update: (id: number, body: ExpenseInput) => put<Expense>(`/expenses/${id}`, body),
  remove: (id: number) => del(`/expenses/${id}`),
}

export const dashboardApi = {
  summary: () => get<DashboardSummary>('/dashboard/summary'),
  charts: (months = 6) => get<DashboardCharts>('/dashboard/charts', { months }),
  activity: () => get<{ items: ActivityEvent[] }>('/dashboard/activity'),
  trainer: () => get<TrainerOverview>('/dashboard/trainer'),
}

export const reportsApi = {
  /** Report data as JSON — the browser renders the CSV / PDF (nothing is stored). */
  get: (kind: ReportKind, from?: string, to?: string) => get<ReportData>(`/reports/${kind}`, { from, to }, { timeout: 60_000 }),
}

export const notificationsApi = {
  inbox: () => get<{ items: NotificationItem[]; unread: number }>('/notifications/inbox'),
  unread: () => get<{ unread: number }>('/notifications/unread'),
  readAll: () => post<void>('/notifications/read-all'),
  read: (id: number) => post<void>(`/notifications/${id}/read`),
  log: (params: Query) => get<Paginated<NotificationItem>>('/notifications', params),
  send: (body: { message: string; member_ids?: number[]; segment?: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'ALL' }) =>
    post<AnnounceResult>('/notifications/send', body),
  runReminders: () => post<Record<string, number> & { created: number }>('/notifications/run-reminders'),
}

export const portalApi = {
  overview: () => get<PortalOverview>('/me/overview'),
  profile: () => get<MemberProfile>('/me/profile'),
  updateProfile: (body: { email?: string | null; address?: string | null; emergency_contact?: string | null }) =>
    put<MemberProfile>('/me/profile', body),
  membership: () => get<{ membership: MemberWorkspace['membership']; history: Membership[] }>('/me/membership'),
  plans: () => get<{ items: Plan[] }>('/me/plans'),
  upi: (plan_id: number) => get<UpiDetails>('/me/upi', { plan_id }),
  /** The member paid the gym's UPI ID directly and submits the 12-digit UTR for verification. */
  submitRenewal: (plan_id: number, utr: string) => post<{ payment: Payment }>('/me/renewals', { plan_id, utr }),
  pending: () => get<{ payment: Payment | null }>('/me/renewals/pending'),
  withdraw: () => del('/me/renewals/pending'),
  payments: (params: Query) => get<PaymentList>('/me/payments', params),
  receipt: (id: number) => get<Receipt>(`/me/payments/${id}/receipt`),
  attendance: (month?: string) => get<AttendanceHistory>('/me/attendance', { month }),
  workouts: () => get<{ items: Workout[] }>('/me/workouts'),
  progress: () => get<Progress>('/me/progress'),
  qr: () => get<{ member_id: number; member_code: string; name: string; payload: string }>('/me/qr'),
}

export const backupsApi = {
  list: () => get<{ options: BackupOptions; items: BackupRecord[] }>('/backups'),
  create: (body: { datasets: string[]; period_from: string; period_to: string }) => post<BackupManifest>('/backups', body),
  get: (id: number) => get<BackupManifest>(`/backups/${id}`),
  /** One page of rows in id order; request again with after = last id until a short page. */
  exportPage: (id: number, table: string, after: number) =>
    get<Record<string, unknown>[]>(`/backups/${id}/data`, { table, after }, { timeout: 60_000 }),
  verify: (id: number, body: { file_name: string; checksum: string; counts: Record<string, number> }) =>
    post<BackupManifest>(`/backups/${id}/verify`, body),
  archive: (id: number) => post<ArchiveProgress>(`/backups/${id}/archive`, { backup_verified: true, confirm: true }, { timeout: 60_000 }),
  cancel: (id: number) => post<BackupManifest>(`/backups/${id}/cancel`),
  restoreCheck: (table: string, ids: number[]) => post<RestoreCheckResult>('/backups/restore/check', { table, ids }),
  restoreApply: (table: string, rows: Record<string, unknown>[]) =>
    post<RestoreApplyResult>('/backups/restore/apply', { table, rows }, { timeout: 60_000 }),
  restoreComplete: (body: { file_name: string; backup_created_at: string | null; inserted: number; skipped: number; datasets: string[] }) =>
    post<BackupRecord>('/backups/restore/complete', body),
}

export const storageApi = {
  overview: () => get<StorageOverview>('/storage'),
  refresh: () => post<StorageOverview>('/storage/refresh'),
  timeTravel: () => get<TimeTravelInfo>('/storage/time-travel'),
  timeTravelRestore: (timestamp: string) =>
    post<TimeTravelResult>('/storage/time-travel/restore', { timestamp, confirm_text: 'RESTORE' }, { timeout: 60_000 }),
}
