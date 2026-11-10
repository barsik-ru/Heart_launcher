import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuthService } from '../../shared/contracts/services'
import type { AuthResult, MinecraftLinkStatus, UserProfile } from '../../shared/types'
import { getOfflinePlayerUuid } from './minecraft/offline-uuid'

interface OfflineStorageData {
  activeId: string | null
  accounts: UserProfile[]
}

export class OfflineAuthService implements AuthService {
  private currentProfile: UserProfile | null = null
  private savedAccounts: UserProfile[] = []

  constructor(private readonly sessionPath: string) {
    this.loadSession()
  }

  private loadSession() {
    try {
      if (existsSync(this.sessionPath)) {
        const raw = JSON.parse(readFileSync(this.sessionPath, 'utf8')) as OfflineStorageData | UserProfile
        if ('accounts' in raw && Array.isArray(raw.accounts)) {
          this.savedAccounts = raw.accounts
          this.currentProfile = this.savedAccounts.find(a => a.id === raw.activeId) || this.savedAccounts[0] || null
        } else if ('username' in raw) {
          this.currentProfile = raw as UserProfile
          this.savedAccounts = [this.currentProfile]
          this.saveSession()
        }
      }
    } catch {
      this.currentProfile = null
      this.savedAccounts = []
    }
  }

  private saveSession() {
    try {
      const data: OfflineStorageData = {
        activeId: this.currentProfile?.id ?? null,
        accounts: this.savedAccounts
      }
      writeFileSync(this.sessionPath, JSON.stringify(data, null, 2), 'utf8')
    } catch {}
  }

  async getSavedAccounts(): Promise<UserProfile[]> {
    return [...this.savedAccounts]
  }

  async removeSavedAccount(id: string): Promise<void> {
    this.savedAccounts = this.savedAccounts.filter(a => a.id !== id)
    if (this.currentProfile?.id === id) {
      this.currentProfile = this.savedAccounts[0] || null
    }
    this.saveSession()
  }

  getSkinFilePath(username: string, type: 'skin' | 'cape' = 'skin'): string {
    const safeUsername = username.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(safeUsername)) throw new Error('Некорректный Minecraft-никнейм.')
    const skinsDir = join(dirname(this.sessionPath), '..', '.heart', type === 'skin' ? 'skins' : 'capes')
    return join(skinsDir, `${safeUsername}.png`)
  }

  async saveSkin(username: string, skinDataUrl: string, type: 'skin' | 'cape'): Promise<UserProfile> {
    const acc = this.savedAccounts.find(a => a.username.toLowerCase() === username.toLowerCase())
    if (!acc) throw new Error('Аккаунт не найден.')
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(skinDataUrl)) throw new Error('Скин должен быть корректным PNG-файлом.')

    if (type === 'skin') acc.skinUrl = skinDataUrl
    else acc.capeUrl = skinDataUrl

    const filePath = this.getSkinFilePath(username, type)
    mkdirSync(dirname(filePath), { recursive: true })
    const base64Data = skinDataUrl.slice('data:image/png;base64,'.length)
    const bytes = Buffer.from(base64Data, 'base64')
    if (bytes.length < 8 || bytes.length > 5 * 1024 * 1024 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
      throw new Error('PNG повреждён или превышает 5 МБ.')
    }
    writeFileSync(filePath, bytes)

    if (this.currentProfile?.id === acc.id) {
      this.currentProfile = { ...acc }
    }
    this.saveSession()
    return { ...acc }
  }

  async removeSkin(username: string, type: 'skin' | 'cape'): Promise<UserProfile> {
    const acc = this.savedAccounts.find(a => a.username.toLowerCase() === username.toLowerCase())
    if (!acc) throw new Error('Аккаунт не найден.')

    if (type === 'skin') acc.skinUrl = null
    else acc.capeUrl = null
    try { unlinkSync(this.getSkinFilePath(username, type)) } catch {}

    if (this.currentProfile?.id === acc.id) {
      this.currentProfile = { ...acc }
    }
    this.saveSession()
    return { ...acc }
  }

  async login(input: { username: string }): Promise<AuthResult> {
    const rawUsername = input.username.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(rawUsername)) {
      return { success: false, code: 'AUTH_INVALID', message: 'Никнейм должен быть от 3 до 16 символов.', demo: false }
    }

    const uuid = getOfflinePlayerUuid(rawUsername)
    const existingIndex = this.savedAccounts.findIndex(a => a.username.toLowerCase() === rawUsername.toLowerCase())

    const profile: UserProfile = {
      id: uuid,
      username: rawUsername,
      email: `${rawUsername.toLowerCase()}@offline.heart`,
      registeredAt: existingIndex >= 0 ? this.savedAccounts[existingIndex].registeredAt : new Date().toISOString(),
      group: 'Игрок',
      status: 'active',
      skinUrl: existingIndex >= 0 ? this.savedAccounts[existingIndex].skinUrl : null,
      capeUrl: existingIndex >= 0 ? this.savedAccounts[existingIndex].capeUrl : null,
      minecraft: {
        uuid,
        username: rawUsername,
        linkedAt: new Date().toISOString()
      }
    }

    if (existingIndex >= 0) {
      this.savedAccounts[existingIndex] = profile
    } else {
      this.savedAccounts.unshift(profile)
    }

    this.currentProfile = profile
    this.saveSession()
    return { success: true, profile: this.currentProfile, demo: false }
  }

  async register(input: { username: string }): Promise<AuthResult> {
    const username = input.username.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      return { success: false, code: 'AUTH_INVALID', message: 'Никнейм должен быть от 3 до 16 символов и содержать только латинские буквы, цифры и _.', demo: false }
    }
    const taken = this.savedAccounts.some(account => account.username.toLowerCase() === username.toLowerCase())
    if (taken) {
      return { success: false, code: 'AUTH_USERNAME_TAKEN', message: 'Этот ник уже сохранён в локальных профилях Heart Launcher. Войди в существующий профиль вместо повторной регистрации.', demo: false }
    }
    return this.login({ username })
  }

  async logout(): Promise<void> {
    this.currentProfile = null
    this.saveSession()
  }

  async getProfile(): Promise<UserProfile | null> {
    return this.currentProfile ? { ...this.currentProfile } : null
  }

  async updateProfile(input: { username?: string }): Promise<UserProfile> {
    if (!this.currentProfile) throw new Error('Нет активной сессии.')
    if (input.username) {
      const res = await this.login({ username: input.username })
      if (res.success) {
        this.currentProfile = res.profile
        return this.currentProfile
      }
    }
    return { ...this.currentProfile }
  }

  async linkMicrosoft(): Promise<MinecraftLinkStatus> {
    return { state: 'unavailable', profile: null, reason: 'Офлайн-режим не требует Microsoft.' }
  }

  async unlinkMicrosoft(): Promise<void> {}

  async getMinecraftLinkStatus(): Promise<MinecraftLinkStatus> {
    return this.currentProfile?.minecraft
      ? { state: 'linked', profile: this.currentProfile.minecraft }
      : { state: 'not-linked', profile: null }
  }

  async requestPasswordReset(): Promise<void> {}
}