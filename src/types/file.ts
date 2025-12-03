export type FileType = 'image' | 'video' | 'document';

export interface PdfPage {
  pageNumber: number; // 1-based page number
  id: string; // Unique ID for this page
}

export interface FileItem {
  id: string;
  name: string;
  type: FileType;
  file: File;
  pages?: PdfPage[]; // For PDFs: array of pages with their order
  pageNumber?: number; // For individual PDF pages when expanded (deprecated, kept for compatibility)
  totalPages?: number; // For PDFs: total pages in the document
}

