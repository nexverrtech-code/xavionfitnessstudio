// Formatting in the gym's locale/timezone. Amounts from the API are integer paise.

let timeZone = 'Asia/Kolkata'
let currency = 'INR'
const LOCALE = 'en-IN'

export function configureFormatting(options: { timezone?: string; currency?: string }): void {
  if (options.timezone) timeZone = options.timezone
  if (options.currency) currency = options.currency
  moneyFormatters.clear()
}

const moneyFormatters = new Map<string, Intl.NumberFormat>()

function moneyFormatter(fraction: boolean, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${fraction}|${compact}`
  let formatter = moneyFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction ? 2 : 0,
      maximumFractionDigits: compact ? 1 : fraction ? 2 : 0,
      notation: compact ? 'compact' : 'standard',
    })
    moneyFormatters.set(key, formatter)
  }
  return formatter
}

/** 250000 paise -> "₹2,500"; keeps paise only when present. */
export function formatMoney(paise: number | null | undefined, options: { compact?: boolean } = {}): string {
  const value = (paise ?? 0) / 100
  const compact = !!options.compact && Math.abs(value) >= 100000
  return moneyFormatter(!compact && value % 1 !== 0, compact).format(value)
}

/** Bytes in decimal units (1 MB = 1,000,000 bytes), matching Cloudflare's D1 limits. */
export function formatBytes(bytes: number | null | undefined): string {
  const value = Math.max(0, bytes ?? 0)
  if (value < 1000) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let scaled = value / 1000
  let unit = 0
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000
    unit += 1
  }
  // One decimal, trimmed: "499.5 MB" remaining must never round up to the "500 MB" limit.
  return `${String(Math.floor(scaled * 10) / 10)} ${units[unit]}`
}

export function rupeesToPaise(value: string | number): number {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0
}

export function paiseToRupees(paise: number): string {
  const value = paise / 100
  return value % 1 === 0 ? String(value) : value.toFixed(2)
}

export const numberFormat = new Intl.NumberFormat(LOCALE)

export function formatNumber(value: number | null | undefined): string {
  return numberFormat.format(value ?? 0)
}

/** A calendar date ('2026-12-22') — no timezone shifting. */
export function formatDate(value: string | null | undefined, options: { withYear?: boolean; weekday?: boolean } = {}): string {
  if (!value) return '—'
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: options.withYear === false ? undefined : 'numeric',
    weekday: options.weekday ? 'short' : undefined,
    timeZone: 'UTC',
  }).format(date)
}

/** A UTC timestamp shown in the gym's timezone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso))
}

/** Compact timestamp for tables and PDFs: "24 Sept 26, 15:47" in the gym's timezone. */
export function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso))
}

/** 'YYYY-MM-DD HH:mm' in the gym's timezone — for CSV files (sortable, spreadsheet-friendly). */
export function formatDateTimeCsv(iso: string | null | undefined): string {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** Paise as a plain decimal rupee amount for CSV ("4000.00"). */
export function paiseToDecimal(paise: number | null | undefined): string {
  return paise === null || paise === undefined ? '' : (paise / 100).toFixed(2)
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso))
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return formatDateTime(iso).split(',')[0]
}

/** Today's date in the gym's timezone, 'YYYY-MM-DD'. */
export function todayISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return parts // en-CA formats as YYYY-MM-DD
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function daysLeftLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'No membership'
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  if (days === 0) return 'Expires today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

export function planDurationLabel(days: number): string {
  if (days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`
  if (days % 30 === 0) return days === 30 ? '1 month' : `${days / 30} months`
  if (days % 7 === 0) return days === 7 ? '1 week' : `${days / 7} weeks`
  return `${days} days`
}

/** Monthly equivalent of a plan price in whole rupees (a year counts as 12 months), or
 *  null for plans shorter than two months, where the figure would only repeat the price. */
export function perMonthPaise(price: number, days: number): number | null {
  if (days < 60) return null
  const months = days % 365 === 0 ? (days / 365) * 12 : days / 30
  return Math.round(price / months / 100) * 100
}

export const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CARD_MANUAL: 'Card (manual)',
}

export const CATEGORY_LABELS: Record<string, string> = {
  RENT: 'Rent',
  ELECTRICITY: 'Electricity',
  SALARY: 'Salary',
  EQUIPMENT: 'Equipment',
  MAINTENANCE: 'Maintenance',
  MARKETING: 'Marketing',
  OTHER: 'Other',
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone }).format(new Date()))
  if (hour < 12) return 'Good Morning'
  if (hour < 17) return 'Good Afternoon'
  return 'Good Evening'
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there'
}
