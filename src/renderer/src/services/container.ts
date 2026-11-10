import type { Services } from '@shared/contracts/services'
import { unavailableServices } from './unavailable-services'

const mainBridgeServices = typeof window !== 'undefined' ? window.launcher?.services : undefined

/** Electron always talks to Main through the narrow Preload bridge. The browser-only fallback is unavailable, never a second mock implementation. */
export const isMockMode = Boolean(
  mainBridgeServices && import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true'
)
export const isLauncherAvailable = Boolean(mainBridgeServices?.launcher)

export const services: Services = mainBridgeServices ?? unavailableServices
