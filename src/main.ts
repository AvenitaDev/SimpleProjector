import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
} else {
  // This is the first instance, handle second instance attempts
  app.on('second-instance', () => {
    // Someone tried to run a second instance, restore our window instead
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
    // Note: If window doesn't exist yet, it will be created in app.whenReady()
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
let exitBehaviorSettings: { showExitPrompt: boolean; exitBehavior: 'minimize' | 'close' } = {
  showExitPrompt: true,
  exitBehavior: 'minimize',
};

// Get settings file path
const getSettingsPath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'settings.json');
};

// Get files storage path
const getFilesStoragePath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'files-storage');
};

// Save exit behavior settings directly to disk
const saveExitBehaviorToSettings = async () => {
  try {
    const settingsPath = getSettingsPath();
    let settings: any = {};

    // Load existing settings if they exist
    if (existsSync(settingsPath)) {
      const settingsData = await fs.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(settingsData);
    }

    // Update exit behavior settings
    settings.showExitPrompt = exitBehaviorSettings.showExitPrompt;
    settings.exitBehavior = exitBehaviorSettings.exitBehavior;

    // Save back to disk
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving exit behavior settings:', error);
  }
};

const createWindow = () => {
  // Get icon path and create icon
  // Use icon.png for the main app window (general purpose)
  // Try multiple possible paths for dev and production
  const possiblePaths = [
    path.join(app.getAppPath(), 'src/assets/icon.png'),  // Dev mode
    path.join(app.getAppPath(), 'assets/icon.png'),      // Packaged
    path.join(__dirname, '../../src/assets/icon.png'),   // Dev mode from .vite/build
    path.join(__dirname, '../assets/icon.png'),          // Packaged
  ];

  let icon: Electron.NativeImage | undefined;
  for (const iconPath of possiblePaths) {
    try {
      if (existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          console.log('Successfully loaded app icon from:', iconPath);
          break;
        }
        icon = undefined;
      }
    } catch (error) {
      console.warn(`Failed to load icon from ${iconPath}:`, error);
    }
  }

  if (!icon) {
    console.warn('Could not load app icon from any path, using default');
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'SimpleProjector',
    icon: icon,
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

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  // Handle window close with confirmation
  mainWindow.on('close', async (event) => {
    // If we're already minimizing or closing, proceed
    if (shouldMinimizeOnClose) {
      shouldMinimizeOnClose = false;
      if (projectorWindow && !projectorWindow.isDestroyed()) {
        projectorWindow.close();
      }
      return;
    }

    // Prevent default close
    event.preventDefault();

    // Check if projector is active - if so, always show prompt as exception
    const isProjectorActive = projectorWindow && !projectorWindow.isDestroyed();

    // Check if we should show the prompt
    // Reload settings from disk to ensure we have the latest values
    try {
      const settingsPath = getSettingsPath();
      if (existsSync(settingsPath)) {
        const settingsData = await fs.readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(settingsData);
        if (settings.showExitPrompt !== undefined) {
          exitBehaviorSettings.showExitPrompt = settings.showExitPrompt;
        }
        if (settings.exitBehavior !== undefined) {
          exitBehaviorSettings.exitBehavior = settings.exitBehavior;
        }
      }
    } catch (error) {
      console.error('Error loading exit behavior settings:', error);
    }

    // If projector is active, always show prompt (exception)
    // Otherwise, check the saved preference
    const shouldShowPrompt = isProjectorActive || exitBehaviorSettings.showExitPrompt;

    if (!shouldShowPrompt) {
      // Use saved preference without showing dialog
      if (exitBehaviorSettings.exitBehavior === 'minimize') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
        }
      } else {
        // Close completely
        // Close projector window first
        if (projectorWindow && !projectorWindow.isDestroyed()) {
          projectorWindow.close();
        }
        // Set flag before destroying to prevent re-entry
        shouldMinimizeOnClose = true;
        // Use setImmediate to ensure any pending operations complete before destroying window
        setImmediate(() => {
          // Destroy main window and quit
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
          }
          app.quit();
        });
      }
      return;
    }

    // Show confirmation dialog
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
      // Minimize to tray
      // Only save preference if not projecting (exception case)
      if (!isProjectorActive) {
        exitBehaviorSettings.exitBehavior = 'minimize';
        exitBehaviorSettings.showExitPrompt = false;
        // Save settings directly in main process
        await saveExitBehaviorToSettings();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    } else if (choice.response === 1) {
      // Close completely
      // Only save preference if not projecting (exception case)
      if (!isProjectorActive) {
        exitBehaviorSettings.exitBehavior = 'close';
        exitBehaviorSettings.showExitPrompt = false;
        // Save settings directly in main process (must complete before quitting)
        await saveExitBehaviorToSettings();
      }
      // Close projector window first
      if (projectorWindow && !projectorWindow.isDestroyed()) {
        projectorWindow.close();
      }
      // Set flag before destroying to prevent re-entry
      shouldMinimizeOnClose = true;
      // Use setImmediate to ensure dialog cleanup is complete before destroying window
      setImmediate(() => {
        // Destroy main window and quit
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        app.quit();
      });
    }
    // If response is 2 (Cancel), do nothing - window stays open
  });
};

const createTray = () => {
  // Get icon path and create tray icon
  // Use icon_taskbar.png for the system tray notification icon
  // Try multiple possible paths for dev and production
  const possiblePaths = [
    path.join(app.getAppPath(), 'src/assets/icon_taskbar.png'),  // Dev mode
    path.join(app.getAppPath(), 'assets/icon_taskbar.png'),      // Packaged
    path.join(__dirname, '../../src/assets/icon_taskbar.png'),   // Dev mode from .vite/build
    path.join(__dirname, '../assets/icon_taskbar.png'),          // Packaged
  ];

  const size = process.platform === 'darwin' ? 22 : 16;

  // Fallback icon data
  const fallbackIconData = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  let icon: Electron.NativeImage = nativeImage.createFromBuffer(fallbackIconData);
  let iconLoaded = false;

  for (const iconPath of possiblePaths) {
    console.log('Checking tray icon path:', iconPath, 'exists:', existsSync(iconPath));
    try {
      if (existsSync(iconPath)) {
        const loadedIcon = nativeImage.createFromPath(iconPath);
        // Check if icon is empty (format might not be supported)
        if (!loadedIcon.isEmpty()) {
          icon = loadedIcon;
          iconLoaded = true;
          console.log('Successfully loaded tray icon from:', iconPath);
          break; // Successfully loaded icon
        } else {
          console.warn('Tray icon file is empty or not supported:', iconPath);
        }
      }
    } catch (error) {
      console.warn(`Failed to load tray icon from ${iconPath}:`, error);
      continue;
    }
  }

  if (!iconLoaded) {
    console.warn('Could not load tray icon, using default');
  }

  // Resize to appropriate size for tray
  icon = icon.resize({ width: size, height: size });

  tray = new Tray(icon);

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Open Projector',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // Send message to renderer to open projector
          mainWindow.webContents.send('tray-open-projector');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        shouldMinimizeOnClose = true;
        // Close projector window first
        if (projectorWindow && !projectorWindow.isDestroyed()) {
          projectorWindow.close();
        }
        // Use setImmediate to ensure any pending operations complete before destroying window
        setImmediate(() => {
          // Destroy main window and quit
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
          }
          app.quit();
        });
      },
    },
  ]);

  tray.setToolTip('SimpleProjector');
  tray.setContextMenu(contextMenu);

  // Single-click to toggle window (show if hidden, minimize to tray if visible)
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        // Window is visible, minimize to tray
        mainWindow.hide();
      } else {
        // Window is hidden or minimized, show it
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // Double-click to show window (backup for platforms where single-click doesn't work)
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
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

  if (projectorWindow && !projectorWindow.isDestroyed()) {
    // Update fullscreen if setting changed
    const isFullscreen = projectorWindow.isFullScreen();
    if (validatedSettings.openFullscreen && !isFullscreen) {
      setTimeout(() => {
        if (projectorWindow && !projectorWindow.isDestroyed()) {
          projectorWindow.setFullScreen(true);
        }
      }, 100);
    } else if (!validatedSettings.openFullscreen && isFullscreen) {
      projectorWindow.setFullScreen(false);
    }

    projectorWindow.focus();
    projectorWindow.webContents.send('projector-settings', validatedSettings);
    const initialIndex = projectorFilesOrder.length > 0 ? projectorFilesOrder[0] : 0;
    projectorWindow.webContents.send('projector-navigate', initialIndex);
    // Sync play/pause state if auto-advance is enabled
    if (isProjectorPlaying) {
      projectorWindow.webContents.send('projector-play-pause', true);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-play-pause', true);
      }
    }
    // Notify main window that projector is open and send initial index
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-opened');
      mainWindow.webContents.send('projector-navigate', initialIndex);
    }
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

  // Handle window showing and fullscreen
  projectorWindow.once('ready-to-show', () => {
    if (projectorWindow && !projectorWindow.isDestroyed()) {
      // Show the window
      projectorWindow.show();

      // Set fullscreen if requested - must be done after showing
      if (validatedSettings.openFullscreen) {
        setTimeout(() => {
          if (projectorWindow && !projectorWindow.isDestroyed()) {
            projectorWindow.setFullScreen(true);
          }
        }, 100);
      }
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    projectorWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/projector.html`);
  } else {
    const projectorHtmlPath = path.join(__dirname, '../projector.html');
    projectorWindow.loadFile(projectorHtmlPath);
  }

  // Handle F11 fullscreen toggle
  projectorWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') {
      event.preventDefault();
      if (projectorWindow) {
        const isFullscreen = projectorWindow.isFullScreen();
        projectorWindow.setFullScreen(!isFullscreen);
        // Notify renderer about fullscreen state change
        projectorWindow.webContents.send('projector-fullscreen-changed', !isFullscreen);
      }
    }
  });

  // Listen for fullscreen changes
  projectorWindow.on('enter-full-screen', () => {
    if (projectorWindow) {
      projectorWindow.webContents.send('projector-fullscreen-changed', true);
    }
  });

  projectorWindow.on('leave-full-screen', () => {
    if (projectorWindow) {
      projectorWindow.webContents.send('projector-fullscreen-changed', false);
    }
  });

  projectorWindow.on('closed', () => {
    // Notify main window that projector closed
    if (mainWindow) {
      mainWindow.webContents.send('projector-closed');
    }
    projectorWindow = null;
    projectorFiles = [];
    projectorFilesOrder = [];
    currentProjectorIndex = 0;
    isProjectorPlaying = false;
    isShowingBackground = false;
    projectorSettings = null;
  });

  // Send settings to projector window once it's ready
  projectorWindow.webContents.once('did-finish-load', () => {
    if (projectorWindow && projectorSettings) {
      projectorWindow.webContents.send('projector-settings', projectorSettings);
      const initialIndex = projectorFilesOrder.length > 0 ? projectorFilesOrder[0] : 0;
      projectorWindow.webContents.send('projector-navigate', initialIndex);
      // Sync play/pause state if auto-advance is enabled
      if (isProjectorPlaying) {
        projectorWindow.webContents.send('projector-play-pause', true);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('projector-play-pause', true);
        }
      }
      // Notify main window that projector is open and send initial index
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-opened');
        mainWindow.webContents.send('projector-navigate', initialIndex);
      }
    }
  });
};

// Register IPC handlers
const registerIpcHandlers = () => {
  ipcMain.handle('open-projector-window', async (_event, files, settings) => {
    createProjectorWindow(files, settings);
    // Notify main window that projector opened
    if (mainWindow) {
      mainWindow.webContents.send('projector-opened');
    }
    return { success: true };
  });

  ipcMain.handle('close-projector-window', async () => {
    if (projectorWindow) {
      projectorWindow.close();
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('navigate-projector', async (_event, direction: 'next' | 'previous') => {
    if (!projectorWindow || projectorFiles.length === 0 || projectorFilesOrder.length === 0) {
      // If no files, send -1 to show background
      isShowingBackground = true;
      if (projectorWindow) {
        projectorWindow.webContents.send('projector-navigate', -1);
      }
      // Also notify main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-navigate', -1);
      }
      return { success: true, index: -1 };
    }

    // If we're currently showing background, navigate to the appropriate end
    if (isShowingBackground) {
      isShowingBackground = false;
      if (direction === 'next') {
        // From background, forward goes to first item
        currentProjectorIndex = 0;
      } else {
        // From background, backward goes to last item
        currentProjectorIndex = projectorFilesOrder.length - 1;
      }
      const actualIndex = projectorFilesOrder[currentProjectorIndex];
      projectorWindow.webContents.send('projector-navigate', actualIndex);
      // Also notify main window with the actual flattened index
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-navigate', actualIndex);
      }
      return { success: true, index: actualIndex };
    }

    if (direction === 'next') {
      const nextIndex = currentProjectorIndex + 1;
      // If at end and not looping, navigate to background
      if (nextIndex >= projectorFilesOrder.length && projectorSettings && !projectorSettings.loop) {
        isProjectorPlaying = false;
        isShowingBackground = true;
        if (projectorWindow) {
          projectorWindow.webContents.send('projector-play-pause', false);
          projectorWindow.webContents.send('projector-navigate', -1);
        }
        // Also notify main window
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('projector-play-pause', false);
          mainWindow.webContents.send('projector-navigate', -1);
        }
        // Return -1 to show background
        return { success: true, index: -1 };
      }
      currentProjectorIndex = nextIndex % projectorFilesOrder.length;
    } else {
      const prevIndex = currentProjectorIndex - 1;
      if (prevIndex < 0) {
        // If at beginning and not looping, navigate to background
        if (projectorSettings && !projectorSettings.loop) {
          isProjectorPlaying = false;
          isShowingBackground = true;
          if (projectorWindow) {
            projectorWindow.webContents.send('projector-play-pause', false);
            projectorWindow.webContents.send('projector-navigate', -1);
          }
          // Also notify main window
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('projector-play-pause', false);
            mainWindow.webContents.send('projector-navigate', -1);
          }
          // Return -1 to show background
          return { success: true, index: -1 };
        } else {
          currentProjectorIndex = projectorFilesOrder.length - 1;
        }
      } else {
        currentProjectorIndex = prevIndex;
      }
    }

    const actualIndex = projectorFilesOrder[currentProjectorIndex];
    isShowingBackground = false; // Reset flag when navigating to a file
    projectorWindow.webContents.send('projector-navigate', actualIndex);
    // Also notify main window with the actual flattened index
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-navigate', actualIndex);
    }
    return { success: true, index: actualIndex };
  });

  ipcMain.handle('navigate-projector-to-index', async (_event, targetIndex: number) => {
    if (!projectorWindow || projectorFiles.length === 0 || projectorFilesOrder.length === 0) {
      return { success: false };
    }

    // Validate the target index
    if (targetIndex < 0 || targetIndex >= projectorFiles.length) {
      return { success: false };
    }

    // Find the position in projectorFilesOrder that corresponds to this file index
    const orderIndex = projectorFilesOrder.indexOf(targetIndex);
    if (orderIndex < 0) {
      return { success: false };
    }

    // Update current projector index
    currentProjectorIndex = orderIndex;
    isShowingBackground = false; // Reset flag when navigating to a file

    // Navigate to the target index
    projectorWindow.webContents.send('projector-navigate', targetIndex);
    // Also notify main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-navigate', targetIndex);
    }

    return { success: true, index: targetIndex };
  });

  ipcMain.handle('toggle-projector-play-pause', async () => {
    if (!projectorWindow) return { success: false };

    const wasPlaying = isProjectorPlaying;
    isProjectorPlaying = !isProjectorPlaying;

    // If we're showing background and user wants to play, navigate to first item
    if (isShowingBackground && isProjectorPlaying && !wasPlaying && projectorFilesOrder.length > 0) {
      isShowingBackground = false;
      currentProjectorIndex = 0;
      const actualIndex = projectorFilesOrder[currentProjectorIndex];
      projectorWindow.webContents.send('projector-navigate', actualIndex);
      // Also notify main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-navigate', actualIndex);
      }
    }

    projectorWindow.webContents.send('projector-play-pause', isProjectorPlaying);
    // Also notify main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-play-pause', isProjectorPlaying);
    }
    return { success: true, isPlaying: isProjectorPlaying };
  });

  ipcMain.handle('notify-projector-index-change', async (_event, index: number) => {
    // Update the current projector index based on the file index
    // The index parameter is the index in the projectorFiles array
    // We need to find which position in projectorFilesOrder corresponds to this file index
    if (index < 0) {
      // Background shown
      isShowingBackground = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-navigate', -1);
      }
      return { success: true };
    }

    // Find the position in projectorFilesOrder that corresponds to this file index
    const orderIndex = projectorFilesOrder.indexOf(index);
    if (orderIndex >= 0) {
      currentProjectorIndex = orderIndex;
      isShowingBackground = false; // Reset flag when navigating to a file
      // Send the actual flattened index to the main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-navigate', index);
      }
    }

    return { success: true };
  });

  ipcMain.handle('update-projector-settings', async (_event, settings) => {
    if (!projectorWindow) return { success: false };

    // Ensure random is disabled if loop is disabled
    const validatedSettings = {
      ...settings,
      random: settings.loop ? settings.random : false,
    };

    projectorSettings = validatedSettings;

    // Recreate order if random setting changed
    if (validatedSettings.random) {
      projectorFilesOrder = shuffleArray(projectorFiles.map((_, i) => i));
    } else {
      projectorFilesOrder = projectorFiles.map((_, i) => i);
    }

    projectorWindow.webContents.send('projector-settings', validatedSettings);
    return { success: true };
  });

  ipcMain.handle('update-projector-volume', async (_event, volume: number) => {
    if (!projectorWindow) return { success: false };

    projectorWindow.webContents.send('projector-volume', volume);
    return { success: true };
  });

  ipcMain.handle('seek-projector-video', async (_event, time: number) => {
    if (!projectorWindow) return { success: false };

    projectorWindow.webContents.send('projector-seek-video', time);
    return { success: true };
  });

  ipcMain.handle('send-video-progress', async (_event, progress: { currentTime: number; duration: number }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-video-progress', progress);
    }
    return { success: true };
  });

  ipcMain.handle('send-timer-progress', async (_event, progress: { elapsed: number; total: number }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-timer-progress', progress);
    }
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
    if (!projectorWindow || projectorWindow.isDestroyed()) return { success: false };

    const isFullscreen = projectorWindow.isFullScreen();
    projectorWindow.setFullScreen(!isFullscreen);
    return { success: true, isFullscreen: !isFullscreen };
  });

  ipcMain.handle('is-projector-fullscreen', async () => {
    if (!projectorWindow || projectorWindow.isDestroyed()) return false;
    return projectorWindow.isFullScreen();
  });

  ipcMain.handle('update-projector-files', async (_event, files: Array<{ id: string; name: string; type: string; data: string }>) => {
    if (!projectorWindow) return { success: false };

    projectorFiles = files;

    // Ensure random is disabled if loop is disabled (safety check)
    if (projectorSettings && !projectorSettings.loop) {
      projectorSettings.random = false;
    }

    // Recreate order array based on current settings
    if (projectorSettings?.random && projectorSettings?.loop) {
      projectorFilesOrder = shuffleArray(files.map((_, i) => i));
    } else {
      projectorFilesOrder = files.map((_, i) => i);
    }

    // Reset current index if it's out of bounds
    if (currentProjectorIndex >= projectorFilesOrder.length) {
      currentProjectorIndex = Math.max(0, projectorFilesOrder.length - 1);
    }

    // Send updated files to projector window
    projectorWindow.webContents.send('projector-files-updated', files);

    // Update navigation if needed
    if (projectorFilesOrder.length > 0 && currentProjectorIndex >= 0) {
      const actualIndex = projectorFilesOrder[currentProjectorIndex];
      isShowingBackground = false; // Reset flag when navigating to a file
      projectorWindow.webContents.send('projector-navigate', actualIndex);
      // Also notify main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-navigate', actualIndex);
      }
    } else {
      isShowingBackground = true; // Set flag when showing background
      projectorWindow.webContents.send('projector-navigate', -1);
      // Also notify main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projector-navigate', -1);
      }
    }

    return { success: true };
  });

  // Window control handlers
  ipcMain.handle('window-minimize', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('window-maximize', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return { success: true, isMaximized: mainWindow.isMaximized() };
    }
    return { success: false };
  });

  ipcMain.handle('window-close', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('window-is-maximized', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.isMaximized();
    }
    return false;
  });

  // Startup settings handlers
  ipcMain.handle('update-startup-settings', async (_event, settings: { bootOnStartup: boolean; bootInProjectorMode: boolean }) => {
    appSettings = settings;

    // Update login item settings
    const loginItemSettings: Electron.Settings = {
      openAtLogin: settings.bootOnStartup,
      openAsHidden: false,
      args: settings.bootInProjectorMode ? ['--projector-mode'] : [],
    };

    app.setLoginItemSettings(loginItemSettings);

    return { success: true };
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

  // Handle tray open projector event
  ipcMain.on('tray-open-projector-request', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Request files and settings from renderer
      mainWindow.webContents.send('tray-open-projector-request');
    }
  });

  // Load persistent settings
  ipcMain.handle('load-settings', async () => {
    try {
      const settingsPath = getSettingsPath();
      if (existsSync(settingsPath)) {
        const settingsData = await fs.readFile(settingsPath, 'utf-8');
        return JSON.parse(settingsData);
      }
      return null;
    } catch (error) {
      console.error('Error loading settings:', error);
      return null;
    }
  });

  // Save persistent settings
  ipcMain.handle('save-settings', async (_event, settings: any) => {
    try {
      const settingsPath = getSettingsPath();
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      // Update exit behavior settings in main process
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

      // Save files
      for (const file of filesData) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileExtension = path.extname(safeName) || (file.type === 'image' ? '.png' : file.type === 'video' ? '.mp4' : '.pdf');
        const baseName = path.basename(safeName, fileExtension);
        const savedFileName = file.pageNumber
          ? `${file.id}_page${file.pageNumber}${fileExtension}`
          : `${file.id}${fileExtension}`;
        const savedFilePath = path.join(filesDir, savedFileName);

        const base64Data = file.data.split(',')[1] || file.data;
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.writeFile(savedFilePath, buffer);
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving files:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Save thumbnail to persistence
  ipcMain.handle('save-thumbnail', async (_event, fileId: string, thumbnailData: string) => {
    try {
      const storagePath = getFilesStoragePath();
      const thumbnailsDir = path.join(storagePath, 'thumbnails');

      // Create thumbnails directory
      await fs.mkdir(thumbnailsDir, { recursive: true });

      const thumbnailPath = path.join(thumbnailsDir, `${fileId}.jpg`);

      // Convert base64 data URL to buffer and save
      const base64Data = thumbnailData.split(',')[1] || thumbnailData;
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(thumbnailPath, buffer);

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

      // Determine file extension
      const fileExtension = fileData.type === 'image' ? '.png' : fileData.type === 'video' ? '.mp4' : '.pdf';
      const savedFileName = `${fileData.id}${fileExtension}`;
      const savedFilePath = path.join(filesDir, savedFileName);

      // Convert base64 to buffer and save
      const base64Data = fileData.data.split(',')[1] || fileData.data;
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(savedFilePath, buffer);

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

      // Determine file extension
      const fileExtension = fileType === 'image' ? '.png' : fileType === 'video' ? '.mp4' : '.pdf';
      const savedFileName = `${fileId}${fileExtension}`;
      const savedFilePath = path.join(filesDir, savedFileName);

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
        const fileExtension = fileMeta.type === 'image' ? '.png' : fileMeta.type === 'video' ? '.mp4' : '.pdf';
        const savedFileName = fileMeta.pageNumber
          ? `${fileMeta.id}_page${fileMeta.pageNumber}${fileExtension}`
          : `${fileMeta.id}${fileExtension}`;
        const filePath = path.join(filesDir, savedFileName);

        if (existsSync(filePath)) {
          const fileBuffer = await fs.readFile(filePath);
          const base64Data = fileBuffer.toString('base64');

          // Determine mime type
          let mimeType = 'image/png';
          if (fileMeta.type === 'video') {
            mimeType = 'video/mp4';
          } else if (fileMeta.type === 'document') {
            mimeType = 'application/pdf';
          } else if (path.extname(savedFileName).toLowerCase() === '.jpg' || path.extname(savedFileName).toLowerCase() === '.jpeg') {
            mimeType = 'image/jpeg';
          }

          const dataUrl = `data:${mimeType};base64,${base64Data}`;
          files.push({
            id: fileMeta.id,
            name: fileMeta.name,
            type: fileMeta.type,
            data: dataUrl,
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

      // Copy files
      const fileMapping: Record<string, string> = {}; // Maps file ID to saved filename
      for (const file of projectData.files) {
        // Create a safe filename - only remove characters that are invalid in file systems
        const safeName = file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const fileExtension = path.extname(safeName) || (file.type === 'image' ? '.png' : file.type === 'video' ? '.mp4' : '.pdf');
        const baseName = path.basename(safeName, fileExtension);
        const savedFileName = file.pageNumber
          ? `${baseName}_page${file.pageNumber}${fileExtension}`
          : `${baseName}${fileExtension}`;
        const savedFilePath = path.join(filesDir, savedFileName);

        // Convert base64 data URL to buffer and save
        const base64Data = file.data.split(',')[1] || file.data;
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.writeFile(savedFilePath, buffer);

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

          // Determine file type from extension
          const ext = path.extname(entry.name).toLowerCase();
          let fileType = 'image';
          let mimeType = 'image/png';
          if (['.mp4', '.webm', '.ogg', '.mov', '.avi'].includes(ext)) {
            fileType = 'video';
            mimeType = 'video/mp4';
          } else if (ext === '.pdf') {
            fileType = 'document';
            mimeType = 'application/pdf';
          } else if (['.jpg', '.jpeg'].includes(ext)) {
            mimeType = 'image/jpeg';
          } else if (ext === '.png') {
            mimeType = 'image/png';
          } else if (ext === '.gif') {
            mimeType = 'image/gif';
          } else if (ext === '.webp') {
            mimeType = 'image/webp';
          }

          // Extract page number from filename if present
          const pageMatch = entry.name.match(/_page(\d+)/);
          const pageNumber = pageMatch ? parseInt(pageMatch[1], 10) : undefined;

          // Find original ID from mapping (reverse lookup)
          const originalId = Object.keys(fileMapping).find(
            id => fileMapping[id] === entry.name
          ) || `${entry.name}-${Date.now()}-${Math.random()}`;

          // Read file and convert to base64
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
        // Load settings
        const settingsPath = getSettingsPath();
        if (existsSync(settingsPath)) {
          const settingsData = await fs.readFile(settingsPath, 'utf-8');
          const settings = JSON.parse(settingsData);
          // Load exit behavior settings
          if (settings.showExitPrompt !== undefined) {
            exitBehaviorSettings.showExitPrompt = settings.showExitPrompt;
          }
          if (settings.exitBehavior !== undefined) {
            exitBehaviorSettings.exitBehavior = settings.exitBehavior;
          }
          mainWindow?.webContents.send('load-persistent-settings', settings);
        }

        // Load files
        const storagePath = getFilesStoragePath();
        const filesDir = path.join(storagePath, 'files');
        const metadataPath = path.join(storagePath, 'metadata.json');

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
              // Only load full files, not page files (pages are part of PDFs)
              if (fileMeta.pageNumber) {
                continue; // Skip page files, we'll load the full PDF
              }

              const fileExtension = fileMeta.type === 'image' ? '.png' : fileMeta.type === 'video' ? '.mp4' : '.pdf';
              const savedFileName = `${fileMeta.id}${fileExtension}`;
              const filePath = path.join(filesDir, savedFileName);

              if (existsSync(filePath)) {
                const fileBuffer = await fs.readFile(filePath);
                const base64Data = fileBuffer.toString('base64');

                let mimeType = 'image/png';
                if (fileMeta.type === 'video') {
                  mimeType = 'video/mp4';
                } else if (fileMeta.type === 'document') {
                  mimeType = 'application/pdf';
                } else if (path.extname(savedFileName).toLowerCase() === '.jpg' || path.extname(savedFileName).toLowerCase() === '.jpeg') {
                  mimeType = 'image/jpeg';
                }

                const dataUrl = `data:${mimeType};base64,${base64Data}`;
                files.push({
                  id: fileMeta.id,
                  name: fileMeta.name,
                  type: fileMeta.type,
                  data: dataUrl,
                });
              }
            }

            mainWindow?.webContents.send('load-persistent-files', {
              files,
              fileOrder: metadata.fileOrder || [],
            });
          } catch (error) {
            console.error('Error loading persistent files:', error);
          }
        }
      } catch (error) {
        console.error('Error loading persistent data:', error);
      }

      // If booting in projector mode, wait a bit then open projector
      if (shouldBootInProjectorMode) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('boot-in-projector-mode');
          }
        }, 500);
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
