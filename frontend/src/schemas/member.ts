import { z } from 'zod'

const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label} must be at most ${max} characters`)

export const phoneField = z
  .string()
  .trim()
  .min(1, 'Enter a phone number')
  .refine((value) => {
    let digits = value.replace(/\D/g, '')
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
    return digits.length >= 7 && digits.length <= 15 && (digits.length !== 10 || /^[6-9]/.test(digits))
  }, { error: 'Enter a valid 10-digit mobile number' })

export const optionalEmail = z
  .string()
  .trim()
  .refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(value), { error: 'Enter a valid email address' })

export const memberSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name must be at most 80 characters'),
  phone: phoneField,
  email: optionalEmail,
  gender: z.enum(['', 'MALE', 'FEMALE', 'OTHER']),
  date_of_birth: z.string(),
  address: optionalText(250, 'Address'),
  emergency_contact: optionalText(80, 'Emergency contact'),
  trainer_id: z.string(),
  joining_date: z.string(),
  create_app_login: z.boolean(),
})
export type MemberValues = z.infer<typeof memberSchema>

export const emptyMember: MemberValues = {
  name: '',
  phone: '',
  email: '',
  gender: '',
  date_of_birth: '',
  address: '',
  emergency_contact: '',
  trainer_id: '',
  joining_date: '',
  create_app_login: true,
}

export function memberPayload(values: MemberValues) {
  const blank = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    name: values.name.trim(),
    phone: values.phone.trim(),
    email: blank(values.email),
    gender: blank(values.gender),
    date_of_birth: blank(values.date_of_birth),
    address: blank(values.address),
    emergency_contact: blank(values.emergency_contact),
    trainer_id: values.trainer_id ? Number(values.trainer_id) : null,
    joining_date: blank(values.joining_date),
    create_app_login: values.create_app_login,
  }
}

export const trainerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: phoneField,
  email: optionalEmail,
  specialization: optionalText(80, 'Specialization'),
  joining_date: z.string(),
})
export type TrainerValues = z.infer<typeof trainerSchema>

export const profileSchema = z.object({
  email: optionalEmail,
  address: optionalText(250, 'Address'),
  emergency_contact: optionalText(80, 'Emergency contact'),
})
export type ProfileValues = z.infer<typeof profileSchema>
