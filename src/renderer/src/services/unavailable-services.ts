import type { Services } from '@shared/contracts/services'
import { ServiceUnavailableError } from '@shared/types/errors'
import type { LauncherSettings } from '@shared/types'

const error = () => new ServiceUnavailableError()
const defaults: LauncherSettings = {
  ramGb: 6,
  javaPath: '',
  gamePath: '',
  width: 1920,
  height: 1080,
  fullscreen: false,
  closeOnLaunch: false,
  language: 'ru',
  animations: true,
  theme: 'verdant',
  setupComplete: false
}

export const unavailableServices: Services = {
  auth: {
    async register() { throw error() },
    async login() { throw error() },
    async logout() {},
    async getProfile() { return null },
    async updateProfile() { throw error() },
    async linkMicrosoft() { return { state: 'unavailable', profile: null, reason: 'Microsoft OAuth не подключён.' } },
    async unlinkMicrosoft() { throw error() },
    async getMinecraftLinkStatus() { return { state: 'unavailable', profile: null, reason: 'Microsoft OAuth не подключён.' } },
    async requestPasswordReset() { throw error() }
  },
  news: {
    async getNews() { return [] },
    async getArticle() { return null }
  },
  server: {
    async getStatus() { return { online: false, players: 0, capacity: 0, latency: null, message: 'Backend API не подключён', demo: false } },
    async getOnlinePlayers() { return 0 }
  },
  settings: {
    async getSettings() { return { ...defaults } },
    async updateSettings(patch) { return { ...defaults, ...patch } },
    async resetSettings() {}
  },
  launcher: {
    async getStatus() { return { state: 'error', progress: null, error: 'Launcher API не подключён.' } },
    async getInstallationInfo() {
      return {
        installedVersion: null,
        latestVersion: '—',
        installed: false,
        lastVerified: null,
        updateSize: '—',
        minecraftVersion: '—',
        fabricLoaderVersion: '—',
        javaMajorVersion: 21,
        changes: { added: [], updated: [], removed: [], configurations: [] }
      }
    },
    async install() { throw error() },
    async update() { throw error() },
    async verifyFiles() { throw error() },
    async launch() { throw error() },
    async cancel() {},
    onProgress() { return () => undefined },
    onLog() { return () => undefined },
    onStateChange() { return () => undefined },
    onGameProcess() { return () => undefined }
  },
  updater: {
    async getStatus() { return { state: 'error', currentVersion: '—', availableVersion: null, progress: null, error: 'Updater provider не подключён.', demo: false } },
    async checkForUpdates() { throw error() },
    async downloadUpdate() { throw error() },
    async installUpdate() { throw error() },
    onStateChange() { return () => undefined },
    onProgress() { return () => undefined }
  }
}
