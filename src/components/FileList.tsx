import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { FileItem, PdfPage } from '../types/file';
import { cn } from '../lib/utils';
import { FileThumbnail } from './FileThumbnail';
import { PdfFileItem } from './PdfFileItem';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import dragDropAnimation from '../assets/Drag & drop.lottie?url';

interface FileListProps {
  files: FileItem[];
  onReorder: (files: FileItem[]) => void;
  onRemove: (id: string) => void;
  currentItem?: { fileId: string; pageId?: string } | null;
  onItemClick?: (fileId: string, pageId?: string) => void;
}

interface SortableFileItemProps {
  file: FileItem;
  onRemove: (id: string) => void;
  isActive?: boolean;
  onClick?: (fileId: string) => void;
}

const SortableFileItem = ({ file, onRemove, isActive, onClick }: SortableFileItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger click if clicking on interactive elements
    if ((e.target as HTMLElement).closest('button, [role="button"]')) {
      return;
    }
    onClick?.(file.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick ? handleClick : undefined}
      className={cn(
        'flex items-center gap-4 p-4 bg-white border rounded-lg',
        'hover:border-gray-300 transition-colors',
        isDragging && 'shadow-lg',
        isActive 
          ? 'border-blue-500 border-2 bg-blue-50 shadow-md' 
          : 'border-gray-200',
        onClick && 'cursor-pointer'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
      >
        <GripVertical className="w-5 h-5" />
      </div>
      <div className="flex-shrink-0 w-16 h-16">
        <FileThumbnail
          file={file.file}
          type={file.type}
          className="w-full h-full"
          pageNumber={file.pageNumber}
          fileId={file.id}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {file.name}
        </p>
        <p className="text-xs text-gray-500 capitalize">
          {file.type}
          {file.pageNumber && file.totalPages && file.totalPages > 1 && (
            <span className="ml-1">• Page {file.pageNumber}/{file.totalPages}</span>
          )}
        </p>
      </div>
      <button
        onClick={() => onRemove(file.id)}
        className="flex-shrink-0 p-1 text-gray-400 hover:text-red-600 transition-colors"
        aria-label="Remove file"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
};

export const FileList = ({ files, onReorder, onRemove, currentItem, onItemClick }: FileListProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = files.findIndex((file) => file.id === active.id);
      const newIndex = files.findIndex((file) => file.id === over.id);

      const newFiles = arrayMove(files, oldIndex, newIndex);
      onReorder(newFiles);
    }
  };

  const handleReorderPages = (fileId: string, pages: PdfPage[]) => {
    const newFiles = files.map((file) => {
      if (file.id === fileId) {
        return { ...file, pages };
      }
      return file;
    });
    onReorder(newFiles);
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500 min-h-[400px]">
        <div className="w-64 h-64 mb-6">
          <DotLottieReact
            src={dragDropAnimation}
            loop
            autoplay
            className="w-full h-full"
          />
        </div>
        <p className="text-lg font-medium text-gray-600">
          No files added yet.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Drag and drop files anywhere to get started.
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {files.map((file) => {
            // Show PDF files with expandable pages
            if (file.type === 'document' && file.pages && file.pages.length > 0) {
              const isFileActive = currentItem?.fileId === file.id;
              return (
                <PdfFileItem
                  key={file.id}
                  file={file}
                  onRemove={onRemove}
                  onReorderPages={handleReorderPages}
                  currentItem={currentItem}
                  isFileActive={isFileActive}
                  onItemClick={onItemClick}
                />
              );
            }
            // Regular files
            const isActive = currentItem?.fileId === file.id && !currentItem?.pageId;
            return (
              <SortableFileItem 
                key={file.id} 
                file={file} 
                onRemove={onRemove} 
                isActive={isActive}
                onClick={onItemClick ? () => onItemClick(file.id) : undefined}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
};

