import { describe, expect, it } from 'vitest'
import { BackendApiClient, normalizeApiBaseUrl } from '../src/main/services/backend-api-client'
import {
  backendAuthSessionSchema,
  backendNewsArticleSchema,
  backendServerStatusSchema
} from '../src/shared/schemas'

const profile = {
  id: 'user_123', username: 'Wanderer', email: 'player@example.net',
  registeredAt: '2026-11-02T18:00:00.000Z', group: 'Игрок', status: 'active', minecraft: null
}

describe('Backend API boundary', () => {
  it('accepts HTTPS and local development URLs only', () => {
    expect(normalizeApiBaseUrl('https://api.verdant.example')).toBe('https://api.verdant.example/')
    expect(normalizeApiBaseUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    expect(() => normalizeApiBaseUrl('http://api.verdant.example')).toThrow('HTTPS')
    expect(() => normalizeApiBaseUrl('https://user:pass@api.verdant.example')).toThrow('логин')
  })

  it('refuses invalid API base paths before any request is made', () => {
    expect(() => new BackendApiClient('file:///etc')).toThrow('HTTPS')
    expect(() => new BackendApiClient('https://api.verdant.example')).not.toThrow()
  })

  it('validates the session response before storing tokens or profile data', () => {
    const session = {
      accessToken: 'a'.repeat(40), refreshToken: 'r'.repeat(40),
      expiresAt: '2026-11-02T22:00:00.000Z', profile
    }
    expect(backendAuthSessionSchema.safeParse(session).success).toBe(true)
    expect(backendAuthSessionSchema.safeParse({ ...session, profile: { ...profile, status: 'admin' } }).success).toBe(false)
    expect(backendAuthSessionSchema.safeParse({ ...session, accessToken: 'short' }).success).toBe(false)
  })

  it('validates server status and news DTOs before exposing them to the UI', () => {
    expect(backendServerStatusSchema.safeParse({ online: true, players: 38, capacity: 120, latency: 24 }).success).toBe(true)
    expect(backendServerStatusSchema.safeParse({ online: true, players: -1, capacity: 120, latency: 24 }).success).toBe(false)
    expect(backendNewsArticleSchema.safeParse({
      id: 'news_1', title: 'Открытие', excerpt: 'Коротко', content: 'Полный текст',
      category: 'Объявления', date: '2026-11-02T18:00:00.000Z', image: 'worlds/village-lake.webp', pinned: true
    }).success).toBe(true)
  })
})
