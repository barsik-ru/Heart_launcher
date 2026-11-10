import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { hardenNavigation } from './security/navigation'
import { brand } from '../shared/config/brand'
import { IPC_CHANNELS } from '../shared/constants'
import { createMockServices } from './services/mock-services'
import { unavailableServices } from './services/unavailable-services'
import { createPersistentSettingsService } from './services/settings-service'
import { createBackendServices } from './services/backend-services'
import { createMinecraftStatusService } from './services/minecraft-status-service'
import { createHeartBridgeNewsService } from './services/heart-bridge-news-service'
import { MinecraftLauncherService } from './services/minecraft/minecraft-launcher-service'
import { OfflineAuthService } from './services/offline-auth-service'
import { ElectronUpdaterService } from './services/electron-updater-service'
import type { Services } from '../shared/contracts/services'

declare const __VERDANT_API_BASE_URL__: string | undefined
declare const __HEART_BRIDGE_API_BASE_URL__: string | undefined

// Регистрируем явный App User Model ID для панели задач Windows
if (process.platform === 'win32') {
  app.setAppUserModelId('com.heart.launcher')
}

// Нативная поддержка Wayland для современных Linux-систем
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}

// Флаги оптимизации потребления памяти Electron
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=160')

let mainWindow: BrowserWindow | null = null
let disposeIpc: (() => void) | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

function migrateLegacyOfflineAccounts(legacyPath: string, offlineAccountsPath: string): void {
  if (!existsSync(legacyPath) || existsSync(offlineAccountsPath)) return
  try {
    const parsed = JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return
    const record = parsed as Record<string, unknown>
    const isOfflineAccountStore = Array.isArray(record.accounts) || typeof record.username === 'string'
    if (!isOfflineAccountStore) return
    writeFileSync(offlineAccountsPath, JSON.stringify(parsed, null, 2), { encoding: 'utf8', flag: 'wx' })
  } catch {}
}

function readLocalConfig(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') values[key] = value
  if (app.isPackaged) return values
  const candidates = [join(app.getAppPath(), '.env'), join(process.cwd(), '.env')]
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const index = trimmed.indexOf('=')
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
      if (values[key] === undefined) values[key] = value
    }
  }
  return values
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (!mainWindow.isVisible()) mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setName(brand.productName)
    const config = readLocalConfig()
    const mockMode = !app.isPackaged && config.VITE_USE_MOCKS === 'true'
    const fallbackVerdantUrl = typeof __VERDANT_API_BASE_URL__ !== 'undefined' ? __VERDANT_API_BASE_URL__ : ''
    const fallbackBridgeUrl = typeof __HEART_BRIDGE_API_BASE_URL__ !== 'undefined' ? __HEART_BRIDGE_API_BASE_URL__ : ''
    const apiBaseUrl = (config.VERDANT_API_BASE_URL?.trim() || fallbackVerdantUrl || '').trim()
    const heartBridgeApiBaseUrl = (config.HEART_BRIDGE_API_BASE_URL?.trim() || fallbackBridgeUrl || '').trim()
    const settingsFilePath = join(app.getPath('userData'), 'launcher-settings.json')
    const sessionFilePath = join(app.getPath('userData'), 'offline-session.json')
    const offlineAccountsPath = join(app.getPath('userData'), 'offline-accounts.json')
    migrateLegacyOfflineAccounts(sessionFilePath, offlineAccountsPath)
    const settingsService = createPersistentSettingsService(settingsFilePath)
    const serverHost = config.VERDANT_MINECRAFT_HOST?.trim() || brand.server.host
    const serverPortValue = Number(config.VERDANT_MINECRAFT_PORT || String(brand.server.port))
    const serverPort = Number.isInteger(serverPortValue) && serverPortValue >= 1 && serverPortValue <= 65535 ? serverPortValue : brand.server.port
    const minecraftStatusService = createMinecraftStatusService({ host: serverHost, port: serverPort })

    const offlineAuth = new OfflineAuthService(offlineAccountsPath)
    const updaterService = new ElectronUpdaterService()

    const defaultGameDir = join(
      process.env.APPDATA || (process.platform === 'darwin'
        ? join(app.getPath('appData'), 'heart')
        : join(app.getPath('home'), '.heart')),
      '.heart'
    )

    const companionJarPath = app.isPackaged
      ? join(process.resourcesPath, 'heart-identity-fabric.jar')
      : join(app.getAppPath(), 'resources', 'heart-identity-fabric.jar')

    // На Linux используем .png, на Windows .ico
    const iconExt = process.platform === 'linux' ? 'icon.png' : 'icon.ico'
    const windowIconPath = app.isPackaged
      ? join(process.resourcesPath, iconExt)
      : join(app.getAppPath(), 'build', iconExt)

    let serviceMode: 'demo' | 'backend' | 'offline' = 'offline'
    let services: Services = {
      ...unavailableServices,
      settings: settingsService,
      auth: offlineAuth,
      server: minecraftStatusService,
      updater: updaterService
    }

    if (mockMode) {
      services = createMockServices(settingsFilePath)
      services.server = minecraftStatusService
      services.auth = offlineAuth
      services.updater = updaterService
      serviceMode = 'demo'
    } else if (apiBaseUrl) {
      try {
        services = createBackendServices(apiBaseUrl, settingsService, sessionFilePath)
        services.server = minecraftStatusService
        services.updater = updaterService
        serviceMode = 'backend'
      } catch (cause) {
        console.error('Backend API configuration rejected:', cause)
      }
    }

    if (heartBridgeApiBaseUrl) {
      services.news = createHeartBridgeNewsService(heartBridgeApiBaseUrl)
    }

    const realLauncher = new MinecraftLauncherService({
      settingsService,
      getProfile: () => services.auth.getProfile(),
      getMinecraftGrant: async () => {
        if (typeof services.auth.createMinecraftTicketGrant === 'function') {
          try {
            return await services.auth.createMinecraftTicketGrant()
          } catch (err) {
            console.warn('Could not acquire Heart ticket grant:', err)
            return null
          }
        }
        return null
      },
      companionModJarPath: companionJarPath,
      defaultGameDir,
      heartBridgeApiBaseUrl,
      onWindowMinimizeRequest: () => mainWindow?.minimize(),
      onWindowHideRequest: () => {
        if (!mainWindow) return
        mainWindow.hide()
      },
      onWindowRestoreRequest: () => {
        if (!mainWindow) return
        mainWindow.show()
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
    })

    services.launcher = realLauncher

    const createWindow = (): void => {
      mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1040,
        minHeight: 680,
        frame: false,
        icon: existsSync(windowIconPath) ? windowIconPath : undefined,
        backgroundColor: brand.colors.background,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
          preload: join(__dirname, '../preload/index.js')
        }
      })

      hardenNavigation(mainWindow.webContents, app.isPackaged)
      mainWindow.on('maximize', () => mainWindow?.webContents.send(IPC_CHANNELS.windowMaximized, true))
      mainWindow.on('unmaximize', () => mainWindow?.webContents.send(IPC_CHANNELS.windowMaximized, false))
      mainWindow.once('ready-to-show', () => mainWindow?.show())
      mainWindow.on('closed', () => { mainWindow = null })

      if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
      else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    disposeIpc = registerIpc(() => mainWindow, services, serviceMode)
    createWindow()

    // Автопроверка обновлений через 4 секунды после старта собранного приложения
    if (app.isPackaged) {
      setTimeout(() => {
        void updaterService.checkForUpdates()
      }, 4000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => { disposeIpc?.(); disposeIpc = null })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}