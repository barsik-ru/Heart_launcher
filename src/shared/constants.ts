export const DEMO_ACCOUNT = {
  username: 'verdant',
  password: 'VerdantDemo26!'
} as const

export const IPC_CHANNELS = {
  windowAction: 'window:action',
  windowIsMaximized: 'window:isMaximized',
  windowMaximized: 'window:maximized',
  systemGetMemory: 'system:getMemory',
  appGetInfo: 'app:getInfo',
  dialogSelectPath: 'dialog:selectPath',

  authRegister: 'service:auth:register',
  authLogin: 'service:auth:login',
  authLogout: 'service:auth:logout',
  authGetProfile: 'service:auth:getProfile',
  authUpdateProfile: 'service:auth:updateProfile',
  authLinkMicrosoft: 'service:auth:linkMicrosoft',
  authUnlinkMicrosoft: 'service:auth:unlinkMicrosoft',
  authGetMinecraftLinkStatus: 'service:auth:getMinecraftLinkStatus',
  authPasswordReset: 'service:auth:passwordReset',

  newsGet: 'service:news:get',
  newsGetArticle: 'service:news:getArticle',
  serverGetStatus: 'service:server:getStatus',
  serverGetOnlinePlayers: 'service:server:getOnlinePlayers',

  settingsGet: 'service:settings:get',
  settingsUpdate: 'service:settings:update',
  settingsReset: 'service:settings:reset',

  launcherGetStatus: 'service:launcher:getStatus',
  launcherGetInstallationInfo: 'service:launcher:getInstallationInfo',
  launcherInstall: 'service:launcher:install',
  launcherUpdate: 'service:launcher:update',
  launcherVerify: 'service:launcher:verify',
  launcherLaunch: 'service:launcher:launch',
  launcherCancel: 'service:launcher:cancel',
  launcherProgress: 'event:launcher:progress',
  launcherLog: 'event:launcher:log',
  launcherState: 'event:launcher:state',
  launcherProcess: 'event:launcher:process',

  updaterGetStatus: 'service:updater:getStatus',
  updaterCheck: 'service:updater:check',
  updaterDownload: 'service:updater:download',
  updaterInstall: 'service:updater:install',
  updaterState: 'event:updater:state',
  updaterProgress: 'event:updater:progress'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]
