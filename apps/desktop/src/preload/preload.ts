import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc/channels'

const ALLOWED_INVOKE = Object.entries(IPC_CHANNELS)
  .filter(([, v]) => v.type === 'invoke')
  .map(([k]) => k)

const ALLOWED_ON = Object.entries(IPC_CHANNELS)
  .filter(([, v]) => v.type === 'on')
  .map(([k]) => k)

const api = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!ALLOWED_INVOKE.includes(channel)) return Promise.reject(new Error(`blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!ALLOWED_ON.includes(channel)) return () => {}
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      callback(...args)
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('sovara', api)

declare global {
  interface Window {
    sovara: typeof api
  }
}
