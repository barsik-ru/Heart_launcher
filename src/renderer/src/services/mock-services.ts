import villageImage from '../assets/verdant-village.jpg'
import portalImage from '../assets/verdant-portal.jpg'
import highlandsImage from '../assets/verdant-highlands.jpg'
import type { Services } from '@shared/contracts/services'
import { brand } from '@shared/config/brand'
import { launcherSettingsSchema, launcherSettingsPatchSchema } from '@shared/schemas'
import type {
  AppUpdateProgress,
  AppUpdateStatus,
  GameLogEvent,
  GameProcessEvent,
  InstallationInfo,
  LauncherSettings,
  LauncherStatus,
  NewsArticle,
  ProgressEvent,
  UserProfile
} from '@shared/types'

const demoProfile: UserProfile = {
  id: 'VD-20481',
  username: 'Wanderer',
  email: 'player@example.test',
  registeredAt: '2025-08-14T12:00:00.000Z',
  group: 'Путник',
  status: 'active',
  minecraft: null
}

const news: NewsArticle[] = [
  {
    id: '1',
    title: 'Новая глава начинается',
    excerpt: 'Мир Verdant готовится к большому обновлению. Исследуйте новые земли и знакомьтесь с соседями.',
    content: 'Мы рады объявить о следующем этапе развития нашего мира. Впереди новые территории, активности и улучшения игрового процесса. Следите за новостями — подробности уже скоро.',
    category: 'Объявления',
    date: '2026-10-28',
    image: villageImage,
    pinned: true
  },
  {
    id: '2',
    title: 'Fabric-сборка 1.4.2',
    excerpt: 'Обновили клиентские моды, оптимизировали загрузку чанков и поправили конфигурации.',
    content: 'В версии 1.4.2 обновлены клиентские моды, исправлены конфигурации и улучшена стабильность. Рекомендуем обновить сборку перед следующим входом.',
    category: 'Обновления',
    date: '2026-10-24',
    image: portalImage
  },
  {
    id: '3',
    title: 'Осенний поход',
    excerpt: 'В эти выходные отправляемся исследовать дальние биомы вместе с сообществом.',
    content: 'Собираемся у центрального портала в субботу. Возьмите с собой снаряжение, еду и хорошее настроение. Координаты и расписание будут опубликованы дополнительно.',
    category: 'События',
    date: '2026-10-19',
    image: highlandsImage
  }
]

const defaults: LauncherSettings = {
  ramGb: 6,
  javaPath: 'Автоматический поиск',
  gamePath: 'C:/Users/Player/AppData/Roaming/.verdant',
  width: 1920,
  height: 1080,
  fullscreen: false,
  closeOnLaunch: false,
  language: 'ru',
  animations: true,
  theme: 'obsidian',
  setupComplete: true
}

const installation: InstallationInfo = {
  installedVersion: '1.4.1',
  latestVersion: brand.game.modpackVersion,
  installed: true,
  lastVerified: '2026-10-30T15:20:00.000Z',
  updateSize: '284 MB',
  minecraftVersion: brand.game.minecraftVersion,
  fabricLoaderVersion: brand.game.fabricVersion,
  javaMajorVersion: brand.game.javaMajorVersion,
  changes: {
    added: ['Ambient Environment', 'BetterF3'],
    updated: ['Fabric API', 'Sodium', 'Lithium'],
    removed: ['Legacy Tweaks'],
    configurations: ['Дальность прорисовки', 'Профиль производительности']
  }
}

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))
const settingsStorageKey = 'verdant-settings-v2'

export function createMockServices(): Services {
  let currentProfile: UserProfile | null = null
  let status: LauncherStatus = { state: 'ready', progress: null, error: null, activeOperationId: null }
  const progressListeners = new Set<(event: ProgressEvent) => void>()
  const logListeners = new Set<(event: GameLogEvent) => void>()
  const stateListeners = new Set<(event: LauncherStatus) => void>()
  const processListeners = new Set<(event: GameProcessEvent) => void>()
  const updateStateListeners = new Set<(event: AppUpdateStatus) => void>()
  const updateProgressListeners = new Set<(event: AppUpdateProgress) => void>()
  let appUpdateStatus: AppUpdateStatus = { state: 'idle', currentVersion: brand.version, availableVersion: null, progress: null, error: null, demo: true }

  let activeTimer: ReturnType<typeof setInterval> | null = null
  let operationSequence = 0
  let finishActiveOperation: (() => void) | null = null

  const emitLog = (level: GameLogEvent['level'], message: string, source: GameLogEvent['source'] = 'launcher') => {
    const event: GameLogEvent = { timestamp: Date.now(), level, source, message }
    logListeners.forEach(callback => callback(event))
  }

  const setUpdaterState = (next: AppUpdateStatus) => {
    appUpdateStatus = next
    updateStateListeners.forEach(callback => callback({ ...next }))
  }

  const setState = (next: LauncherStatus) => {
    status = next
    stateListeners.forEach(callback => callback({ ...next }))
  }

  const readSettings = (): LauncherSettings => {
    if (typeof localStorage === 'undefined') return { ...defaults }
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(settingsStorageKey) ?? '{}')
      const candidate = { ...defaults, ...(parsed as Partial<LauncherSettings>) }
      const result = launcherSettingsSchema.safeParse(candidate)
      return result.success ? result.data : { ...defaults }
    } catch {
      return { ...defaults }
    }
  }

  const runOperation = (kind: 'install' | 'update' | 'verify'): Promise<void> => {
    if (activeTimer) return Promise.reject(new Error('Другая операция уже выполняется.'))

    const operationId = `demo-${Date.now()}-${++operationSequence}`
    const totalBytes = kind === 'verify' ? 0 : 680_000_000
    let value = 0
    const initialState = kind === 'verify' ? 'verifying' : 'checking'
    setState({ state: initialState, progress: null, error: null, activeOperationId: operationId })
    emitLog('INFO', `DEMO: операция ${kind} запущена`)

    return new Promise(resolve => {
      finishActiveOperation = () => {
        if (activeTimer) clearInterval(activeTimer)
        activeTimer = null
        finishActiveOperation = null
        resolve()
      }

      activeTimer = setInterval(() => {
        value = Math.min(100, value + 10)
        const stage: ProgressEvent['stage'] = kind === 'verify'
          ? (value < 90 ? 'files' : 'sha256')
          : value < 15 ? 'environment'
            : value < 28 ? 'java'
              : value < 42 ? 'files'
                : value < 72 ? 'download'
                  : value < 90 ? 'sha256' : 'install'
        const progress: ProgressEvent = {
          operationId,
          operation: kind,
          stage: value >= 100 ? 'complete' : stage,
          progress: value,
          downloadedBytes: Math.round(totalBytes * value / 100),
          totalBytes,
          currentFile: kind === 'verify'
            ? 'client/mods/verdant-core.jar'
            : value < 75 ? 'mods/verdant-core.jar' : 'config/verdant/options.json',
          downloadSpeed: kind === 'verify' ? 0 : 8_400_000,
          timestamp: Date.now()
        }
        progressListeners.forEach(callback => callback(progress))
        setState({
          state: value >= 100 ? 'ready' : stage === 'install' ? 'installing' : kind === 'verify' ? 'verifying' : stage === 'environment' || stage === 'java' || stage === 'files' ? 'checking' : 'downloading',
          progress,
          error: null,
          activeOperationId: value >= 100 ? null : operationId
        })

        if (value >= 100) {
          if (activeTimer) clearInterval(activeTimer)
          activeTimer = null
          finishActiveOperation = null
          if (kind === 'install' || kind === 'update') installation.installedVersion = installation.latestVersion
          if (kind === 'verify') installation.lastVerified = new Date().toISOString()
          emitLog('INFO', 'DEMO: операция завершена. Файлы не скачивались и не изменялись.')
          resolve()
        }
      }, 145)
    })
  }

  return {
    auth: {
      async register(input) {
        await wait(420)
        currentProfile = {
          ...demoProfile,
          id: `VD-${Math.floor(10000 + Math.random() * 89999)}`,
          username: input.username,
          email: input.email,
          registeredAt: new Date().toISOString()
        }
        return { success: true, profile: currentProfile, demo: true }
      },
      async login(input) {
        await wait(320)
        if (input.password === 'wrongpass') {
          return { success: false, code: 'AUTH_INVALID', message: 'Неверный логин или пароль', demo: true }
        }
        currentProfile = { ...demoProfile, username: input.username }
        return { success: true, profile: currentProfile, demo: true }
      },
      async logout() { currentProfile = null },
      async getProfile() { return currentProfile },
      async updateProfile(input) {
        if (!currentProfile) throw new Error('Нет активной сессии.')
        currentProfile = { ...currentProfile, ...input }
        return currentProfile
      },
      async linkMicrosoft() {
        return { state: 'unavailable', profile: null, reason: 'Microsoft OAuth не подключён в этой версии.' }
      },
      async unlinkMicrosoft() {},
      async getMinecraftLinkStatus() {
        return currentProfile?.minecraft
          ? { state: 'linked', profile: currentProfile.minecraft }
          : { state: 'not-linked', profile: null }
      },
      async requestPasswordReset() { await wait(350) }
    },
    news: {
      async getNews() { return news.map(article => ({ ...article })) },
      async getArticle(id) { return news.find(article => article.id === id) ?? null }
    },
    server: {
      async getStatus() { return { online: true, players: 38, capacity: 120, latency: 24, demo: true } },
      async getOnlinePlayers() { return 38 }
    },
    settings: {
      async getSettings() { return readSettings() },
      async updateSettings(patch) {
        const validatedPatch = launcherSettingsPatchSchema.parse(patch)
        const next = launcherSettingsSchema.parse({ ...readSettings(), ...validatedPatch })
        if (typeof localStorage !== 'undefined') localStorage.setItem(settingsStorageKey, JSON.stringify(next))
        return next
      },
      async resetSettings() {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(settingsStorageKey)
      }
    },
    launcher: {
      async getStatus() { return { ...status, progress: status.progress ? { ...status.progress } : null } },
      async getInstallationInfo() { return { ...installation, changes: { ...installation.changes } } },
      async install() { await runOperation('install') },
      async update() { await runOperation('update') },
      async verifyFiles() { await runOperation('verify') },
      async launch() {
        emitLog('WARN', 'DEMO: запуск игры не выполняется — игровой движок и проверка лицензии не подключены.')
        setState({ state: 'error', progress: null, error: 'Настоящий запуск Minecraft пока недоступен.', activeOperationId: null })
      },
      async cancel() {
        if (!activeTimer) return
        if (activeTimer) clearInterval(activeTimer)
        activeTimer = null
        finishActiveOperation?.()
        finishActiveOperation = null
        emitLog('WARN', 'DEMO: операция отменена пользователем.')
        setState({ state: 'cancelled', progress: null, error: null, activeOperationId: null })
      },
      onProgress(callback) { progressListeners.add(callback); return () => progressListeners.delete(callback) },
      onLog(callback) { logListeners.add(callback); return () => logListeners.delete(callback) },
      onStateChange(callback) { stateListeners.add(callback); return () => stateListeners.delete(callback) },
      onGameProcess(callback) { processListeners.add(callback); return () => processListeners.delete(callback) }
    },
    updater: {
      async getStatus() { return { ...appUpdateStatus } },
      async checkForUpdates() {
        const result: AppUpdateStatus = {
          state: 'not-available',
          currentVersion: brand.version,
          availableVersion: null,
          progress: null,
          error: 'DEMO: проверка обновлений приложения не обращается к серверу.',
          demo: true
        }
        setUpdaterState(result)
        return result
      },
      async downloadUpdate() {
        setUpdaterState({ ...appUpdateStatus, state: 'error', error: 'DEMO: загрузка обновления приложения не выполняется.' })
        throw new Error('Демонстрационный режим не скачивает обновления приложения.')
      },
      async installUpdate() {
        setUpdaterState({ ...appUpdateStatus, state: 'error', error: 'DEMO: установка обновления приложения недоступна.' })
        throw new Error('Установка обновлений приложения появится после подключения electron-updater.')
      },
      onStateChange(callback) { updateStateListeners.add(callback); return () => updateStateListeners.delete(callback) },
      onProgress(callback) { updateProgressListeners.add(callback); return () => updateProgressListeners.delete(callback) }
    }
  }
}

export const mockServices = createMockServices()
