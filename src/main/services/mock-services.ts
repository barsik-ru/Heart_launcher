import { DEMO_ACCOUNT } from '../../shared/constants'
import { brand } from '../../shared/config/brand'
import { media } from '../../shared/config/media'
import { createPersistentSettingsService } from './settings-service'
import type { Services } from '../../shared/contracts/services'
import type {
  AppUpdateProgress,
  AppUpdateStatus,
  GameLogEvent,
  GameProcessEvent,
  InstallationInfo,
  LauncherStatus,
  MinecraftLinkStatus,
  NewsArticle,
  ProgressEvent,
  ServerStatus,
  UserProfile
} from '../../shared/types'

const articles: NewsArticle[] = [
  {
    id: '1',
    title: 'Fabric API, Sodium и Lithium обновлены',
    excerpt: 'В сборке 1.4.2 обновлены три основных компонента Fabric-клиента. Старый мод Legacy Tweaks удалён.',
    content: 'В версии 1.4.2 обновлены Fabric API, Sodium и Lithium. Из состава клиента удалён Legacy Tweaks. Список изменений и параметры установки доступны на странице модпака.',
    category: 'Обновления', date: '2026-10-28', image: media.river, pinned: true
  },
  {
    id: '2',
    title: 'В сборку добавлены Ambient Environment и BetterF3',
    excerpt: 'Два новых мода вошли в клиентскую сборку 1.4.2. Также обновлён профиль производительности.',
    content: 'В клиентскую сборку 1.4.2 добавлены Ambient Environment и BetterF3. Вместе с обновлением настроены профили производительности и параметры дальности прорисовки.',
    category: 'Обновления', date: '2026-10-24', image: media.mountains
  },
  {
    id: '3',
    title: 'Профиль производительности клиента',
    excerpt: 'В конфигурации сборки обновлены параметры дальности прорисовки и профиль производительности.',
    content: 'В комплект конфигураций добавлены параметры дальности прорисовки и профиль производительности. Их текущие значения можно посмотреть на странице модпака.',
    category: 'Обновления', date: '2026-10-19', image: media.cherry
  }
]

const demoProfile: UserProfile = {
  id: 'VD-20481', username: 'Wanderer', email: 'player@example.test',
  registeredAt: '2025-08-14T12:00:00.000Z', group: 'Путник', status: 'active', minecraft: null
}

const delay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const cancelled = () => { const error = new Error('Операция отменена'); error.name = 'AbortError'; return error }
  if (signal.aborted) { reject(cancelled()); return }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
  const abort = () => { clearTimeout(timer); reject(cancelled()) }
  signal.addEventListener('abort', abort, { once: true })
})

export function createMockServices(settingsFilePath: string): Services {
  const settingsService = createPersistentSettingsService(settingsFilePath)
  const installation: InstallationInfo = {
    installedVersion: '1.4.1', latestVersion: brand.game.modpackVersion, installed: true,
    lastVerified: '2026-10-30T15:20:00.000Z', updateSize: '284 MB',
    minecraftVersion: brand.game.minecraftVersion, fabricLoaderVersion: brand.game.fabricVersion,
    javaMajorVersion: brand.game.javaMajorVersion,
    changes: { added: ['Ambient Environment', 'BetterF3'], updated: ['Fabric API', 'Sodium', 'Lithium'],
      removed: ['Legacy Tweaks'], configurations: ['Дальность прорисовки', 'Профиль производительности'] }
  }
  let currentProfile: UserProfile | null = null
  const demoAccounts = new Map<string, { password: string; profile: UserProfile }>()
  demoAccounts.set(DEMO_ACCOUNT.username.toLowerCase(), {
    password: DEMO_ACCOUNT.password,
    profile: { ...demoProfile }
  })
  let status: LauncherStatus = { state: 'ready', progress: null, error: null, activeOperationId: null }
  let appUpdateStatus: AppUpdateStatus = {
    state: 'idle', currentVersion: brand.version, availableVersion: null, progress: null, error: null, demo: true
  }
  let activeOperation: { id: string; controller: AbortController } | null = null
  let operationSequence = 0
  const progressListeners = new Set<(event: ProgressEvent) => void>()
  const logListeners = new Set<(event: GameLogEvent) => void>()
  const stateListeners = new Set<(event: LauncherStatus) => void>()
  const processListeners = new Set<(event: GameProcessEvent) => void>()
  const updaterStateListeners = new Set<(event: AppUpdateStatus) => void>()
  const updaterProgressListeners = new Set<(event: AppUpdateProgress) => void>()

  const emitLog = (level: GameLogEvent['level'], message: string, source: GameLogEvent['source'] = 'launcher') => {
    const event: GameLogEvent = { timestamp: Date.now(), level, source, message }
    for (const listener of logListeners) { try { listener(event) } catch { /* listeners are isolated */ } }
  }
  const setState = (next: LauncherStatus) => {
    status = next
    for (const listener of stateListeners) {
      try { listener({ ...next, progress: next.progress ? { ...next.progress } : null }) } catch { /* listeners are isolated */ }
    }
  }
  const setUpdaterState = (next: AppUpdateStatus) => {
    appUpdateStatus = next
    for (const listener of updaterStateListeners) { try { listener({ ...next }) } catch { /* listeners are isolated */ } }
  }
  const runOperation = async (kind: 'install' | 'update' | 'verify'): Promise<void> => {
    if (activeOperation) throw new Error('Другая операция уже выполняется.')
    const operationId = `demo-${Date.now()}-${++operationSequence}`
    const controller = new AbortController()
    activeOperation = { id: operationId, controller }
    const totalBytes = kind === 'verify' ? 0 : 680_000_000
    let lastStage: ProgressEvent['stage'] = 'environment'
    setState({ state: kind === 'verify' ? 'verifying' : 'checking', progress: null, error: null, activeOperationId: operationId })
    emitLog('INFO', `DEMO: операция ${kind} запущена`)

    try {
      for (let percent = 5; percent <= 100; percent += 5) {
        await delay(150, controller.signal)
        const stage: ProgressEvent['stage'] = kind === 'verify'
          ? (percent < 85 ? 'files' : 'sha256')
          : percent < 15 ? 'environment' : percent < 25 ? 'java' : percent < 40 ? 'files'
            : percent < 72 ? 'download' : percent < 90 ? 'sha256' : percent < 100 ? 'install' : 'complete'
        lastStage = stage
        const progress: ProgressEvent = {
          operationId, operation: kind, stage: percent >= 100 ? 'complete' : stage,
          progress: percent, downloadedBytes: Math.round(totalBytes * percent / 100), totalBytes,
          currentFile: kind === 'verify' ? 'client/mods/verdant-core.jar' : percent < 75 ? 'mods/verdant-core.jar' : 'config/verdant/options.json',
          downloadSpeed: kind === 'verify' ? 0 : 8_400_000, timestamp: Date.now()
        }
        for (const listener of progressListeners) { try { listener(progress) } catch { /* listeners are isolated */ } }
        setState({
          state: percent >= 100 ? 'ready' : stage === 'install' ? 'installing' : kind === 'verify' ? 'verifying'
            : ['environment', 'java', 'files'].includes(stage) ? 'checking' : 'downloading',
          progress, error: null, activeOperationId: percent >= 100 ? null : operationId
        })
      }
      if (kind === 'install' || kind === 'update') installation.installedVersion = installation.latestVersion
      if (kind === 'verify') installation.lastVerified = new Date().toISOString()
      emitLog('INFO', 'DEMO: операция завершена. Файлы не скачивались и не изменялись.')
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : 'Неизвестная ошибка'
        setState({ state: 'error', progress: null, error: message, activeOperationId: null })
        emitLog('ERROR', message)
        throw cause
      }
      setState({ state: 'cancelled', progress: null, error: null, activeOperationId: null })
      emitLog('WARN', `DEMO: операция ${kind} отменена на этапе ${lastStage}.`)
    } finally {
      if (activeOperation?.id === operationId) activeOperation = null
    }
  }

  return {
    auth: {
      async register(input) {
        const accountKey = input.username.toLowerCase()
        if (demoAccounts.has(accountKey)) {
          return { success: false, code: 'AUTH_EXISTS', message: 'Этот логин уже зарегистрирован в текущей DEMO-сессии.', demo: true }
        }
        const profile: UserProfile = {
          ...demoProfile,
          id: `VD-${String(Math.floor(10000 + Math.random() * 89999))}`,
          username: input.username,
          email: input.email,
          registeredAt: new Date().toISOString()
        }
        demoAccounts.set(accountKey, { password: input.password, profile })
        currentProfile = { ...profile }
        return { success: true, profile: currentProfile, demo: true }
      },
      async login(input) {
        const account = demoAccounts.get(input.username.toLowerCase())
        if (!account || account.password !== input.password) {
          return { success: false, code: 'AUTH_INVALID', message: 'Неверный логин или пароль для DEMO-аккаунта.', demo: true }
        }
        currentProfile = { ...account.profile }
        return { success: true, profile: currentProfile, demo: true }
      },
      async logout() { currentProfile = null },
      async getProfile() { return currentProfile ? { ...currentProfile } : null },
      async updateProfile(input) {
        if (!currentProfile) throw new Error('Нет активной сессии.')
        currentProfile = { ...currentProfile, ...input }
        return { ...currentProfile }
      },
      async linkMicrosoft(): Promise<MinecraftLinkStatus> {
        return { state: 'unavailable', profile: null, reason: 'Microsoft OAuth не подключён в этой версии.' }
      },
      async unlinkMicrosoft() { throw new Error('Привязка Microsoft не подключена.') },
      async getMinecraftLinkStatus() {
        return currentProfile?.minecraft
          ? { state: 'linked', profile: currentProfile.minecraft }
          : { state: 'not-linked', profile: null }
      },
      async requestPasswordReset() { throw new Error('Восстановление пароля появится после подключения backend API.') }
    },
    news: {
      async getNews() { return articles.map(item => ({ ...item })) },
      async getArticle(id) { return articles.find(item => item.id === id) ?? null }
    },
    server: {
      async getStatus(): Promise<ServerStatus> { return { online: true, players: 38, capacity: 120, latency: 24, message: 'Демонстрационные показатели', demo: true } },
      async getOnlinePlayers() { return 38 }
    },
    settings: settingsService,
    launcher: {
      async getStatus() { return { ...status, progress: status.progress ? { ...status.progress } : null } },
      async getInstallationInfo() { return { ...installation, changes: { ...installation.changes } } },
      async install() { await runOperation('install') },
      async update() { await runOperation('update') },
      async verifyFiles() { await runOperation('verify') },
      async launch() {
        const message = 'DEMO: запуск Minecraft не выполняется. Игровой движок и официальная проверка лицензии не подключены.'
        emitLog('WARN', message)
        setState({ state: 'error', progress: null, error: message, activeOperationId: null })
        throw new Error(message)
      },
      async cancel() { activeOperation?.controller.abort() },
      onProgress(callback) { progressListeners.add(callback); return () => progressListeners.delete(callback) },
      onLog(callback) { logListeners.add(callback); return () => logListeners.delete(callback) },
      onStateChange(callback) { stateListeners.add(callback); return () => stateListeners.delete(callback) },
      onGameProcess(callback) { processListeners.add(callback); return () => processListeners.delete(callback) }
    },
    updater: {
      async getStatus() { return { ...appUpdateStatus } },
      async checkForUpdates() {
        const result: AppUpdateStatus = {
          state: 'not-available', currentVersion: brand.version, availableVersion: null,
          progress: null, error: 'DEMO: проверка не обращается к серверу обновлений.', demo: true
        }
        setUpdaterState(result)
        return result
      },
      async downloadUpdate() { throw new Error('DEMO: загрузка обновления лаунчера не выполняется.') },
      async installUpdate() { throw new Error('electron-updater ещё не подключён.') },
      onStateChange(callback) { updaterStateListeners.add(callback); return () => updaterStateListeners.delete(callback) },
      onProgress(callback) { updaterProgressListeners.add(callback); return () => updaterProgressListeners.delete(callback) }
    }
  }
}
