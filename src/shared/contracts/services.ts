import type {
  AppUpdateProgress,
  AppUpdateStatus,
  AuthResult,
  DonateCatalog,
  DonateCreateOrderInput,
  DonateCreateOrderResponse,
  DonateMarkPaidInput,
  DonateOrder,
  GameLogEvent,
  GameProcessEvent,
  InstallationInfo,
  LauncherSettings,
  LauncherStatus,
  LoginInput,
  MinecraftLinkStatus,
  MinecraftJoinTicket,
  MinecraftTicketGrant,
  NewsArticle,
  ProgressEvent,
  RegisterInput,
  ServerStatus,
  UpdateProfileInput,
  UserProfile
} from '../types'

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>
  login(input: LoginInput): Promise<AuthResult>
  logout(): Promise<void>
  getProfile(): Promise<UserProfile | null>
  syncProfile?(): Promise<UserProfile | null>
  updateProfile(input: UpdateProfileInput): Promise<UserProfile>
  linkMicrosoft(): Promise<MinecraftLinkStatus>
  unlinkMicrosoft(): Promise<void>
  getMinecraftLinkStatus(): Promise<MinecraftLinkStatus>
  createMinecraftJoinTicket?(): Promise<MinecraftJoinTicket>
  createMinecraftTicketGrant?(): Promise<MinecraftTicketGrant>
  requestPasswordReset(email: string): Promise<void>
  getSavedAccounts?(): Promise<UserProfile[]>
  removeSavedAccount?(id: string): Promise<void>
  saveSkin?(username: string, skinDataUrl: string, type: 'skin' | 'cape', variant?: 'classic' | 'slim'): Promise<UserProfile>
  removeSkin?(username: string, type: 'skin' | 'cape'): Promise<UserProfile>
}

export interface NewsService {
  getNews(): Promise<NewsArticle[]>
  getArticle(id: string): Promise<NewsArticle | null>
}

export interface ServerService {
  getStatus(): Promise<ServerStatus>
  getOnlinePlayers(): Promise<number>
}

export interface SettingsService {
  getSettings(): Promise<LauncherSettings>
  updateSettings(settings: Partial<LauncherSettings>): Promise<LauncherSettings>
  resetSettings(): Promise<void>
}

export interface LauncherService {
  getStatus(): Promise<LauncherStatus>
  getInstallationInfo(): Promise<InstallationInfo>
  install(): Promise<void>
  update(): Promise<void>
  verifyFiles(): Promise<void>
  launch(): Promise<void>
  cancel(): Promise<void>
  onProgress(callback: (event: ProgressEvent) => void): () => void
  onLog(callback: (event: GameLogEvent) => void): () => void
  onStateChange(callback: (state: LauncherStatus) => void): () => void
  onGameProcess(callback: (event: GameProcessEvent) => void): () => void
}

export interface UpdaterService {
  getStatus(): Promise<AppUpdateStatus>
  checkForUpdates(): Promise<AppUpdateStatus>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onStateChange(callback: (status: AppUpdateStatus) => void): () => void
  onProgress(callback: (progress: AppUpdateProgress) => void): () => void
}

export interface DonateService {
  getCatalog(): Promise<DonateCatalog>
  getOrders(): Promise<DonateOrder[]>
  createOrder(input: DonateCreateOrderInput): Promise<DonateCreateOrderResponse>
  markPaid(input: DonateMarkPaidInput): Promise<DonateOrder>
  getOrderStatus(orderId: string): Promise<DonateOrder>
}

export interface Services {
  auth: AuthService
  news: NewsService
  server: ServerService
  settings: SettingsService
  launcher: LauncherService
  updater: UpdaterService
  donate?: DonateService
}