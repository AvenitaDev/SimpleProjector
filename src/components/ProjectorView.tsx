import { useEffect, useState, useRef, useCallback } from "react";
import { FileType } from "../types/file";
import { ProjectorSettings, defaultSettings } from "../types/settings";
import * as pdfjsLib from "pdfjs-dist";
import { Maximize2, X, Minimize2 } from "lucide-react";
import { cn } from "../lib/utils";
import pdfWorkerURL from "pdfjs-dist/build/pdf.worker.min?url";
import "../types/electron"; // Import electron API types

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  pdfWorkerURL,
  import.meta.url
).toString();

interface ProjectorFile {
  id: string;
  name: string;
  type: FileType;
  data: string; // base64 data URL
  pageNumber?: number; // For PDF pages
}

export const ProjectorView = () => {
  const [files, setFiles] = useState<ProjectorFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [settings, setSettings] = useState<ProjectorSettings>(defaultSettings);
  const [pdfThumbnail, setPdfThumbnail] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isIdle, setIsIdle] = useState(false);
  const [volume, setVolume] = useState<number>(1.0);
  const [previousIndex, setPreviousIndex] = useState<number>(-1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerStartTimeRef = useRef<number | null>(null);
  const videoProgressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerProgressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const volumeRef = useRef<number>(1.0);
  const isPlayingRef = useRef<boolean>(false);
  const isSeekingRef = useRef<boolean>(false);
  const filesRef = useRef<ProjectorFile[]>([]);
  const currentIndexRef = useRef<number>(0);
  const hasAutoStartedRef = useRef<boolean>(false);
  const previousPdfThumbnailRef = useRef<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    const handleMouseMove = () => {
      setIsIdle(false);
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
      idleTimeoutRef.current = setTimeout(() => {
        setIsIdle(true);
      }, 3000);
    };

    if (isHovered) {
      setIsIdle(false);
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
      idleTimeoutRef.current = setTimeout(() => {
        setIsIdle(true);
      }, 3000);
      window.addEventListener("mousemove", handleMouseMove);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        if (idleTimeoutRef.current) {
          clearTimeout(idleTimeoutRef.current);
          idleTimeoutRef.current = null;
        }
      };
    } else {
      setIsIdle(false);
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
    }
  }, [isHovered]);

  // Track previous index for transitions
  useEffect(() => {
    if (
      currentIndex !== previousIndex &&
      previousIndex >= 0 &&
      files.length > 0 &&
      currentIndex >= 0
    ) {
      // Store previous PDF thumbnail before transition starts
      if (previousIndex >= 0 && previousIndex < files.length) {
        const prevFile = files[previousIndex];
        if (prevFile.type === "document" && pdfThumbnail) {
          previousPdfThumbnailRef.current = pdfThumbnail;
        }
      }
      setIsTransitioning(true);
      const timer = setTimeout(() => {
        setIsTransitioning(false);
        setPreviousIndex(currentIndex);
        // Clear previous PDF thumbnail after transition completes
        previousPdfThumbnailRef.current = null;
      }, 500); // Match transition duration
      return () => clearTimeout(timer);
    } else if (previousIndex < 0 && currentIndex >= 0) {
      // Initial load
      setPreviousIndex(currentIndex);
    }
  }, [currentIndex, previousIndex, files.length, pdfThumbnail]);

  // Helper function to calculate settings hash (excluding welcome dialog fields)
  const calculateSettingsHash = (settings: ProjectorSettings): string => {
    const settingsForHash = {
      enableTimeBetweenElements: settings.enableTimeBetweenElements,
      timeBetweenElements: settings.timeBetweenElements,
      loop: settings.loop,
      random: settings.random,
      autoPlayVideos: settings.autoPlayVideos,
      backgroundColor: settings.backgroundColor,
      backgroundImage: settings.backgroundImage,
      showBackgroundWithFiles: settings.showBackgroundWithFiles,
      openFullscreen: settings.openFullscreen,
      bootOnStartup: settings.bootOnStartup,
      bootInProjectorMode: settings.bootInProjectorMode,
      showExitPrompt: settings.showExitPrompt,
      exitBehavior: settings.exitBehavior,
      transitionType: settings.transitionType,
    };
    // Simple hash function
    const str = JSON.stringify(settingsForHash);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  };

  useEffect(() => {
    // Load files and settings from main process
    const loadData = async () => {
      if (window.electronAPI) {
        try {
          const [
            filesResult,
            settingsResult,
            fullscreenState,
            persistentSettings,
          ] = await Promise.all([
            window.electronAPI.getProjectorFiles(),
            window.electronAPI.getProjectorSettings(),
            window.electronAPI.isProjectorFullscreen(),
            window.electronAPI.loadSettings(),
          ]);
          setFiles(
            filesResult.files.map((file) => ({
              ...file,
              type: file.type as FileType,
            }))
          );
          setCurrentIndex(filesResult.currentIndex);
          setIsFullscreen(fullscreenState);
          if (settingsResult) {
            // Merge with defaults to ensure all properties exist
            const mergedSettings = {
              ...defaultSettings,
              ...settingsResult,
            };
            setSettings(mergedSettings);

            // Show welcome dialog if setting is enabled
            // Check for backward compatibility with old dontShowWelcomeDialog setting
            let shouldShow = true;
            if (mergedSettings.showWelcomeDialog === false) {
              shouldShow = false;
            } else if (persistentSettings?.dontShowWelcomeDialog === true) {
              // Backward compatibility: if old setting says don't show, respect it
              // unless settings have changed significantly
              const savedHash = persistentSettings.welcomeDialogSettingsHash;
              const currentHash = calculateSettingsHash(mergedSettings);
              shouldShow = savedHash !== currentHash;
            }
            setShowWelcome(shouldShow);
          } else {
            // Use defaults if no settings received
            setSettings(defaultSettings);
            setShowWelcome(defaultSettings.showWelcomeDialog);
          }
        } catch (error) {
          console.error("Error loading data:", error);
          // Use defaults on error
          setSettings(defaultSettings);
          setShowWelcome(defaultSettings.showWelcomeDialog);
        }
      }
    };

    loadData();

    // Listen for navigation events
    if (window.electronAPI) {
      const handleNavigate = (index: number) => {
        // -1 means show background (no file)
        setCurrentIndex(index);
        if (index === -1) {
          setIsPlaying(false);
        }
      };

      const handlePlayPause = (playing: boolean) => {
        setIsPlaying(playing);
      };

      const handleSettings = async (newSettings: ProjectorSettings) => {
        // Merge with defaults to ensure all properties exist
        const mergedSettings = {
          ...defaultSettings,
          ...newSettings,
        };
        setSettings(mergedSettings);
        // Don't show welcome dialog when settings change - only show on initial load
      };

      const handleFilesUpdated = async (updatedFiles: ProjectorFile[]) => {
        setFiles(updatedFiles);
        // Reload current index from main process to ensure consistency
        if (window.electronAPI) {
          try {
            const filesResult = await window.electronAPI.getProjectorFiles();
            setCurrentIndex(filesResult.currentIndex);
          } catch (error) {
            console.error("Error reloading projector index:", error);
          }
        }
      };

      const handleFullscreenChanged = (fullscreen: boolean) => {
        setIsFullscreen(fullscreen);
      };

      const handleVolume = (newVolume: number) => {
        setVolume(newVolume);
      };

      const handleSeekVideo = (time: number) => {
        const video = videoRef.current;
        if (!video) {
          return;
        }

        // Use refs to get current values (not stale closure values)
        const currentFiles = filesRef.current;
        const currentIdx = currentIndexRef.current;

        if (
          currentFiles.length === 0 ||
          currentIdx < 0 ||
          currentIdx >= currentFiles.length
        ) {
          return;
        }

        const currentFile = currentFiles[currentIdx];
        if (currentFile.type !== "video") {
          return;
        }

        isSeekingRef.current = true;

        // Clamp time to valid range
        let clampedTime = Math.max(0, time);
        if (video.duration && !isNaN(video.duration) && video.duration > 0) {
          clampedTime = Math.min(clampedTime, video.duration);
        }

        // Function to perform the seek
        const performSeek = () => {
          // Store current playing state
          const wasPlaying = !video.paused;

          // If video is playing, pause it temporarily to ensure seek works
          if (wasPlaying) {
            video.pause();
          }

          // Set currentTime
          try {
            video.currentTime = clampedTime;

            // If video was playing, resume playback after a brief moment
            if (wasPlaying) {
              // Use requestAnimationFrame to ensure the seek is processed
              requestAnimationFrame(() => {
                video.play().catch(console.error);
              });
            }
          } catch (error) {
            console.error("Error setting video currentTime:", error);
            isSeekingRef.current = false;
            // Resume playback if it was playing
            if (wasPlaying) {
              video.play().catch(console.error);
            }
          }
        };

        // If video has metadata loaded, seek immediately
        if (video.readyState >= 1) {
          // HAVE_METADATA or higher
          performSeek();
        } else {
          // Wait for metadata to load
          const handleLoadedMetadata = () => {
            performSeek();
            video.removeEventListener("loadedmetadata", handleLoadedMetadata);
          };
          video.addEventListener("loadedmetadata", handleLoadedMetadata, {
            once: true,
          });
        }

        // Reset seeking flag after seek completes
        const handleSeeked = () => {
          isSeekingRef.current = false;
        };

        // Listen for seeked event
        video.addEventListener("seeked", handleSeeked, { once: true });

        // Fallback: reset after timeout
        setTimeout(() => {
          isSeekingRef.current = false;
        }, 1000);
      };

      window.electronAPI.onProjectorNavigate(handleNavigate);
      window.electronAPI.onProjectorPlayPause(handlePlayPause);
      window.electronAPI.onProjectorSettings(handleSettings);
      window.electronAPI.onProjectorFilesUpdated(handleFilesUpdated);
      window.electronAPI.onProjectorFullscreenChanged(handleFullscreenChanged);
      window.electronAPI.onProjectorVolume(handleVolume);
      window.electronAPI.onProjectorSeekVideo(handleSeekVideo);

      return () => {
        if (window.electronAPI) {
          window.electronAPI.removeAllListeners("projector-navigate");
          window.electronAPI.removeAllListeners("projector-play-pause");
          window.electronAPI.removeAllListeners("projector-settings");
          window.electronAPI.removeAllListeners("projector-files-updated");
          window.electronAPI.removeAllListeners("projector-fullscreen-changed");
          window.electronAPI.removeAllListeners("projector-volume");
          window.electronAPI.removeAllListeners("projector-seek-video");
        }
      };
    }
  }, []);

  // Auto-start playing when projector opens if auto-advance or auto-play videos is enabled
  useEffect(() => {
    // Only auto-start once on initial load if:
    // 1. Files are loaded
    // 2. Settings are loaded
    // 3. Either auto-advance or auto-play videos is enabled
    // 4. We haven't already auto-started
    if (
      !hasAutoStartedRef.current &&
      files.length > 0 &&
      currentIndex >= 0 &&
      (settings.enableTimeBetweenElements || settings.autoPlayVideos) &&
      !isPlaying
    ) {
      hasAutoStartedRef.current = true;
      setIsPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    files.length,
    settings.enableTimeBetweenElements,
    settings.autoPlayVideos,
    currentIndex,
  ]);

  const handleToggleFullscreen = async () => {
    if (window.electronAPI) {
      try {
        await window.electronAPI.toggleProjectorFullscreen();
      } catch (error) {
        console.error("Error toggling fullscreen:", error);
      }
    }
  };

  const handleDismissWelcome = async () => {
    setShowWelcome(false);

    if (dontShowAgain && window.electronAPI) {
      try {
        const currentSettings = await window.electronAPI.loadSettings();
        const updatedSettings = {
          ...defaultSettings,
          ...currentSettings,
          ...settings,
          showWelcomeDialog: false,
        };
        await window.electronAPI.updateProjectorSettings(updatedSettings);
        await window.electronAPI.saveSettings(updatedSettings);
        setSettings(updatedSettings);
      } catch (error) {
        console.error("Error saving welcome dialog preference:", error);
      }
    }
  };

  const handleCloseProjector = async () => {
    if (window.electronAPI) {
      try {
        await window.electronAPI.closeProjectorWindow();
      } catch (error) {
        console.error("Error closing projector:", error);
      }
    }
  };

  const handleClick = (event: React.MouseEvent) => {
    if (showWelcome) return;

    const target = event.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest('[style*="no-drag"]') ||
      target.closest('[style*="drag"]') ||
      target.getAttribute("style")?.includes("drag")
    ) {
      return;
    }

    if (!isFullscreen && event.clientY <= 32) {
      return;
    }

    if (window.electronAPI) {
      if (event.button === 0) {
        window.electronAPI.navigateProjector("next").catch((error) => {
          console.error("Error navigating forward:", error);
        });
      } else if (event.button === 2) {
        event.preventDefault();
        window.electronAPI.navigateProjector("previous").catch((error) => {
          console.error("Error navigating backward:", error);
        });
      }
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
  };

  // Track if currentIndex was changed by auto-play (not by navigation event)
  const isAutoPlayChangeRef = useRef(false);

  // Helper function to advance to next file
  // Uses the main process navigation handler which respects random order
  const advanceToNext = useCallback(() => {
    if (window.electronAPI) {
      isAutoPlayChangeRef.current = true;
      // Use the main process navigation handler which handles random order correctly
      window.electronAPI.navigateProjector("next").catch((error) => {
        console.error("Error navigating projector:", error);
        // Fallback to local navigation if IPC fails
        setCurrentIndex((prev) => {
          if (prev < 0) return -1; // Already showing background
          const next = prev + 1;
          if (next >= files.length) {
            if (settings.loop) {
              return 0;
            } else {
              setIsPlaying(false);
              return -1; // Show background when loop is disabled
            }
          }
          return next;
        });
      });
    } else {
      // Fallback if electronAPI is not available
      isAutoPlayChangeRef.current = true;
      setCurrentIndex((prev) => {
        if (prev < 0) return -1; // Already showing background
        const next = prev + 1;
        if (next >= files.length) {
          if (settings.loop) {
            return 0;
          } else {
            // Stop playback and show background when loop is disabled
            setIsPlaying(false);
            return -1; // Show background when loop is disabled
          }
        }
        return next;
      });
    }
  }, [files.length, settings.loop]);

  // Handle auto-play timer for images and documents (not videos)
  useEffect(() => {
    // Clear any existing interval
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    // Reset timer start time when navigating
    timerStartTimeRef.current = Date.now();

    // Only start timer if playing, auto-advance is enabled, and current file is not a video
    if (
      isPlaying &&
      settings.enableTimeBetweenElements &&
      files.length > 0 &&
      currentIndex >= 0 &&
      currentIndex < files.length
    ) {
      const currentFile = files[currentIndex];
      // Only use timer for images and documents, not videos
      if (currentFile.type !== "video") {
        playIntervalRef.current = setInterval(() => {
          advanceToNext();
        }, settings.timeBetweenElements);
      }
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [
    isPlaying,
    files,
    currentIndex,
    settings.timeBetweenElements,
    settings.enableTimeBetweenElements,
    advanceToNext,
  ]);

  // Handle video ended event to advance to next file
  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      files.length === 0 ||
      currentIndex < 0 ||
      currentIndex >= files.length
    ) {
      return;
    }

    const currentFile = files[currentIndex];
    if (currentFile.type === "video" && isPlaying) {
      const handleVideoEnded = () => {
        advanceToNext();
      };

      video.addEventListener("ended", handleVideoEnded);

      return () => {
        video.removeEventListener("ended", handleVideoEnded);
      };
    }
  }, [currentIndex, files, isPlaying, advanceToNext]);

  // Notify main process when currentIndex changes due to auto-play
  useEffect(() => {
    if (isAutoPlayChangeRef.current && window.electronAPI) {
      isAutoPlayChangeRef.current = false;
      window.electronAPI
        .notifyProjectorIndexChange(currentIndex)
        .catch(console.error);
    }
  }, [currentIndex]);

  // Handle PDF thumbnail generation
  useEffect(() => {
    if (
      files.length === 0 ||
      currentIndex < 0 ||
      currentIndex >= files.length
    ) {
      setPdfThumbnail(null);
      return;
    }

    const currentFile = files[currentIndex];
    if (currentFile.type === "document") {
      const generatePdfThumbnail = async () => {
        try {
          const canvas = canvasRef.current;
          if (!canvas) return;

          // If data is already a rendered page image, use it directly
          if (currentFile.data.startsWith("data:image")) {
            setPdfThumbnail(currentFile.data);
            return;
          }

          // Otherwise, render the PDF page
          const response = await fetch(currentFile.data);
          const arrayBuffer = await response.arrayBuffer();

          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const pageToRender = currentFile.pageNumber || 1;
          const page = await pdf.getPage(pageToRender);

          const viewport = page.getViewport({ scale: 1.0 });
          const maxDimension = Math.max(window.innerWidth, window.innerHeight);
          const scale = Math.min(
            maxDimension / viewport.width,
            maxDimension / viewport.height,
            2.0
          );
          const scaledViewport = page.getViewport({ scale });

          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;

          const context = canvas.getContext("2d");
          if (!context) return;

          await page.render({
            canvasContext: context,
            viewport: scaledViewport,
            canvas: canvas,
          }).promise;

          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          setPdfThumbnail(dataUrl);
        } catch (error) {
          console.error("Error generating PDF thumbnail:", error);
          setPdfThumbnail(null);
        }
      };

      generatePdfThumbnail();
    } else {
      setPdfThumbnail(null);
    }
  }, [currentIndex, files]);

  // Handle video source loading (only when file changes)
  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      files.length === 0 ||
      currentIndex < 0 ||
      currentIndex >= files.length
    ) {
      if (video) {
        video.pause();
        video.src = "";
      }
      return;
    }

    const currentFile = files[currentIndex];
    if (currentFile.type === "video") {
      // Only reload if the source actually changed
      if (video.src !== currentFile.data) {
        video.src = currentFile.data;
        video.load();
        // Set initial volume from ref (latest value)
        video.volume = volumeRef.current;
        // Auto-play if enabled
        if (settings.autoPlayVideos || isPlayingRef.current) {
          video.play().catch(console.error);
        }
      }
    }

    return () => {
      // Cleanup only when component unmounts or file changes significantly
      // Don't clear src on cleanup to preserve playback position
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, files, settings.autoPlayVideos]);

  // Update video volume when volume changes (without reloading)
  useEffect(() => {
    const video = videoRef.current;
    if (
      video &&
      files.length > 0 &&
      currentIndex >= 0 &&
      currentIndex < files.length
    ) {
      const currentFile = files[currentIndex];
      if (currentFile.type === "video") {
        video.volume = volume;
      }
    }
  }, [volume, currentIndex, files]);

  // Control video play/pause based on isPlaying state (without reloading)
  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      files.length === 0 ||
      currentIndex < 0 ||
      currentIndex >= files.length
    ) {
      return;
    }

    const currentFile = files[currentIndex];
    if (currentFile.type === "video") {
      if (isPlaying) {
        video.play().catch(console.error);
      } else {
        video.pause();
      }
    }
  }, [isPlaying, currentIndex, files]);

  // Send video progress updates to main window
  useEffect(() => {
    // Clear any existing interval
    if (videoProgressIntervalRef.current) {
      clearInterval(videoProgressIntervalRef.current);
      videoProgressIntervalRef.current = null;
    }

    const video = videoRef.current;
    if (
      !video ||
      files.length === 0 ||
      currentIndex < 0 ||
      currentIndex >= files.length
    ) {
      return;
    }

    const currentFile = files[currentIndex];
    if (currentFile.type !== "video") {
      return;
    }

    const sendProgress = () => {
      try {
        // Don't send progress updates while seeking to avoid conflicts
        if (isSeekingRef.current) {
          return;
        }
        if (video && video.duration && window.electronAPI) {
          window.electronAPI
            .sendVideoProgress({
              currentTime: video.currentTime || 0,
              duration: video.duration,
            })
            .catch(() => {
              // Silently handle errors
            });
        }
      } catch (error) {
        // Silently handle errors
      }
    };

    // Send progress every 100ms
    videoProgressIntervalRef.current = setInterval(sendProgress, 100);
    sendProgress(); // Send immediately

    return () => {
      if (videoProgressIntervalRef.current) {
        clearInterval(videoProgressIntervalRef.current);
        videoProgressIntervalRef.current = null;
      }
    };
  }, [isPlaying, currentIndex, files]);

  // Send timer progress updates to main window
  useEffect(() => {
    // Clear any existing interval
    if (timerProgressIntervalRef.current) {
      clearInterval(timerProgressIntervalRef.current);
      timerProgressIntervalRef.current = null;
    }

    if (
      isPlaying &&
      settings.enableTimeBetweenElements &&
      files.length > 0 &&
      currentIndex >= 0 &&
      currentIndex < files.length
    ) {
      const currentFile = files[currentIndex];
      if (currentFile.type !== "video") {
        // Ensure timer start time is set
        if (timerStartTimeRef.current === null) {
          timerStartTimeRef.current = Date.now();
        }

        const sendProgress = () => {
          try {
            if (timerStartTimeRef.current !== null && window.electronAPI) {
              const elapsed = Date.now() - timerStartTimeRef.current;
              window.electronAPI
                .sendTimerProgress({
                  elapsed: Math.min(elapsed, settings.timeBetweenElements),
                  total: settings.timeBetweenElements,
                })
                .catch(console.error);
            }
          } catch (error) {
            console.error("Error sending timer progress:", error);
          }
        };

        // Send progress every 100ms
        timerProgressIntervalRef.current = setInterval(sendProgress, 100);
        sendProgress(); // Send immediately
      }
    }

    return () => {
      if (timerProgressIntervalRef.current) {
        clearInterval(timerProgressIntervalRef.current);
        timerProgressIntervalRef.current = null;
      }
    };
  }, [
    isPlaying,
    currentIndex,
    files,
    settings.enableTimeBetweenElements,
    settings.timeBetweenElements,
  ]);

  // Get background style
  const getBackgroundStyle = (): React.CSSProperties => {
    if (settings.backgroundImage) {
      return {
        backgroundImage: `url(${settings.backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      };
    }
    return {
      backgroundColor: settings.backgroundColor,
    };
  };

  // Show background when no files or currentIndex is -1 (end of non-looping sequence)
  if (files.length === 0 || currentIndex === -1) {
    return (
      <div
        className={`w-screen h-screen relative ${isIdle ? "cursor-none" : ""}`}
        style={getBackgroundStyle()}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Draggable region - only when not fullscreen */}
        {!isFullscreen && (
          <div
            className="absolute top-0 left-0 right-0 h-8 bg-transparent z-50"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />
        )}

        {/* Welcome overlay */}
        {showWelcome && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-lg p-8 max-w-md mx-4 border border-gray-700">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold text-white">
                  Welcome to Projector Mode
                </h2>
                <button
                  onClick={handleDismissWelcome}
                  className="text-gray-400 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4 text-gray-300">
                <p className="text-lg">
                  You can use the projector in two modes:
                </p>
                <ul className="space-y-2 list-disc list-inside">
                  <li>
                    <strong className="text-white">Fullscreen Mode:</strong>{" "}
                    Press{" "}
                    <kbd className="px-2 py-1 bg-gray-800 rounded text-sm">
                      F11
                    </kbd>{" "}
                    or click the button below
                  </li>
                  <li>
                    <strong className="text-white">Window Mode:</strong> Drag
                    the window by the top bar to move it around
                  </li>
                </ul>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="dont-show-again"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <label
                    htmlFor="dont-show-again"
                    className="text-sm text-gray-300 cursor-pointer"
                  >
                    Don't show this message again
                  </label>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleToggleFullscreen}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    <Maximize2 className="w-5 h-5" />
                    Toggle Fullscreen
                  </button>
                  <button
                    onClick={handleDismissWelcome}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Hover controls */}
        <div
          className={`absolute top-4 right-4 flex gap-2 z-50 transition-all duration-200 ${
            isHovered && !showWelcome && !isIdle
              ? "opacity-100 translate-y-0 delay-100"
              : "opacity-0 translate-y-[-10px] pointer-events-none delay-0"
          }`}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            onClick={handleToggleFullscreen}
            className="p-3 bg-black/70 hover:bg-black/90 text-white rounded-lg transition-all backdrop-blur-sm"
            aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-5 h-5" />
            ) : (
              <Maximize2 className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={handleCloseProjector}
            className="p-3 border-2 border-white/30 hover:border-white/60 hover:bg-white/10 text-white rounded-lg transition-all backdrop-blur-sm"
            aria-label="Close Projector"
            title="Close Projector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  const currentFile = files[currentIndex];
  if (!currentFile) {
    return <div className="w-screen h-screen" style={getBackgroundStyle()} />;
  }

  // Helper function to render a file
  const renderFile = (
    file: ProjectorFile,
    thumbnail: string | null,
    isExiting: boolean = false,
    shouldAnimate: boolean = true
  ) => {
    // For exiting files: only apply exit animation when shouldAnimate is true
    // This prevents the blink by showing the file first, then animating it out
    const transitionClass =
      settings.transitionType === "none"
        ? ""
        : isExiting
          ? shouldAnimate
            ? cn(
                settings.transitionType === "fade" && "transition-fade-exit",
                settings.transitionType === "slide" && "transition-slide-exit",
                settings.transitionType === "zoom" && "transition-zoom-exit",
                settings.transitionType === "blur" && "transition-blur-exit",
                settings.transitionType === "rotate" && "transition-rotate-exit"
              )
            : ""
          : cn(
              settings.transitionType === "fade" && "transition-fade-enter",
              settings.transitionType === "slide" && "transition-slide-enter",
              settings.transitionType === "zoom" && "transition-zoom-enter",
              settings.transitionType === "blur" && "transition-blur-enter",
              settings.transitionType === "rotate" && "transition-rotate-enter"
            );

    return (
      <div
        key={`${file.id}-${isExiting ? "exit" : "enter"}`}
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          transitionClass
        )}
      >
        {file.type === "image" && (
          <img
            src={file.data}
            alt={file.name}
            className="w-screen h-screen object-contain"
          />
        )}

        {file.type === "video" && !isExiting && (
          <video
            ref={videoRef}
            className="w-screen h-screen"
            controls={false}
            autoPlay={isPlaying}
            muted={false}
            preload="metadata"
          />
        )}

        {file.type === "document" && thumbnail && (
          <img
            src={thumbnail}
            alt={file.name}
            className="max-w-full max-h-full object-contain"
          />
        )}

        {file.type === "document" && !thumbnail && (
          <div className="text-white text-center">
            <p className="text-2xl mb-4">Loading PDF...</p>
            <p className="text-lg">{file.name}</p>
          </div>
        )}
      </div>
    );
  };

  const previousFile =
    previousIndex >= 0 && previousIndex < files.length
      ? files[previousIndex]
      : null;
  // Show previous file when index changes, NOT when isTransitioning is true
  // This prevents the blink by ensuring the file is visible before the animation starts
  const showPreviousFile =
    settings.transitionType !== "none" &&
    previousFile &&
    previousIndex !== currentIndex;

  return (
    <div
      className={`w-screen h-screen flex items-center justify-center overflow-hidden relative ${isIdle ? "cursor-none" : ""}`}
      style={
        settings.showBackgroundWithFiles
          ? getBackgroundStyle()
          : { backgroundColor: "#000000" }
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Draggable region - only when not fullscreen */}
      {!isFullscreen && (
        <div
          className="absolute top-0 left-0 right-0 h-8 bg-transparent z-50"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      )}

      {/* Welcome overlay */}
      {showWelcome && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg p-8 max-w-md mx-4 border border-gray-700">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold text-white">
                Welcome to Projector Mode
              </h2>
              <button
                onClick={handleDismissWelcome}
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4 text-gray-300">
              <p className="text-lg">You can use the projector in two modes:</p>
              <ul className="space-y-2 list-disc list-inside">
                <li>
                  <strong className="text-white">Fullscreen Mode:</strong> Press{" "}
                  <kbd className="px-2 py-1 bg-gray-800 rounded text-sm">
                    F11
                  </kbd>{" "}
                  or click the button below
                </li>
                <li>
                  <strong className="text-white">Window Mode:</strong> Drag the
                  window by the top bar to move it around
                </li>
              </ul>
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="dont-show-again-2"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                />
                <label
                  htmlFor="dont-show-again-2"
                  className="text-sm text-gray-300 cursor-pointer"
                >
                  Don't show this message again
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleToggleFullscreen}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Maximize2 className="w-5 h-5" />
                  Toggle Fullscreen
                </button>
                <button
                  onClick={handleDismissWelcome}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {/* Previous file (exiting) */}
      {showPreviousFile &&
        previousFile &&
        renderFile(
          previousFile,
          previousFile.type === "document"
            ? previousPdfThumbnailRef.current ||
                (previousFile.data.startsWith("data:image")
                  ? previousFile.data
                  : null)
            : null,
          true,
          isTransitioning // Only animate when isTransitioning is true (prevents blink)
        )}

      {/* Current file (entering) */}
      {renderFile(currentFile, pdfThumbnail, false)}

      {/* Hover controls */}
      <div
        className={`absolute top-4 right-4 flex gap-2 z-50 transition-all duration-200 ${
          isHovered && !showWelcome && !isIdle
            ? "opacity-100 translate-y-0 delay-100"
            : "opacity-0 translate-y-[-10px] pointer-events-none delay-0"
        }`}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={handleToggleFullscreen}
          className="p-3 bg-black/70 hover:bg-black/90 text-white rounded-lg transition-all backdrop-blur-sm"
          aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 className="w-5 h-5" />
          ) : (
            <Maximize2 className="w-5 h-5" />
          )}
        </button>
        <button
          onClick={handleCloseProjector}
          className="p-3 border-2 border-white/30 hover:border-white/60 hover:bg-white/10 text-white rounded-lg transition-all backdrop-blur-sm"
          aria-label="Close Projector"
          title="Close Projector"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
