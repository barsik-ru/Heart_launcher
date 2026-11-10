import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { freemem, totalmem } from 'node:os'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ipcEmailSchema,
  ipcLoginInputSchema,
  ipcNewsIdSchema,
  ipcPathSelectionSchema,
  ipcRegisterInputSchema,
  ipcSettingsPatchSchema,
  ipcUpdateProfileSchema,
  ipcWindowActionSchema
} from '../../shared/schemas/ipc'
import type { Services } from '../../shared/contracts/services'
import type { AppInfo, PathSelection, SystemMemoryInfo } from '../../shared/types'
import { isTrustedRendererUrl } from '../security/navigation'
import { IPC_CHANNELS } from '../../shared/constants'
import type { IpcEventChannel, IpcEventPayloads } from '../../shared/contracts/ipc'
import type { OfflineAuthService } from '../services/offline-auth-service'

function assertTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) throw new Error('IPC is only available to the main frame')
  if (!isTrustedRendererUrl(frame.url, app.isPackaged)) throw new Error('Untrusted IPC sender')
}

function sendToRenderer<Channel extends IpcEventChannel>(
  getWindow: () => BrowserWindow | null, channel: Channel, payload: IpcEventPayloads[Channel]
): void {
  const window = getWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, payload)
}

export function registerIpc(getWindow: () => BrowserWindow | null, services: Services, serviceMode: AppInfo['serviceMode'] = 'offline'): () => void {
  const handlers: string[] = []
  const handle = (channel: string, callback: (raw: unknown) => unknown | Promise<unknown>): void => {
    ipcMain.handle(channel, (event, raw) => {
      assertTrustedSender(event)
      return callback(raw)
    })
    handlers.push(channel)
  }
  const handleVoid = (channel: string, callback: () => unknown | Promise<unknown>): void => {
    ipcMain.handle(channel, event => {
      assertTrustedSender(event)
      return callback()
    })
    handlers.push(channel)
  }

  // Оконные функции
  handle(IPC_CHANNELS.windowAction, raw => {
    const action = ipcWindowActionSchema.parse(raw)
    const window = getWindow()
    if (!window) return
    if (action === 'minimize') window.minimize()
    if (action === 'toggleMaximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    if (action === 'close') window.close()
  })
  handleVoid(IPC_CHANNELS.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)
  handleVoid(IPC_CHANNELS.systemGetMemory, (): SystemMemoryInfo => {
    const totalBytes = totalmem()
    const freeBytes = freemem()
    return { totalBytes, freeBytes, totalGb: Math.round(totalBytes / 1024 ** 3), freeGb: Math.round(freeBytes / 1024 ** 3) }
  })
  handleVoid(IPC_CHANNELS.appGetInfo, (): AppInfo => ({ version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged, serviceMode }))
  
  // Автоподбор разрешения экрана
  handleVoid('system:getScreenResolution', () => {
    try {
      const primary = screen.getPrimaryDisplay()
      return {
        width: primary.bounds.width,
        height: primary.bounds.height
      }
    } catch {
      return { width: 1920, height: 1080 }
    }
  })

  // Папка с игрой (с гарантированным созданием папки перед открытием в Проводнике)
  handleVoid('system:openGameFolder', async () => {
    const settings = await services.settings.getSettings()
    const gameDir = settings.gamePath && settings.gamePath.trim()
      ? settings.gamePath.trim()
      : join(
          process.env.APPDATA || (process.platform === 'darwin'
            ? join(app.getPath('appData'), 'heart')
            : join(app.getPath('home'), '.heart')),
          '.heart'
        )
    if (!existsSync(gameDir)) {
      mkdirSync(gameDir, { recursive: true })
    }
    await shell.openPath(gameDir)
  })

  handle(IPC_CHANNELS.dialogSelectPath, async raw => {
    const { kind } = ipcPathSelectionSchema.parse(raw)
    const window = getWindow()
    const properties: Array<'openFile' | 'openDirectory'> = [kind === 'file' ? 'openFile' : 'openDirectory']
    const result = window ? await dialog.showOpenDialog(window, { properties }) : await dialog.showOpenDialog({ properties })
    return { kind, path: result.canceled ? null : (result.filePaths[0] ?? null) } satisfies PathSelection
  })

  // Авторизация
  handle(IPC_CHANNELS.authRegister, raw => services.auth.register(ipcRegisterInputSchema.parse(raw)))
  handle(IPC_CHANNELS.authLogin, raw => services.auth.login(ipcLoginInputSchema.parse(raw)))
  handleVoid(IPC_CHANNELS.authLogout, () => services.auth.logout())
  handleVoid(IPC_CHANNELS.authGetProfile, () => services.auth.getProfile())
  handle(IPC_CHANNELS.authUpdateProfile, raw => services.auth.updateProfile(ipcUpdateProfileSchema.parse(raw)))
  handleVoid(IPC_CHANNELS.authLinkMicrosoft, () => services.auth.linkMicrosoft())
  handleVoid(IPC_CHANNELS.authUnlinkMicrosoft, () => services.auth.unlinkMicrosoft())
  handleVoid(IPC_CHANNELS.authGetMinecraftLinkStatus, () => services.auth.getMinecraftLinkStatus())
  handle(IPC_CHANNELS.authPasswordReset, raw => services.auth.requestPasswordReset(ipcEmailSchema.parse(raw)))

  // Мульти-аккаунты и Скины
  handleVoid('service:auth:getSavedAccounts', async () => {
    const auth = services.auth as unknown as OfflineAuthService
    return typeof auth.getSavedAccounts === 'function' ? await auth.getSavedAccounts() : []
  })
  handle('service:auth:removeSavedAccount', async raw => {
    const auth = services.auth as unknown as OfflineAuthService
    if (typeof auth.removeSavedAccount === 'function' && typeof raw === 'string') {
      await auth.removeSavedAccount(raw)
    }
  })
  handle('service:auth:saveSkin', async raw => {
    const payload = raw as { username: string; skinDataUrl: string; type: 'skin' | 'cape'; variant?: 'classic' | 'slim' }
    if (typeof services.auth.saveSkin === 'function') {
      return await services.auth.saveSkin(payload.username, payload.skinDataUrl, payload.type, payload.variant)
    }
    return null
  })
  handle('service:auth:removeSkin', async raw => {
    const payload = raw as { username: string; type: 'skin' | 'cape' }
    if (typeof services.auth.removeSkin === 'function') {
      return await services.auth.removeSkin(payload.username, payload.type)
    }
    return null
  })

  // Новости / Сервер
  handleVoid(IPC_CHANNELS.newsGet, () => services.news.getNews())
  handle(IPC_CHANNELS.newsGetArticle, raw => services.news.getArticle(ipcNewsIdSchema.parse(raw)))
  handleVoid(IPC_CHANNELS.serverGetStatus, () => services.server.getStatus())
  handleVoid(IPC_CHANNELS.serverGetOnlinePlayers, () => services.server.getOnlinePlayers())

  // Настройки
  handleVoid(IPC_CHANNELS.settingsGet, () => services.settings.getSettings())
  handle(IPC_CHANNELS.settingsUpdate, raw => services.settings.updateSettings(ipcSettingsPatchSchema.parse(raw)))
  handleVoid(IPC_CHANNELS.settingsReset, () => services.settings.resetSettings())

  // Движок запуска
  handleVoid(IPC_CHANNELS.launcherGetStatus, () => services.launcher.getStatus())
  handleVoid(IPC_CHANNELS.launcherGetInstallationInfo, () => services.launcher.getInstallationInfo())
  handleVoid(IPC_CHANNELS.launcherInstall, () => services.launcher.install())
  handleVoid(IPC_CHANNELS.launcherUpdate, () => services.launcher.update())
  handleVoid(IPC_CHANNELS.launcherVerify, () => services.launcher.verifyFiles())
  handleVoid(IPC_CHANNELS.launcherLaunch, () => services.launcher.launch())
  handleVoid(IPC_CHANNELS.launcherCancel, () => services.launcher.cancel())

  // Обновления
  handleVoid(IPC_CHANNELS.updaterGetStatus, () => services.updater.getStatus())
  handleVoid(IPC_CHANNELS.updaterCheck, () => services.updater.checkForUpdates())
  handleVoid(IPC_CHANNELS.updaterDownload, () => services.updater.downloadUpdate())
  handleVoid(IPC_CHANNELS.updaterInstall, () => services.updater.installUpdate())

  const subscriptions = [
    services.launcher.onProgress(event => sendToRenderer(getWindow, IPC_CHANNELS.launcherProgress, event)),
    services.launcher.onLog(event => sendToRenderer(getWindow, IPC_CHANNELS.launcherLog, event)),
    services.launcher.onStateChange(state => sendToRenderer(getWindow, IPC_CHANNELS.launcherState, state)),
    services.launcher.onGameProcess(event => sendToRenderer(getWindow, IPC_CHANNELS.launcherProcess, event)),
    services.updater.onStateChange(state => sendToRenderer(getWindow, IPC_CHANNELS.updaterState, state)),
    services.updater.onProgress(progress => sendToRenderer(getWindow, IPC_CHANNELS.updaterProgress, progress))
  ]

  return () => {
    for (const channel of handlers) ipcMain.removeHandler(channel)
    for (const unsubscribe of subscriptions) unsubscribe()
  }
}