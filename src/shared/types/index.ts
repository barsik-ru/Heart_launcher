export type LauncherState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'ready'
  | 'launching'
  | 'running'
  | 'error'
  | 'cancelled'

export type OperationStage =
  | 'environment'
  | 'java'
  | 'files'
  | 'download'
  | 'sha256'
  | 'install'
  | 'prepare'
  | 'complete'

export type OperationKind = 'install' | 'update' | 'verify'
export type GameLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'not-available'
  | 'error'

export interface AppUpdateStatus {
  state: AppUpdateState
  currentVersion: string
  availableVersion: string | null
  progress: number | null
  error: string | null
  demo: boolean
}

export interface AppUpdateProgress {
  percent: number
  transferredBytes: number
  totalBytes: number
  bytesPerSecond: number
  timestamp: number
}

export interface UserProfile {
  id: string
  username: string
  email: string
  registeredAt: string
  group: string
  status: 'active' | 'pending' | 'blocked'
  minecraft: MinecraftProfile | null
  skinUrl?: string | null
  skinVariant?: 'classic' | 'slim' | null
  capeUrl?: string | null
}

export interface MinecraftProfile {
  uuid: string
  username: string
  linkedAt: string
}

export interface MinecraftJoinTicket {
  ticket: string
  expiresAt: string
  minecraftUsername: string
  minecraftUuid: string
}

export interface MinecraftTicketGrant {
  grant: string
  expiresAt: string
  minecraftUsername: string
  minecraftUuid: string
}

export type MinecraftLinkStatus =
  | { state: 'not-linked'; profile: null }
  | { state: 'linked'; profile: MinecraftProfile }
  | { state: 'pending'; profile: null }
  | { state: 'unavailable'; profile: null; reason: string }

export type NewsCategory = 'Обновления' | 'События' | 'Объявления' | 'Технические работы'

export interface NewsArticle {
  id: string
  title: string
  excerpt: string
  content: string
  category: NewsCategory
  date: string
  image: string
  pinned?: boolean
}

export interface ServerStatus {
  online: boolean
  players: number
  capacity: number
  latency: number | null
  message?: string
  address?: string
  demo: boolean
}

export interface LauncherSettings {
  ramGb: number
  javaPath: string
  gamePath: string
  width: number
  height: number
  fullscreen: boolean
  borderless?: boolean
  closeOnLaunch: boolean
  autoConnectServer?: boolean
  language: 'ru' | 'en'
  animations: boolean
  theme: 'verdant' | 'obsidian' | 'crimson' | 'ocean' | 'amethyst'
  setupComplete: boolean
}

export interface InstallationInfo {
  installedVersion: string | null
  latestVersion: string
  installed: boolean
  lastVerified: string | null
  updateSize: string
  minecraftVersion: string
  fabricLoaderVersion: string
  javaMajorVersion: number
  changes: {
    added: string[]
    updated: string[]
    removed: string[]
    configurations: string[]
  }
}

export interface ProgressEvent {
  operationId: string
  operation: OperationKind
  stage: OperationStage
  progress: number
  downloadedBytes: number
  totalBytes: number
  currentFile: string
  downloadSpeed: number
  processedBytes?: number
  cachedFiles?: number
  cachedBytes?: number
  downloadedFiles?: number
  totalFiles?: number
  timestamp: number
  error?: string
}

export interface GameLogEvent {
  timestamp: number
  level: GameLogLevel
  source: 'launcher' | 'stdout' | 'stderr' | 'game'
  message: string
}

export interface GameProcessEvent {
  type: 'started' | 'stdout' | 'stderr' | 'exited'
  timestamp: number
  pid?: number
  exitCode?: number | null
  message?: string
}

export interface LauncherStatus {
  state: LauncherState
  progress: ProgressEvent | null
  error: string | null
  activeOperationId?: string | null
}

export interface RegisterInput {
  username: string
  password: string
  email: string
  accepted: true
}

export interface LoginInput {
  username: string
  password: string
  remember: boolean
}

export interface UpdateProfileInput {
  username?: string
  email?: string
}

export type AuthResult =
  | { success: true; profile: UserProfile; demo: boolean }
  | { success: false; code: string; message: string; demo: boolean }

export interface AppInfo {
  version: string
  platform: NodeJS.Platform | string
  isPackaged: boolean
  serviceMode: 'demo' | 'backend' | 'offline'
}

export interface SystemMemoryInfo {
  totalBytes: number
  freeBytes: number
  totalGb: number
  freeGb: number
}

export interface PathSelection {
  kind: 'file' | 'directory'
  path: string | null
}