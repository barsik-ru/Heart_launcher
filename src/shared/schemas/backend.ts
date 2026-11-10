import { z } from 'zod'

export const backendMinecraftProfileSchema = z.object({
  uuid: z.string().min(1).max(64),
  username: z.string().min(1).max(16),
  linkedAt: z.string().min(1)
})

export const backendUserProfileSchema = z.object({
  id: z.string().min(1).max(128),
  username: z.string().min(3).max(32),
  email: z.string().email().max(254),
  registeredAt: z.string().min(1),
  group: z.string().min(1).max(64),
  status: z.enum(['active', 'pending', 'blocked']),
  // Older Gson builds omitted JsonNull object members; treat a missing link as an unlinked profile.
  minecraft: backendMinecraftProfileSchema.nullable().default(null),
  skinUrl: z.string().nullable().optional(),
  skinVariant: z.enum(['classic', 'slim']).nullable().optional(),
  capeUrl: z.string().nullable().optional()
})

export const backendAuthSessionSchema = z.object({
  accessToken: z.string().min(16).max(8192),
  refreshToken: z.string().min(16).max(8192),
  expiresAt: z.string().optional(),
  profile: backendUserProfileSchema
})

export const backendRefreshSessionSchema = z.object({
  accessToken: z.string().min(16).max(8192),
  refreshToken: z.string().min(16).max(8192).optional(),
  expiresAt: z.string().optional()
})

export const backendNewsArticleSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(180),
  excerpt: z.string().min(1).max(600),
  content: z.string().min(1).max(40_000),
  category: z.enum(['Обновления', 'События', 'Объявления', 'Технические работы']),
  date: z.string().min(1),
  image: z.string().max(2048),
  pinned: z.boolean().optional()
})

export const backendServerStatusSchema = z.object({
  online: z.boolean(),
  players: z.number().int().min(0),
  capacity: z.number().int().min(0),
  latency: z.number().min(0).nullable(),
  message: z.string().max(500).optional()
})

export const encryptedSessionSchema = z.object({
  accessToken: z.string().min(16),
  refreshToken: z.string().min(16),
  expiresAt: z.string().optional()
})