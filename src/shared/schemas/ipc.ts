import { z } from 'zod'
import { launcherSettingsPatchSchema } from './index'

export const ipcRegisterInputSchema = z.object({
  username: z.string().trim().min(3).max(16).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128).regex(/[A-Z]/, 'Добавьте заглавную букву').regex(/[0-9]/, 'Добавьте цифру'),
  email: z.string().trim().email().max(254),
  accepted: z.literal(true)
}).strict()

export const ipcLoginInputSchema = z.object({
  username: z.string().trim().min(3).max(16),
  password: z.string().min(8).max(128),
  remember: z.boolean()
}).strict()

export const ipcUpdateProfileSchema = z.object({
  username: z.string().trim().min(3).max(16).regex(/^[a-zA-Z0-9_]+$/).optional(),
  email: z.string().trim().email().max(254).optional()
}).strict()

export const ipcNewsIdSchema = z.string().trim().min(1).max(80)
export const ipcEmailSchema = z.string().trim().email().max(254)
export const ipcSettingsPatchSchema = launcherSettingsPatchSchema
export const ipcPathSelectionSchema = z.object({ kind: z.enum(['file', 'directory']) }).strict()
export const ipcWindowActionSchema = z.enum(['minimize', 'toggleMaximize', 'close'])
