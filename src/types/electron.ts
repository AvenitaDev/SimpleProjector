import { ProjectorSettings } from './settings';

export interface ElectronAPI {
    // Projector window controls
    openProjectorWindow: (
        files: Array<{ id: string; name: string; type: string; data: string }>,
        settings: ProjectorSettings
    ) => Promise<{ success: boolean }>;
    closeProjectorWindow: () => Promise<{ success: boolean }>;

    // Projector navigation
    navigateProjector: (direction: 'next' | 'previous') => Promise<{ success: boolean }>;
    navigateProjectorToIndex: (index: number) => Promise<{ success: boolean }>;

    // Projector playback controls
    toggleProjectorPlayPause: () => Promise<{ success: boolean; isPlaying?: boolean }>;
    seekProjectorVideo: (time: number) => Promise<{ success: boolean }>;
    updateProjectorVolume: (volume: number) => Promise<{ success: boolean }>;

    // Projector settings
    updateProjectorSettings: (settings: ProjectorSettings) => Promise<{ success: boolean }>;
    getProjectorSettings: () => Promise<ProjectorSettings>;
    updateProjectorFiles: (files: Array<{ id: string; name: string; type: string; data: string }>) => Promise<{ success: boolean }>;
    getProjectorFiles: () => Promise<{ files: Array<{ id: string; name: string; type: string; data: string }>; currentIndex: number }>;

    // Projector events
    onProjectorReady: (callback: () => void) => void;
    onProjectorNavigate: (callback: (index: number) => void) => void;
    onProjectorPlayPause: (callback: (isPlaying: boolean) => void) => void;
    onProjectorClosed: (callback: () => void) => void;
    onProjectorOpened: (callback: () => void) => void;
    onProjectorSettings: (callback: (settings: ProjectorSettings) => void) => void;
    onProjectorFilesUpdated: (callback: (files: Array<{ id: string; name: string; type: string; data: string }>) => void) => void;
    onProjectorFullscreenChanged: (callback: (isFullscreen: boolean) => void) => void;
    onProjectorVolume: (callback: (volume: number) => void) => void;
    onProjectorSeekVideo: (callback: (time: number) => void) => void;
    onProjectorVideoProgress: (callback: (progress: { currentTime: number; duration: number }) => void) => void;
    onProjectorTimerProgress: (callback: (progress: { elapsed: number; total: number }) => void) => void;

    // Projector fullscreen
    toggleProjectorFullscreen: () => Promise<{ success: boolean; isFullscreen?: boolean }>;
    isProjectorFullscreen: () => Promise<boolean>;
    notifyProjectorIndexChange: (index: number) => Promise<{ success: boolean }>;
    sendVideoProgress: (progress: { currentTime: number; duration: number }) => Promise<{ success: boolean }>;
    sendTimerProgress: (progress: { elapsed: number; total: number }) => Promise<{ success: boolean }>;

    // Window controls
    windowMinimize: () => Promise<{ success: boolean }>;
    windowMaximize: () => Promise<{ success: boolean }>;
    windowClose: () => Promise<{ success: boolean }>;
    windowIsMaximized: () => Promise<boolean>;

    // Startup settings
    updateStartupSettings: (settings: { bootOnStartup: boolean; bootInProjectorMode: boolean }) => Promise<{ success: boolean }>;
    getStartupSettings: () => Promise<{ bootOnStartup: boolean; bootInProjectorMode: boolean }>;

    // Exit behavior settings
    updateExitBehaviorSettings: (settings: { showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' }) => Promise<{ success: boolean }>;
    getExitBehaviorSettings: () => Promise<{ showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' }>;
    onSaveExitBehavior: (callback: (settings: { showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' }) => void) => void;

    // Tray events
    onTrayOpenProjector: (callback: () => void) => void;
    onTrayOpenProjectorRequest: (callback: () => void) => void;
    onBootInProjectorMode: (callback: () => void) => void;
    trayOpenProjectorRequest: () => void;

    // Settings persistence
    loadSettings: () => Promise<ProjectorSettings | null>;
    saveSettings: (settings: ProjectorSettings) => Promise<{ success: boolean; error?: string }>;
    onLoadPersistentSettings: (callback: (settings: ProjectorSettings) => void) => void;

    // Files persistence
    saveFiles: (
        files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>,
        fileOrder: string[]
    ) => Promise<{ success: boolean; error?: string }>;
    saveSingleFile: (fileData: { id: string; name: string; type: string; data: string }) => Promise<{ success: boolean; error?: string }>;
    deleteFile: (fileId: string, fileType: string) => Promise<{ success: boolean; error?: string }>;
    loadFiles: () => Promise<{
        success: boolean;
        files?: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>;
        fileOrder?: string[];
        error?: string;
    }>;
    onLoadPersistentFiles: (
        callback: (data: {
            files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>;
            fileOrder: string[];
        }) => void
    ) => void;
    notifyFilesLoaded: () => Promise<{ success: boolean }>;

    // Thumbnails
    saveThumbnail: (fileId: string, thumbnailData: string) => Promise<{ success: boolean; error?: string }>;
    loadThumbnail: (fileId: string) => Promise<{ success: boolean; exists: boolean; data?: string; error?: string }>;

    // Export/Import project
    exportProject: (projectData: {
        settings: any;
        files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>;
        fileOrder: string[];
    }) => Promise<{ success: boolean; canceled?: boolean; error?: string; zipPath?: string }>;
    importProject: () => Promise<{
        success: boolean;
        canceled?: boolean;
        error?: string;
        project?: {
            settings: ProjectorSettings;
            fileOrder: string[];
            files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>;
        };
    }>;

    // Utility
    removeAllListeners: (channel: string) => void;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

