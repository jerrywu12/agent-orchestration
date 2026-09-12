export interface TaskBrief {
  acceptanceCriteria: string;
  scope: string;
  verification: string;
}
export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  createdAt: string;
  ticketId: string | null;
  text?: string;
  warnings: string[];
  pageCount?: number;
}
export interface FolderInspection {
  path: string;
  name: string;
  key: string;
  repo: string;
  git: {
    isRepository: boolean;
    root: string | null;
    branch: string | null;
    hasHead: boolean;
    dirty: boolean;
  };
  existingProjectId: string | null;
  warnings: string[];
}
export interface FolderListing {
  path: string;
  parentPath: string | null;
  directories: { name: string; path: string }[];
  truncated: boolean;
  nativePicker: boolean;
}
