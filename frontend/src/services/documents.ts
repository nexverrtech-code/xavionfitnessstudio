// Receipts and reports are generated on demand in the browser from JSON the API returns.
// Nothing is stored on the server (no PDFs, no files) — the admin downloads and keeps them.
import type { PaymentMethod, Receipt, ReportData, ReportKind } from '@/types'
import { csvBlob, toCsv, type Cell } from '@/utils/csv'
import { saveBlob } from '@/utils/download'
import {
  CATEGORY_LABELS,
  METHOD_LABELS,
  formatDate,
  formatDateTime,
  formatDateTimeCsv,
  formatDateTimeShort,
  formatMoney,
  formatNumber,
  formatTime,
  paiseToDecimal,
} from '@/utils/format'
import { hexColor, PdfDocument, wrapText, type Color } from '@/utils/pdf'

// Print palette (documents are always printed light, whatever the app theme).
const INK = hexColor('#16181d')
const MUTED = hexColor('#5b606b')
const FAINT = hexColor('#8f95a1')
const LINE = hexColor('#e3e5e9')
const ZEBRA = hexColor('#f6f7f9')
const HEAD = hexColor('#eceef1')
const BAND = hexColor('#16181d')
const LIME = hexColor('#c6f432')
const WHITE: Color = [1, 1, 1]

type Format = 'money' | 'date' | 'datetime' | 'time' | 'method' | 'category' | 'text' | 'number'

export interface ReportColumn {
  key: string
  label: string
  format?: Format
  /** Relative width in the PDF table. */
  weight: number
}

export const REPORT_COLUMNS: Record<ReportKind, ReportColumn[]> = {
  members: [
    { key: 'member_code', label: 'Member ID', weight: 1.1 },
    { key: 'name', label: 'Name', weight: 1.8 },
    { key: 'phone', label: 'Phone', weight: 1.2 },
    { key: 'email', label: 'Email', weight: 2 },
    { key: 'gender', label: 'Gender', weight: 0.8 },
    { key: 'joining_date', label: 'Joined', format: 'date', weight: 1 },
    { key: 'status', label: 'Status', weight: 0.9 },
    { key: 'trainer', label: 'Trainer', weight: 1.4 },
    { key: 'expiry_date', label: 'Membership ends', format: 'date', weight: 1.2 },
  ],
  memberships: [
    { key: 'member_code', label: 'Member ID', weight: 1.1 },
    { key: 'name', label: 'Name', weight: 1.9 },
    { key: 'plan', label: 'Plan', weight: 1.2 },
    { key: 'start_date', label: 'Start', format: 'date', weight: 1 },
    { key: 'end_date', label: 'End', format: 'date', weight: 1 },
    { key: 'amount', label: 'Amount', format: 'money', weight: 1 },
    { key: 'status', label: 'Status', weight: 1 },
  ],
  payments: [
    { key: 'payment_number', label: 'Payment No.', weight: 1.35 },
    { key: 'payment_date', label: 'Date', format: 'date', weight: 1.05 },
    { key: 'member_code', label: 'Member ID', weight: 1.1 },
    { key: 'name', label: 'Name', weight: 1.3 },
    { key: 'plan', label: 'Plan', weight: 0.9 },
    { key: 'payment_method', label: 'Method', format: 'method', weight: 1.15 },
    { key: 'transaction_reference', label: 'UTR / Ref.', weight: 1.2 },
    { key: 'amount', label: 'Amount', format: 'money', weight: 0.95 },
    { key: 'status', label: 'Status', weight: 1.05 },
    { key: 'refund_amount', label: 'Refunded', format: 'money', weight: 0.9 },
    { key: 'verified_by', label: 'Verified by', weight: 1 },
    { key: 'verified_at', label: 'Verified at', format: 'datetime', weight: 1.6 },
  ],
  attendance: [
    { key: 'attendance_date', label: 'Date', format: 'date', weight: 1 },
    { key: 'member_code', label: 'Member ID', weight: 1 },
    { key: 'name', label: 'Name', weight: 2 },
    { key: 'check_in', label: 'Check-in', format: 'time', weight: 0.9 },
    { key: 'check_out', label: 'Check-out', format: 'time', weight: 0.9 },
    { key: 'method', label: 'Method', weight: 0.8 },
  ],
  expenses: [
    { key: 'expense_date', label: 'Date', format: 'date', weight: 1 },
    { key: 'category', label: 'Category', format: 'category', weight: 1.1 },
    { key: 'description', label: 'Description', weight: 3 },
    { key: 'amount', label: 'Amount', format: 'money', weight: 1 },
    { key: 'recorded_by', label: 'Recorded by', weight: 1.2 },
  ],
}

function csvCell(value: unknown, format: Format = 'text'): Cell {
  if (value === null || value === undefined || value === '') return ''
  switch (format) {
    case 'money':
      return paiseToDecimal(Number(value))
    case 'datetime':
      return formatDateTimeCsv(String(value))
    case 'time':
      return formatDateTimeCsv(String(value)).slice(11)
    case 'method':
      return METHOD_LABELS[String(value)] ?? String(value)
    case 'category':
      return CATEGORY_LABELS[String(value)] ?? String(value)
    default:
      return value as Cell
  }
}

export function displayCell(value: unknown, format: Format = 'text'): string {
  if (value === null || value === undefined || value === '') return '-'
  switch (format) {
    case 'money':
      return formatMoney(Number(value))
    case 'date':
      return formatDate(String(value))
    case 'datetime':
      return formatDateTimeShort(String(value))
    case 'time':
      return formatTime(String(value))
    case 'method':
      return METHOD_LABELS[String(value)] ?? String(value)
    case 'category':
      return CATEGORY_LABELS[String(value)] ?? String(value)
    case 'number':
      return formatNumber(Number(value))
    default:
      return String(value)
  }
}

function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** e.g. Xavion_Fitness_Studio_Payment_Report_2026-09-01_to_2026-09-24.csv */
export function reportFileName(report: ReportData, extension: 'csv' | 'pdf'): string {
  return `${slug(report.gym_name) || 'Gym'}_${slug(report.title)}_${report.from}_to_${report.to}.${extension}`
}

// -- summaries ------------------------------------------------------------------------------------
export interface SummaryItem {
  label: string
  value: string
}

type Rows<T> = T[] | undefined

/** The headline numbers of a report, shown on screen and at the top of the PDF. */
export function reportSummary(report: ReportData): { stats: SummaryItem[]; breakdown: SummaryItem[] } {
  const s = report.summary as Record<string, unknown>
  const n = (key: string) => formatNumber(Number(s[key] ?? 0))
  const m = (key: string) => formatMoney(Number(s[key] ?? 0))
  switch (report.kind) {
    case 'members':
      return {
        stats: [
          { label: 'Total members', value: n('total') },
          { label: 'Active', value: n('active') },
          { label: 'Expired', value: n('expired') },
          { label: 'Inactive', value: n('inactive') },
          { label: 'Suspended', value: n('suspended') },
          { label: 'Joined in period', value: n('new_members') },
        ],
        breakdown: [],
      }
    case 'memberships': {
      const plans = (s.plans as Rows<{ plan: string; active: number; expired: number; renewals: number; started: number; amount: number }>) ?? []
      return {
        stats: [
          { label: 'Started in period', value: formatNumber(plans.reduce((t, p) => t + p.started, 0)) },
          { label: 'Renewals', value: formatNumber(plans.reduce((t, p) => t + p.renewals, 0)) },
          { label: 'Active now', value: formatNumber(plans.reduce((t, p) => t + p.active, 0)) },
          { label: 'Value started', value: formatMoney(plans.reduce((t, p) => t + p.amount, 0)) },
        ],
        breakdown: plans.map((p) => ({
          label: p.plan,
          value: `${formatNumber(p.started)} started · ${formatNumber(p.renewals)} renewals · ${formatNumber(p.active)} active · ${formatMoney(p.amount)}`,
        })),
      }
    }
    case 'payments': {
      const methods = (s.methods as Rows<{ method: PaymentMethod; count: number; amount: number }>) ?? []
      const statuses = (s.statuses as Rows<{ status: string; count: number; amount: number }>) ?? []
      return {
        stats: [
          { label: 'Collected', value: m('collected') },
          { label: 'Refunded', value: `${m('refunds')} (${n('refund_count')})` },
          { label: 'Net revenue', value: m('total_revenue') },
          { label: 'Payments', value: formatNumber(statuses.reduce((t, x) => t + x.count, 0)) },
        ],
        breakdown: [
          ...methods.map((x) => ({ label: METHOD_LABELS[x.method] ?? x.method, value: `${formatNumber(x.count)} · ${formatMoney(x.amount)}` })),
          ...statuses.map((x) => ({ label: `Status ${x.status}`, value: `${formatNumber(x.count)} · ${formatMoney(x.amount)}` })),
        ],
      }
    }
    case 'attendance': {
      const daily = (s.daily as Rows<{ date: string; visits: number }>) ?? []
      const busiest = daily.reduce<{ date: string; visits: number } | null>((best, d) => (!best || d.visits > best.visits ? d : best), null)
      return {
        stats: [
          { label: 'Total visits', value: n('total_visits') },
          { label: 'Days open', value: formatNumber(daily.length) },
          { label: 'Average per day', value: daily.length ? formatNumber(Math.round(Number(s.total_visits ?? 0) / daily.length)) : '0' },
          { label: 'Busiest day', value: busiest ? `${formatDate(busiest.date, { withYear: false })} (${formatNumber(busiest.visits)})` : '-' },
        ],
        breakdown: ((s.monthly as Rows<{ month: string; visits: number; days: number }>) ?? []).map((x) => ({
          label: x.month,
          value: `${formatNumber(x.visits)} visits over ${formatNumber(x.days)} days`,
        })),
      }
    }
    case 'expenses': {
      const categories = (s.categories as Rows<{ category: string; count: number; amount: number }>) ?? []
      return {
        stats: [
          { label: 'Total expenses', value: m('total') },
          { label: 'Entries', value: formatNumber(categories.reduce((t, c) => t + c.count, 0)) },
        ],
        breakdown: categories.map((c) => ({
          label: CATEGORY_LABELS[c.category] ?? c.category,
          value: `${formatNumber(c.count)} · ${formatMoney(c.amount)}`,
        })),
      }
    }
  }
}

// -- CSV ---------------------------------------------------------------------------------------------
export function reportCsv(report: ReportData): Blob {
  const columns = REPORT_COLUMNS[report.kind]
  const rows = report.rows.map((row) => columns.map((c) => csvCell(row[c.key], c.format)))
  return csvBlob(toCsv(columns.map((c) => c.label), rows, { neutralize: true }))
}

// -- PDF ---------------------------------------------------------------------------------------------
const MARGIN = 36

function footer(pdf: PdfDocument, left: string): void {
  const total = pdf.pageCount
  for (let index = 0; index < total; index++) {
    pdf.onPage(index, () => {
      const y = pdf.height - 26
      pdf.line(MARGIN, y - 6, pdf.width - MARGIN, y - 6, { color: LINE })
      pdf.text(MARGIN, y, left, { size: 7.5, color: FAINT, maxWidth: pdf.width / 2 })
      pdf.text(pdf.width - MARGIN, y, `Page ${index + 1} of ${total}`, { size: 7.5, color: FAINT, align: 'right' })
    })
  }
}

export async function reportPdf(report: ReportData): Promise<Blob> {
  const columns = REPORT_COLUMNS[report.kind]
  const landscape = columns.length > 6
  const pdf = new PdfDocument({ landscape, title: `${report.gym_name} - ${report.title}`, author: report.gym_name })
  const width = pdf.width - MARGIN * 2
  const bottom = pdf.height - 48

  // Header band
  pdf.rect(0, 0, pdf.width, 70, { fill: BAND })
  pdf.rect(0, 70, pdf.width, 3, { fill: LIME })
  pdf.text(MARGIN, 18, report.gym_name, { size: 15, bold: true, color: WHITE, maxWidth: width * 0.6 })
  pdf.text(MARGIN, 40, report.title.toUpperCase(), { size: 10, bold: true, color: LIME })
  pdf.text(pdf.width - MARGIN, 20, `${formatDate(report.from)} - ${formatDate(report.to)}`, { size: 10, bold: true, color: WHITE, align: 'right' })
  pdf.text(pdf.width - MARGIN, 38, `Generated ${formatDateTime(report.generated_at)}`, { size: 8, color: [0.8, 0.82, 0.86], align: 'right' })

  // Summary tiles
  let y = 92
  const { stats, breakdown } = reportSummary(report)
  const gap = 8
  const tileWidth = (width - gap * (stats.length - 1)) / stats.length
  stats.forEach((item, i) => {
    const x = MARGIN + i * (tileWidth + gap)
    pdf.rect(x, y, tileWidth, 42, { fill: ZEBRA, stroke: LINE, radius: 6 })
    pdf.text(x + 10, y + 8, item.label.toUpperCase(), { size: 6.5, bold: true, color: MUTED, maxWidth: tileWidth - 20 })
    pdf.text(x + 10, y + 21, item.value, { size: 12, bold: true, color: INK, maxWidth: tileWidth - 20 })
  })
  y += 54
  if (breakdown.length) {
    const perRow = landscape ? 3 : 2
    const cell = width / perRow
    breakdown.forEach((item, i) => {
      const x = MARGIN + (i % perRow) * cell
      if (i % perRow === 0 && i > 0) y += 14
      pdf.text(x, y, `${item.label}:`, { size: 8, bold: true, color: INK, maxWidth: cell * 0.35 })
      pdf.text(x + cell * 0.36, y, item.value, { size: 8, color: MUTED, maxWidth: cell * 0.62 })
    })
    y += 24
  }
  if (report.truncated) {
    pdf.text(MARGIN, y, `Showing the first ${formatNumber(report.row_cap)} rows. Choose a shorter period for the complete list.`, {
      size: 8,
      bold: true,
      color: hexColor('#9a3412'),
    })
    y += 16
  }

  // Table
  const totalWeight = columns.reduce((t, c) => t + c.weight, 0)
  const widths = columns.map((c) => (c.weight / totalWeight) * width)
  const rightAligned = (c: ReportColumn) => c.format === 'money' || c.format === 'number'
  const rowHeight = 16
  const drawHeader = () => {
    pdf.rect(MARGIN, y, width, 20, { fill: HEAD })
    let x = MARGIN
    columns.forEach((c, i) => {
      const w = widths[i]
      pdf.text(rightAligned(c) ? x + w - 5 : x + 5, y + 6, c.label, { size: 7.5, bold: true, color: MUTED, maxWidth: w - 10, align: rightAligned(c) ? 'right' : 'left' })
      x += w
    })
    y += 20
  }
  drawHeader()
  if (!report.rows.length) {
    pdf.text(MARGIN + width / 2, y + 18, 'No records in this period.', { size: 10, color: MUTED, align: 'center' })
  }
  report.rows.forEach((row, index) => {
    if (y + rowHeight > bottom) {
      pdf.addPage()
      y = MARGIN
      drawHeader()
    }
    if (index % 2 === 1) pdf.rect(MARGIN, y, width, rowHeight, { fill: ZEBRA })
    let x = MARGIN
    columns.forEach((c, i) => {
      const w = widths[i]
      pdf.text(rightAligned(c) ? x + w - 5 : x + 5, y + 4.5, displayCell(row[c.key], c.format), {
        size: 8,
        color: INK,
        maxWidth: w - 10,
        align: rightAligned(c) ? 'right' : 'left',
      })
      x += w
    })
    y += rowHeight
  })
  pdf.line(MARGIN, y, MARGIN + width, y, { color: LINE })
  footer(pdf, `${report.gym_name} · ${report.title} · ${formatNumber(report.rows.length)} rows`)
  return pdf.output()
}

export async function downloadReport(report: ReportData, format: 'csv' | 'pdf'): Promise<void> {
  const blob = format === 'csv' ? reportCsv(report) : await reportPdf(report)
  saveBlob(blob, reportFileName(report, format))
}

// -- receipt -------------------------------------------------------------------------------------------
export async function receiptPdf(receipt: Receipt): Promise<Blob> {
  const pdf = new PdfDocument({ title: `${receipt.gym.name} - Receipt ${receipt.receipt_number}`, author: receipt.gym.name })
  const width = pdf.width - MARGIN * 2
  const right = pdf.width - MARGIN

  pdf.rect(0, 0, pdf.width, 96, { fill: BAND })
  pdf.rect(0, 96, pdf.width, 3, { fill: LIME })
  pdf.text(MARGIN, 22, receipt.gym.name, { size: 18, bold: true, color: WHITE, maxWidth: width * 0.62 })
  const contact = [receipt.gym.phone, receipt.gym.email].filter(Boolean).join('  ·  ')
  pdf.text(MARGIN, 48, receipt.gym.address || '', { size: 8.5, color: [0.8, 0.82, 0.86], maxWidth: width * 0.62 })
  pdf.text(MARGIN, 62, contact, { size: 8.5, color: [0.8, 0.82, 0.86], maxWidth: width * 0.62 })
  pdf.text(right, 24, 'PAYMENT RECEIPT', { size: 11, bold: true, color: LIME, align: 'right' })
  pdf.text(right, 44, receipt.receipt_number, { size: 13, bold: true, color: WHITE, align: 'right' })
  pdf.text(right, 64, `Payment ${receipt.payment_number}`, { size: 8.5, color: [0.8, 0.82, 0.86], align: 'right' })

  let y = 124
  const status = receipt.status === 'REFUNDED' ? 'REFUNDED' : receipt.status === 'PAID' ? 'PAID' : receipt.status
  pdf.rect(MARGIN, y, 74, 20, { stroke: INK, lineWidth: 1, radius: 10 })
  pdf.text(MARGIN + 37, y + 5.5, status, { size: 8.5, bold: true, color: INK, align: 'center' })
  pdf.text(right, y + 5, `Paid on ${formatDate(receipt.payment_date)}`, { size: 9.5, color: MUTED, align: 'right' })
  y += 40

  const column = width / 2
  const block = (x: number, top: number, title: string, rows: [string, string][]) => {
    pdf.text(x, top, title.toUpperCase(), { size: 7.5, bold: true, color: FAINT })
    let at = top + 16
    for (const [label, value] of rows) {
      pdf.text(x, at, label, { size: 8, color: MUTED })
      pdf.text(x, at + 11, value || '-', { size: 10.5, bold: true, color: INK, maxWidth: column - 20 })
      at += 32
    }
    return at
  }
  const leftEnd = block(MARGIN, y, 'Member', [
    ['Name', receipt.member_name],
    ['Member ID', receipt.member_code],
  ])
  const rightEnd = block(MARGIN + column, y, 'Membership', [
    ['Plan', receipt.plan_name],
    [
      'Period',
      receipt.membership_start && receipt.membership_end
        ? `${formatDate(receipt.membership_start)} - ${formatDate(receipt.membership_end)}`
        : '-',
    ],
  ])
  y = Math.max(leftEnd, rightEnd) + 4
  pdf.line(MARGIN, y, right, y, { color: LINE })
  y += 16
  const payEnd = block(MARGIN, y, 'Payment', [
    ['Method', METHOD_LABELS[receipt.payment_method] ?? receipt.payment_method],
    ['Reference / UTR', receipt.transaction_reference ?? '-'],
  ])
  block(MARGIN + column, y, 'Verification', [['Verified on', receipt.verified_at ? formatDateTime(receipt.verified_at) : '-']])
  y = payEnd + 6

  pdf.rect(MARGIN, y, width, 64, { fill: ZEBRA, stroke: LINE, radius: 10 })
  pdf.text(MARGIN + 18, y + 16, 'AMOUNT PAID', { size: 8, bold: true, color: MUTED })
  pdf.text(MARGIN + 18, y + 30, formatMoney(receipt.amount), { size: 22, bold: true, color: INK })
  y += 84

  if (receipt.refund) {
    const r = receipt.refund
    pdf.rect(MARGIN, y, width, 86, { stroke: INK, lineWidth: 0.8, radius: 10 })
    pdf.text(MARGIN + 18, y + 14, 'REFUND RECORDED', { size: 8, bold: true, color: INK })
    pdf.text(MARGIN + 18, y + 30, `${formatMoney(r.amount)} by ${METHOD_LABELS[r.method] ?? r.method} on ${formatDate(r.date)}`, { size: 10.5, bold: true, color: INK })
    pdf.text(MARGIN + 18, y + 47, `Reference: ${r.reference ?? '-'}`, { size: 8.5, color: MUTED })
    wrapText(`Reason: ${r.reason}`, 8.5, width - 36).slice(0, 2).forEach((line, i) => {
      pdf.text(MARGIN + 18, y + 60 + i * 11, line, { size: 8.5, color: MUTED })
    })
    y += 104
  }

  pdf.text(MARGIN, y + 6, 'This is a computer-generated receipt and does not need a signature.', { size: 8, color: FAINT })
  footer(pdf, `${receipt.gym.name} · Receipt ${receipt.receipt_number}`)
  return pdf.output()
}

export async function downloadReceipt(receipt: Receipt): Promise<void> {
  saveBlob(await receiptPdf(receipt), `${slug(receipt.gym.name) || 'Gym'}_Receipt_${receipt.receipt_number}.pdf`)
}
