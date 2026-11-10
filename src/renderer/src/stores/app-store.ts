import { create } from 'zustand'
import type { UserProfile, LauncherStatus, LauncherSettings } from '@shared/types'

interface AppState {
  profile: UserProfile | null
  setProfile: (profile: UserProfile | null) => void
  launcher: LauncherStatus
  setLauncher: (launcher: LauncherStatus) => void
  settings: LauncherSettings | null
  setSettings: (settings: LauncherSettings) => void
  settingsDirty: boolean
  setSettingsDirty: (dirty: boolean) => void
}

export const useAppStore = create<AppState>(set => ({
  profile: null,
  setProfile: profile => set({ profile }),
  launcher: { state: 'idle', progress: null, error: null, activeOperationId: null },
  setLauncher: launcher => set({ launcher }),
  settings: null,
  setSettings: settings => set({ settings }),
  settingsDirty: false,
  setSettingsDirty: settingsDirty => set({ settingsDirty })
}))
