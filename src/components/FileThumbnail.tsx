import { useEffect, useRef, useState } from "react";
import { FileImage, Video, FileText } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { FileType } from "../types/file";
import { cn } from "../lib/utils";
import pdfWorkerURL from "pdfjs-dist/build/pdf.worker.min?url";
import "../types/electron"; // Import electron API types

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  pdfWorkerURL,
  import.meta.url
).toString();

interface FileThumbnailProps {
  file: File;
  type: FileType;
  className?: string;
  pageNumber?: number; // For PDF pages
  fileId?: string; // File ID for loading saved thumbnails
}

export const FileThumbnail = ({
  file,
  type,
  className,
  pageNumber,
  fileId,
}: FileThumbnailProps) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null); // Store the render task to cancel it if needed

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const loadThumbnail = async () => {
      setIsLoading(true);
      setError(false);

      // Try to load saved thumbnail first
      if (fileId && window.electronAPI) {
        try {
          const result = await window.electronAPI.loadThumbnail(fileId);
          if (result.success && result.exists && result.data) {
            setThumbnailUrl(result.data);
            setIsLoading(false);
            return;
          }
        } catch (error) {
          console.error("Error loading saved thumbnail:", error);
        }
      }

      // If no saved thumbnail, generate one
      if (type === "image") {
        const url = URL.createObjectURL(file);
        setThumbnailUrl(url);
        setIsLoading(false);

        // Save thumbnail for future use (images can use the file directly)
        if (fileId && window.electronAPI) {
          try {
            // Convert image to base64 for saving
            const reader = new FileReader();
            reader.onload = async () => {
              if (window.electronAPI) {
                await window.electronAPI.saveThumbnail(
                  fileId,
                  reader.result as string
                );
              }
            };
            reader.readAsDataURL(file);
          } catch (error) {
            console.error("Error saving image thumbnail:", error);
          }
        }

        cleanup = () => {
          URL.revokeObjectURL(url);
        };
      } else if (type === "document") {
        // Generate PDF thumbnail
        setThumbnailUrl(null);
        setError(false);

        const loadPdfThumbnail = async () => {
          try {
            // Wait a bit to ensure canvas is mounted
            await new Promise((resolve) => setTimeout(resolve, 0));

            const canvas = pdfCanvasRef.current;
            if (!canvas) {
              setError(true);
              setIsLoading(false);
              return;
            }

            // Cancel any previous render task
            if (renderTaskRef.current) {
              try {
                renderTaskRef.current.cancel();
              } catch (e) {
                // Ignore cancellation errors
              }
              renderTaskRef.current = null;
            }

            // Create a new canvas context to avoid reuse issues
            const context = canvas.getContext("2d", {
              willReadFrequently: false,
            });
            if (!context) {
              setError(true);
              setIsLoading(false);
              return;
            }

            // Clear the canvas before rendering
            context.clearRect(0, 0, canvas.width, canvas.height);

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer })
              .promise;
            const pageToRender = pageNumber || 1; // Use specified page or default to page 1
            const page = await pdf.getPage(pageToRender);

            // Calculate scale to fit thumbnail size (assuming max 256x256)
            const viewport = page.getViewport({ scale: 1.0 });
            const maxDimension = 256;
            const scale = Math.min(
              maxDimension / viewport.width,
              maxDimension / viewport.height,
              2.0 // Max scale for quality
            );
            const scaledViewport = page.getViewport({ scale });

            // Set canvas size before rendering
            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;

            // Create render task and store it
            const renderTask = page.render({
              canvasContext: context,
              viewport: scaledViewport,
              canvas: canvas,
            });

            renderTaskRef.current = renderTask;

            await renderTask.promise;

            // Only set thumbnail if this render task wasn't cancelled
            if (renderTaskRef.current === renderTask) {
              const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
              setThumbnailUrl(dataUrl);

              // Save thumbnail for future use
              if (fileId && window.electronAPI) {
                try {
                  await window.electronAPI.saveThumbnail(fileId, dataUrl);
                } catch (error) {
                  console.error("Error saving thumbnail:", error);
                }
              }

              renderTaskRef.current = null;
              setIsLoading(false);
            }
          } catch (err: any) {
            // Ignore cancellation errors
            if (
              err.name !== "RenderingCancelledException" &&
              err.name !== "AbortException"
            ) {
              console.error("Error generating PDF thumbnail:", err);
              setError(true);
            }
            renderTaskRef.current = null;
            setIsLoading(false);
          }
        };

        loadPdfThumbnail();

        // Cleanup: cancel render task if component unmounts or file changes
        cleanup = () => {
          if (renderTaskRef.current) {
            try {
              renderTaskRef.current.cancel();
            } catch (e) {
              // Ignore cancellation errors
            }
            renderTaskRef.current = null;
          }
        };
      } else if (type === "video") {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas) {
          setIsLoading(false);
          return;
        }

        const url = URL.createObjectURL(file);
        video.src = url;

        const handleLoadedMetadata = () => {
          // Seek to 1 second or 10% of video duration, whichever is smaller
          const seekTime = Math.min(1, video.duration * 0.1);
          video.currentTime = seekTime;
        };

        const handleSeeked = async () => {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
            setThumbnailUrl(dataUrl);

            // Save thumbnail for future use
            if (fileId && window.electronAPI) {
              try {
                await window.electronAPI.saveThumbnail(fileId, dataUrl);
              } catch (error) {
                console.error("Error saving thumbnail:", error);
              }
            }

            setIsLoading(false);
          }
        };

        const handleError = () => {
          setError(true);
          setIsLoading(false);
          URL.revokeObjectURL(url);
        };

        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("seeked", handleSeeked);
        video.addEventListener("error", handleError);

        cleanup = () => {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
          video.removeEventListener("seeked", handleSeeked);
          video.removeEventListener("error", handleError);
          URL.revokeObjectURL(url);
        };
      }
    };

    loadThumbnail();

    return cleanup;
  }, [file, type, fileId, pageNumber]);

  const getIcon = () => {
    switch (type) {
      case "image":
        return FileImage;
      case "video":
        return Video;
      case "document":
        return FileText;
      default:
        return FileImage;
    }
  };

  // Always render the canvas for PDFs so it's available when needed
  return (
    <>
      {type === "video" && (
        <>
          <video
            ref={videoRef}
            className="hidden"
            preload="metadata"
            muted
            playsInline
          />
          <canvas ref={canvasRef} className="hidden" />
        </>
      )}
      {type === "document" && <canvas ref={pdfCanvasRef} className="hidden" />}
      {error || (!thumbnailUrl && !isLoading) ? (
        <div
          className={cn(
            "flex items-center justify-center bg-gray-100 rounded",
            isLoading && "animate-pulse",
            className
          )}
        >
          {(() => {
            const Icon = getIcon();
            return <Icon className="w-6 h-6 text-gray-400" />;
          })()}
        </div>
      ) : (
        <img
          src={thumbnailUrl}
          alt={file.name}
          className={cn("object-cover rounded bg-gray-100", className)}
          onError={() => setError(true)}
        />
      )}
    </>
  );
};
