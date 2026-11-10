import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMockServices } from '../src/main/services/mock-services'
import { createPersistentSettingsService } from '../src/main/services/settings-service'
import { DEMO_ACCOUNT } from '../src/shared/constants'

const temporaryDirectories: string[] = []
async function makeServices() {
  const directory = await mkdtemp(join(tmpdir(), 'verdant-services-'))
  temporaryDirectories.push(directory)
  return createMockServices(join(directory, 'settings.json'))
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Main-process service adapters', () => {
  it('marks demo authentication and keeps Minecraft linking separate', async () => {
    const services = await makeServices()
    const result = await services.auth.login({ ...DEMO_ACCOUNT, remember: true })
    expect(result.success).toBe(true)
    if (result.success) expect(result.demo).toBe(true)
    expect(await services.auth.getMinecraftLinkStatus()).toEqual({ state: 'not-linked', profile: null })
    expect((await services.auth.linkMicrosoft()).state).toBe('unavailable')
    const badCredentials = await services.auth.login({ username: 'verdant', password: 'incorrect-pass', remember: false })
    expect(badCredentials.success).toBe(false)
  })


  it('allows a newly registered demo account to sign in during the same app session', async () => {
    const services = await makeServices()
    const registered = await services.auth.register({
      username: 'Builder_01', password: 'BuilderPass9', email: 'builder@example.test', accepted: true
    })
    expect(registered.success).toBe(true)
    await services.auth.logout()
    const login = await services.auth.login({ username: 'builder_01', password: 'BuilderPass9', remember: false })
    expect(login.success).toBe(true)
    if (login.success) expect(login.profile.username).toBe('Builder_01')
  })

  it('rejects duplicate demo usernames without replacing the original account', async () => {
    const services = await makeServices()
    const first = await services.auth.register({
      username: 'Builder_02', password: 'BuilderPass9', email: 'builder2@example.test', accepted: true
    })
    expect(first.success).toBe(true)
    const duplicate = await services.auth.register({
      username: 'builder_02', password: 'OtherPass9', email: 'builder3@example.test', accepted: true
    })
    expect(duplicate.success).toBe(false)
    const login = await services.auth.login({ username: 'Builder_02', password: 'BuilderPass9', remember: true })
    expect(login.success).toBe(true)
  })

  it('provides typed progress and resolves only after the operation is complete', async () => {
    vi.useFakeTimers()
    const services = await makeServices()
    const progress: number[] = []
    const unsubscribe = services.launcher.onProgress(event => progress.push(event.progress))
    const operation = services.launcher.verifyFiles()
    await vi.advanceTimersByTimeAsync(4_000)
    await operation
    unsubscribe()
    expect(progress.at(-1)).toBe(100)
    expect((await services.launcher.getStatus()).state).toBe('ready')
  })

  it('cancels the operation promise and exposes the cancelled state', async () => {
    vi.useFakeTimers()
    const services = await makeServices()
    const operation = services.launcher.install()
    await vi.advanceTimersByTimeAsync(300)
    await services.launcher.cancel()
    await operation
    expect((await services.launcher.getStatus()).state).toBe('cancelled')
  })

  it('persists settings in Main user data storage and validates the patch', async () => {
    const services = await makeServices()
    const updated = await services.settings.updateSettings({ ramGb: 10, fullscreen: true })
    expect(updated.ramGb).toBe(10)
    expect(updated.fullscreen).toBe(true)
    const file = await readFile(join(temporaryDirectories[0], 'settings.json'), 'utf8')
    expect(JSON.parse(file).ramGb).toBe(10)
    await expect(services.settings.updateSettings({ ramGb: 999 } as never)).rejects.toThrow()
  })


  it('keeps first-run setup enabled for a genuinely new profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'verdant-first-run-'))
    temporaryDirectories.push(directory)
    const settings = createPersistentSettingsService(join(directory, 'settings.json'))
    const current = await settings.getSettings()
    expect(current.setupComplete).toBe(false)
    expect(current.theme).toBe('verdant')
  })

  it('migrates existing 0.3.7 preferences without reopening first-run setup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'verdant-settings-migration-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'settings.json')
    await writeFile(filePath, JSON.stringify({ ramGb: 10, language: 'en', theme: 'dark' }), 'utf8')
    const settings = createPersistentSettingsService(filePath)
    const migrated = await settings.getSettings()
    expect(migrated.ramGb).toBe(10)
    expect(migrated.language).toBe('en')
    expect(migrated.theme).toBe('verdant')
    expect(migrated.setupComplete).toBe(true)
  })

  it('serializes concurrent Main-process settings updates without losing a field', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'verdant-settings-'))
    temporaryDirectories.push(directory)
    const settings = createPersistentSettingsService(join(directory, 'settings.json'))
    await Promise.all([
      settings.updateSettings({ ramGb: 10 }),
      settings.updateSettings({ width: 1600 })
    ])
    const finalSettings = await settings.getSettings()
    expect(finalSettings.ramGb).toBe(10)
    expect(finalSettings.width).toBe(1600)
  })

  it('keeps app updater isolated and labels the mock response', async () => {
    const services = await makeServices()
    const result = await services.updater.checkForUpdates()
    expect(result.demo).toBe(true)
    expect(result.state).toBe('not-available')
    await expect(services.updater.downloadUpdate()).rejects.toThrow('не выполняется')
  })

  it('does not pretend to launch a game in demo mode', async () => {
    const services = await makeServices()
    await expect(services.launcher.launch()).rejects.toThrow('проверка лицензии не подключены')
    expect((await services.launcher.getStatus()).state).toBe('error')
  })

  it('releases event subscriptions and rejects overlapping operations', async () => {
    vi.useFakeTimers()
    const services = await makeServices()
    const callback = vi.fn()
    const unsubscribe = services.launcher.onProgress(callback)
    const operation = services.launcher.verifyFiles()
    await expect(services.launcher.install()).rejects.toThrow('уже выполняется')
    await vi.advanceTimersByTimeAsync(4_000)
    await operation
    const count = callback.mock.calls.length
    unsubscribe()
    expect(count).toBeGreaterThan(0)
    expect(callback).toHaveBeenCalledTimes(count)
  })
})
