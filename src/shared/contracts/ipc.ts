import { IPC_CHANNELS } from '../constants'
import type {
  AppUpdateProgress,
  AppUpdateStatus,
  GameLogEvent,
  GameProcessEvent,
  LauncherStatus,
  ProgressEvent
} from '../types'

/** Event names and their payloads are a single compile-time contract shared by Main and Preload. */
export interface IpcEventPayloads {
  [IPC_CHANNELS.windowMaximized]: boolean
  [IPC_CHANNELS.launcherProgress]: ProgressEvent
  [IPC_CHANNELS.launcherLog]: GameLogEvent
  [IPC_CHANNELS.launcherState]: LauncherStatus
  [IPC_CHANNELS.launcherProcess]: GameProcessEvent
  [IPC_CHANNELS.updaterState]: AppUpdateStatus
  [IPC_CHANNELS.updaterProgress]: AppUpdateProgress
}

export type IpcEventChannel = keyof IpcEventPayloads
export type IpcInvokeChannel = Exclude<typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS], IpcEventChannel>
