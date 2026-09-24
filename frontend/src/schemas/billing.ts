import { z } from 'zod'

const REFERENCE = /^[A-Za-z0-9\-/]{4,64}$/

export const moneyField = (label = 'Amount', allowZero = false) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label.toLowerCase()}`)
    .refine((value) => /^\d{1,7}(\.\d{1,2})?$/.test(value.replace(/,/g, '')), { error: 'Enter a valid amount, e.g. 2500' })
    .refine((value) => allowZero || Number(value.replace(/,/g, '')) >= 1, { error: `${label} must be at least ₹1` })

export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD_MANUAL'] as const

/** Reference rules match the API: UPI needs the 12-digit UTR, bank transfers a reference. */
function checkReference(method: string, value: string, ctx: z.RefinementCtx, path: string): void {
  const ref = value.replace(/\s/g, '')
  if (method === 'UPI') {
    if (!/^\d{12}$/.test(ref)) ctx.addIssue({ code: 'custom', path: [path], message: 'Enter the 12-digit UTR / UPI reference number' })
  } else if (method === 'BANK_TRANSFER') {
    if (!REFERENCE.test(ref)) ctx.addIssue({ code: 'custom', path: [path], message: 'Enter the bank reference (4–64 letters, digits, - or /)' })
  } else if (ref && !REFERENCE.test(ref)) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'Use 4–64 letters, digits, - or /' })
  }
}

export const collectSchema = z
  .object({
    plan_id: z.string().min(1, 'Choose a plan'),
    amount: moneyField('Amount'),
    payment_method: z.enum(PAYMENT_METHODS),
    transaction_reference: z.string().trim().max(64),
    payment_date: z.string(),
    start_date: z.string(),
    notes: z.string().trim().max(200, 'Keep notes under 200 characters'),
  })
  .superRefine((values, ctx) => checkReference(values.payment_method, values.transaction_reference, ctx, 'transaction_reference'))
export type CollectValues = z.infer<typeof collectSchema>

export const refundSchema = z
  .object({
    amount: moneyField('Refund amount'),
    refund_method: z.enum(PAYMENT_METHODS),
    refund_reference: z.string().trim().max(64),
    refund_reason: z.string().trim().min(3, 'Give the reason (at least 3 characters)').max(200, 'Keep it under 200 characters'),
    refund_date: z.string(),
    cancel_membership: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const ref = values.refund_reference.replace(/\s/g, '')
    if (ref && !REFERENCE.test(ref)) ctx.addIssue({ code: 'custom', path: ['refund_reference'], message: 'Use 4–64 letters, digits, - or /' })
  })
export type RefundValues = z.infer<typeof refundSchema>

export const utrSchema = z.object({
  utr: z
    .string()
    .trim()
    .refine((value) => /^\d{12}$/.test(value.replace(/\s/g, '')), { error: 'The UTR / UPI reference number has 12 digits' }),
})
export type UtrValues = z.infer<typeof utrSchema>

export const rejectSchema = z.object({
  reason: z.string().trim().min(3, 'Tell the member why (at least 3 characters)').max(160),
  status: z.enum(['REJECTED', 'FAILED']),
})
export type RejectValues = z.infer<typeof rejectSchema>

export const planSchema = z.object({
  name: z.string().trim().min(2, 'Plan name must be at least 2 characters').max(60),
  duration_days: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1830, { error: 'Enter 1–1830 days' }),
  price: moneyField('Price'),
  description: z.string().trim().max(200, 'Description must be at most 200 characters'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
})
export type PlanValues = z.infer<typeof planSchema>

export const expenseSchema = z.object({
  category: z.enum(['RENT', 'ELECTRICITY', 'SALARY', 'EQUIPMENT', 'MAINTENANCE', 'MARKETING', 'OTHER']),
  amount: moneyField('Amount'),
  description: z.string().trim().max(200, 'Description must be at most 200 characters'),
  expense_date: z.string(),
})
export type ExpenseValues = z.infer<typeof expenseSchema>
