import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import type { SettingsService } from '../../shared/contracts/services'
import type { LauncherSettings } from '../../shared/types'
import { launcherSettingsPatchSchema, launcherSettingsSchema } from '../../shared/schemas'

export const defaultLauncherSettings: LauncherSettings = {
  ramGb: 6,
  javaPath: '',
  gamePath: '',
  width: 1920,
  height: 1080,
  fullscreen: false,
  closeOnLaunch: false,
  autoConnectServer: false,
  language: 'ru',
  animations: true,
  theme: 'verdant',
  setupComplete: false
}

export function createPersistentSettingsService(filePath: string): SettingsService {
  let writeQueue: Promise<void> = Promise.resolve()

  const serializeWrite = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const readCurrent = async (): Promise<LauncherSettings> => {
    try {
      const content = await readFile(filePath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      const previous = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      const merged: Record<string, unknown> = { ...defaultLauncherSettings, ...previous }
      if (merged.theme === 'dark' || merged.theme === 'system') merged.theme = 'verdant'
      if (typeof merged.setupComplete !== 'boolean') {
        merged.setupComplete = Object.keys(previous).length > 0
      }
      return launcherSettingsSchema.parse(merged)
    } catch {
      return { ...defaultLauncherSettings }
    }
  }

  const persist = async (value: LauncherSettings): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true })
    const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`)
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, filePath)
  }

  return {
    async getSettings() {
      await writeQueue
      return readCurrent()
    },
    async updateSettings(patch) {
      return serializeWrite(async () => {
        const validPatch = launcherSettingsPatchSchema.parse(patch)
        const next = launcherSettingsSchema.parse({ ...(await readCurrent()), ...validPatch })
        await persist(next)
        return next
      })
    },
    async resetSettings() {
      await serializeWrite(() => persist({ ...defaultLauncherSettings }))
    }
  }
}