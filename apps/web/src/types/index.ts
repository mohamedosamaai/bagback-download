export type Lang = 'ar' | 'en';

export interface Job {
  id: string;
  url: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  progress: number;
  title?: string;
  format?: string;
  audioOnly?: boolean;
  mediaType?: 'video' | 'audio';
  fileName?: string;
  fileSize?: number;
  gcsObject?: string;
  batchId?: string;
  batchTitle?: string;
  archived?: boolean;
  savedOnDeviceAt?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ArchivedDeviceItem {
  id: string;
  url: string;
  title: string;
  fileName: string;
  fileSize?: number;
  mediaType: 'video' | 'audio';
  batchTitle?: string;
  savedAt: string;
}

export interface DailyStat {
  date: string;
  analyses: number;
  downloadsStarted: number;
  downloadsCompleted: number;
  downloadsFailed: number;
  bytesProcessed: number;
}

export interface UsageStats {
  startedAt: string;
  updatedAt: string;
  totalAnalyses: number;
  totalDownloadsStarted: number;
  totalDownloadsCompleted: number;
  totalDownloadsFailed: number;
  totalPlaylistsQueued: number;
  totalAutoSavedFiles: number;
  totalBytesProcessed: number;
  avgDurationMs: number;
  platforms: Record<string, number>;
  daily: DailyStat[];
  runtime: {
    activeDownloads: number;
    queuedDownloads: number;
    activeSseClients: number;
    uptimeSeconds: number;
    ytdlpVersion: string;
    gcsEnabled: boolean;
  };
}

export interface Format {
  id: string;
  ext: string;
  resolution?: string;
  fps?: number;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
}

export interface PlaylistItem {
  id: string;
  title: string;
  url: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
}

export interface AnalyzeResult {
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats: Format[];
  isPlaylist?: boolean;
  playlistTitle?: string;
  playlistCount?: number;
  playlistItems?: PlaylistItem[];
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  thumbnail?: string;
  timestamp: number;
}
