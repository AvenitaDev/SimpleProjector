import { useCallback, useRef, useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Presentation,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import { FileList } from "./FileList";
import { FileItem, FileType, PdfPage } from "../types/file";
import { ProjectorSettings, defaultSettings } from "../types/settings";
import { TitleBar } from "./TitleBar";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerURL from "pdfjs-dist/build/pdf.worker.min?url";
import "../types/electron"; // Import electron API types

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  pdfWorkerURL,
  import.meta.url
).toString();

const getFileType = (file: File): FileType => {
  if (file.type.startsWith("image/")) {
    return "image";
  }
  if (file.type.startsWith("video/")) {
    return "video";
  }
  if (file.type === "application/pdf") {
    return "document";
  }
  return "image"; // default
};

export const App = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProjectorOpen, setIsProjectorOpen] = useState(false);
  const [settings, setSettings] = useState<ProjectorSettings>(defaultSettings);
  const [currentProjectorIndex, setCurrentProjectorIndex] = useState<
    number | null
  >(null);
  const [volume, setVolume] = useState<number>(1.0); // Volume range: 0.0 to 1.0
  const [videoProgress, setVideoProgress] = useState<{
    currentTime: number;
    duration: number;
  } | null>(null);
  const [timerProgress, setTimerProgress] = useState<{
    elapsed: number;
    total: number;
  } | null>(null);
  const [currentFileType, setCurrentFileType] = useState<
    "video" | "image" | "document" | null
  >(null);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [draggedProgressValue, setDraggedProgressValue] = useState<
    number | null
  >(null);
  const isDraggingProgressRef = useRef(false);
  const draggedProgressValueRef = useRef<number | null>(null);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousVolumeRef = useRef<number>(1.0); // Store volume before muting

  // Convert PDF pages to images at upload time for instant projection
  const convertPdfToImages = async (
    file: File,
    fileId: string
  ): Promise<{ pages: PdfPage[]; totalPages: number }> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;

      const pages: PdfPage[] = [];
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        // Render at high quality for projection
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");

        if (context) {
          await page.render({
            canvasContext: context,
            viewport: viewport,
            canvas: canvas,
          }).promise;

          // Convert to base64 image
          const imageData = canvas.toDataURL("image/jpeg", 0.92);

          pages.push({
            pageNumber: pageNum,
            id: `${fileId}-page-${pageNum}`,
            imageData: imageData,
          });
        }
      }
      return { pages, totalPages: numPages };
    } catch (error) {
      console.error("Error converting PDF to images:", error);
      return { pages: [], totalPages: 0 };
    }
  };

  const handleFiles = useCallback(async (filesList: FileList | null) => {
    if (!filesList || !window.electronAPI) return;

    const fileItems: FileItem[] = [];

    for (const file of Array.from(filesList)) {
      const fileType = getFileType(file);
      const fileId = `${file.name}-${Date.now()}-${Math.random()}`;

      // Convert file to base64 for persistence
      const base64Data = await convertFileToBase64(file);

      // Save file to persistence immediately
      try {
        await window.electronAPI.saveSingleFile({
          id: fileId,
          name: file.name,
          type: fileType,
          data: base64Data,
        });
      } catch (error) {
        console.error("Error saving file to persistence:", error);
      }

      // Create File object from base64 (using persisted copy)
      const base64Content = base64Data.split(",")[1] || base64Data;
      const mimeType = base64Data.split(",")[0].split(":")[1].split(";")[0];
      const byteCharacters = atob(base64Content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      const persistedFile = new File([blob], file.name, { type: mimeType });

      // Generate and save thumbnail
      try {
        let thumbnailData: string | null = null;

        if (fileType === "image") {
          // For images, use the file directly as thumbnail
          thumbnailData = base64Data;
        } else if (fileType === "video") {
          // For videos, generate thumbnail from first frame
          const video = document.createElement("video");
          video.src = URL.createObjectURL(file);
          video.muted = true;
          await new Promise((resolve, reject) => {
            video.onloadedmetadata = () => {
              video.currentTime = Math.min(1, video.duration * 0.1);
            };
            video.onseeked = () => {
              const canvas = document.createElement("canvas");
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                thumbnailData = canvas.toDataURL("image/jpeg", 0.8);
              }
              URL.revokeObjectURL(video.src);
              resolve(null);
            };
            video.onerror = reject;
          });
        } else if (fileType === "document" && file.type === "application/pdf") {
          // For PDFs, generate thumbnail from first page
          const arrayBuffer = await persistedFile.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const page = await pdf.getPage(1);

          const viewport = page.getViewport({ scale: 1.0 });
          const maxDimension = 256;
          const scale = Math.min(
            maxDimension / viewport.width,
            maxDimension / viewport.height,
            2.0
          );
          const scaledViewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          const context = canvas.getContext("2d");

          if (context) {
            await page.render({
              canvasContext: context,
              viewport: scaledViewport,
              canvas: canvas,
            }).promise;
            thumbnailData = canvas.toDataURL("image/jpeg", 0.8);
          }
        }

        // Save thumbnail if generated
        if (thumbnailData && window.electronAPI) {
          await window.electronAPI.saveThumbnail(fileId, thumbnailData);
        }
      } catch (error) {
        console.error("Error generating thumbnail:", error);
      }

      if (fileType === "document" && file.type === "application/pdf") {
        // Convert PDF pages to images at upload time for instant projection
        const { pages, totalPages } = await convertPdfToImages(
          persistedFile,
          fileId
        );

        // Save each page image to persistence
        for (const page of pages) {
          if (page.imageData && window.electronAPI) {
            try {
              await window.electronAPI.saveSingleFile({
                id: page.id,
                name: `${file.name} (Page ${page.pageNumber})`,
                type: "image",
                data: page.imageData,
              });
              // Also save thumbnail for each page
              await window.electronAPI.saveThumbnail(page.id, page.imageData);
            } catch (error) {
              console.error(`Error saving PDF page ${page.pageNumber}:`, error);
            }
          }
        }

        fileItems.push({
          id: fileId,
          name: file.name,
          type: "document",
          file: persistedFile,
          pages,
          totalPages,
        });
      } else {
        // Regular file (image, video, or non-PDF document)
        fileItems.push({
          id: fileId,
          name: file.name,
          type: fileType,
          file: persistedFile,
        });
      }
    }

    setFiles((prev) => [...prev, ...fileItems]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      e.target.value = ""; // Reset input
    },
    [handleFiles]
  );

  const handleSelectFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only trigger if clicking on blank space, not on file items or interactive elements
      const target = e.target as HTMLElement;
      // Check if clicking on the container itself or on empty space
      // Don't trigger if clicking on buttons, inputs, file items, or other interactive elements
      if (target === e.currentTarget) {
        handleSelectFiles();
      } else {
        // Check if the click is on empty space (not on any interactive element)
        const isInteractive =
          target.closest("button") ||
          target.closest("input") ||
          target.closest('[role="button"]') ||
          target.closest(".flex.items-center.gap-4"); // File item container
        if (!isInteractive) {
          handleSelectFiles();
        }
      }
    },
    [handleSelectFiles]
  );

  const handleReorder = (reorderedFiles: FileItem[]) => {
    setFiles(reorderedFiles);
  };

  const handleRemove = async (id: string) => {
    // Find the file to get its type
    const fileToRemove = files.find((f) => f.id === id);

    // Delete from persistence
    if (fileToRemove && window.electronAPI) {
      try {
        await window.electronAPI.deleteFile(id, fileToRemove.type);
      } catch (error) {
        console.error("Error deleting file from persistence:", error);
      }
    }

    // Remove from state
    setFiles((prev) => prev.filter((file) => file.id !== id));
  };

  // Update projector when files change
  const updateProjectorFiles = useCallback(
    async (filesToUpdate: FileItem[]) => {
      if (!window.electronAPI || !isProjectorOpen) return;

      try {
        // Flatten PDF pages into individual items for projection
        const flattenedFiles: Array<{
          fileItem: FileItem;
          page?: PdfPage;
        }> = [];
        for (const fileItem of filesToUpdate) {
          if (
            fileItem.type === "document" &&
            fileItem.pages &&
            fileItem.pages.length > 0
          ) {
            // Add each page as a separate projection item (using pre-rendered images)
            for (const page of fileItem.pages) {
              flattenedFiles.push({ fileItem, page });
            }
          } else {
            // Regular file or PDF without pages
            flattenedFiles.push({ fileItem });
          }
        }

        const filesData = await Promise.all(
          flattenedFiles.map(async ({ fileItem, page }) => {
            if (page && page.imageData) {
              // Use pre-rendered image for PDF pages
              return {
                id: page.id,
                name: `${fileItem.name} (Page ${page.pageNumber})`,
                type: "image" as const,
                data: page.imageData,
                pageNumber: page.pageNumber,
              };
            } else {
              // Regular file (image or video)
              return {
                id: fileItem.id,
                name: fileItem.name,
                type: fileItem.type,
                data: await convertFileToBase64(fileItem.file),
              };
            }
          })
        );

        await window.electronAPI.updateProjectorFiles(filesData);
      } catch (error) {
        console.error("Error updating projector files:", error);
      }
    },
    [isProjectorOpen]
  );

  // Watch for file changes and update projector
  useEffect(() => {
    updateProjectorFiles(files);
  }, [files, updateProjectorFiles]);

  const handleSettingsChange = useCallback(
    async (newSettings: ProjectorSettings) => {
      setSettings(newSettings);
      // Immediately update projector window if it's open
      if (window.electronAPI) {
        try {
          await window.electronAPI.updateProjectorSettings(newSettings);
          // Update startup settings
          await window.electronAPI.updateStartupSettings({
            bootOnStartup: newSettings.bootOnStartup,
            bootInProjectorMode: newSettings.bootInProjectorMode,
          });
          // Update exit behavior settings
          await window.electronAPI.updateExitBehaviorSettings({
            showExitPrompt: newSettings.showExitPrompt,
            exitBehavior: newSettings.exitBehavior,
          });
          // Save settings persistently
          await window.electronAPI.saveSettings(newSettings);
        } catch (error) {
          console.error("Error updating projector settings:", error);
        }
      }
    },
    []
  );

  const convertFileToBase64 = async (file: File): Promise<string> => {
    // Regular file conversion (PDFs are pre-converted to images at upload time)
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleLoadProject = useCallback(
    async (loadedFiles: FileItem[], loadedSettings: ProjectorSettings) => {
      setFiles(loadedFiles);
      setSettings(loadedSettings);

      // Persist the imported data
      if (window.electronAPI) {
        try {
          // Save settings persistently
          await window.electronAPI.saveSettings(loadedSettings);

          // Convert files to base64 and save them
          const flattenedFiles: Array<{
            fileItem: FileItem;
            page?: PdfPage;
            isMainDocument?: boolean;
          }> = [];
          for (const fileItem of loadedFiles) {
            if (
              fileItem.type === "document" &&
              fileItem.pages &&
              fileItem.pages.length > 0
            ) {
              // Add each page as a separate item (with pre-rendered images)
              for (const page of fileItem.pages) {
                flattenedFiles.push({ fileItem, page });
              }
              // Also add the main document itself
              flattenedFiles.push({ fileItem, isMainDocument: true });
            } else {
              // Regular file or PDF without pages
              flattenedFiles.push({ fileItem });
            }
          }

          const filesData = await Promise.all(
            flattenedFiles.map(async ({ fileItem, page, isMainDocument }) => {
              if (page && page.imageData) {
                // Use pre-rendered image for PDF pages
                return {
                  id: page.id,
                  name: `${fileItem.name} (Page ${page.pageNumber})`,
                  type: "image" as const,
                  data: page.imageData,
                  pageNumber: page.pageNumber,
                };
              } else if (isMainDocument) {
                // Save the main document file
                return {
                  id: fileItem.id,
                  name: fileItem.name,
                  type: fileItem.type,
                  data: await convertFileToBase64(fileItem.file),
                };
              } else {
                // Regular file (image or video)
                return {
                  id: fileItem.id,
                  name: fileItem.name,
                  type: fileItem.type,
                  data: await convertFileToBase64(fileItem.file),
                };
              }
            })
          );

          // Build file order from the loaded files
          const fileOrder = loadedFiles.flatMap((f) => {
            if (f.type === "document" && f.pages && f.pages.length > 0) {
              // Include pages and the main document
              return [...f.pages.map((p) => p.id), f.id];
            }
            return [f.id];
          });

          await window.electronAPI.saveFiles(filesData, fileOrder);
        } catch (error) {
          console.error("Error persisting imported project:", error);
        }
      }
    },
    []
  );

  const handleOpenProjector = useCallback(async () => {
    if (!window.electronAPI) {
      console.error("Electron API not available");
      return;
    }

    try {
      // Flatten PDF pages into individual items for projection
      const flattenedFiles: Array<{ fileItem: FileItem; page?: PdfPage }> = [];
      for (const fileItem of files) {
        if (
          fileItem.type === "document" &&
          fileItem.pages &&
          fileItem.pages.length > 0
        ) {
          // Add each page as a separate projection item (using pre-rendered images)
          for (const page of fileItem.pages) {
            flattenedFiles.push({ fileItem, page });
          }
        } else {
          // Regular file or PDF without pages
          flattenedFiles.push({ fileItem });
        }
      }

      const filesData = await Promise.all(
        flattenedFiles.map(async ({ fileItem, page }) => {
          if (page && page.imageData) {
            // Use pre-rendered image for PDF pages
            return {
              id: page.id,
              name: `${fileItem.name} (Page ${page.pageNumber})`,
              type: "image" as const, // PDF pages are now images
              data: page.imageData,
              pageNumber: page.pageNumber,
            };
          } else {
            // Regular file (image or video)
            return {
              id: fileItem.id,
              name: fileItem.name,
              type: fileItem.type,
              data: await convertFileToBase64(fileItem.file),
            };
          }
        })
      );

      await window.electronAPI.openProjectorWindow(filesData, settings);
      setIsProjectorOpen(true);
      // Send initial volume to projector
      await window.electronAPI.updateProjectorVolume(volume);
    } catch (error) {
      console.error("Error opening projector window:", error);
    }
  }, [files, settings, volume]);

  const handleCloseProjector = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      await window.electronAPI.closeProjectorWindow();
      setIsProjectorOpen(false);
    } catch (error) {
      console.error("Error closing projector window:", error);
    }
  }, []);

  const handleNavigate = useCallback(async (direction: "next" | "previous") => {
    if (!window.electronAPI) return;
    await window.electronAPI.navigateProjector(direction);
  }, []);

  const handleTogglePlayPause = useCallback(async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.toggleProjectorPlayPause();
    if (result.isPlaying !== undefined) {
      setIsPlaying(result.isPlaying);
    }
  }, []);

  const handleVolumeChange = useCallback(
    async (newVolume: number) => {
      setVolume(newVolume);
      // Update previous volume if not muted (volume > 0)
      if (newVolume > 0) {
        previousVolumeRef.current = newVolume;
      }
      if (window.electronAPI && isProjectorOpen) {
        try {
          await window.electronAPI.updateProjectorVolume(newVolume);
        } catch (error) {
          console.error("Error updating projector volume:", error);
        }
      }
    },
    [isProjectorOpen]
  );

  const handleToggleMute = useCallback(async () => {
    const isMuted = volume === 0;
    const newVolume = isMuted ? previousVolumeRef.current : 0;

    // If unmuting and previous volume was 0, set to default
    if (isMuted && previousVolumeRef.current === 0) {
      previousVolumeRef.current = 1.0;
      setVolume(1.0);
      if (window.electronAPI && isProjectorOpen) {
        try {
          await window.electronAPI.updateProjectorVolume(1.0);
        } catch (error) {
          console.error("Error updating projector volume:", error);
        }
      }
    } else {
      // Store current volume before muting
      if (!isMuted && volume > 0) {
        previousVolumeRef.current = volume;
      }
      setVolume(newVolume);
      if (window.electronAPI && isProjectorOpen) {
        try {
          await window.electronAPI.updateProjectorVolume(newVolume);
        } catch (error) {
          console.error("Error updating projector volume:", error);
        }
      }
    }
  }, [volume, isProjectorOpen]);

  const handleSeek = useCallback(
    async (time: number) => {
      if (
        window.electronAPI &&
        isProjectorOpen &&
        currentFileType === "video"
      ) {
        try {
          await window.electronAPI.seekProjectorVideo(time);
        } catch (error) {
          console.error("Error seeking video:", error);
        }
      }
    },
    [isProjectorOpen, currentFileType]
  );

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Helper function to get the flattened index for a file/page
  const getFlattenedIndex = useCallback(
    (fileId: string, pageId?: string): number | null => {
      if (files.length === 0) return null;

      // Flatten files the same way as in handleOpenProjector
      let flattenedIndex = 0;
      for (const fileItem of files) {
        if (
          fileItem.type === "document" &&
          fileItem.pages &&
          fileItem.pages.length > 0
        ) {
          for (const page of fileItem.pages) {
            if (fileItem.id === fileId && page.id === pageId) {
              return flattenedIndex;
            }
            flattenedIndex++;
          }
        } else {
          if (fileItem.id === fileId && !pageId) {
            return flattenedIndex;
          }
          flattenedIndex++;
        }
      }
      return null;
    },
    [files]
  );

  // Handle clicking on a file/item to navigate projector to it
  const handleItemClick = useCallback(
    async (fileId: string, pageId?: string) => {
      if (!window.electronAPI || !isProjectorOpen) return;

      const flattenedIndex = getFlattenedIndex(fileId, pageId);
      if (flattenedIndex !== null) {
        try {
          await window.electronAPI.navigateProjectorToIndex(flattenedIndex);
        } catch (error) {
          console.error("Error navigating projector to index:", error);
        }
      }
    },
    [isProjectorOpen, getFlattenedIndex]
  );

  // Helper function to get the current item identifier from projector index
  const getCurrentItemIdentifier = useCallback(
    (index: number | null): { fileId: string; pageId?: string } | null => {
      if (index === null || files.length === 0) return null;

      // Flatten files the same way as in handleOpenProjector
      const flattenedFiles: Array<{ fileItem: FileItem; pageNumber?: number }> =
        [];
      for (const fileItem of files) {
        if (
          fileItem.type === "document" &&
          fileItem.pages &&
          fileItem.pages.length > 0
        ) {
          for (const page of fileItem.pages) {
            flattenedFiles.push({ fileItem, pageNumber: page.pageNumber });
          }
        } else {
          flattenedFiles.push({ fileItem });
        }
      }

      if (index < 0 || index >= flattenedFiles.length) return null;

      const current = flattenedFiles[index];
      if (current.pageNumber) {
        const page = current.fileItem.pages?.find(
          (p) => p.pageNumber === current.pageNumber
        );
        return {
          fileId: current.fileItem.id,
          pageId: page?.id,
        };
      }
      return {
        fileId: current.fileItem.id,
      };
    },
    [files]
  );

  // Load persistent settings and files on mount
  useEffect(() => {
    if (!window.electronAPI) return;

    const loadPersistentSettings = async () => {
      try {
        const loadedSettings = await window.electronAPI.loadSettings();
        if (loadedSettings) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        console.error("Error loading persistent settings:", error);
      }
    };

    const loadPersistentFiles = async () => {
      try {
        const result = await window.electronAPI.loadFiles();
        if (
          result &&
          result.success &&
          result.files &&
          result.files.length > 0
        ) {
          // Convert files data to FileItem objects
          const loadedFiles: FileItem[] = [];

          // Process each file (we're now saving full files, not page files)
          for (const savedFile of result.files) {
            try {
              const fileType: "image" | "video" | "document" =
                savedFile.type === "video"
                  ? "video"
                  : savedFile.type === "document"
                    ? "document"
                    : "image";

              // Convert base64 to File object
              const base64Data = savedFile.data.split(",")[1] || savedFile.data;
              const mimeType = savedFile.data
                .split(",")[0]
                .split(":")[1]
                .split(";")[0];
              const byteCharacters = atob(base64Data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: mimeType });
              const file = new File([blob], savedFile.name, { type: mimeType });

              if (fileType === "document" && file.type === "application/pdf") {
                // For PDFs, load page count and pre-rendered images
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer })
                  .promise;
                const numPages = pdf.numPages;

                const pages: PdfPage[] = [];
                for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                  const pageId = `${savedFile.id}-page-${pageNum}`;
                  // Try to find pre-rendered image in the loaded files
                  let imageData: string | undefined;
                  const pageFile = result.files?.find((f) => f.id === pageId);
                  if (pageFile) {
                    imageData = pageFile.data;
                  }

                  // If no pre-rendered image, render it now
                  if (!imageData) {
                    try {
                      const page = await pdf.getPage(pageNum);
                      const viewport = page.getViewport({ scale: 2.0 });
                      const canvas = document.createElement("canvas");
                      canvas.width = viewport.width;
                      canvas.height = viewport.height;
                      const context = canvas.getContext("2d");
                      if (context) {
                        await page.render({
                          canvasContext: context,
                          viewport: viewport,
                          canvas: canvas,
                        }).promise;
                        imageData = canvas.toDataURL("image/jpeg", 0.92);
                      }
                    } catch (e) {
                      console.error(`Error rendering PDF page ${pageNum}:`, e);
                    }
                  }

                  pages.push({
                    pageNumber: pageNum,
                    id: pageId,
                    imageData,
                  });
                }

                loadedFiles.push({
                  id: savedFile.id,
                  name: savedFile.name,
                  type: "document",
                  file,
                  pages,
                  totalPages: numPages,
                });
              } else {
                // Regular file (image or video)
                loadedFiles.push({
                  id: savedFile.id,
                  name: savedFile.name,
                  type: fileType,
                  file,
                });
              }
            } catch (error) {
              console.error(`Error loading file ${savedFile.id}:`, error);
            }
          }

          // Restore file order
          const orderedFiles: FileItem[] = [];
          const fileIdMap = new Map(loadedFiles.map((f) => [f.id, f]));

          // Add files in the saved order
          for (const fileId of result.fileOrder || []) {
            const file = fileIdMap.get(fileId);
            if (file && !orderedFiles.find((f) => f.id === fileId)) {
              orderedFiles.push(file);
            }
          }

          // Add any remaining files that weren't in the order
          for (const file of loadedFiles) {
            if (!orderedFiles.find((f) => f.id === file.id)) {
              orderedFiles.push(file);
            }
          }

          setFiles(orderedFiles);
        }
        // Notify main process that files are loaded
        await window.electronAPI.notifyFilesLoaded();
      } catch (error) {
        console.error("Error loading persistent files:", error);
        // Still notify main process even on error
        await window.electronAPI.notifyFilesLoaded();
      }
    };

    const handleLoadPersistentSettings = (
      loadedSettings: ProjectorSettings
    ) => {
      setSettings(loadedSettings);
    };

    const handleLoadPersistentFiles = async (data: {
      files: Array<{
        id: string;
        name: string;
        type: string;
        data: string;
        pageNumber?: number;
      }>;
      fileOrder: string[];
    }) => {
      // Load files from the data sent by main process
      if (data && data.files && data.files.length > 0) {
        const loadedFiles: FileItem[] = [];

        for (const savedFile of data.files) {
          try {
            const fileType: "image" | "video" | "document" =
              savedFile.type === "video"
                ? "video"
                : savedFile.type === "document"
                  ? "document"
                  : "image";

            // Convert base64 to File object
            const base64Data = savedFile.data.split(",")[1] || savedFile.data;
            const mimeType = savedFile.data
              .split(",")[0]
              .split(":")[1]
              .split(";")[0];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            const file = new File([blob], savedFile.name, { type: mimeType });

            if (fileType === "document" && file.type === "application/pdf") {
              // For PDFs, load page count and pre-rendered images
              const arrayBuffer = await file.arrayBuffer();
              const pdf = await pdfjsLib.getDocument({ data: arrayBuffer })
                .promise;
              const numPages = pdf.numPages;

              const pages: PdfPage[] = [];
              for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                const pageId = `${savedFile.id}-page-${pageNum}`;
                // Try to load pre-rendered image from persistence
                let imageData: string | undefined;
                try {
                  const result = await window.electronAPI!.loadFiles();
                  if (result.success && result.files) {
                    const pageFile = result.files.find((f) => f.id === pageId);
                    if (pageFile) {
                      imageData = pageFile.data;
                    }
                  }
                } catch (e) {
                  // Image not found, will be re-rendered if needed
                }

                // If no pre-rendered image, render it now
                if (!imageData) {
                  try {
                    const page = await pdf.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 2.0 });
                    const canvas = document.createElement("canvas");
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const context = canvas.getContext("2d");
                    if (context) {
                      await page.render({
                        canvasContext: context,
                        viewport: viewport,
                        canvas: canvas,
                      }).promise;
                      imageData = canvas.toDataURL("image/jpeg", 0.92);
                    }
                  } catch (e) {
                    console.error(`Error rendering PDF page ${pageNum}:`, e);
                  }
                }

                pages.push({
                  pageNumber: pageNum,
                  id: pageId,
                  imageData,
                });
              }

              loadedFiles.push({
                id: savedFile.id,
                name: savedFile.name,
                type: "document",
                file,
                pages,
                totalPages: numPages,
              });
            } else {
              // Regular file (image or video)
              loadedFiles.push({
                id: savedFile.id,
                name: savedFile.name,
                type: fileType,
                file,
              });
            }
          } catch (error) {
            console.error(`Error loading file ${savedFile.id}:`, error);
          }
        }

        // Restore file order
        const orderedFiles: FileItem[] = [];
        const fileIdMap = new Map(loadedFiles.map((f) => [f.id, f]));

        for (const fileId of data.fileOrder || []) {
          const file = fileIdMap.get(fileId);
          if (file && !orderedFiles.find((f) => f.id === fileId)) {
            orderedFiles.push(file);
          }
        }

        for (const file of loadedFiles) {
          if (!orderedFiles.find((f) => f.id === file.id)) {
            orderedFiles.push(file);
          }
        }

        setFiles(orderedFiles);
      }
      // Notify main process that files are loaded (even if empty)
      if (window.electronAPI) {
        await window.electronAPI.notifyFilesLoaded();
      }
    };

    const handleSaveExitBehavior = async (exitBehavior: {
      showExitPrompt: boolean;
      exitBehavior: "minimize" | "close";
    }) => {
      // Update settings with exit behavior
      setSettings((prev) => ({
        ...prev,
        showExitPrompt: exitBehavior.showExitPrompt,
        exitBehavior: exitBehavior.exitBehavior,
      }));
      // Save settings persistently
      if (window.electronAPI) {
        try {
          const currentSettings = await window.electronAPI.loadSettings();
          const updatedSettings = {
            ...(currentSettings || defaultSettings),
            showExitPrompt: exitBehavior.showExitPrompt,
            exitBehavior: exitBehavior.exitBehavior,
          };
          await window.electronAPI.saveSettings(updatedSettings);
        } catch (error) {
          console.error("Error saving exit behavior settings:", error);
        }
      }
    };

    loadPersistentSettings();
    loadPersistentFiles();
    window.electronAPI.onLoadPersistentSettings(handleLoadPersistentSettings);
    window.electronAPI.onLoadPersistentFiles(handleLoadPersistentFiles);
    window.electronAPI.onSaveExitBehavior(handleSaveExitBehavior);

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners("load-persistent-settings");
        window.electronAPI.removeAllListeners("load-persistent-files");
        window.electronAPI.removeAllListeners("save-exit-behavior");
      }
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    const handlePlayPause = (isPlaying: boolean) => {
      setIsPlaying(isPlaying);
    };

    const handleProjectorClosed = () => {
      setIsProjectorOpen(false);
      setCurrentProjectorIndex(null);
      setIsPlaying(false);
      setVideoProgress(null);
      setTimerProgress(null);
      setIsDraggingProgress(false);
      setDraggedProgressValue(null);
      isDraggingProgressRef.current = false;
      draggedProgressValueRef.current = null;
    };

    const handleProjectorOpened = () => {
      setIsProjectorOpen(true);
    };

    const handleProjectorNavigate = (index: number) => {
      setCurrentProjectorIndex(index);
      // Update current file type
      if (index >= 0 && files.length > 0) {
        const flattenedFiles: Array<{
          fileItem: FileItem;
          isPdfPage: boolean;
        }> = [];
        for (const fileItem of files) {
          if (
            fileItem.type === "document" &&
            fileItem.pages &&
            fileItem.pages.length > 0
          ) {
            for (const page of fileItem.pages) {
              // PDF pages are sent as images to the projector
              flattenedFiles.push({ fileItem, isPdfPage: true });
            }
          } else {
            flattenedFiles.push({ fileItem, isPdfPage: false });
          }
        }
        if (index < flattenedFiles.length) {
          const current = flattenedFiles[index];
          // PDF pages are treated as images in the projector
          setCurrentFileType(
            current.isPdfPage ? "image" : current.fileItem.type
          );
        } else {
          setCurrentFileType(null);
        }
      } else {
        setCurrentFileType(null);
      }
      // Clear progress when navigating
      setVideoProgress(null);
      setTimerProgress(null);
    };

    const handleVideoProgress = (progress: {
      currentTime: number;
      duration: number;
    }) => {
      // Don't update progress while user is dragging the progress bar
      if (!isDraggingProgressRef.current) {
        setVideoProgress(progress);
        setTimerProgress(null); // Clear timer progress when video progress is received
      } else if (draggedProgressValueRef.current !== null) {
        // If we're dragging, check if the progress matches our seeked position
        // Allow update if progress is close to our dragged value (within 0.5 seconds)
        const timeDiff = Math.abs(
          progress.currentTime - draggedProgressValueRef.current
        );
        if (timeDiff < 0.5) {
          // Progress matches our seeked position, safe to update
          setIsDraggingProgress(false);
          isDraggingProgressRef.current = false;
          setVideoProgress(progress);
          setTimerProgress(null);
          setDraggedProgressValue(null);
          draggedProgressValueRef.current = null;
        }
      }
    };

    const handleTimerProgress = (progress: {
      elapsed: number;
      total: number;
    }) => {
      setTimerProgress(progress);
      setVideoProgress(null); // Clear video progress when timer progress is received
    };

    window.electronAPI.onProjectorPlayPause(handlePlayPause);
    window.electronAPI.onProjectorClosed(handleProjectorClosed);
    window.electronAPI.onProjectorOpened(handleProjectorOpened);
    window.electronAPI.onProjectorNavigate(handleProjectorNavigate);
    window.electronAPI.onProjectorVideoProgress(handleVideoProgress);
    window.electronAPI.onProjectorTimerProgress(handleTimerProgress);

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners("projector-play-pause");
        window.electronAPI.removeAllListeners("projector-closed");
        window.electronAPI.removeAllListeners("projector-opened");
        window.electronAPI.removeAllListeners("projector-navigate");
        window.electronAPI.removeAllListeners("projector-video-progress");
        window.electronAPI.removeAllListeners("projector-timer-progress");
      }
    };
  }, [files]);

  // Track if we need to boot in projector mode (for when files aren't loaded yet)
  const shouldBootInProjectorModeRef = useRef(false);

  // Handle boot in projector mode and tray open projector
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleBootInProjectorMode = async () => {
      // Set flag that we want to boot in projector mode
      shouldBootInProjectorModeRef.current = true;
      // If we have files, open projector immediately
      if (files.length > 0) {
        shouldBootInProjectorModeRef.current = false;
        await handleOpenProjector();
      }
    };

    const handleTrayOpenProjector = async () => {
      // If we have files, open projector
      if (files.length > 0) {
        await handleOpenProjector();
      }
    };

    const handleTrayOpenProjectorRequest = () => {
      // Send files and settings to main process
      if (window.electronAPI && files.length > 0) {
        handleOpenProjector();
      }
    };

    window.electronAPI.onBootInProjectorMode(handleBootInProjectorMode);
    window.electronAPI.onTrayOpenProjector(handleTrayOpenProjector);
    window.electronAPI.onTrayOpenProjectorRequest(
      handleTrayOpenProjectorRequest
    );

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners("boot-in-projector-mode");
        window.electronAPI.removeAllListeners("tray-open-projector");
        window.electronAPI.removeAllListeners("tray-open-projector-request");
      }
    };
  }, [files, handleOpenProjector]);

  // Check if we need to boot in projector mode when files are loaded
  useEffect(() => {
    if (
      shouldBootInProjectorModeRef.current &&
      files.length > 0 &&
      !isProjectorOpen
    ) {
      shouldBootInProjectorModeRef.current = false;
      handleOpenProjector();
    }
  }, [files, isProjectorOpen, handleOpenProjector]);

  // Handle global mouseup to reset dragging state
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingProgressRef.current) {
        // Clear any pending seek timeout and seek immediately
        if (seekTimeoutRef.current) {
          clearTimeout(seekTimeoutRef.current);
          seekTimeoutRef.current = null;
        }
        if (
          draggedProgressValue !== null &&
          videoProgress &&
          isProjectorOpen &&
          currentFileType === "video"
        ) {
          handleSeek(draggedProgressValue);
        }
        // Don't reset dragging state immediately - wait a bit for seek to complete
        // This prevents progress updates from overriding the slider position
        // The dragging state will be reset when we receive a progress update matching our seeked position
        // But add a timeout as fallback
        setTimeout(() => {
          if (isDraggingProgressRef.current) {
            setIsDraggingProgress(false);
            isDraggingProgressRef.current = false;
            setDraggedProgressValue(null);
            draggedProgressValueRef.current = null;
          }
        }, 500); // Fallback timeout
      }
    };

    if (isDraggingProgress) {
      window.addEventListener("mouseup", handleGlobalMouseUp);
      return () => {
        window.removeEventListener("mouseup", handleGlobalMouseUp);
      };
    }
  }, [
    isDraggingProgress,
    draggedProgressValue,
    videoProgress,
    isProjectorOpen,
    currentFileType,
    handleSeek,
  ]);

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-100 overflow-hidden rounded-2xl border border-gray-200 shadow-2xl">
      <TitleBar
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onUploadClick={handleSelectFiles}
        files={files}
        onLoadProject={handleLoadProject}
      />
      <div
        className={`flex-1 overflow-y-auto p-6 rounded-b-2xl transition-all duration-300 ${
          videoProgress || timerProgress ? "pb-44" : "pb-32"
        } ${isDragging ? "bg-primary/5" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDoubleClick={handleDoubleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,application/pdf"
          onChange={handleFileInput}
          className="hidden"
        />
        <FileList
          files={files}
          onReorder={handleReorder}
          onRemove={handleRemove}
          currentItem={getCurrentItemIdentifier(currentProjectorIndex)}
          onItemClick={isProjectorOpen ? handleItemClick : undefined}
        />
      </div>

      {/* Fixed Navigation Controls Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none">
        <div className="max-w-full">
          <div className="bg-gray-900/95 backdrop-blur-md rounded-b-xl rounded-t-none shadow-2xl pointer-events-auto">
            {/* Progress Bar - Full Width at Top */}
            {(videoProgress || timerProgress) && (
              <div className="w-full bg-blue-500/20 px-6 py-3 border-b border-blue-500/30">
                <div className="flex items-center gap-3 w-full overflow-visible">
                  <span className="text-white text-xs font-medium w-12 text-right">
                    {isDraggingProgress && draggedProgressValue !== null
                      ? formatTime(draggedProgressValue)
                      : videoProgress
                        ? formatTime(videoProgress.currentTime)
                        : timerProgress
                          ? formatTime(timerProgress.elapsed / 1000)
                          : "0:00"}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={
                      videoProgress
                        ? videoProgress.duration
                        : timerProgress
                          ? timerProgress.total / 1000
                          : 100
                    }
                    step="0.1"
                    value={
                      isDraggingProgress && draggedProgressValue !== null
                        ? draggedProgressValue
                        : videoProgress
                          ? videoProgress.currentTime
                          : timerProgress
                            ? timerProgress.elapsed / 1000
                            : 0
                    }
                    onMouseDown={() => {
                      if (
                        videoProgress &&
                        isProjectorOpen &&
                        currentFileType === "video"
                      ) {
                        setIsDraggingProgress(true);
                        isDraggingProgressRef.current = true;
                      }
                    }}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      // Ensure dragging state is set if not already set (for direct clicks on track)
                      if (
                        videoProgress &&
                        isProjectorOpen &&
                        currentFileType === "video"
                      ) {
                        if (!isDraggingProgressRef.current) {
                          setIsDraggingProgress(true);
                          isDraggingProgressRef.current = true;
                        }
                        setDraggedProgressValue(value);
                        draggedProgressValueRef.current = value;
                        // Clear any pending seek
                        if (seekTimeoutRef.current) {
                          clearTimeout(seekTimeoutRef.current);
                          seekTimeoutRef.current = null;
                        }
                        // Seek immediately for responsive dragging/clicking
                        handleSeek(value).catch(console.error);
                      }
                    }}
                    onMouseUp={() => {
                      if (isDraggingProgressRef.current) {
                        // Clear any pending seek timeout
                        if (seekTimeoutRef.current) {
                          clearTimeout(seekTimeoutRef.current);
                          seekTimeoutRef.current = null;
                        }
                        // Final seek on mouse up if we have a dragged value
                        if (
                          draggedProgressValue !== null &&
                          videoProgress &&
                          isProjectorOpen &&
                          currentFileType === "video"
                        ) {
                          handleSeek(draggedProgressValue).catch(console.error);
                        }
                        // Don't reset dragging state immediately - wait a bit for seek to complete
                        // This prevents progress updates from overriding the slider position
                        // The dragging state will be reset when we receive a progress update matching our seeked position
                        // But add a timeout as fallback
                        setTimeout(() => {
                          if (isDraggingProgressRef.current) {
                            setIsDraggingProgress(false);
                            isDraggingProgressRef.current = false;
                            setDraggedProgressValue(null);
                            draggedProgressValueRef.current = null;
                          }
                        }, 500); // Fallback timeout
                      }
                    }}
                    disabled={
                      !isProjectorOpen || (!videoProgress && !timerProgress)
                    }
                    className={`flex-1 h-2 bg-white/20 rounded-lg appearance-none slider overflow-visible ${
                      isDraggingProgress ? "slider-dragging" : "slider-smooth"
                    } ${
                      videoProgress &&
                      isProjectorOpen &&
                      currentFileType === "video"
                        ? "cursor-grab active:cursor-grabbing"
                        : "cursor-default"
                    }`}
                    style={{
                      background: videoProgress
                        ? `linear-gradient(to right, #ffffff 0%, #ffffff ${
                            isDraggingProgress && draggedProgressValue !== null
                              ? (draggedProgressValue /
                                  videoProgress.duration) *
                                100
                              : (videoProgress.currentTime /
                                  videoProgress.duration) *
                                100
                          }%, rgba(255, 255, 255, 0.2) ${
                            isDraggingProgress && draggedProgressValue !== null
                              ? (draggedProgressValue /
                                  videoProgress.duration) *
                                100
                              : (videoProgress.currentTime /
                                  videoProgress.duration) *
                                100
                          }%, rgba(255, 255, 255, 0.2) 100%)`
                        : timerProgress
                          ? `linear-gradient(to right, #ffffff 0%, #ffffff ${(timerProgress.elapsed / timerProgress.total) * 100}%, rgba(255, 255, 255, 0.2) ${(timerProgress.elapsed / timerProgress.total) * 100}%, rgba(255, 255, 255, 0.2) 100%)`
                          : "rgba(255, 255, 255, 0.2)",
                      transition: isDraggingProgress
                        ? "none"
                        : "background 0.12s linear",
                    }}
                    aria-label={
                      videoProgress ? "Video progress" : "Timer progress"
                    }
                  />
                  <span className="text-white text-xs font-medium w-12">
                    {videoProgress
                      ? formatTime(videoProgress.duration)
                      : timerProgress
                        ? formatTime(timerProgress.total / 1000)
                        : "0:00"}
                  </span>
                </div>
              </div>
            )}

            {/* Playback Controls */}
            <div className="p-6">
              <div className="flex items-center justify-between">
                {/* Left: Volume Control */}
                <div className="flex-1 flex items-center gap-3">
                  <button
                    onClick={handleToggleMute}
                    className="p-1 rounded cursor-pointer"
                    aria-label={volume === 0 ? "Unmute" : "Mute"}
                  >
                    {volume === 0 ? (
                      <VolumeX className="w-5 h-5 text-red-400" />
                    ) : (
                      <Volume2 className="w-5 h-5 text-gray-300" />
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) =>
                      handleVolumeChange(parseFloat(e.target.value))
                    }
                    className="w-32 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    style={{
                      background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${volume * 100}%, #374151 ${volume * 100}%, #374151 100%)`,
                    }}
                    aria-label="Volume"
                  />
                  <span className="text-gray-300 text-sm w-10 text-right">
                    {Math.round(volume * 100)}%
                  </span>
                </div>

                {/* Center: Playback Controls */}
                <div className="flex items-center gap-4 flex-1 max-w-2xl justify-center">
                  <button
                    onClick={() => handleNavigate("previous")}
                    className="p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Previous"
                    disabled={files.length === 0}
                  >
                    <ChevronLeft className="w-6 h-6 text-gray-200" />
                  </button>
                  <button
                    onClick={handleTogglePlayPause}
                    className="p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={isPlaying ? "Pause" : "Play"}
                    disabled={files.length === 0}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 text-gray-200" />
                    ) : (
                      <Play className="w-6 h-6 text-gray-200" />
                    )}
                  </button>
                  <button
                    onClick={() => handleNavigate("next")}
                    className="p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Next"
                    disabled={files.length === 0}
                  >
                    <ChevronRight className="w-6 h-6 text-gray-200" />
                  </button>
                </div>

                {/* Right: Projector Toggle Button */}
                <div className="flex-1 flex justify-end">
                  <button
                    onClick={
                      isProjectorOpen
                        ? handleCloseProjector
                        : handleOpenProjector
                    }
                    className={`p-3 rounded-lg transition-colors ${
                      isProjectorOpen
                        ? "bg-red-500 hover:bg-red-600 text-white"
                        : "bg-blue-500 hover:bg-blue-600 text-white"
                    }`}
                    aria-label={isProjectorOpen ? "Close Projector" : "Project"}
                  >
                    {isProjectorOpen ? (
                      <X className="w-5 h-5" />
                    ) : (
                      <Presentation className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
