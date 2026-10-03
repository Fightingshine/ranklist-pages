export interface Photo {
  id: number;
  itemId: number;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  url: string;
  blob?: Blob;
  staticUrl?: string;
  createdAt?: string;
}

export interface Item {
  id: number;
  tierId: number;
  name: string;
  description: string;
  coverPhotoId: number | null;
  sortOrder: number;
  photos: Photo[];
  createdAt?: string;
}

export interface Tier {
  id: number;
  boardId: number;
  name: string;
  sortOrder: number;
  items: Item[];
}

export interface BoardSummary {
  id: number;
  name: string;
  sortOrder: number;
}

export interface Board {
  id: number;
  name: string;
  sortOrder: number;
  tiers: Tier[];
}

export interface ReorderUpdate {
  id: number;
  tierId: number;
  sortOrder: number;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  boards: BoardSummary[];
  tiers: Array<{ id: number; boardId: number; name: string; sortOrder: number }>;
  items: Array<{
    id: number;
    tierId: number;
    name: string;
    description: string;
    coverPhotoId: number | null;
    sortOrder: number;
  }>;
  photos: Array<{
    id: number;
    itemId: number;
    filename: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sortOrder: number;
    staticUrl?: string;
    hasBlob?: boolean;
  }>;
}
