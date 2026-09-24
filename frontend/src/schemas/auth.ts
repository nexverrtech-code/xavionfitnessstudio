import { z } from 'zod'

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email, member ID or phone number'),
  password: z.string().min(1, 'Enter your password'),
  remember: z.boolean(),
})
export type LoginValues = z.infer<typeof loginSchema>

const strongPassword = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => /[A-Za-z]/.test(value) && /[^A-Za-z]/.test(value), { error: 'Mix letters with numbers or symbols' })

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password'),
    new_password: strongPassword,
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, { error: "Passwords don't match", path: ['confirm_password'] })
  .refine((v) => v.new_password !== v.current_password, { error: 'Choose a password different from the current one', path: ['new_password'] })
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>

export const setupSchema = z
  .object({
    setup_token: z.string().trim().min(8, 'Enter the setup token from your Worker secrets'),
    name: z.string().trim().min(2, 'Enter your name'),
    email: z.email('Enter a valid email address'),
    password: strongPassword,
    confirm_password: z.string(),
  })
  .refine((v) => v.password === v.confirm_password, { error: "Passwords don't match", path: ['confirm_password'] })
export type SetupValues = z.infer<typeof setupSchema>
