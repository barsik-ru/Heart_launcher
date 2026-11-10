import { contextBridge, ipcRenderer } from 'electron'
import type { LauncherBridge } from './types'
import { IPC_CHANNELS } from '../shared/constants'
import type { IpcEventChannel, IpcEventPayloads } from '../shared/contracts/ipc'

function subscribe<Channel extends IpcEventChannel>(
  channel: Channel, callback: (payload: IpcEventPayloads[Channel]) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: IpcEventPayloads[Channel]): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const services: LauncherBridge['services'] = {
  auth: {
    register: input => ipcRenderer.invoke(IPC_CHANNELS.authRegister, input),
    login: input => ipcRenderer.invoke(IPC_CHANNELS.authLogin, input),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.authLogout),
    getProfile: () => ipcRenderer.invoke(IPC_CHANNELS.authGetProfile),
    updateProfile: input => ipcRenderer.invoke(IPC_CHANNELS.authUpdateProfile, input),
    linkMicrosoft: () => ipcRenderer.invoke(IPC_CHANNELS.authLinkMicrosoft),
    unlinkMicrosoft: () => ipcRenderer.invoke(IPC_CHANNELS.authUnlinkMicrosoft),
    getMinecraftLinkStatus: () => ipcRenderer.invoke(IPC_CHANNELS.authGetMinecraftLinkStatus),
    requestPasswordReset: email => ipcRenderer.invoke(IPC_CHANNELS.authPasswordReset, email),
    getSavedAccounts: () => ipcRenderer.invoke('service:auth:getSavedAccounts'),
    removeSavedAccount: (id: string) => ipcRenderer.invoke('service:auth:removeSavedAccount', id),
    saveSkin: (username: string, skinDataUrl: string, type: 'skin' | 'cape', variant?: 'classic' | 'slim') =>
      ipcRenderer.invoke('service:auth:saveSkin', { username, skinDataUrl, type, variant }),
    removeSkin: (username: string, type: 'skin' | 'cape') =>
      ipcRenderer.invoke('service:auth:removeSkin', { username, type })
  },
  news: {
    getNews: () => ipcRenderer.invoke(IPC_CHANNELS.newsGet),
    getArticle: id => ipcRenderer.invoke(IPC_CHANNELS.newsGetArticle, id)
  },
  server: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.serverGetStatus),
    getOnlinePlayers: () => ipcRenderer.invoke(IPC_CHANNELS.serverGetOnlinePlayers)
  },
  settings: {
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    updateSettings: settings => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, settings),
    resetSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsReset)
  },
  launcher: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.launcherGetStatus),
    getInstallationInfo: () => ipcRenderer.invoke(IPC_CHANNELS.launcherGetInstallationInfo),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.launcherInstall),
    update: () => ipcRenderer.invoke(IPC_CHANNELS.launcherUpdate),
    verifyFiles: () => ipcRenderer.invoke(IPC_CHANNELS.launcherVerify),
    launch: () => ipcRenderer.invoke(IPC_CHANNELS.launcherLaunch),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.launcherCancel),
    onProgress: callback => subscribe(IPC_CHANNELS.launcherProgress, callback),
    onLog: callback => subscribe(IPC_CHANNELS.launcherLog, callback),
    onStateChange: callback => subscribe(IPC_CHANNELS.launcherState, callback),
    onGameProcess: callback => subscribe(IPC_CHANNELS.launcherProcess, callback)
  },
  updater: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updaterGetStatus),
    checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updaterCheck),
    downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updaterDownload),
    installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updaterInstall),
    onStateChange: callback => subscribe(IPC_CHANNELS.updaterState, callback),
    onProgress: callback => subscribe(IPC_CHANNELS.updaterProgress, callback)
  }
}

const bridge: LauncherBridge = {
  window: {
    action: action => ipcRenderer.invoke(IPC_CHANNELS.windowAction, action),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized),
    onMaximized: callback => subscribe(IPC_CHANNELS.windowMaximized, callback)
  },
  system: {
    getMemory: () => ipcRenderer.invoke(IPC_CHANNELS.systemGetMemory),
    getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
    openGameFolder: () => ipcRenderer.invoke('system:openGameFolder'),
    getScreenResolution: () => ipcRenderer.invoke('system:getScreenResolution')
  },
  dialog: {
    selectPath: kind => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectPath, { kind })
  },
  services
}

contextBridge.exposeInMainWorld('launcher', bridge)