// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openProjectorWindow: (files: Array<{ id: string; name: string; type: string; data: string }>, settings: any) =>
    ipcRenderer.invoke('open-projector-window', files, settings),
  closeProjectorWindow: () =>
    ipcRenderer.invoke('close-projector-window'),
  navigateProjector: (direction: 'next' | 'previous') =>
    ipcRenderer.invoke('navigate-projector', direction),
  navigateProjectorToIndex: (index: number) =>
    ipcRenderer.invoke('navigate-projector-to-index', index),
  toggleProjectorPlayPause: () =>
    ipcRenderer.invoke('toggle-projector-play-pause'),
  updateProjectorSettings: (settings: any) =>
    ipcRenderer.invoke('update-projector-settings', settings),
  updateProjectorVolume: (volume: number) =>
    ipcRenderer.invoke('update-projector-volume', volume),
  onProjectorReady: (callback: () => void) =>
    ipcRenderer.on('projector-ready', callback),
  onProjectorNavigate: (callback: (index: number) => void) =>
    ipcRenderer.on('projector-navigate', (_event, index) => callback(index)),
  onProjectorPlayPause: (callback: (isPlaying: boolean) => void) =>
    ipcRenderer.on('projector-play-pause', (_event, isPlaying) => callback(isPlaying)),
  onProjectorClosed: (callback: () => void) =>
    ipcRenderer.on('projector-closed', callback),
  onProjectorOpened: (callback: () => void) =>
    ipcRenderer.on('projector-opened', callback),
  onProjectorSettings: (callback: (settings: any) => void) =>
    ipcRenderer.on('projector-settings', (_event, settings) => callback(settings)),
  onProjectorFilesUpdated: (callback: (files: Array<{ id: string; name: string; type: string; data: string }>) => void) =>
    ipcRenderer.on('projector-files-updated', (_event, files) => callback(files)),
  onProjectorFullscreenChanged: (callback: (isFullscreen: boolean) => void) =>
    ipcRenderer.on('projector-fullscreen-changed', (_event, isFullscreen) => callback(isFullscreen)),
  onProjectorVolume: (callback: (volume: number) => void) =>
    ipcRenderer.on('projector-volume', (_event, volume) => callback(volume)),
  onProjectorSeekVideo: (callback: (time: number) => void) =>
    ipcRenderer.on('projector-seek-video', (_event, time) => callback(time)),
  onProjectorVideoProgress: (callback: (progress: { currentTime: number; duration: number }) => void) =>
    ipcRenderer.on('projector-video-progress', (_event, progress) => callback(progress)),
  onProjectorTimerProgress: (callback: (progress: { elapsed: number; total: number }) => void) =>
    ipcRenderer.on('projector-timer-progress', (_event, progress) => callback(progress)),
  seekProjectorVideo: (time: number) =>
    ipcRenderer.invoke('seek-projector-video', time),
  getProjectorFiles: () =>
    ipcRenderer.invoke('get-projector-files'),
  getProjectorSettings: () =>
    ipcRenderer.invoke('get-projector-settings'),
  updateProjectorFiles: (files: Array<{ id: string; name: string; type: string; data: string }>) =>
    ipcRenderer.invoke('update-projector-files', files),
  toggleProjectorFullscreen: () =>
    ipcRenderer.invoke('toggle-projector-fullscreen'),
  isProjectorFullscreen: () =>
    ipcRenderer.invoke('is-projector-fullscreen'),
  notifyProjectorIndexChange: (index: number) =>
    ipcRenderer.invoke('notify-projector-index-change', index),
  sendVideoProgress: (progress: { currentTime: number; duration: number }) =>
    ipcRenderer.invoke('send-video-progress', progress),
  sendTimerProgress: (progress: { elapsed: number; total: number }) =>
    ipcRenderer.invoke('send-timer-progress', progress),
  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
  // Window controls
  windowMinimize: () =>
    ipcRenderer.invoke('window-minimize'),
  windowMaximize: () =>
    ipcRenderer.invoke('window-maximize'),
  windowClose: () =>
    ipcRenderer.invoke('window-close'),
  windowIsMaximized: () =>
    ipcRenderer.invoke('window-is-maximized'),
  // Startup settings
  updateStartupSettings: (settings: { bootOnStartup: boolean; bootInProjectorMode: boolean }) =>
    ipcRenderer.invoke('update-startup-settings', settings),
  getStartupSettings: () =>
    ipcRenderer.invoke('get-startup-settings'),
  // Exit behavior settings
  updateExitBehaviorSettings: (settings: { showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' }) =>
    ipcRenderer.invoke('update-exit-behavior-settings', settings),
  getExitBehaviorSettings: () =>
    ipcRenderer.invoke('get-exit-behavior-settings'),
  onSaveExitBehavior: (callback: (settings: { showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' }) => void) =>
    ipcRenderer.on('save-exit-behavior', (_event, settings) => callback(settings)),
  // Tray events
  onTrayOpenProjector: (callback: () => void) =>
    ipcRenderer.on('tray-open-projector', callback),
  onTrayOpenProjectorRequest: (callback: () => void) =>
    ipcRenderer.on('tray-open-projector-request', callback),
  onBootInProjectorMode: (callback: () => void) =>
    ipcRenderer.on('boot-in-projector-mode', callback),
  trayOpenProjectorRequest: () =>
    ipcRenderer.send('tray-open-projector-request'),
  // Settings persistence
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  onLoadPersistentSettings: (callback: (settings: any) => void) =>
    ipcRenderer.on('load-persistent-settings', (_event, settings) => callback(settings)),
  // Files persistence
  saveFiles: (files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>, fileOrder: string[]) =>
    ipcRenderer.invoke('save-files', files, fileOrder),
  saveSingleFile: (fileData: { id: string; name: string; type: string; data: string }) =>
    ipcRenderer.invoke('save-single-file', fileData),
  deleteFile: (fileId: string, fileType: string) =>
    ipcRenderer.invoke('delete-file', fileId, fileType),
  loadFiles: () => ipcRenderer.invoke('load-files'),
  // Thumbnails
  saveThumbnail: (fileId: string, thumbnailData: string) =>
    ipcRenderer.invoke('save-thumbnail', fileId, thumbnailData),
  loadThumbnail: (fileId: string) =>
    ipcRenderer.invoke('load-thumbnail', fileId),
  onLoadPersistentFiles: (callback: (data: { files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>; fileOrder: string[] }) => void) =>
    ipcRenderer.on('load-persistent-files', (_event, data) => callback(data)),
  notifyFilesLoaded: () =>
    ipcRenderer.invoke('notify-files-loaded'),
  // Export/Import project
  exportProject: (projectData: {
    settings: any;
    files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>;
    fileOrder: string[];
  }) => ipcRenderer.invoke('export-project', projectData),
  importProject: () => ipcRenderer.invoke('import-project'),
});
