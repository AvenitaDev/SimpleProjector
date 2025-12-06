import { Settings as SettingsIcon, X, Info, Download, Upload } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { ProjectorSettings } from '../types/settings';
import { cn } from '../lib/utils';
import { FileItem } from '../types/file';

interface SettingsProps {
  settings: ProjectorSettings;
  onSettingsChange: (settings: ProjectorSettings) => void;
  files: FileItem[];
  onLoadProject: (files: FileItem[], settings: ProjectorSettings) => Promise<void>;
}

// Extend the global Window interface if needed
// The electronAPI is already defined in App.tsx

export const Settings = ({ settings, onSettingsChange, files, onLoadProject }: SettingsProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [localSettings, setLocalSettings] = useState<ProjectorSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const backgroundImageInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const isUpdatingFromLocalRef = useRef(false);

  // Sync localSettings with props when settings change externally
  useEffect(() => {
    // Skip sync if the change came from local settings (avoid feedback loop)
    if (isUpdatingFromLocalRef.current) {
      isUpdatingFromLocalRef.current = false;
      return;
    }
    
    // Ensure random is disabled if loop is disabled
    // Ensure auto-play videos is disabled if auto-advance is disabled
    // Ensure showWelcomeDialog has a default value if undefined
    // Ensure transitionType has a default value if undefined
    // Ensure bootWindowState has a default value if undefined
    const syncedSettings = {
      ...settings,
      random: settings.loop ? settings.random : false,
      autoPlayVideos: settings.enableTimeBetweenElements ? settings.autoPlayVideos : false,
      showWelcomeDialog: settings.showWelcomeDialog ?? true,
      transitionType: settings.transitionType ?? 'fade',
      bootWindowState: settings.bootWindowState ?? 'normal',
    };
    setLocalSettings(syncedSettings);
  }, [settings]);

  // Auto-save on change
  useEffect(() => {
    if (isOpen) {
      isUpdatingFromLocalRef.current = true;
      onSettingsChange(localSettings);
    }
  }, [localSettings, isOpen, onSettingsChange]);

  const handleBackgroundImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setLocalSettings((prev) => ({ ...prev, backgroundImage: null }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setLocalSettings((prev) => ({
        ...prev,
        backgroundImage: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveBackgroundImage = () => {
    setLocalSettings((prev) => ({ ...prev, backgroundImage: null }));
    if (backgroundImageInputRef.current) {
      backgroundImageInputRef.current.value = '';
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsAnimating(false);
    // Wait for animation to complete before closing
    setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };

  // Reset animation state when opening
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(false);
      setTimeout(() => setIsAnimating(true), 10);
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      handleClose();
    }
  };

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleExportProject = async () => {
    if (!window.electronAPI || files.length === 0) {
      alert('No files to export');
      return;
    }

    setIsSaving(true);
    try {
      // Convert files to the format needed for exporting
      const filesData: Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }> = [];
      const fileOrder: string[] = [];

      for (const fileItem of files) {
        // Always export the full file (for PDFs, export the full PDF, not individual pages)
        const data = await convertFileToBase64(fileItem.file);
        filesData.push({
          id: fileItem.id,
          name: fileItem.name,
          type: fileItem.type,
          data,
        });
        fileOrder.push(fileItem.id);
      }

      const result = await (window.electronAPI as any).exportProject({
        settings: localSettings,
        files: filesData,
        fileOrder,
      });

      if (result.canceled) {
        // User canceled the save dialog
        return;
      }

      if (result.success) {
        alert('Project exported successfully!');
      } else {
        alert(`Error exporting project: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error exporting project:', error);
      alert(`Error exporting project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const convertFileToBase64 = async (file: File, pageNumber?: number): Promise<string> => {
    // For PDFs with page numbers, we'll need to handle this in the renderer
    // For now, just convert the file
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImportProject = async () => {
    if (!window.electronAPI) {
      alert('Electron API not available');
      return;
    }

    setIsLoading(true);
    try {
      const result = await (window.electronAPI as any).importProject();

      if (result.canceled) {
        setIsLoading(false);
        return;
      }

      if (!result.success || !result.project) {
        alert(`Error loading project: ${result.error || 'Unknown error'}`);
        setIsLoading(false);
        return;
      }

      // Group files by base ID (for PDFs with pages)
      const filesByBaseId = new Map<string, Array<{ id: string; name: string; type: string; data: string; pageNumber?: number }>>();
      
      for (const savedFile of result.project.files) {
        const baseFileId = savedFile.id.replace(/-page-\d+$/, '');
        if (!filesByBaseId.has(baseFileId)) {
          filesByBaseId.set(baseFileId, []);
        }
        filesByBaseId.get(baseFileId)!.push(savedFile);
      }

      // Load files from base64 data
      const loadedFiles: FileItem[] = [];
      
      for (const [baseFileId, fileGroup] of filesByBaseId.entries()) {
        try {
          // Get the first file to determine type
          const firstFile = fileGroup[0];
          const fileType: 'image' | 'video' | 'document' = firstFile.type === 'video' ? 'video' : firstFile.type === 'document' ? 'document' : 'image';
          
          // For PDFs, we need to reconstruct the full PDF from pages
          if (fileType === 'document' && firstFile.data.includes('application/pdf')) {
            // Find the full PDF file (not a page image)
            const fullPdfFile = fileGroup.find(f => !f.pageNumber && f.data.includes('application/pdf'));
            
            if (fullPdfFile) {
              // Convert base64 to File
              const base64Data = fullPdfFile.data.split(',')[1] || fullPdfFile.data;
              const mimeType = 'application/pdf';
              const byteCharacters = atob(base64Data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: mimeType });
              const file = new File([blob], firstFile.name.replace(/\s*\(Page\s+\d+\)\s*$/, ''), { type: mimeType });

              // Get PDF pages
              const pdfjsLib = await import('pdfjs-dist');
              pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
              
              const arrayBuffer = await file.arrayBuffer();
              const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
              const numPages = pdf.numPages;

              const pages: Array<{ pageNumber: number; id: string }> = [];
              for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                pages.push({
                  pageNumber: pageNum,
                  id: `${baseFileId}-page-${pageNum}-${Date.now()}-${Math.random()}`,
                });
              }

              loadedFiles.push({
                id: baseFileId,
                name: firstFile.name.replace(/\s*\(Page\s+\d+\)\s*$/, ''),
                type: 'document',
                file,
                pages,
                totalPages: numPages,
              });
            } else {
              // If no full PDF found, try to use the first page as the file
              // This shouldn't happen in normal cases, but handle it gracefully
              console.warn(`No full PDF found for ${baseFileId}, using first page`);
              const firstPage = fileGroup[0];
              const base64Data = firstPage.data.split(',')[1] || firstPage.data;
              const mimeType = firstPage.data.split(',')[0].split(':')[1].split(';')[0];
              const byteCharacters = atob(base64Data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: mimeType });
              const file = new File([blob], firstPage.name.replace(/\s*\(Page\s+\d+\)\s*$/, ''), { type: mimeType });

              loadedFiles.push({
                id: baseFileId,
                name: firstPage.name.replace(/\s*\(Page\s+\d+\)\s*$/, ''),
                type: 'document',
                file,
              });
            }
          } else {
            // Regular file (image, video, or non-PDF document)
            const fileData = fileGroup[0];
            const base64Data = fileData.data.split(',')[1] || fileData.data;
            const mimeType = fileData.data.split(',')[0].split(':')[1].split(';')[0];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            const file = new File([blob], fileData.name, { type: mimeType });

            loadedFiles.push({
              id: baseFileId,
              name: fileData.name,
              type: fileType,
              file,
            });
          }
        } catch (error) {
          console.error(`Error loading file group ${baseFileId}:`, error);
        }
      }

      // Restore file order
      const orderedFiles: FileItem[] = [];
      const fileIdMap = new Map(loadedFiles.map(f => [f.id, f]));
      
      // First, add files in the saved order
      for (const fileId of result.project.fileOrder) {
        // Handle page IDs
        const baseId = fileId.replace(/-page-\d+$/, '');
        const file = fileIdMap.get(baseId);
        if (file && !orderedFiles.find(f => f.id === baseId)) {
          orderedFiles.push(file);
        }
      }
      
      // Add any remaining files that weren't in the order
      for (const file of loadedFiles) {
        if (!orderedFiles.find(f => f.id === file.id)) {
          orderedFiles.push(file);
        }
      }

      // Update settings and files
      onSettingsChange(result.project.settings);
      await onLoadProject(orderedFiles, result.project.settings);
      alert('Project loaded successfully!');
    } catch (error) {
      console.error('Error loading project:', error);
      alert(`Error loading project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Settings"
      >
        <SettingsIcon className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div
      onClick={handleBackdropClick}
      className={cn(
        'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 transition-opacity duration-200',
        isAnimating ? 'opacity-100' : 'opacity-0'
      )}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto transition-all duration-200',
          isAnimating
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 translate-y-4'
        )}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-bold text-gray-900">Settings</h2>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Enable time between elements */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Auto-advance elements
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Automatically advance to the next element after a set time
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => {
                  const newAutoAdvance = !prev.enableTimeBetweenElements;
                  // If enabling auto-advance, also enable auto-play videos
                  // If disabling auto-advance, also disable auto-play videos
                  return {
                    ...prev,
                    enableTimeBetweenElements: newAutoAdvance,
                    autoPlayVideos: newAutoAdvance ? true : false,
                  };
                })
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.enableTimeBetweenElements ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.enableTimeBetweenElements ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Auto-play videos */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className={cn(
                'text-sm font-medium',
                localSettings.enableTimeBetweenElements ? 'text-gray-700' : 'text-gray-400'
              )}>
                Auto-play videos
              </label>
              <div className="group relative">
                <Info className={cn(
                  'w-4 h-4 cursor-help',
                  localSettings.enableTimeBetweenElements ? 'text-gray-400' : 'text-gray-300'
                )} />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    {localSettings.enableTimeBetweenElements
                      ? 'Automatically play videos when displayed'
                      : 'Requires "Auto-advance elements" to be enabled'}
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({ ...prev, autoPlayVideos: !prev.autoPlayVideos }))
              }
              disabled={!localSettings.enableTimeBetweenElements}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.autoPlayVideos && localSettings.enableTimeBetweenElements ? 'bg-blue-600' : 'bg-gray-300',
                !localSettings.enableTimeBetweenElements ? 'opacity-50 cursor-not-allowed' : ''
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.autoPlayVideos && localSettings.enableTimeBetweenElements ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Time between elements */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Time between elements (seconds)
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Duration to display each file before switching to the next
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <input
              type="number"
              min="0.5"
              max="60"
              step="0.5"
              value={localSettings.timeBetweenElements / 1000}
              onChange={(e) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  timeBetweenElements: Math.round(parseFloat(e.target.value) * 1000) || 3000,
                }))
              }
              disabled={!localSettings.enableTimeBetweenElements}
              className={`w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                !localSettings.enableTimeBetweenElements ? 'bg-gray-100 cursor-not-allowed opacity-60' : ''
              }`}
            />
          </div>

          {/* Transition type */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Transition between files
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Animation effect when switching between files
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <select
              value={localSettings.transitionType || 'fade'}
              onChange={(e) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  transitionType: e.target.value as 'none' | 'fade' | 'slide' | 'zoom' | 'blur' | 'rotate',
                }))
              }
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">None</option>
              <option value="fade">Fade</option>
              <option value="slide">Slide</option>
              <option value="zoom">Zoom</option>
              <option value="blur">Blur</option>
              <option value="rotate">Rotate</option>
            </select>
          </div>

          {/* Loop */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Loop elements
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full pl-10 mb-2 hidden group-hover:block z-100">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Restart from the beginning when reaching the end
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => {
                  const newLoop = !prev.loop;
                  // If disabling loop, also disable random
                  return {
                    ...prev,
                    loop: newLoop,
                    random: newLoop ? prev.random : false,
                  };
                })
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.loop ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.loop ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Random */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className={cn(
                'text-sm font-medium',
                localSettings.loop ? 'text-gray-700' : 'text-gray-400'
              )}>
                Random order
              </label>
              <div className="group relative">
                <Info className={cn(
                  'w-4 h-4 cursor-help',
                  localSettings.loop ? 'text-gray-400' : 'text-gray-300'
                )} />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    {localSettings.loop 
                      ? 'Shuffle files in random order'
                      : 'Requires "Loop elements" to be enabled'}
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({ ...prev, random: !prev.random }))
              }
              disabled={!localSettings.loop}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.random && localSettings.loop ? 'bg-blue-600' : 'bg-gray-300',
                !localSettings.loop ? 'opacity-50 cursor-not-allowed' : ''
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.random && localSettings.loop ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Show background with files */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Show background with files
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Display background color/image behind projected files
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  showBackgroundWithFiles: !prev.showBackgroundWithFiles,
                }))
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.showBackgroundWithFiles ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.showBackgroundWithFiles ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Background color */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Background color
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Shown when no files are displayed
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={localSettings.backgroundColor}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    backgroundColor: e.target.value,
                  }))
                }
                className="h-9 w-16 border border-gray-300 rounded cursor-pointer"
              />
              <input
                type="text"
                value={localSettings.backgroundColor}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    backgroundColor: e.target.value,
                  }))
                }
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="#000000"
              />
            </div>
          </div>

          {/* Background image */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Background image
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Background image takes precedence over background color
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <input
                ref={backgroundImageInputRef}
                type="file"
                accept="image/*"
                onChange={handleBackgroundImageChange}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => backgroundImageInputRef.current?.click()}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-sm font-medium text-gray-700 transition-colors"
                >
                  Choose Image
                </button>
                {localSettings.backgroundImage && (
                  <>
                    <button
                      onClick={handleRemoveBackgroundImage}
                      className="px-3 py-1.5 bg-red-100 hover:bg-red-200 rounded-md text-sm font-medium text-red-700 transition-colors"
                    >
                      Remove
                    </button>
                    <div className="flex-1 h-16 border border-gray-300 rounded overflow-hidden">
                      <img
                        src={localSettings.backgroundImage}
                        alt="Background preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Open in fullscreen */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Open projector in fullscreen
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 max-w-xs shadow-lg">
                    Automatically enter fullscreen mode when opening the projector. The fullscreen will open on the screen where the program is running.
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  openFullscreen: !prev.openFullscreen,
                }))
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.openFullscreen ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.openFullscreen ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 my-4"></div>

          {/* Export/Import Project */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Export/Import Project
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 max-w-xs shadow-lg">
                    Export your current settings, file order, and copies of all files as a compressed zip file, or import a previously exported project
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportProject}
                disabled={isSaving || files.length === 0}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm font-medium transition-colors',
                  (isSaving || files.length === 0) && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Download className="w-4 h-4" />
                {isSaving ? 'Exporting...' : 'Export Project'}
              </button>
              <button
                onClick={handleImportProject}
                disabled={isLoading}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-sm font-medium transition-colors',
                  isLoading && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Upload className="w-4 h-4" />
                {isLoading ? 'Importing...' : 'Import Project'}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 my-4"></div>

          {/* Boot on startup */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Boot on startup
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                    Start the app automatically when the system boots
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  bootOnStartup: !prev.bootOnStartup,
                }))
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.bootOnStartup ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.bootOnStartup ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Boot in projector mode */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Boot in projector mode
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 max-w-xs shadow-lg">
                    Open the projector window automatically when the program is launched
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  bootInProjectorMode: !prev.bootInProjectorMode,
                }))
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.bootInProjectorMode ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.bootInProjectorMode ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Boot window state */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Window state on launch
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 max-w-xs shadow-lg">
                    Choose whether the main window opens minimized to tray or normally when the program is launched
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <select
              value={localSettings.bootWindowState || 'normal'}
              onChange={(e) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  bootWindowState: e.target.value as 'minimized' | 'normal',
                }))
              }
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="normal">Open normally</option>
              <option value="minimized">Minimize to tray</option>
            </select>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 my-4"></div>

          {/* Show exit prompt */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Show exit prompt
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 max-w-xs shadow-lg">
                    Show a prompt when closing the window asking whether to minimize to tray or close completely
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  showExitPrompt: !prev.showExitPrompt,
                }))
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                localSettings.showExitPrompt ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  localSettings.showExitPrompt ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Exit behavior */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Exit behavior
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 max-w-xs shadow-lg">
                    What to do when closing the window (only used when "Show exit prompt" is disabled)
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <select
              value={localSettings.exitBehavior}
              onChange={(e) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  exitBehavior: e.target.value as 'minimize' | 'close',
                }))
              }
              disabled={localSettings.showExitPrompt}
              className={cn(
                'w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
                localSettings.showExitPrompt ? 'bg-gray-100 cursor-not-allowed opacity-60' : ''
              )}
            >
              <option value="minimize">Minimize to Tray</option>
              <option value="close">Close Completely</option>
            </select>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 my-4"></div>

          {/* Show welcome dialog */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Show welcome dialog
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-400 cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1.5 px-2.5 max-w-xs shadow-lg">
                    Show the welcome dialog when opening projector mode
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  showWelcomeDialog: !(prev.showWelcomeDialog ?? true),
                }))
              }
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                (localSettings.showWelcomeDialog ?? true) ? 'bg-blue-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  (localSettings.showWelcomeDialog ?? true) ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

