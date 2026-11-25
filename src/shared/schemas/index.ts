import { z } from 'zod'

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Логин должен быть от 3 до 16 символов')
  .max(16, 'Логин должен быть от 3 до 16 символов')
  .regex(/^[a-zA-Z0-9_]+$/, 'Логин может содержать только латинские буквы, цифры и _')

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8, 'Пароль должен содержать не менее 8 символов').max(128, 'Пароль слишком длинный'),
  remember: z.boolean().default(true)
})

export const registerSchema = z.object({
  username: usernameSchema,
  password: z
    .string()
    .min(8, 'Пароль должен содержать не менее 8 символов')
    .max(128, 'Пароль слишком длинный')
    .regex(/[A-Z]/, 'Добавьте хотя бы одну заглавную латинскую букву (A-Z)')
    .regex(/[0-9]/, 'Добавьте хотя бы одну цифру'),
  confirmPassword: z.string().min(1, 'Повторите пароль'),
  email: z.string().trim().email('Введите корректную электронную почту').max(254),
  accepted: z.literal(true, {
    errorMap: () => ({ message: 'Примите правила сообщества для создания аккаунта' })
  })
}).refine(value => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Пароли не совпадают'
})

export const launcherSettingsSchema = z.object({
  ramGb: z.number().int().min(2).max(64),
  javaPath: z.string().max(500),
  gamePath: z.string().max(500),
  width: z.number().int().min(800).max(7680),
  height: z.number().int().min(600).max(4320),
  fullscreen: z.boolean(),
  borderless: z.boolean().default(true),
  closeOnLaunch: z.boolean(),
  autoConnectServer: z.boolean().default(false),
  language: z.enum(['ru', 'en']),
  animations: z.boolean(),
  theme: z.enum(['verdant', 'obsidian', 'crimson', 'ocean', 'amethyst']),
  setupComplete: z.boolean()
})

export const launcherSettingsPatchSchema = launcherSettingsSchema.partial().strict()
export const windowActionSchema = z.enum(['minimize', 'toggleMaximize', 'close'])
export const pathSelectionSchema = z.object({ kind: z.enum(['file', 'directory']) }).strict()
export const emptyPayloadSchema = z.object({}).strict()
export const appErrorCodeSchema = z.enum([
  'AUTH_INVALID',
  'AUTH_USERNAME_TAKEN',
  'AUTH_UNAVAILABLE',
  'BACKEND_UNAVAILABLE',
  'OPERATION_IN_PROGRESS',
  'OPERATION_CANCELLED',
  'LAUNCHER_ENGINE_UNAVAILABLE',
  'VALIDATION_FAILED',
  'UNKNOWN'
])

export type LoginSchema = z.infer<typeof loginSchema>
export type RegisterSchema = z.infer<typeof registerSchema>
export type LauncherSettingsSchema = z.infer<typeof launcherSettingsSchema>

export {
  backendAuthSessionSchema,
  backendNewsArticleSchema,
  backendRefreshSessionSchema,
  backendServerStatusSchema,
  backendUserProfileSchema,
  encryptedSessionSchema
} from './backend'