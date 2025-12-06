// @ts-ignore - Vite constants injected by Electron Forge at build time
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
// @ts-ignore
declare const MAIN_WINDOW_VITE_NAME: string;
// @ts-ignore
declare const PROJECTOR_WINDOW_VITE_NAME: string | undefined;

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, createWriteStream, readdirSync, statSync } from 'node:fs';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

if (started) app.quit();

app.setAppUserModelId("com.squirrel.SimpleProjector.SimpleProjector");

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
} else {
  app.on('second-instance', () => {
    if (isMainWindowValid()) {
      if (mainWindow!.isMinimized()) {
        mainWindow!.restore();
      }
      mainWindow!.show();
      mainWindow!.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;
let projectorFiles: Array<{ id: string; name: string; type: string; data: string }> = [];
let projectorFilesOrder: number[] = []; // Indices in display order (for random)
let currentProjectorIndex = 0;
let isProjectorPlaying = false;
let projectorSettings: any = null;
let isShowingBackground = false; // Track if we're currently showing background
let tray: Tray | null = null;
let appSettings: { bootOnStartup: boolean; bootInProjectorMode: boolean } = {
  bootOnStartup: false,
  bootInProjectorMode: false,
};
let shouldMinimizeOnClose = false;
let isFirstWindowShow = true; // Track if this is the first time showing the window
let exitBehaviorSettings: { showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' } = {
  showExitPrompt: true,
  exitBehavior: 'minimize',
};

// ==================== Utility Functions ====================

// Resource path helper
const resourcePath = !process.env.NODE_ENV || process.env.NODE_ENV === "production"
  ? process.resourcesPath // Live Mode
  : __dirname; // Dev Mode

// Path helpers
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const getFilesStoragePath = () => path.join(app.getPath('userData'), 'files-storage');

// Debug mode check - disable autostart in debug/development mode
const isDebugMode = (): boolean => {
  return !app.isPackaged || process.env.DEBUG === 'true';
};

// Linux autostart .desktop file management
const getLinuxAutostartPath = (): string => {
  const homeDir = app.getPath('home');
  return path.join(homeDir, '.config', 'autostart', 'simpleprojector.desktop');
};

const getExecutablePath = (): string => {
  if (app.isPackaged) {
    // In production, use process.execPath which points to the executable
    return process.execPath;
  } else {
    // In development, use electron executable with the app path
    return process.execPath;
  }
};

const createLinuxAutostartDesktop = async (bootInProjectorMode: boolean): Promise<void> => {
  try {
    const autostartDir = path.dirname(getLinuxAutostartPath());
    await fs.mkdir(autostartDir, { recursive: true });

    const execPath = getExecutablePath();
    // Escape the executable path if it contains spaces
    const escapedExecPath = execPath.includes(' ') ? `"${execPath}"` : execPath;
    const execArgs = bootInProjectorMode ? ' --projector-mode' : '';

    // Find icon path
    const iconPaths = [
      path.join(resourcePath, 'assets/icon.png'),
      path.join(app.getAppPath(), 'src/assets/icon.png'),
    ];
    let iconPath = '';
    for (const iconPathCandidate of iconPaths) {
      if (existsSync(iconPathCandidate)) {
        iconPath = iconPathCandidate;
        break;
      }
    }

    const desktopContent = `[Desktop Entry]
Type=Application
Name=SimpleProjector
Comment=SimpleProjector - Projector Application
Exec=${escapedExecPath}${execArgs}
Icon=${iconPath || 'application-default-icon'}
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
`;

    await fs.writeFile(getLinuxAutostartPath(), desktopContent, 'utf-8');
    console.log('Created Linux autostart .desktop file at:', getLinuxAutostartPath());
  } catch (error) {
    console.error('Error creating Linux autostart .desktop file:', error);
    throw error;
  }
};

const removeLinuxAutostartDesktop = async (): Promise<void> => {
  try {
    const autostartPath = getLinuxAutostartPath();
    if (existsSync(autostartPath)) {
      await fs.unlink(autostartPath);
      console.log('Removed Linux autostart .desktop file');
    }
  } catch (error) {
    console.error('Error removing Linux autostart .desktop file:', error);
    throw error;
  }
};

const updateLinuxAutostart = async (bootOnStartup: boolean, bootInProjectorMode: boolean): Promise<void> => {
  if (process.platform !== 'linux') {
    return;
  }

  // Disable autostart in debug mode
  if (isDebugMode()) {
    console.log('Autostart disabled in debug mode');
    // Remove any existing autostart file if in debug mode
    try {
      await removeLinuxAutostartDesktop();
    } catch (error) {
      // Ignore errors when removing in debug mode
    }
    return;
  }

  try {
    if (bootOnStartup) {
      await createLinuxAutostartDesktop(bootInProjectorMode);
    } else {
      await removeLinuxAutostartDesktop();
    }
  } catch (error) {
    console.error('Error updating Linux autostart:', error);
    throw error;
  }
};

// Window existence helpers
const isMainWindowValid = (): boolean => mainWindow !== null && !mainWindow.isDestroyed();
const isProjectorWindowValid = (): boolean => projectorWindow !== null && !projectorWindow.isDestroyed();

// File type utilities
const getFileExtension = (fileType: string): string => {
  if (fileType === 'image') return '.png';
  if (fileType === 'video') return '.mp4';
  return '.pdf';
};

const getMimeType = (fileType: string, fileName?: string): string => {
  if (fileType === 'video') return 'video/mp4';
  if (fileType === 'document') return 'application/pdf';
  if (fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
  }
  return 'image/png';
};

// Base64 conversion helper
const extractBase64Data = (dataUrl: string): string => dataUrl.split(',')[1] || dataUrl;

// Icon loading helper
const loadIconFromPaths = (possiblePaths: string[]): Electron.NativeImage | undefined => {
  for (const iconPath of possiblePaths) {
    try {
      if (existsSync(iconPath)) {
        const loadedIcon = nativeImage.createFromPath(iconPath);
        if (!loadedIcon.isEmpty()) {
          console.log('Successfully loaded icon from:', iconPath);
          return loadedIcon;
        }
        console.warn('Icon file is empty or not supported:', iconPath);
      }
    } catch (error) {
      console.warn(`Failed to load icon from ${iconPath}:`, error);
    }
  }
  return undefined;
};

// Notification helpers
const notifyProjectorWindow = (channel: string, ...args: any[]): void => {
  if (isProjectorWindowValid()) {
    projectorWindow!.webContents.send(channel, ...args);
  }
};

const notifyMainWindow = (channel: string, ...args: any[]): void => {
  if (isMainWindowValid()) {
    mainWindow!.webContents.send(channel, ...args);
  }
};

const notifyBothWindows = (channel: string, ...args: any[]): void => {
  notifyProjectorWindow(channel, ...args);
  notifyMainWindow(channel, ...args);
};

// Settings management
const loadSettings = async (): Promise<any> => {
  try {
    const settingsPath = getSettingsPath();
    if (existsSync(settingsPath)) {
      const settingsData = await fs.readFile(settingsPath, 'utf-8');
      return JSON.parse(settingsData);
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return null;
};

const saveSettings = async (settings: any): Promise<void> => {
  try {
    const settingsPath = getSettingsPath();
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

const saveExitBehaviorToSettings = async (): Promise<void> => {
  const settings = await loadSettings() || {};
  settings.showExitPrompt = exitBehaviorSettings.showExitPrompt;
  settings.exitBehavior = exitBehaviorSettings.exitBehavior;
  await saveSettings(settings);
};

const loadExitBehaviorSettings = async (): Promise<void> => {
  const settings = await loadSettings();
  if (settings) {
    if (settings.showExitPrompt !== undefined) {
      exitBehaviorSettings.showExitPrompt = settings.showExitPrompt;
    }
    if (settings.exitBehavior !== undefined) {
      exitBehaviorSettings.exitBehavior = settings.exitBehavior;
    }
  }
};

// Window closing helper
const closeApp = (): void => {
  shouldMinimizeOnClose = true;
  if (isProjectorWindowValid()) {
    projectorWindow!.close();
  }
  setImmediate(() => {
    if (isMainWindowValid()) {
      mainWindow!.destroy();
    }
    app.quit();
  });
};

const createWindow = () => {
  const possiblePaths = [
    path.join(resourcePath, 'assets/icon.png'),
    path.join(resourcePath, 'assets/icon_taskbar.png'),
    path.join(app.getAppPath(), 'src/assets/icon.png'),
  ];

  const icon = loadIconFromPaths(possiblePaths) || nativeImage.createEmpty();

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'SimpleProjector',
    icon: icon, // Use the loaded icon instead of hardcoded path
    frame: false,
    resizable: false,
    transparent: true, // Enable transparency for rounded corners
    backgroundColor: '#00000000', // Fully transparent background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // On Linux, explicitly set the icon after window is ready for better compatibility
  // This ensures the icon appears correctly in taskbars (especially Wayland)
  if (process.platform === 'linux' && icon && !icon.isEmpty()) {
    // Also set the app name for better Linux integration
    app.setName('SimpleProjector');
  }

  // Handle window ready-to-show: set Linux icon and check boot window state
  mainWindow.once('ready-to-show', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // On Linux, set icon after window is shown - this helps with Wayland compositors
      if (process.platform === 'linux' && icon && !icon.isEmpty()) {
        // Linux taskbars typically use 48x64 or 64x64 icons
        // Resize to 64x64 for better visibility
        const taskbarIcon = icon.resize({ width: 64, height: 64 });
        mainWindow.setIcon(taskbarIcon);
        console.log('Set Linux taskbar icon (64x64)');
      }

      // Handle boot window state (hide to tray on first launch if setting is enabled)
      if (isFirstWindowShow) {
        try {
          const settings = await loadSettings();
          if (settings && settings.bootWindowState === 'minimized') {
            // Hide window to tray instead of minimizing to taskbar
            mainWindow.hide();
          }
        } catch (error) {
          console.error('Error loading boot window state setting:', error);
        }
        isFirstWindowShow = false;
      }
    }
  });

  // Open the DevTools (even in production for debugging)
  if (!app.isPackaged || process.env.DEBUG === 'true') {
    mainWindow.webContents.openDevTools();
  }

  // Handle window close with confirmation
  mainWindow.on('close', async (event) => {
    if (shouldMinimizeOnClose) {
      shouldMinimizeOnClose = false;
      if (isProjectorWindowValid()) {
        projectorWindow!.close();
      }
      return;
    }

    event.preventDefault();
    const isProjectorActive = isProjectorWindowValid();
    await loadExitBehaviorSettings();
    const shouldShowPrompt = isProjectorActive || exitBehaviorSettings.showExitPrompt;

    if (!shouldShowPrompt) {
      if (exitBehaviorSettings.exitBehavior === 'minimize') {
        if (isMainWindowValid()) {
          mainWindow!.hide();
        }
      } else {
        closeApp();
      }
      return;
    }

    const choice = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Minimize to Tray', 'Close Completely', 'Cancel'],
      defaultId: exitBehaviorSettings.exitBehavior === 'minimize' ? 0 : 1,
      cancelId: 2,
      title: 'Exit SimpleProjector?',
      message: 'What would you like to do?',
      detail: 'Choose "Minimize to Tray" to keep the app running in the background, or "Close Completely" to exit the application.',
    });

    if (choice.response === 0) {
      if (!isProjectorActive) {
        exitBehaviorSettings.exitBehavior = 'minimize';
        exitBehaviorSettings.showExitPrompt = false;
        await saveExitBehaviorToSettings();
      }
      if (isMainWindowValid()) {
        mainWindow!.hide();
      }
    } else if (choice.response === 1) {
      if (!isProjectorActive) {
        exitBehaviorSettings.exitBehavior = 'close';
        exitBehaviorSettings.showExitPrompt = false;
        await saveExitBehaviorToSettings();
      }
      closeApp();
    }
  });
};

const createTray = () => {
  const possiblePaths = [
    path.join(resourcePath, 'assets/icon_taskbar.png'),
    path.join(app.getAppPath(), 'src/assets/icon_taskbar.png'),
  ];

  const size = process.platform === 'darwin' ? 22 : 16;
  const fallbackIconData = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const icon = (loadIconFromPaths(possiblePaths) || nativeImage.createFromBuffer(fallbackIconData))
    .resize({ width: size, height: size });

  tray = new Tray(icon);

  const showMainWindow = () => {
    if (isMainWindowValid()) {
      if (mainWindow!.isMinimized()) {
        mainWindow!.restore();
      }
      mainWindow!.show();
      mainWindow!.focus();
    }
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: showMainWindow,
    },
    {
      label: 'Open Projector',
      click: () => notifyMainWindow('tray-open-projector'),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: closeApp,
    },
  ]);

  tray.setToolTip('SimpleProjector');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (isMainWindowValid()) {
      if (mainWindow!.isVisible()) {
        mainWindow!.hide();
      } else {
        showMainWindow();
      }
    }
  });

  tray.on('double-click', showMainWindow);
};

const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const createProjectorWindow = (files: Array<{ id: string; name: string; type: string; data: string }>, settings: any) => {
  projectorFiles = files;

  // Ensure random is disabled if loop is disabled
  const validatedSettings = {
    ...settings,
    random: settings.loop ? settings.random : false,
  };

  projectorSettings = validatedSettings;
  currentProjectorIndex = 0;
  isShowingBackground = false; // Reset flag when creating/updating projector window
  // If auto-advance is enabled, start playing automatically
  isProjectorPlaying = validatedSettings.enableTimeBetweenElements || false;

  // Create order array (for random support)
  if (validatedSettings.random) {
    projectorFilesOrder = shuffleArray(files.map((_, i) => i));
  } else {
    projectorFilesOrder = files.map((_, i) => i);
  }

  if (isProjectorWindowValid()) {
    const isFullscreen = projectorWindow!.isFullScreen();
    if (validatedSettings.openFullscreen && !isFullscreen) {
      setTimeout(() => {
        if (isProjectorWindowValid()) {
          projectorWindow!.setFullScreen(true);
        }
      }, 100);
    } else if (!validatedSettings.openFullscreen && isFullscreen) {
      projectorWindow!.setFullScreen(false);
    }

    projectorWindow!.focus();
    const initialIndex = projectorFilesOrder.length > 0 ? projectorFilesOrder[0] : 0;
    notifyProjectorWindow('projector-settings', validatedSettings);
    notifyProjectorWindow('projector-navigate', initialIndex);
    if (isProjectorPlaying) {
      notifyBothWindows('projector-play-pause', true);
    }
    notifyMainWindow('projector-opened');
    notifyMainWindow('projector-navigate', initialIndex);
    return;
  }

  // Window options - use default dimensions
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1920,
    height: 1080,
    frame: false,
    fullscreen: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  };

  projectorWindow = new BrowserWindow(windowOptions);

  projectorWindow.once('ready-to-show', () => {
    if (isProjectorWindowValid()) {
      projectorWindow!.show();
      if (validatedSettings.openFullscreen) {
        setTimeout(() => {
          if (isProjectorWindowValid()) {
            projectorWindow!.setFullScreen(true);
          }
        }, 100);
      }
    }
  });

  // Enable DevTools for projector window in development
  if (!app.isPackaged || process.env.DEBUG === 'true') {
    projectorWindow.webContents.openDevTools();
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    projectorWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/projector.html`);
  } else {
    // In packaged mode, load from the built renderer directory
    const projectorWindowName = typeof PROJECTOR_WINDOW_VITE_NAME !== 'undefined' && PROJECTOR_WINDOW_VITE_NAME
      ? PROJECTOR_WINDOW_VITE_NAME
      : 'projector_window';

    const projectorHtmlPath = path.join(__dirname, `../renderer/${projectorWindowName}/projector.html`);
    projectorWindow.loadFile(projectorHtmlPath);
  }

  projectorWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && isProjectorWindowValid()) {
      event.preventDefault();
      const isFullscreen = projectorWindow!.isFullScreen();
      projectorWindow!.setFullScreen(!isFullscreen);
      notifyProjectorWindow('projector-fullscreen-changed', !isFullscreen);
    }
  });

  projectorWindow.on('enter-full-screen', () => {
    if (isProjectorWindowValid()) {
      notifyProjectorWindow('projector-fullscreen-changed', true);
    }
  });

  projectorWindow.on('leave-full-screen', () => {
    if (isProjectorWindowValid()) {
      notifyProjectorWindow('projector-fullscreen-changed', false);
    }
  });

  projectorWindow.on('closed', () => {
    notifyMainWindow('projector-closed');
    projectorWindow = null;
    projectorFiles = [];
    projectorFilesOrder = [];
    currentProjectorIndex = 0;
    isProjectorPlaying = false;
    isShowingBackground = false;
    projectorSettings = null;
  });

  projectorWindow.webContents.once('did-finish-load', () => {
    if (isProjectorWindowValid() && projectorSettings) {
      const initialIndex = projectorFilesOrder.length > 0 ? projectorFilesOrder[0] : 0;
      notifyProjectorWindow('projector-settings', projectorSettings);
      notifyProjectorWindow('projector-navigate', initialIndex);
      if (isProjectorPlaying) {
        notifyBothWindows('projector-play-pause', true);
      }
      notifyMainWindow('projector-opened');
      notifyMainWindow('projector-navigate', initialIndex);
    }
  });
};

// Register IPC handlers
const registerIpcHandlers = () => {
  ipcMain.handle('open-projector-window', async (_event, files, settings) => {
    createProjectorWindow(files, settings);
    notifyMainWindow('projector-opened');
    return { success: true };
  });

  ipcMain.handle('close-projector-window', async () => {
    if (!isProjectorWindowValid()) return { success: false };
    projectorWindow!.close();
    return { success: true };
  });

  const navigateToBackground = (): { success: true; index: -1 } => {
    isProjectorPlaying = false;
    isShowingBackground = true;
    notifyBothWindows('projector-play-pause', false);
    notifyBothWindows('projector-navigate', -1);
    return { success: true, index: -1 };
  };

  const navigateToIndex = (index: number): { success: true; index: number } => {
    isShowingBackground = false;
    notifyBothWindows('projector-navigate', index);
    return { success: true, index };
  };

  ipcMain.handle('navigate-projector', async (_event, direction: 'next' | 'previous') => {
    if (!isProjectorWindowValid() || projectorFiles.length === 0 || projectorFilesOrder.length === 0) {
      isShowingBackground = true;
      notifyBothWindows('projector-navigate', -1);
      return { success: true, index: -1 };
    }

    if (isShowingBackground) {
      isShowingBackground = false;
      currentProjectorIndex = direction === 'next' ? 0 : projectorFilesOrder.length - 1;
      return navigateToIndex(projectorFilesOrder[currentProjectorIndex]);
    }

    // Get current file index before navigation
    const currentFileIndex = projectorFilesOrder[currentProjectorIndex];

    if (direction === 'next') {
      const nextIndex = currentProjectorIndex + 1;
      if (nextIndex >= projectorFilesOrder.length && projectorSettings && !projectorSettings.loop) {
        return navigateToBackground();
      }
      currentProjectorIndex = nextIndex % projectorFilesOrder.length;

      // In random mode, ensure we don't select the same item twice in a row
      if (projectorSettings && projectorSettings.random && projectorSettings.loop && projectorFilesOrder.length > 1) {
        // If the next item is the same as current, skip to the next one
        if (projectorFilesOrder[currentProjectorIndex] === currentFileIndex) {
          // Find next different item
          let foundDifferent = false;
          const startIndex = currentProjectorIndex;
          do {
            currentProjectorIndex = (currentProjectorIndex + 1) % projectorFilesOrder.length;
            if (projectorFilesOrder[currentProjectorIndex] !== currentFileIndex) {
              foundDifferent = true;
            }
            // Prevent infinite loop - if we've checked all items and they're all the same, break
            if (currentProjectorIndex === startIndex) {
              break;
            }
          } while (!foundDifferent && projectorFilesOrder[currentProjectorIndex] === currentFileIndex);
        }
      }
    } else {
      const prevIndex = currentProjectorIndex - 1;
      if (prevIndex < 0) {
        if (projectorSettings && !projectorSettings.loop) {
          return navigateToBackground();
        }
        currentProjectorIndex = projectorFilesOrder.length - 1;

        // In random mode, ensure we don't select the same item twice in a row
        if (projectorSettings && projectorSettings.random && projectorSettings.loop && projectorFilesOrder.length > 1) {
          // If the previous item is the same as current, skip to the previous one
          if (projectorFilesOrder[currentProjectorIndex] === currentFileIndex) {
            // Find previous different item
            let foundDifferent = false;
            const startIndex = currentProjectorIndex;
            do {
              currentProjectorIndex = (currentProjectorIndex - 1 + projectorFilesOrder.length) % projectorFilesOrder.length;
              if (projectorFilesOrder[currentProjectorIndex] !== currentFileIndex) {
                foundDifferent = true;
              }
              // Prevent infinite loop - if we've checked all items and they're all the same, break
              if (currentProjectorIndex === startIndex) {
                break;
              }
            } while (!foundDifferent && projectorFilesOrder[currentProjectorIndex] === currentFileIndex);
          }
        }
      } else {
        currentProjectorIndex = prevIndex;
      }
    }

    return navigateToIndex(projectorFilesOrder[currentProjectorIndex]);
  });

  ipcMain.handle('navigate-projector-to-index', async (_event, targetIndex: number) => {
    if (!isProjectorWindowValid() || projectorFiles.length === 0 || projectorFilesOrder.length === 0) {
      return { success: false };
    }

    if (targetIndex < 0 || targetIndex >= projectorFiles.length) {
      return { success: false };
    }

    const orderIndex = projectorFilesOrder.indexOf(targetIndex);
    if (orderIndex < 0) {
      return { success: false };
    }

    currentProjectorIndex = orderIndex;
    return navigateToIndex(targetIndex);
  });

  ipcMain.handle('toggle-projector-play-pause', async () => {
    if (!isProjectorWindowValid()) return { success: false };

    const wasPlaying = isProjectorPlaying;
    isProjectorPlaying = !isProjectorPlaying;

    if (isShowingBackground && isProjectorPlaying && !wasPlaying && projectorFilesOrder.length > 0) {
      isShowingBackground = false;
      currentProjectorIndex = 0;
      notifyBothWindows('projector-navigate', projectorFilesOrder[currentProjectorIndex]);
    }

    notifyBothWindows('projector-play-pause', isProjectorPlaying);
    return { success: true, isPlaying: isProjectorPlaying };
  });

  ipcMain.handle('notify-projector-index-change', async (_event, index: number) => {
    if (index < 0) {
      isShowingBackground = true;
      notifyMainWindow('projector-navigate', -1);
      return { success: true };
    }

    const orderIndex = projectorFilesOrder.indexOf(index);
    if (orderIndex >= 0) {
      currentProjectorIndex = orderIndex;
      isShowingBackground = false;
      notifyMainWindow('projector-navigate', index);
    }

    return { success: true };
  });

  ipcMain.handle('update-projector-settings', async (_event, settings) => {
    if (!isProjectorWindowValid()) return { success: false };

    const validatedSettings = {
      ...settings,
      random: settings.loop ? settings.random : false,
    };

    projectorSettings = validatedSettings;
    projectorFilesOrder = validatedSettings.random
      ? shuffleArray(projectorFiles.map((_, i) => i))
      : projectorFiles.map((_, i) => i);

    notifyProjectorWindow('projector-settings', validatedSettings);
    return { success: true };
  });

  ipcMain.handle('update-projector-volume', async (_event, volume: number) => {
    if (!isProjectorWindowValid()) return { success: false };
    notifyProjectorWindow('projector-volume', volume);
    return { success: true };
  });

  ipcMain.handle('seek-projector-video', async (_event, time: number) => {
    if (!isProjectorWindowValid()) return { success: false };
    notifyProjectorWindow('projector-seek-video', time);
    return { success: true };
  });

  ipcMain.handle('send-video-progress', async (_event, progress: { currentTime: number; duration: number }) => {
    notifyMainWindow('projector-video-progress', progress);
    return { success: true };
  });

  ipcMain.handle('send-timer-progress', async (_event, progress: { elapsed: number; total: number }) => {
    notifyMainWindow('projector-timer-progress', progress);
    return { success: true };
  });

  ipcMain.handle('get-projector-files', async () => {
    if (projectorFilesOrder.length === 0) {
      return { files: projectorFiles, currentIndex: -1 };
    }
    // Check if we're at the end and loop is disabled
    if (currentProjectorIndex >= projectorFilesOrder.length && projectorSettings && !projectorSettings.loop) {
      return { files: projectorFiles, currentIndex: -1 };
    }
    const actualIndex = projectorFilesOrder[Math.min(currentProjectorIndex, projectorFilesOrder.length - 1)];
    return { files: projectorFiles, currentIndex: actualIndex };
  });

  ipcMain.handle('get-projector-settings', async () => {
    return projectorSettings;
  });

  ipcMain.handle('toggle-projector-fullscreen', async () => {
    if (!isProjectorWindowValid()) return { success: false };
    const isFullscreen = projectorWindow!.isFullScreen();
    projectorWindow!.setFullScreen(!isFullscreen);
    return { success: true, isFullscreen: !isFullscreen };
  });

  ipcMain.handle('is-projector-fullscreen', async () => {
    return isProjectorWindowValid() ? projectorWindow!.isFullScreen() : false;
  });

  ipcMain.handle('update-projector-files', async (_event, files: Array<{ id: string; name: string; type: string; data: string }>) => {
    if (!isProjectorWindowValid()) return { success: false };

    projectorFiles = files;

    if (projectorSettings && !projectorSettings.loop) {
      projectorSettings.random = false;
    }

    projectorFilesOrder = (projectorSettings?.random && projectorSettings?.loop)
      ? shuffleArray(files.map((_, i) => i))
      : files.map((_, i) => i);

    if (currentProjectorIndex >= projectorFilesOrder.length) {
      currentProjectorIndex = Math.max(0, projectorFilesOrder.length - 1);
    }

    notifyProjectorWindow('projector-files-updated', files);

    if (projectorFilesOrder.length > 0 && currentProjectorIndex >= 0) {
      navigateToIndex(projectorFilesOrder[currentProjectorIndex]);
    } else {
      isShowingBackground = true;
      notifyBothWindows('projector-navigate', -1);
    }

    return { success: true };
  });

  ipcMain.handle('window-minimize', async () => {
    if (!isMainWindowValid()) return { success: false };
    mainWindow!.minimize();
    return { success: true };
  });

  ipcMain.handle('window-maximize', async () => {
    if (!isMainWindowValid()) return { success: false };
    if (mainWindow!.isMaximized()) {
      mainWindow!.unmaximize();
    } else {
      mainWindow!.maximize();
    }
    return { success: true, isMaximized: mainWindow!.isMaximized() };
  });

  ipcMain.handle('window-close', async () => {
    if (!isMainWindowValid()) return { success: false };
    mainWindow!.close();
    return { success: true };
  });

  ipcMain.handle('window-is-maximized', async () => {
    return isMainWindowValid() ? mainWindow!.isMaximized() : false;
  });

  // Startup settings handlers
  ipcMain.handle('update-startup-settings', async (_event, settings: { bootOnStartup: boolean; bootInProjectorMode: boolean }) => {
    appSettings = settings;

    // Disable autostart in debug mode
    if (isDebugMode()) {
      console.log('Autostart disabled in debug mode');
      // Remove any existing autostart configuration
      if (process.platform === 'linux') {
        try {
          await removeLinuxAutostartDesktop();
        } catch (error) {
          // Ignore errors when removing in debug mode
        }
      } else {
        // Windows/macOS: Disable login item settings
        const loginItemSettings: Electron.Settings = {
          openAtLogin: false,
          openAsHidden: false,
          args: [],
        };
        app.setLoginItemSettings(loginItemSettings);
      }
      return { success: true };
    }

    if (process.platform === 'linux') {
      // Linux: Use .desktop file approach
      try {
        await updateLinuxAutostart(settings.bootOnStartup, settings.bootInProjectorMode);
        return { success: true };
      } catch (error) {
        console.error('Error updating Linux autostart:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    } else {
      // Windows/macOS: Use Electron's built-in login item settings
      const loginItemSettings: Electron.Settings = {
        openAtLogin: settings.bootOnStartup,
        openAsHidden: false,
        args: settings.bootInProjectorMode ? ['--projector-mode'] : [],
      };

      app.setLoginItemSettings(loginItemSettings);
      return { success: true };
    }
  });

  ipcMain.handle('get-startup-settings', async () => {
    return appSettings;
  });

  // Exit behavior settings handlers
  ipcMain.handle('update-exit-behavior-settings', async (_event, settings: { showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' }) => {
    exitBehaviorSettings.showExitPrompt = settings.showExitPrompt;
    exitBehaviorSettings.exitBehavior = settings.exitBehavior;
    return { success: true };
  });

  ipcMain.handle('get-exit-behavior-settings', async () => {
    return exitBehaviorSettings;
  });

  ipcMain.on('tray-open-projector-request', async () => {
    notifyMainWindow('tray-open-projector-request');
  });

  ipcMain.handle('load-settings', async () => loadSettings());

  ipcMain.handle('save-settings', async (_event, settings: any) => {
    try {
      await saveSettings(settings);
      if (settings.showExitPrompt !== undefined) {
        exitBehaviorSettings.showExitPrompt = settings.showExitPrompt;
      }
      if (settings.exitBehavior !== undefined) {
        exitBehaviorSettings.exitBehavior = settings.exitBehavior;
      }
      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Save files persistently
  ipcMain.handle('save-files', async (_event, filesData: Array<{
    id: string;
    name: string;
    type: string;
    data: string; // base64 data URL
    pageNumber?: number;
  }>, fileOrder: string[]) => {
    try {
      const storagePath = getFilesStoragePath();
      const filesDir = path.join(storagePath, 'files');
      const metadataPath = path.join(storagePath, 'metadata.json');

      // Create storage directory
      await fs.mkdir(filesDir, { recursive: true });

      // Save file metadata
      const metadata = {
        fileOrder,
        files: filesData.map(f => ({
          id: f.id,
          name: f.name,
          type: f.type,
          pageNumber: f.pageNumber,
        })),
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      for (const file of filesData) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileExtension = path.extname(safeName) || getFileExtension(file.type);
        const savedFileName = file.pageNumber
          ? `${file.id}_page${file.pageNumber}${fileExtension}`
          : `${file.id}${fileExtension}`;
        const buffer = Buffer.from(extractBase64Data(file.data), 'base64');
        await fs.writeFile(path.join(filesDir, savedFileName), buffer);
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving files:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('save-thumbnail', async (_event, fileId: string, thumbnailData: string) => {
    try {
      const thumbnailsDir = path.join(getFilesStoragePath(), 'thumbnails');
      await fs.mkdir(thumbnailsDir, { recursive: true });
      const buffer = Buffer.from(extractBase64Data(thumbnailData), 'base64');
      await fs.writeFile(path.join(thumbnailsDir, `${fileId}.jpg`), buffer);
      return { success: true };
    } catch (error) {
      console.error('Error saving thumbnail:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Load thumbnail from persistence
  ipcMain.handle('load-thumbnail', async (_event, fileId: string) => {
    try {
      const storagePath = getFilesStoragePath();
      const thumbnailsDir = path.join(storagePath, 'thumbnails');
      const thumbnailPath = path.join(thumbnailsDir, `${fileId}.jpg`);

      if (!existsSync(thumbnailPath)) {
        return { success: false, exists: false };
      }

      const fileBuffer = await fs.readFile(thumbnailPath);
      const base64Data = fileBuffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64Data}`;

      return { success: true, exists: true, data: dataUrl };
    } catch (error) {
      console.error('Error loading thumbnail:', error);
      return { success: false, exists: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Save individual file to persistence
  ipcMain.handle('save-single-file', async (_event, fileData: {
    id: string;
    name: string;
    type: string;
    data: string; // base64 data URL
  }) => {
    try {
      const storagePath = getFilesStoragePath();
      const filesDir = path.join(storagePath, 'files');
      const metadataPath = path.join(storagePath, 'metadata.json');

      // Create storage directory
      await fs.mkdir(filesDir, { recursive: true });

      const savedFileName = `${fileData.id}${getFileExtension(fileData.type)}`;
      const buffer = Buffer.from(extractBase64Data(fileData.data), 'base64');
      await fs.writeFile(path.join(filesDir, savedFileName), buffer);

      // Update metadata to include this file
      let metadata: { fileOrder: string[]; files: Array<{ id: string; name: string; type: string; pageNumber?: number }>; timestamp: string } = {
        fileOrder: [],
        files: [],
        timestamp: new Date().toISOString(),
      };

      if (existsSync(metadataPath)) {
        try {
          const metadataJson = await fs.readFile(metadataPath, 'utf-8');
          metadata = JSON.parse(metadataJson);
        } catch (error) {
          console.error('Error reading metadata, creating new:', error);
        }
      }

      // Add or update file in metadata
      const existingFileIndex = metadata.files.findIndex(f => f.id === fileData.id);
      if (existingFileIndex >= 0) {
        metadata.files[existingFileIndex] = {
          id: fileData.id,
          name: fileData.name,
          type: fileData.type,
        };
      } else {
        metadata.files.push({
          id: fileData.id,
          name: fileData.name,
          type: fileData.type,
        });
        // Add to file order if not already present
        if (!metadata.fileOrder.includes(fileData.id)) {
          metadata.fileOrder.push(fileData.id);
        }
      }

      metadata.timestamp = new Date().toISOString();
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      return { success: true };
    } catch (error) {
      console.error('Error saving single file:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Delete file from persistence
  ipcMain.handle('delete-file', async (_event, fileId: string, fileType: string) => {
    try {
      const storagePath = getFilesStoragePath();
      const filesDir = path.join(storagePath, 'files');
      const metadataPath = path.join(storagePath, 'metadata.json');

      const savedFilePath = path.join(filesDir, `${fileId}${getFileExtension(fileType)}`);

      // Delete the file if it exists
      if (existsSync(savedFilePath)) {
        await fs.unlink(savedFilePath);
      }

      // Also check for any page files (for PDFs)
      if (fileType === 'document') {
        const entries = await fs.readdir(filesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.startsWith(`${fileId}_page`)) {
            await fs.unlink(path.join(filesDir, entry.name));
          }
        }
      }

      // Delete thumbnail(s) if they exist
      const thumbnailsDir = path.join(storagePath, 'thumbnails');

      // Delete main thumbnail
      const thumbnailPath = path.join(thumbnailsDir, `${fileId}.jpg`);
      if (existsSync(thumbnailPath)) {
        await fs.unlink(thumbnailPath);
      }

      // For PDFs, also delete any page-specific thumbnails
      if (fileType === 'document') {
        try {
          if (existsSync(thumbnailsDir)) {
            const entries = await fs.readdir(thumbnailsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isFile() && entry.name.startsWith(`${fileId}-page-`) && entry.name.endsWith('.jpg')) {
                await fs.unlink(path.join(thumbnailsDir, entry.name));
              }
            }
          }
        } catch (error) {
          console.error('Error deleting PDF page thumbnails:', error);
        }
      }

      // Update metadata to remove this file
      if (existsSync(metadataPath)) {
        try {
          const metadataJson = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataJson);

          // Remove from files array
          metadata.files = metadata.files.filter((f: { id: string }) => f.id !== fileId);

          // Remove from file order
          metadata.fileOrder = metadata.fileOrder.filter((id: string) => id !== fileId);

          metadata.timestamp = new Date().toISOString();
          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        } catch (error) {
          console.error('Error updating metadata after file deletion:', error);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Load files persistently
  ipcMain.handle('load-files', async () => {
    try {
      const storagePath = getFilesStoragePath();
      const filesDir = path.join(storagePath, 'files');
      const metadataPath = path.join(storagePath, 'metadata.json');

      if (!existsSync(metadataPath) || !existsSync(filesDir)) {
        return { success: true, files: [], fileOrder: [] };
      }

      // Read metadata
      const metadataJson = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataJson);

      // Read files
      const files: Array<{
        id: string;
        name: string;
        type: string;
        data: string;
        pageNumber?: number;
      }> = [];

      for (const fileMeta of metadata.files) {
        const savedFileName = fileMeta.pageNumber
          ? `${fileMeta.id}_page${fileMeta.pageNumber}${getFileExtension(fileMeta.type)}`
          : `${fileMeta.id}${getFileExtension(fileMeta.type)}`;
        const filePath = path.join(filesDir, savedFileName);

        if (existsSync(filePath)) {
          const fileBuffer = await fs.readFile(filePath);
          const base64Data = fileBuffer.toString('base64');
          const mimeType = getMimeType(fileMeta.type, savedFileName);
          files.push({
            id: fileMeta.id,
            name: fileMeta.name,
            type: fileMeta.type,
            data: `data:${mimeType};base64,${base64Data}`,
            pageNumber: fileMeta.pageNumber,
          });
        }
      }

      return { success: true, files, fileOrder: metadata.fileOrder || [] };
    } catch (error) {
      console.error('Error loading files:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Export project: create zip file with settings, file order, and files
  ipcMain.handle('export-project', async (_event, projectData: {
    settings: any;
    files: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>;
    fileOrder: string[]; // Array of file IDs in order
  }) => {
    try {
      // Show save dialog to choose where to save the zip file
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Project',
        defaultPath: `SimpleProjector-${new Date().toISOString().split('T')[0]}.zip`,
        filters: [
          { name: 'Zip Files', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      const zipPath = result.filePath;
      const tempDir = path.join(app.getPath('temp'), `simpleprojector-export-${Date.now()}`);
      const projectDir = path.join(tempDir, 'project');
      const filesDir = path.join(projectDir, 'files');

      // Create temporary directories
      await fs.mkdir(projectDir, { recursive: true });
      await fs.mkdir(filesDir, { recursive: true });

      // Save settings and file order to JSON
      const projectInfo = {
        settings: projectData.settings,
        fileOrder: projectData.fileOrder,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      };
      await fs.writeFile(
        path.join(projectDir, 'project.json'),
        JSON.stringify(projectInfo, null, 2),
        'utf-8'
      );

      const fileMapping: Record<string, string> = {};
      for (const file of projectData.files) {
        const safeName = file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const fileExtension = path.extname(safeName) || getFileExtension(file.type);
        const baseName = path.basename(safeName, fileExtension);
        const savedFileName = file.pageNumber
          ? `${baseName}_page${file.pageNumber}${fileExtension}`
          : `${baseName}${fileExtension}`;
        const buffer = Buffer.from(extractBase64Data(file.data), 'base64');
        await fs.writeFile(path.join(filesDir, savedFileName), buffer);
        fileMapping[file.id] = savedFileName;
      }

      // Save file mapping
      await fs.writeFile(
        path.join(projectDir, 'file-mapping.json'),
        JSON.stringify(fileMapping, null, 2),
        'utf-8'
      );

      // Create zip file
      return new Promise((resolve) => {
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', {
          zlib: { level: 9 }, // Maximum compression
        });

        output.on('close', async () => {
          // Clean up temporary directory
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch (error) {
            console.error('Error cleaning up temp directory:', error);
          }
          resolve({ success: true, zipPath });
        });

        archive.on('error', async (err) => {
          console.error('Error creating zip:', err);
          // Clean up temporary directory
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch (error) {
            console.error('Error cleaning up temp directory:', error);
          }
          resolve({ success: false, error: err.message });
        });

        archive.pipe(output);
        archive.directory(projectDir, 'project');
        archive.finalize();
      });
    } catch (error) {
      console.error('Error exporting project:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Import project: extract zip file and read settings, file order, and files
  ipcMain.handle('import-project', async (_event) => {
    try {
      // Show dialog to select zip file
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import Project',
        filters: [
          { name: 'Zip Files', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const zipPath = result.filePaths[0];
      const tempDir = path.join(app.getPath('temp'), `simpleprojector-import-${Date.now()}`);
      const extractDir = path.join(tempDir, 'extracted');

      // Create temporary directory
      await fs.mkdir(extractDir, { recursive: true });

      // Extract zip file
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      // Find project directory (should be 'project' folder inside extracted files)
      const projectDir = path.join(extractDir, 'project');
      const projectJsonPath = path.join(projectDir, 'project.json');
      const filesDir = path.join(projectDir, 'files');
      const fileMappingPath = path.join(projectDir, 'file-mapping.json');

      if (!existsSync(projectJsonPath) || !existsSync(filesDir)) {
        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, error: 'Invalid project file. Missing project.json or files directory.' };
      }

      // Read project info
      const projectInfoJson = await fs.readFile(projectJsonPath, 'utf-8');
      const projectInfo = JSON.parse(projectInfoJson);

      // Read file mapping
      let fileMapping: Record<string, string> = {};
      if (existsSync(fileMappingPath)) {
        const fileMappingJson = await fs.readFile(fileMappingPath, 'utf-8');
        fileMapping = JSON.parse(fileMappingJson);
      }

      // Read files and convert to base64
      const fileEntries = await fs.readdir(filesDir, { withFileTypes: true });
      const files: Array<{
        id: string;
        name: string;
        type: string;
        data: string; // base64 data URL
        pageNumber?: number;
      }> = [];

      for (const entry of fileEntries) {
        if (entry.isFile()) {
          const filePath = path.join(filesDir, entry.name);

          const ext = path.extname(entry.name).toLowerCase();
          let fileType = 'image';
          if (['.mp4', '.webm', '.ogg', '.mov', '.avi'].includes(ext)) {
            fileType = 'video';
          } else if (ext === '.pdf') {
            fileType = 'document';
          }
          const mimeType = getMimeType(fileType, entry.name);

          // Extract page number from filename if present
          const pageMatch = entry.name.match(/_page(\d+)/);
          const pageNumber = pageMatch ? parseInt(pageMatch[1], 10) : undefined;

          // Find original ID from mapping (reverse lookup)
          const originalId = Object.keys(fileMapping).find(
            id => fileMapping[id] === entry.name
          ) || `${entry.name}-${Date.now()}-${Math.random()}`;

          const fileBuffer = await fs.readFile(filePath);
          const base64Data = fileBuffer.toString('base64');
          const dataUrl = `data:${mimeType};base64,${base64Data}`;

          files.push({
            id: originalId,
            name: entry.name.replace(/_page\d+/, ''), // Remove page suffix from name
            type: fileType,
            data: dataUrl,
            pageNumber,
          });
        }
      }

      // Clean up temporary directory
      await fs.rm(tempDir, { recursive: true, force: true });

      return {
        success: true,
        project: {
          settings: projectInfo.settings,
          fileOrder: projectInfo.fileOrder || files.map(f => f.id),
          files,
        },
      };
    } catch (error) {
      console.error('Error importing project:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
};

// Register IPC handlers
registerIpcHandlers();

// Check if app was launched with --projector-mode flag
const shouldBootInProjectorMode = process.argv.includes('--projector-mode');

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Load persistent settings and files, then send to renderer
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const settings = await loadSettings();
        if (settings) {
          await loadExitBehaviorSettings();

          // Load and apply startup settings (only if not in debug mode)
          if (!isDebugMode() && (settings.bootOnStartup !== undefined || settings.bootInProjectorMode !== undefined)) {
            appSettings.bootOnStartup = settings.bootOnStartup ?? false;
            appSettings.bootInProjectorMode = settings.bootInProjectorMode ?? false;

            // Apply startup settings (Linux uses .desktop file, Windows/macOS use setLoginItemSettings)
            if (process.platform === 'linux') {
              try {
                await updateLinuxAutostart(appSettings.bootOnStartup, appSettings.bootInProjectorMode);
              } catch (error) {
                console.error('Error applying Linux autostart settings on startup:', error);
              }
            } else {
              const loginItemSettings: Electron.Settings = {
                openAtLogin: appSettings.bootOnStartup,
                openAsHidden: false,
                args: appSettings.bootInProjectorMode ? ['--projector-mode'] : [],
              };
              app.setLoginItemSettings(loginItemSettings);
            }
          } else if (isDebugMode()) {
            // In debug mode, ensure autostart is disabled
            console.log('Autostart disabled in debug mode');
            if (process.platform === 'linux') {
              try {
                await removeLinuxAutostartDesktop();
              } catch (error) {
                // Ignore errors when removing in debug mode
              }
            } else {
              const loginItemSettings: Electron.Settings = {
                openAtLogin: false,
                openAsHidden: false,
                args: [],
              };
              app.setLoginItemSettings(loginItemSettings);
            }
          }

          notifyMainWindow('load-persistent-settings', settings);
        } else {
          // Even if no settings file exists, check command line flag
          if (shouldBootInProjectorMode) {
            // Will trigger after files are loaded
          }
        }

        // Load files
        const storagePath = getFilesStoragePath();
        const filesDir = path.join(storagePath, 'files');
        const metadataPath = path.join(storagePath, 'metadata.json');

        // Check if we should boot in projector mode (either from command line or settings)
        const shouldBootInProjector = shouldBootInProjectorMode || (settings && settings.bootInProjectorMode === true);

        if (existsSync(metadataPath) && existsSync(filesDir)) {
          try {
            const metadataJson = await fs.readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(metadataJson);

            const files: Array<{
              id: string;
              name: string;
              type: string;
              data: string;
              pageNumber?: number;
            }> = [];

            for (const fileMeta of metadata.files) {
              if (fileMeta.pageNumber) continue;

              const savedFileName = `${fileMeta.id}${getFileExtension(fileMeta.type)}`;
              const filePath = path.join(filesDir, savedFileName);

              if (existsSync(filePath)) {
                const fileBuffer = await fs.readFile(filePath);
                const base64Data = fileBuffer.toString('base64');
                const mimeType = getMimeType(fileMeta.type, savedFileName);
                files.push({
                  id: fileMeta.id,
                  name: fileMeta.name,
                  type: fileMeta.type,
                  data: `data:${mimeType};base64,${base64Data}`,
                });
              }
            }

            mainWindow?.webContents.send('load-persistent-files', {
              files,
              fileOrder: metadata.fileOrder || [],
            });

            // Trigger boot-in-projector-mode after files are loaded and processed
            // Give enough time for the renderer to process the files
            if (shouldBootInProjector) {
              setTimeout(() => notifyMainWindow('boot-in-projector-mode'), 1000);
            }
          } catch (error) {
            console.error('Error loading persistent files:', error);
            // Even if there's an error loading files, trigger boot-in-projector-mode if needed
            if (shouldBootInProjector) {
              setTimeout(() => notifyMainWindow('boot-in-projector-mode'), 1000);
            }
          }
        } else {
          // No files to load, but still trigger boot-in-projector-mode if needed
          if (shouldBootInProjector) {
            setTimeout(() => notifyMainWindow('boot-in-projector-mode'), 1000);
          }
        }
      } catch (error) {
        console.error('Error loading persistent data:', error);
        // Even if there's an error loading settings, check command line flag
        if (shouldBootInProjectorMode) {
          setTimeout(() => notifyMainWindow('boot-in-projector-mode'), 500);
        }
      }
    });
  }
});

// Quit when all windows are closed, except on macOS or if tray exists
app.on('window-all-closed', () => {
  // Don't quit if we have a tray (on Linux/Windows)
  // On macOS, keep the app running
  if (process.platform === 'darwin' || tray) {
    // Keep app running
    return;
  }
  app.quit();
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
