import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AsusApi } from '@shared/api'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AsusApi = {
  snapshot: () => ipcRenderer.invoke('asus:snapshot'),
  refresh: () => ipcRenderer.invoke('asus:refresh'),
  action: (a) => ipcRenderer.invoke('asus:action', a),
  displayState: () => ipcRenderer.invoke('display:state'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  info: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('app:open', url),
  onState: (cb) => subscribe('asus:state', cb),
  onSensors: (cb) => subscribe('sensors', cb),
  onToast: (cb) => subscribe('toast', cb)
}

contextBridge.exposeInMainWorld('asus', api)
