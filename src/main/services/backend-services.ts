import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Services, SettingsService } from '../../shared/contracts/services'
import {
  backendAuthSessionSchema,
  backendNewsArticleSchema,
  backendRefreshSessionSchema,
  backendServerStatusSchema,
  backendUserProfileSchema,
  encryptedSessionSchema
} from '../../shared/schemas'
import type { AuthResult, MinecraftTicketGrant, UserProfile } from '../../shared/types'
import { unavailableServices } from './unavailable-services'
import { BackendApiClient, BackendApiError, isDefinitiveSessionInvalidationError } from './backend-api-client'
import { secretStorage } from '../security/safe-storage'

interface SessionTokens {
  accessToken: string
  refreshToken: string
  expiresAt?: string
}

interface SessionStore {
  load(): Promise<SessionTokens | null>
  save(tokens: SessionTokens): Promise<void>
  clear(): Promise<void>
}

function createEncryptedSessionStore(filePath: string): SessionStore {
  return {
    async load() {
      if (!secretStorage.isAvailable()) return null
      try {
        const encrypted = await readFile(filePath, 'utf8')
        const plain = secretStorage.decrypt(encrypted)
        if (!plain) return null
        return encryptedSessionSchema.parse(JSON.parse(plain))
      } catch {
        return null
      }
    },
    async save(tokens) {
      if (!secretStorage.isAvailable()) throw new Error('Безопасное хранилище ОС недоступно. Сессия не будет сохранена.')
      const encrypted = secretStorage.encrypt(JSON.stringify(tokens))
      if (!encrypted) throw new Error('Не удалось зашифровать сессию через системное хранилище.')
      await mkdir(dirname(filePath), { recursive: true })
      const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`)
      await writeFile(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, filePath)
    },
    async clear() {
      await rm(filePath, { force: true })
    }
  }
}

const authFailure = (cause: unknown): AuthResult => {
  if (cause instanceof BackendApiError && [400, 401, 409, 422].includes(cause.status)) {
    return { success: false, code: cause.code, message: cause.message, demo: false }
  }
  throw cause
}

/** Main-process adapter. Access/refresh tokens never cross IPC and are encrypted at rest with OS safeStorage. */
export function createBackendServices(apiBaseUrl: string, settings: SettingsService, sessionPath: string): Services {
  const api = new BackendApiClient(apiBaseUrl)
  const sessionStore = createEncryptedSessionStore(sessionPath)
  let session: SessionTokens | null = null
  let sessionLoaded = false
  let loadPromise: Promise<void> | null = null
  let refreshPromise: Promise<'refreshed' | 'invalid' | 'temporary-failure'> | null = null
  let currentProfile: UserProfile | null = null
  let rememberSession = false

  const loadSession = async (): Promise<void> => {
    if (sessionLoaded) return
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      session = await sessionStore.load()
      rememberSession = Boolean(session)
      sessionLoaded = true
    })()
    try { await loadPromise } finally { loadPromise = null }
  }

  const saveSession = async (next: SessionTokens, remember: boolean): Promise<void> => {
    if (remember) await sessionStore.save(next)
    else await sessionStore.clear()
    session = next
    sessionLoaded = true
    rememberSession = remember
  }

  const invalidateSession = async (): Promise<void> => {
    session = null
    currentProfile = null
    rememberSession = false
    await sessionStore.clear()
  }

  const refreshSession = async (): Promise<'refreshed' | 'invalid' | 'temporary-failure'> => {
    await loadSession()
    if (!session?.refreshToken) return 'invalid'
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      const old = session
      if (!old) return 'invalid' as const
      try {
        const raw = await api.request<unknown>('v1/auth/refresh', {
          method: 'POST', body: { refreshToken: old.refreshToken }
        })
        const parsed = backendRefreshSessionSchema.parse(raw)
        const next: SessionTokens = {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken ?? old.refreshToken,
          ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {})
        }
        await saveSession(next, rememberSession)
        return 'refreshed' as const
      } catch (cause) {
        if (isDefinitiveSessionInvalidationError(cause)) {
          await invalidateSession()
          return 'invalid' as const
        }
        console.warn('Heart session refresh temporarily failed; keeping the current local session.', {
          status: cause instanceof BackendApiError ? cause.status : undefined,
          code: cause instanceof BackendApiError ? cause.code : 'UNEXPECTED_REFRESH_RESPONSE'
        })
        return 'temporary-failure' as const
      }
    })()
    try { return await refreshPromise } finally { refreshPromise = null }
  }

  const request = async <T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; auth?: boolean; timeoutMs?: number } = {}): Promise<T> => {
    const requiresAuth = options.auth !== false
    if (requiresAuth) await loadSession()
    try {
      return await api.request<T>(path, { method: options.method, body: options.body, accessToken: requiresAuth ? session?.accessToken : undefined, timeoutMs: options.timeoutMs })
    } catch (cause) {
      if (requiresAuth && isDefinitiveSessionInvalidationError(cause)) {
        const refreshResult = await refreshSession()
        if (refreshResult === 'refreshed') {
          try {
            return await api.request<T>(path, {
              method: options.method,
              body: options.body,
              accessToken: session?.accessToken,
              timeoutMs: options.timeoutMs
            })
          } catch (retryCause) {
            if (isDefinitiveSessionInvalidationError(retryCause)) await invalidateSession()
            throw retryCause
          }
        }
        if (refreshResult === 'temporary-failure') {
          throw new BackendApiError(
            'Не удалось временно обновить Heart-сессию. Вы остались в аккаунте — повторите действие чуть позже.',
            503,
            'AUTH_REFRESH_TEMPORARY_FAILURE'
          )
        }
      }
      throw cause
    }
  }

  const acceptSession = async (raw: unknown, remember: boolean): Promise<UserProfile> => {
    const parsed = backendAuthSessionSchema.parse(raw)
    const next: SessionTokens = {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {})
    }
    await saveSession(next, remember)
    currentProfile = parsed.profile
    return parsed.profile
  }

  return {
    ...unavailableServices,
    auth: {
      async register(input) {
        try {
          const raw = await request<unknown>('v1/auth/register', { method: 'POST', auth: false, body: {
            username: input.username, email: input.email, password: input.password, acceptedRules: input.accepted
          } })
          return { success: true, profile: await acceptSession(raw, true), demo: false }
        } catch (cause) { return authFailure(cause) }
      },
      async login(input) {
        try {
          const raw = await request<unknown>('v1/auth/login', { method: 'POST', auth: false, body: {
            username: input.username, password: input.password
          } })
          return { success: true, profile: await acceptSession(raw, input.remember), demo: false }
        } catch (cause) { return authFailure(cause) }
      },
      async logout() {
        try { if (session) await request('v1/auth/logout', { method: 'POST' }) }
        catch { /* local logout must still clear credentials when the API is offline */ }
        finally { session = null; currentProfile = null; rememberSession = false; await sessionStore.clear() }
      },
      async getProfile() {
        await loadSession()
        if (!session) return null
        const raw = await request<unknown>('v1/account/me')
        currentProfile = backendUserProfileSchema.parse(raw)
        return currentProfile
      },
      async updateProfile(input) {
        const raw = await request<unknown>('v1/account/me', { method: 'PATCH', body: input })
        currentProfile = backendUserProfileSchema.parse(raw)
        return currentProfile
      },
      async linkMicrosoft() {
        return { state: 'unavailable', profile: null, reason: 'Microsoft OAuth будет подключён отдельным безопасным этапом.' }
      },
      async unlinkMicrosoft() { throw new Error('Отвязка Microsoft пока не подключена.') },
      async getMinecraftLinkStatus() {
        await loadSession()
        if (!session) return { state: 'not-linked', profile: null }
        const profile = currentProfile ?? backendUserProfileSchema.parse(await request<unknown>('v1/account/me'))
        currentProfile = profile
        return profile.minecraft ? { state: 'linked', profile: profile.minecraft } : { state: 'not-linked', profile: null }
      },
      async createMinecraftTicketGrant(): Promise<MinecraftTicketGrant> {
        await loadSession()
        if (!session) throw new Error('Необходима авторизация в Heart Network')
        const raw = await request<unknown>('v1/auth/minecraft-ticket-grant', { method: 'POST' })
        return raw as MinecraftTicketGrant
      },
      async requestPasswordReset(email) {
        await request('v1/auth/password-reset', { method: 'POST', auth: false, body: { email } })
      },
      async saveSkin(username, skinDataUrl, type, variant = 'classic') {
        if (type !== 'skin') throw new Error('Серверная загрузка плащей пока не подключена. Сейчас доступна загрузка скина.')
        await loadSession()
        if (!session) throw new Error('Войдите в Heart Account, чтобы загрузить серверный скин.')
        if (currentProfile && currentProfile.username.toLowerCase() !== username.toLowerCase()) {
          throw new Error('Ник аккаунта изменился. Обновите профиль и повторите загрузку.')
        }
        const match = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(skinDataUrl)
        if (!match || match[1].length > 1_400_000) throw new Error('PNG некорректен или превышает лимит 1 МБ.')
        const raw = await request<unknown>('v1/skins/upload', {
          method: 'POST', body: { pngBase64: match[1], variant }, timeoutMs: 90_000
        })
        currentProfile = backendUserProfileSchema.parse(raw)
        return currentProfile
      },
      async removeSkin(username, type) {
        if (type !== 'skin') throw new Error('Сброс плащей пока не подключён.')
        await loadSession()
        if (!session) throw new Error('Войдите в Heart Account, чтобы сбросить серверный скин.')
        if (currentProfile && currentProfile.username.toLowerCase() !== username.toLowerCase()) {
          throw new Error('Ник аккаунта изменился. Обновите профиль и повторите действие.')
        }
        const raw = await request<unknown>('v1/skins/current', { method: 'DELETE', timeoutMs: 20_000 })
        currentProfile = backendUserProfileSchema.parse(raw)
        return currentProfile
      }
    },
    news: {
      async getNews() {
        const raw = await request<unknown>('v1/news', { auth: false })
        const rows = Array.isArray(raw) ? raw : (raw as { items?: unknown })?.items
        if (!Array.isArray(rows)) throw new Error('Backend API вернул некорректный список новостей.')
        return rows.map(item => backendNewsArticleSchema.parse(item))
      },
      async getArticle(id) {
        const raw = await request<unknown>(`v1/news/${encodeURIComponent(id)}`, { auth: false })
        return raw === null ? null : backendNewsArticleSchema.parse(raw)
      }
    },
    server: {
      async getStatus() {
        const raw = await request<unknown>('v1/server/status', { auth: false })
        return { ...backendServerStatusSchema.parse(raw), demo: false }
      },
      async getOnlinePlayers() {
        const raw = await request<unknown>('v1/server/status', { auth: false })
        return backendServerStatusSchema.parse(raw).players
      }
    },
    settings
  }
}