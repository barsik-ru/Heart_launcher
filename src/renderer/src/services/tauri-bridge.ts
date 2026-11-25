import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { LauncherBridge } from '../../../preload/types'
import type {
  AppUpdateProgress,
  AppInfo,
  AppUpdateStatus,
  AuthResult,
  GameLogEvent,
  GameProcessEvent,
  InstallationInfo,
  LauncherSettings,
  LauncherStatus,
  LoginInput,
  MinecraftLinkStatus,
  NewsArticle,
  PathSelection,
  ProgressEvent,
  RegisterInput,
  ServerStatus,
  SystemMemoryInfo,
  UpdateProfileInput,
  UserProfile
} from '@shared/types'

const isTauriRuntime =
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

let currentLauncherStatus: LauncherStatus = {
  state: 'ready',
  progress: null,
  error: null,
  activeOperationId: null
}

let activeSessionUsername: string | null = null

const launcherStateListeners = new Set<(status: LauncherStatus) => void>()
const gameProcessListeners = new Set<(event: GameProcessEvent) => void>()

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return fallback
}

function toError(err: unknown, fallback: string): Error {
  return err instanceof Error ? err : new Error(extractErrorMessage(err, fallback))
}

function updateStatus(patch: Partial<LauncherStatus>): void {
  currentLauncherStatus = { ...currentLauncherStatus, ...patch }
  for (const listener of launcherStateListeners) {
    try {
      listener({ ...currentLauncherStatus })
    } catch {}
  }
}

if (isTauriRuntime) {
  void listen<string>('event:launcher:step', (event) => {
    if (currentLauncherStatus.state === 'launching' && currentLauncherStatus.progress) {
      updateStatus({
        progress: {
          ...currentLauncherStatus.progress,
          currentFile: event.payload
        }
      })
    }
  })

  void listen<string>('event:launcher:process', (event) => {
    const payload = event.payload
    const isExit = payload.includes('exited') || payload.includes('Exited')

    if (isExit) {
      updateStatus({ state: 'ready', progress: null, error: null })
    } else if (payload === 'running') {
      updateStatus({ state: 'running', progress: null, error: null })
    } else if (payload.startsWith('started')) {
      updateStatus({
        state: 'launching',
        progress: {
          operationId: currentLauncherStatus.activeOperationId || 'launch',
          operation: 'install',
          stage: 'prepare',
          progress: 100,
          downloadedBytes: 0,
          totalBytes: 0,
          currentFile: 'Запуск Minecraft...',
          downloadSpeed: 0,
          timestamp: Date.now()
        },
        error: null
      })
    }

    const processEvent: GameProcessEvent = {
      type: isExit ? 'exited' : 'started',
      timestamp: Date.now()
    }

    for (const listener of gameProcessListeners) {
      try {
        listener(processEvent)
      } catch {}
    }
  })

  void listen<number>('event:launcher:progress', (event) => {
    if (currentLauncherStatus.state === 'launching' || currentLauncherStatus.state === 'running') {
      return
    }
    const percent = event.payload
    if (percent >= 100) {
      updateStatus({ state: 'ready', progress: null, error: null })
      return
    }
    updateStatus({
      state: 'downloading',
      progress: {
        operationId: currentLauncherStatus.activeOperationId || 'install_operation',
        operation: 'install',
        stage: 'download',
        progress: percent,
        downloadedBytes: 0,
        totalBytes: 0,
        currentFile: 'Проверка и синхронизация файлов...',
        downloadSpeed: 0,
        timestamp: Date.now()
      },
      error: null
    })
  })
}

export const tauriBridge: LauncherBridge = {
  window: {
    action: async (action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> => {
      if (action === 'minimize') await invoke('window_minimize')
      if (action === 'toggleMaximize') await invoke('window_toggle_maximize')
      if (action === 'close') await invoke('window_close')
    },
    isMaximized: async (): Promise<boolean> => {
      return await invoke<boolean>('window_is_maximized')
    },
    onMaximized: () => () => {}
  },

  system: {
    getMemory: async (): Promise<SystemMemoryInfo> => {
      return await invoke<SystemMemoryInfo>('system_get_memory')
    },
    getAppInfo: async (): Promise<AppInfo> => {
      return await invoke<AppInfo>('app_get_info')
    },
    openGameFolder: async (): Promise<void> => {
      await invoke('system_open_game_folder')
    },
    openDiscord: async (): Promise<void> => {
      await invoke('system_open_discord')
    },
    getScreenResolution: async (): Promise<{ width: number; height: number }> => {
      try {
        const res = await invoke<{ width: number; height: number }>('system_get_screen_resolution')
        if (res && res.width >= 640 && res.height >= 480) {
          return { width: Math.round(res.width), height: Math.round(res.height) }
        }
      } catch {}
      const dpr = window.devicePixelRatio || 1
      return {
        width: Math.round(window.screen.width * dpr),
        height: Math.round(window.screen.height * dpr)
      }
    }
  },

  dialog: {
    selectPath: async (kind: 'file' | 'directory'): Promise<PathSelection> => {
      try {
        const path = await invoke<string | null>('dialog_select_path', { kind })
        return { kind, path }
      } catch {
        return { kind, path: null }
      }
    }
  },

  services: {
    server: {
      getStatus: async (): Promise<ServerStatus> => {
        return await invoke<ServerStatus>('server_get_status')
      },
      getOnlinePlayers: async (): Promise<number> => {
        const s = await invoke<ServerStatus>('server_get_status')
        return s.online ? s.players : 0
      }
    },

    auth: {
      login: async (input: LoginInput): Promise<AuthResult> => {
        try {
          const profile = await invoke<UserProfile>('auth_login', {
            username: input.username,
            password: input.password,
            remember: input.remember
          })
          activeSessionUsername = profile.username
          return { success: true, profile, demo: false }
        } catch (err) {
          return {
            success: false,
            code: 'AUTH_INVALID',
            message: extractErrorMessage(err, 'Неверный логин или пароль'),
            demo: false
          }
        }
      },
      register: async (input: RegisterInput): Promise<AuthResult> => {
        try {
          const profile = await invoke<UserProfile>('auth_register', {
            username: input.username,
            password: input.password,
            email: input.email
          })
          activeSessionUsername = profile.username
          return { success: true, profile, demo: false }
        } catch (err) {
          return {
            success: false,
            code: 'AUTH_REGISTER_FAILED',
            message: extractErrorMessage(err, 'Ошибка регистрации'),
            demo: false
          }
        }
      },
      getProfile: async (): Promise<UserProfile | null> => {
        const profile = await invoke<UserProfile | null>('auth_get_current_profile')
        if (profile) {
          activeSessionUsername = profile.username
          return profile
        }
        activeSessionUsername = null
        localStorage.removeItem('heart_username')
        return null
      },
      syncProfile: async (): Promise<UserProfile | null> => {
        const profile = await invoke<UserProfile>('auth_sync_profile')
        if (profile) {
          activeSessionUsername = profile.username
        }
        return profile
      },
      logout: async (): Promise<void> => {
        activeSessionUsername = null
        localStorage.removeItem('heart_username')
        await invoke('auth_logout')
      },
      updateProfile: async (input: UpdateProfileInput): Promise<UserProfile> => {
        const currentUsername = activeSessionUsername ?? (await invoke<UserProfile | null>('auth_get_current_profile'))?.username
        if (!currentUsername) {
          throw new Error('Нет активной сессии.')
        }
        const profile = await invoke<UserProfile>('auth_update_profile', {
          currentUsername,
          username: input.username ?? null,
          email: input.email ?? null
        })
        activeSessionUsername = profile.username
        return profile
      },
      linkMicrosoft: async (): Promise<MinecraftLinkStatus> => ({
        state: 'unavailable',
        profile: null,
        reason: 'Microsoft OAuth отключен'
      }),
      unlinkMicrosoft: async (): Promise<void> => {},
      getMinecraftLinkStatus: async (): Promise<MinecraftLinkStatus> => {
        const profile = await tauriBridge.services.auth.getProfile()
        if (profile?.minecraft) return { state: 'linked', profile: profile.minecraft }
        return { state: 'not-linked', profile: null }
      },
      requestPasswordReset: async (): Promise<void> => {},
      getSavedAccounts: async (): Promise<UserProfile[]> => {
        return await invoke<UserProfile[]>('auth_get_saved_accounts')
      },
      removeSavedAccount: async (id: string): Promise<void> => {
        await invoke('auth_remove_account', { id })
      },
      saveSkin: async (
        username: string,
        skinDataUrl: string,
        _type: 'skin' | 'cape',
        variant?: 'classic' | 'slim'
      ): Promise<UserProfile> => {
        return await invoke<UserProfile>('auth_save_skin', {
          username,
          skinDataUrl,
          variant: variant ?? 'classic'
        })
      },
      removeSkin: async (username: string): Promise<UserProfile> => {
        return await invoke<UserProfile>('auth_remove_skin', { username })
      }
    },

    settings: {
      getSettings: async (): Promise<LauncherSettings> => {
        return await invoke<LauncherSettings>('settings_get')
      },
      updateSettings: async (settings: Partial<LauncherSettings>): Promise<LauncherSettings> => {
        const current = await invoke<LauncherSettings>('settings_get')
        return await invoke<LauncherSettings>('settings_update', { settings: { ...current, ...settings } })
      },
      resetSettings: async (): Promise<void> => {}
    },

    launcher: {
      getStatus: async (): Promise<LauncherStatus> => currentLauncherStatus,
      getInstallationInfo: async (): Promise<InstallationInfo> => {
        return await invoke<InstallationInfo>('modpack_get_info')
      },
      install: async (): Promise<void> => {
        updateStatus({ state: 'downloading', error: null })
        try {
          await invoke('launcher_install')
          updateStatus({ state: 'ready', progress: null, error: null })
        } catch (err) {
          const wrapped = toError(err, 'Ошибка установки')
          updateStatus({ state: 'error', progress: null, error: wrapped.message })
          throw wrapped
        }
      },
      update: async (): Promise<void> => {
        updateStatus({ state: 'downloading', error: null })
        try {
          await invoke('launcher_update')
          updateStatus({ state: 'ready', progress: null, error: null })
        } catch (err) {
          const wrapped = toError(err, 'Ошибка обновления')
          updateStatus({ state: 'error', progress: null, error: wrapped.message })
          throw wrapped
        }
      },
      verifyFiles: async (): Promise<void> => {
        updateStatus({ state: 'verifying', error: null })
        try {
          await invoke('launcher_verify')
          updateStatus({ state: 'ready', progress: null, error: null })
        } catch (err) {
          const wrapped = toError(err, 'Ошибка проверки файлов')
          updateStatus({ state: 'error', progress: null, error: wrapped.message })
          throw wrapped
        }
      },
      launch: async (): Promise<void> => {
        updateStatus({
          state: 'launching',
          progress: {
            operationId: 'launch',
            operation: 'install',
            stage: 'prepare',
            progress: 100,
            downloadedBytes: 0,
            totalBytes: 0,
            currentFile: 'Подготовка к запуску...',
            downloadSpeed: 0,
            timestamp: Date.now()
          },
          error: null
        })

        let username = activeSessionUsername
        if (!username) {
          const current = await tauriBridge.services.auth.getProfile()
          username = current?.username ?? null
        }

        try {
          await invoke('launcher_launch', { username })
        } catch (err) {
          const wrapped = toError(err, 'Ошибка запуска процесса игры')
          updateStatus({
            state: 'error',
            progress: null,
            error: wrapped.message
          })
          throw wrapped
        }
      },
      cancel: async (): Promise<void> => {
        updateStatus({ state: 'ready', progress: null, error: null })
      },
      onProgress: (callback: (event: ProgressEvent) => void): (() => void) => {
        if (!isTauriRuntime) return () => {}
        let unlisten: UnlistenFn | null = null
        void listen<number>('event:launcher:progress', (e) => {
          if (currentLauncherStatus.state === 'launching' || currentLauncherStatus.state === 'running') {
            return
          }
          callback({
            operationId: currentLauncherStatus.activeOperationId || 'install_operation',
            operation: 'install',
            stage: 'download',
            progress: e.payload,
            downloadedBytes: 0,
            totalBytes: 0,
            currentFile: 'Проверка и синхронизация файлов...',
            downloadSpeed: 0,
            timestamp: Date.now()
          })
        }).then((fn) => {
          unlisten = fn
        })
        return () => unlisten?.()
      },
      onLog: (callback: (event: GameLogEvent) => void): (() => void) => {
        if (!isTauriRuntime) return () => {}
        let unlisten: UnlistenFn | null = null
        void listen<string>('event:launcher:log', (e) => {
          callback({
            timestamp: Date.now(),
            level: 'INFO',
            source: 'game',
            message: e.payload
          })
        }).then((fn) => {
          unlisten = fn
        })
        return () => unlisten?.()
      },
      onStateChange: (callback: (state: LauncherStatus) => void): (() => void) => {
        launcherStateListeners.add(callback)
        callback({ ...currentLauncherStatus })
        return () => {
          launcherStateListeners.delete(callback)
        }
      },
      onGameProcess: (callback: (event: GameProcessEvent) => void): (() => void) => {
        gameProcessListeners.add(callback)
        return () => {
          gameProcessListeners.delete(callback)
        }
      }
    },

    news: {
      getNews: async (): Promise<NewsArticle[]> => {
        return await invoke<NewsArticle[]>('news_get')
      },
      getArticle: async (id: string): Promise<NewsArticle | null> => {
        return await invoke<NewsArticle | null>('news_get_article', { id })
      }
    },

    updater: {
      getStatus: async (): Promise<AppUpdateStatus> => {
        return await invoke<AppUpdateStatus>('updater_get_status')
      },
      checkForUpdates: async (): Promise<AppUpdateStatus> => {
        return await invoke<AppUpdateStatus>('updater_check')
      },
      downloadUpdate: async (): Promise<void> => {
        await invoke('updater_download')
      },
      installUpdate: async (): Promise<void> => {
        await invoke('updater_install')
      },
      onStateChange: (callback: (status: AppUpdateStatus) => void): (() => void) => {
        if (!isTauriRuntime) return () => {}
        let unlisten: UnlistenFn | null = null
        void listen<AppUpdateStatus>('event:updater:state', (e) => {
          callback(e.payload)
        }).then((fn) => {
          unlisten = fn
        })
        return () => unlisten?.()
      },
      onProgress: (callback: (progress: AppUpdateProgress) => void): (() => void) => {
        if (!isTauriRuntime) return () => {}
        let unlisten: UnlistenFn | null = null
        void listen<AppUpdateProgress>('event:updater:progress', (e) => {
          callback(e.payload)
        }).then((fn) => {
          unlisten = fn
        })
        return () => unlisten?.()
      }
    }
  }
}

if (typeof window !== 'undefined' && (isTauriRuntime || !window.launcher)) {
  window.launcher = tauriBridge
}