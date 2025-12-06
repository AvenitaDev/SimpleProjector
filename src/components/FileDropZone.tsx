import { useCallback, useState } from "react";
import { Upload, FileImage, Video, FileText } from "lucide-react";
import { cn } from "../lib/utils";
import { FileItem, FileType } from "../types/file";

interface FileDropZoneProps {
  onFilesAdded: (files: FileItem[]) => void;
}

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

export const FileDropZone = ({ onFilesAdded }: FileDropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;

      const fileItems: FileItem[] = Array.from(files).map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        name: file.name,
        type: getFileType(file),
        file,
      }));

      onFilesAdded(fileItems);
    },
    [onFilesAdded]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
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

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative border-2 border-dashed rounded-lg p-12 transition-colors",
        "flex flex-col items-center justify-center gap-4",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-gray-300 hover:border-gray-400 bg-gray-50"
      )}
    >
      <input
        type="file"
        id="file-input"
        multiple
        accept="image/*,video/*,application/pdf"
        onChange={handleFileInput}
        className="hidden"
      />
      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-4">
          <FileImage className="w-12 h-12 text-gray-400" />
          <Video className="w-12 h-12 text-gray-400" />
          <FileText className="w-12 h-12 text-gray-400" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">
            Drag and drop files here
          </p>
          <p className="text-sm text-gray-500 mt-2">or click to browse</p>
        </div>
        <label
          htmlFor="file-input"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Select Files
        </label>
      </div>
    </div>
  );
};
