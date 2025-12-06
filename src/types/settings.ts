export interface ProjectorSettings {
  enableTimeBetweenElements: boolean; // enable/disable auto-advance timer
  timeBetweenElements: number; // milliseconds
  loop: boolean;
  random: boolean;
  autoPlayVideos: boolean;
  backgroundColor: string; // hex color or 'transparent'
  backgroundImage: string | null; // base64 data URL or null
  showBackgroundWithFiles: boolean; // show background even when files are displayed
  openFullscreen: boolean; // open projector in fullscreen mode
  bootOnStartup: boolean; // start app on system startup
  bootInProjectorMode: boolean; // open in projector mode on startup (requires bootOnStartup)
  bootWindowState: 'minimized' | 'normal'; // window state when app is launched
  showExitPrompt: boolean; // show prompt when closing the window
  exitBehavior: 'minimize' | 'close'; // what to do when closing: minimize to tray or close completely
  showWelcomeDialog: boolean; // show welcome dialog when opening projector mode
  transitionType: 'none' | 'fade' | 'slide' | 'zoom' | 'blur' | 'rotate'; // transition effect between files
  dontShowWelcomeDialog?: boolean; // deprecated: kept for backward compatibility
  welcomeDialogSettingsHash?: string; // deprecated: kept for backward compatibility
}

export const defaultSettings: ProjectorSettings = {
  enableTimeBetweenElements: true,
  timeBetweenElements: 3000,
  loop: true,
  random: false,
  autoPlayVideos: true,
  backgroundColor: '#000000',
  backgroundImage: null,
  showBackgroundWithFiles: false,
  openFullscreen: false,
  bootOnStartup: false,
  bootInProjectorMode: false,
  bootWindowState: 'normal',
  showExitPrompt: true,
  exitBehavior: 'minimize',
  showWelcomeDialog: true,
  transitionType: 'fade',
};

