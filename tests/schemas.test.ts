import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema, launcherSettingsPatchSchema } from '../src/shared/schemas'
import { manifestFileSchema, modpackManifestSchema } from '../src/shared/contracts/manifest'
import { ipcLoginInputSchema, ipcRegisterInputSchema, ipcSettingsPatchSchema } from '../src/shared/schemas/ipc'
import { backendAuthSessionSchema } from '../src/shared/schemas/backend'

const validFile = {
  id: 'verdant-core',
  url: 'https://cdn.verdant.example/mods/verdant-core.jar',
  sha256: 'a'.repeat(64),
  size: 1024,
  type: 'mod' as const,
  target: 'mods/verdant-core.jar',
  group: 'client' as const
}

describe('validation contracts', () => {
  it('accepts an account response when an unlinked Minecraft profile is omitted', () => {
    const response = {
      accessToken: 'a'.repeat(32),
      refreshToken: 'r'.repeat(32),
      expiresAt: '2026-11-04T12:00:00Z',
      profile: {
        id: 'account-1', username: 'Player_1', email: 'player@example.com',
        registeredAt: '2026-11-04T11:00:00Z', group: 'Игрок', status: 'active'
      }
    }
    const parsed = backendAuthSessionSchema.parse(response)
    expect(parsed.profile.minecraft).toBeNull()
  })

  it('preserves an explicitly linked Minecraft profile', () => {
    const response = {
      accessToken: 'a'.repeat(32),
      refreshToken: 'r'.repeat(32),
      profile: {
        id: 'account-1', username: 'Player_1', email: 'player@example.com',
        registeredAt: '2026-11-04T11:00:00Z', group: 'Игрок', status: 'active',
        minecraft: { uuid: 'offline-uuid', username: 'Player_1', linkedAt: '2026-11-04T11:00:00Z' }
      }
    }
    expect(backendAuthSessionSchema.parse(response).profile.minecraft?.username).toBe('Player_1')
  })
  it('accepts a valid login payload', () => {
    expect(loginSchema.safeParse({ username: 'Wanderer', password: 'verdant2026', remember: true }).success).toBe(true)
  })

  it('rejects short credentials', () => {
    expect(loginSchema.safeParse({ username: 'abc', password: '123', remember: false }).success).toBe(false)
  })

  it('requires matching registration passwords and consent', () => {
    const payload = { username: 'Player_1', password: 'StrongPass1', confirmPassword: 'StrongPass1', email: 'player@example.com', accepted: true }
    expect(registerSchema.safeParse(payload).success).toBe(true)
    expect(registerSchema.safeParse({ ...payload, confirmPassword: 'OtherPass1' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...payload, accepted: false }).success).toBe(false)
  })

  it('validates the available appearance themes and first-run flag', () => {
    for (const theme of ['verdant', 'obsidian', 'crimson', 'ocean', 'amethyst']) {
      expect(launcherSettingsPatchSchema.safeParse({ theme }).success).toBe(true)
    }
    expect(launcherSettingsPatchSchema.safeParse({ theme: 'neon' }).success).toBe(false)
    expect(launcherSettingsPatchSchema.safeParse({ setupComplete: true }).success).toBe(true)
  })

  it('rejects settings patches with unknown properties', () => {
    expect(launcherSettingsPatchSchema.safeParse({ ramGb: 8 }).success).toBe(true)
    expect(launcherSettingsPatchSchema.safeParse({ ramGb: 8, runShell: true }).success).toBe(false)
  })

  it('validates every user-controlled IPC payload with strict Zod schemas', () => {
    expect(ipcLoginInputSchema.safeParse({ username: 'verdant', password: 'VerdantDemo26!', remember: true }).success).toBe(true)
    expect(ipcLoginInputSchema.safeParse({ username: 'verdant', password: 'short', remember: true }).success).toBe(false)
    expect(ipcRegisterInputSchema.safeParse({ username: 'Player_1', password: 'StrongPass1', email: 'player@example.com', accepted: true }).success).toBe(true)
    expect(ipcRegisterInputSchema.safeParse({ username: 'Player_1', password: 'weakpass', email: 'player@example.com', accepted: true }).success).toBe(false)
    expect(ipcSettingsPatchSchema.safeParse({ ramGb: 8 }).success).toBe(true)
    expect(ipcSettingsPatchSchema.safeParse({ ramGb: 8, command: 'whoami' }).success).toBe(false)
  })

  it('accepts HTTPS manifest files with safe relative targets', () => {
    expect(manifestFileSchema.safeParse(validFile).success).toBe(true)
    expect(manifestFileSchema.safeParse({ ...validFile, target: '../../AppData/startup.exe' }).success).toBe(false)
    expect(manifestFileSchema.safeParse({ ...validFile, target: 'mods/evil:stream.jar' }).success).toBe(false)
    expect(manifestFileSchema.safeParse({ ...validFile, url: 'http://cdn.verdant.example/mod.jar' }).success).toBe(false)
    expect(manifestFileSchema.safeParse({ ...validFile, sha256: 'not-a-hash' }).success).toBe(false)
    expect(manifestFileSchema.safeParse({ ...validFile, url: 'https://unknown.example/mod.jar' }).success).toBe(false)
  })

  it('rejects duplicate paths inside a modpack manifest', () => {
    const manifest = {
      manifestVersion: 1 as const, packVersion: '1.0.0', minecraftVersion: '26.3',
      fabricLoaderVersion: '0.19.5', javaMajorVersion: 21,
      files: [validFile, { ...validFile, id: 'second-file' }],
      changelog: { added: [], removed: [], updated: [], configurations: [] }
    }
    expect(modpackManifestSchema.safeParse(manifest).success).toBe(false)
  })
})
