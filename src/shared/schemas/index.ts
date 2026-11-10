import { z } from 'zod'

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(16),
  password: z.string().min(1).max(128).optional().default('offline123'),
  remember: z.boolean().default(true)
})

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(16).regex(/^[a-zA-Z0-9_]+$/, 'Логин может содержать латинские буквы, цифры и _'),
  password: z.string().min(8).max(128).regex(/[A-Z]/, 'Добавьте хотя бы одну заглавную букву').regex(/[0-9]/, 'Добавьте хотя бы одну цифру'),
  confirmPassword: z.string(),
  email: z.string().trim().email().max(254),
  accepted: z.literal(true)
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