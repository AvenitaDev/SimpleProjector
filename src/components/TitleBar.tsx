import { X, Upload } from "lucide-react";
import { Settings } from "./Settings";
import { ProjectorSettings } from "../types/settings";
import { FileItem } from "../types/file";
import "../types/electron"; // Import electron API types

interface TitleBarProps {
  settings: ProjectorSettings;
  onSettingsChange: (settings: ProjectorSettings) => void;
  onUploadClick: () => void;
  files: FileItem[];
  onLoadProject: (
    files: FileItem[],
    settings: ProjectorSettings
  ) => Promise<void>;
}

export const TitleBar = ({
  settings,
  onSettingsChange,
  onUploadClick,
  files,
  onLoadProject,
}: TitleBarProps) => {
  const handleClose = async () => {
    if (window.electronAPI) {
      await window.electronAPI.windowClose();
    }
  };

  return (
    <div className="flex items-center justify-between h-10 bg-white border-b border-gray-200 px-4 select-none drag-region rounded-t-2xl">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <span>SimpleProjector</span>
      </div>
      <div className="flex items-center gap-2 no-drag">
        <button
          onClick={onUploadClick}
          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
          aria-label="Select files"
        >
          <Upload className="w-4 h-4" />
        </button>
        <Settings
          settings={settings}
          onSettingsChange={onSettingsChange}
          files={files}
          onLoadProject={onLoadProject}
        />
        <button
          onClick={handleClose}
          className="p-1.5 hover:bg-red-500 hover:text-white rounded transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-gray-600" />
        </button>
      </div>
    </div>
  );
};
