import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfflineAuthService } from '../src/main/services/offline-auth-service'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OfflineAuthService registration', () => {
  it('rejects a duplicate username in local launcher profiles (case-insensitive)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'heart-offline-auth-'))
    directories.push(directory)
    const auth = new OfflineAuthService(join(directory, 'offline-session.json'))
    const first = await auth.register({ username: 'HeartPlayer' } as never)
    expect(first.success).toBe(true)

    const duplicate = await auth.register({ username: 'heartplayer' } as never)
    expect(duplicate.success).toBe(false)
    if (!duplicate.success) {
      expect(duplicate.code).toBe('AUTH_USERNAME_TAKEN')
      expect(duplicate.message).toContain('локальных профилях')
    }

    expect((await auth.getSavedAccounts()).map(account => account.username)).toEqual(['HeartPlayer'])
  })

  it('allows different local profiles to use different usernames', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'heart-offline-auth-'))
    directories.push(directory)
    const auth = new OfflineAuthService(join(directory, 'offline-session.json'))
    expect((await auth.register({ username: 'HeartOne' } as never)).success).toBe(true)
    expect((await auth.register({ username: 'HeartTwo' } as never)).success).toBe(true)
    expect(await auth.getSavedAccounts()).toHaveLength(2)
  })
})
