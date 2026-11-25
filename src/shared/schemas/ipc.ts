import { z } from 'zod'
import { launcherSettingsPatchSchema } from './index'

const ipcUsernameSchema = z
  .string()
  .trim()
  .min(3, 'Логин должен быть от 3 до 16 символов')
  .max(16, 'Логин должен быть от 3 до 16 символов')
  .regex(/^[a-zA-Z0-9_]+$/, 'Логин может содержать только латинские буквы, цифры и _')

export const ipcRegisterInputSchema = z.object({
  username: ipcUsernameSchema,
  password: z
    .string()
    .min(8, 'Пароль должен содержать не менее 8 символов')
    .max(128)
    .regex(/[A-Z]/, 'Добавьте заглавную латинскую букву')
    .regex(/[0-9]/, 'Добавьте цифру'),
  email: z.string().trim().email('Введите корректную электронную почту').max(254),
  accepted: z.literal(true, {
    errorMap: () => ({ message: 'Примите правила сообщества' })
  })
}).strict()

export const ipcLoginInputSchema = z.object({
  username: ipcUsernameSchema,
  password: z.string().min(8, 'Пароль должен содержать не менее 8 символов').max(128),
  remember: z.boolean()
}).strict()

export const ipcUpdateProfileSchema = z.object({
  username: ipcUsernameSchema.optional(),
  email: z.string().trim().email().max(254).optional()
}).strict()

export const ipcNewsIdSchema = z.string().trim().min(1).max(80)
export const ipcEmailSchema = z.string().trim().email().max(254)
export const ipcSettingsPatchSchema = launcherSettingsPatchSchema
export const ipcPathSelectionSchema = z.object({ kind: z.enum(['file', 'directory']) }).strict()
export const ipcWindowActionSchema = z.enum(['minimize', 'toggleMaximize', 'close'])

export const ipcDonateCreateOrderSchema = z.object({
  productId: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  paymentMethod: z.enum(['sbp_phone', 'card'])
}).strict()

export const ipcDonateMarkPaidSchema = z.object({
  orderId: z.string().trim().regex(/^HRT-[A-HJ-NP-Z2-9]{6}$/i),
  payerNote: z.string().trim().max(120).default('')
}).strict()

export const ipcDonateOrderIdSchema = z.string().trim().regex(/^HRT-[A-HJ-NP-Z2-9]{6}$/i)