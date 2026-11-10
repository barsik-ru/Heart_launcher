import { app, dialog } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdaterService } from '../../shared/contracts/services'
import type { AppUpdateProgress, AppUpdateStatus } from '../../shared/types'

export class ElectronUpdaterService implements UpdaterService {
  private status: AppUpdateStatus = {
    state: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    progress: null,
    error: null,
    demo: false
  }

  private readonly stateListeners = new Set<(status: AppUpdateStatus) => void>()
  private readonly progressListeners = new Set<(progress: AppUpdateProgress) => void>()

  constructor() {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.setStatus({ state: 'checking', error: null })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setStatus({
        state: 'available',
        availableVersion: info.version,
        error: null
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.setStatus({
        state: 'not-available',
        availableVersion: null,
        error: null
      })
    })

    autoUpdater.on('error', (err: Error) => {
      this.setStatus({
        state: 'error',
        error: err.message || 'Ошибка обновления'
      })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setStatus({
        state: 'downloading',
        progress: Math.round(progress.percent)
      })

      const progressEvent: AppUpdateProgress = {
        percent: Math.round(progress.percent),
        transferredBytes: progress.transferred,
        totalBytes: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
        timestamp: Date.now()
      }

      for (const listener of this.progressListeners) {
        try { listener(progressEvent) } catch {}
      }
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setStatus({ state: 'downloaded', error: null })

      void dialog.showMessageBox({
        type: 'info',
        title: 'Обновление Heart Launcher',
        message: `Загружена новая версия ${info.version}!`,
        detail: 'Перезапустить лаунчер сейчас для завершения обновления?',
        buttons: ['Перезапустить сейчас', 'Позже'],
        defaultId: 0,
        cancelId: 1
      }).then(res => {
        if (res.response === 0) {
          autoUpdater.quitAndInstall(false, true)
        }
      })
    })
  }

  private setStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const listener of this.stateListeners) {
      try { listener({ ...this.status }) } catch {}
    }
  }

  async getStatus(): Promise<AppUpdateStatus> {
    return { ...this.status }
  }

  async checkForUpdates(): Promise<AppUpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({ state: 'not-available', error: 'В режиме разработки автообновление отключено' })
      return this.status
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (cause) {
      this.setStatus({
        state: 'error',
        error: cause instanceof Error ? cause.message : 'Не удалось проверить обновления'
      })
    }
    return this.status
  }

  async downloadUpdate(): Promise<void> {
    if (!app.isPackaged) return
    await autoUpdater.downloadUpdate()
  }

  async installUpdate(): Promise<void> {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall(false, true)
  }

  onStateChange(callback: (status: AppUpdateStatus) => void): () => void {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }

  onProgress(callback: (progress: AppUpdateProgress) => void): () => void {
    this.progressListeners.add(callback)
    return () => this.progressListeners.delete(callback)
  }
}