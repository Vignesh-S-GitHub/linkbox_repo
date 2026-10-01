export type FileKind = 'video' | 'audio' | 'image' | 'pdf' | 'archive' | 'text' | 'sheet' | 'presentation' | 'folder' | 'other';
export type FileStatus = 'ready' | 'downloading' | 'fetching' | 'processing' | 'failed';

export interface LinkBoxFile {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  kind: FileKind;
  status: FileStatus;
  progress?: number;
  subtitle?: string;
  children?: LinkBoxFile[];
  createdAt: string;
}
