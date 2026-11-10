import type { Services } from '../shared/contracts/services'
import type { AppInfo, PathSelection, SystemMemoryInfo } from '../shared/types'

export interface LauncherBridge {
  window: {
    action(action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximized(callback: (maximized: boolean) => void): () => void
  }
  system: {
    getMemory(): Promise<SystemMemoryInfo>
    getAppInfo(): Promise<AppInfo>
    openGameFolder(): Promise<void>
    getScreenResolution(): Promise<{ width: number; height: number }>
  }
  dialog: {
    selectPath(kind: 'file' | 'directory'): Promise<PathSelection>
  }
  services: Services
}

declare global {
  interface Window {
    launcher?: LauncherBridge
  }
}