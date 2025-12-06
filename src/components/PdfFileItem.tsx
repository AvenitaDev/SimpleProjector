import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, GripVertical, X } from "lucide-react";
import { FileItem, PdfPage } from "../types/file";
import { FileThumbnail } from "./FileThumbnail";
import { cn } from "../lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface PdfFileItemProps {
  file: FileItem;
  onRemove: (id: string) => void;
  onReorderPages: (fileId: string, pages: PdfPage[]) => void;
  currentItem?: { fileId: string; pageId?: string } | null;
  isFileActive?: boolean;
  onItemClick?: (fileId: string, pageId?: string) => void;
}

interface SortablePageItemProps {
  page: PdfPage;
  file: File;
  onRemove: (pageId: string) => void;
  isActive?: boolean;
  onClick?: (fileId: string, pageId: string) => void;
  fileId: string;
}

const SortablePageItem = ({
  page,
  file,
  onRemove,
  isActive,
  onClick,
  fileId,
}: SortablePageItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

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
    onClick?.(fileId, page.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick ? handleClick : undefined}
      className={cn(
        "flex items-center gap-3 pl-8 pr-4 py-2 bg-gray-50 border rounded",
        "hover:border-gray-300 transition-colors",
        isDragging && "shadow-md",
        isActive
          ? "border-blue-500 border-2 bg-blue-100 shadow-sm"
          : "border-gray-200",
        onClick && "cursor-pointer"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
      >
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="shrink-0 w-12 h-12">
        <FileThumbnail
          file={file}
          type="document"
          className="w-full h-full"
          pageNumber={page.pageNumber}
          fileId={`${fileId}-page-${page.pageNumber}`}
          preRenderedImage={page.imageData}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-700">
          Page {page.pageNumber}
        </p>
      </div>
      <button
        onClick={() => onRemove(page.id)}
        className="shrink-0 p-1 text-gray-400 hover:text-red-600 transition-colors"
        aria-label="Remove page"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const PdfFileItem = ({
  file,
  onRemove,
  onReorderPages,
  currentItem,
  isFileActive,
  onItemClick,
}: PdfFileItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pages, setPages] = useState<PdfPage[]>(file.pages || []);

  // Make the PDF item itself sortable
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.id });

  const mainItemStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handlePageDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = pages.findIndex((p) => p.id === active.id);
      const newIndex = pages.findIndex((p) => p.id === over.id);

      const newPages = arrayMove(pages, oldIndex, newIndex);
      setPages(newPages);
      onReorderPages(file.id, newPages);
    }
  };

  const handleRemovePage = (pageId: string) => {
    const newPages = pages.filter((p) => p.id !== pageId);
    setPages(newPages);
    onReorderPages(file.id, newPages);

    // If no pages left, remove the entire file
    if (newPages.length === 0) {
      onRemove(file.id);
    }
  };

  // Update pages when file prop changes
  useEffect(() => {
    if (file.pages) {
      setPages(file.pages);
    }
  }, [file.pages]);

  // Highlight the PDF file item when the file itself is active OR when any of its pages is active
  const shouldHighlight = isFileActive;

  const handleFileClick = (e: React.MouseEvent) => {
    // Don't trigger click if clicking on interactive elements
    if ((e.target as HTMLElement).closest('button, [role="button"]')) {
      return;
    }
    // If PDF has pages, navigate to the first page; otherwise navigate to the file
    if (pages.length > 0 && onItemClick) {
      onItemClick(file.id, pages[0].id);
    } else if (onItemClick) {
      onItemClick(file.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={mainItemStyle}
      className={cn(
        "bg-white border rounded-lg overflow-hidden",
        isDragging && "shadow-lg",
        shouldHighlight
          ? "border-blue-500 border-2 shadow-md"
          : "border-gray-200"
      )}
    >
      <div
        onClick={onItemClick ? handleFileClick : undefined}
        className={cn(
          "flex items-center gap-4 p-4 transition-colors",
          shouldHighlight ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-gray-50",
          onItemClick && "cursor-pointer"
        )}
      >
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
        >
          <GripVertical className="w-5 h-5" />
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? (
            <ChevronDown className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
        </button>
        <div className="shrink-0 w-16 h-16">
          <FileThumbnail
            file={file.file}
            type={file.type}
            className="w-full h-full"
            pageNumber={pages[0]?.pageNumber || 1}
            fileId={file.id}
            preRenderedImage={pages[0]?.imageData}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {file.name}
          </p>
          <p className="text-xs text-gray-500">
            PDF • {file.totalPages || pages.length}{" "}
            {file.totalPages === 1 ? "page" : "pages"}
          </p>
        </div>
        <button
          onClick={() => onRemove(file.id)}
          className="shrink-0 p-1 text-gray-400 hover:text-red-600 transition-colors"
          aria-label="Remove file"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {isExpanded && pages.length > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 p-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handlePageDragEnd}
          >
            <SortableContext
              items={pages.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {pages.map((page) => (
                  <SortablePageItem
                    key={page.id}
                    page={page}
                    file={file.file}
                    onRemove={handleRemovePage}
                    isActive={currentItem?.pageId === page.id}
                    onClick={onItemClick}
                    fileId={file.id}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
};
