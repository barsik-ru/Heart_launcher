import type { Services } from '../../shared/contracts/services'
import type { LauncherSettings } from '../../shared/types'

const unavailable = () => new Error('Сервис недоступен: подключите backend adapter или включите DEMO в development.')
const defaults: LauncherSettings = {
  ramGb: 6, javaPath: '', gamePath: '', width: 1920, height: 1080,
  fullscreen: false, closeOnLaunch: false, language: 'ru', animations: true, theme: 'verdant', setupComplete: false
}

export const unavailableServices: Services = {
  auth: {
    async register() { throw unavailable() }, async login() { throw unavailable() }, async logout() {},
    async getProfile() { return null }, async updateProfile() { throw unavailable() },
    async linkMicrosoft() { return { state: 'unavailable', profile: null, reason: 'Microsoft OAuth не подключён.' } },
    async unlinkMicrosoft() { throw unavailable() },
    async getMinecraftLinkStatus() { return { state: 'unavailable', profile: null, reason: 'Microsoft OAuth не подключён.' } },
    async requestPasswordReset() { throw unavailable() }
  },
  news: { async getNews() { return [] }, async getArticle() { return null } },
  server: { async getStatus() { return { online: false, players: 0, capacity: 0, latency: null, message: 'Backend API не подключён', demo: false } }, async getOnlinePlayers() { return 0 } },
  settings: {
    async getSettings() { return { ...defaults } },
    async updateSettings(patch) { return { ...defaults, ...patch } },
    async resetSettings() {}
  },
  launcher: {
    async getStatus() { return { state: 'error', progress: null, error: 'Launcher engine не подключён.' } },
    async getInstallationInfo() { return { installedVersion: null, latestVersion: '—', installed: false, lastVerified: null, updateSize: '—', minecraftVersion: '—', fabricLoaderVersion: '—', javaMajorVersion: 21, changes: { added: [], updated: [], removed: [], configurations: [] } } },
    async install() { throw unavailable() }, async update() { throw unavailable() }, async verifyFiles() { throw unavailable() }, async launch() { throw unavailable() }, async cancel() {},
    onProgress() { return () => undefined }, onLog() { return () => undefined }, onStateChange() { return () => undefined }, onGameProcess() { return () => undefined }
  },
  updater: {
    async getStatus() { return { state: 'error', currentVersion: '—', availableVersion: null, progress: null, error: 'Updater provider не подключён.', demo: false } },
    async checkForUpdates() { throw unavailable() }, async downloadUpdate() { throw unavailable() }, async installUpdate() { throw unavailable() },
    onStateChange() { return () => undefined }, onProgress() { return () => undefined }
  }
}
