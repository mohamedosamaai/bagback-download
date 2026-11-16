export type JobStatus = 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  progress: number;
  title?: string;
  format?: string;
  audioOnly?: boolean;
  mediaType?: 'video' | 'audio';
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  gcsObject?: string;
  contentType?: string;
  batchId?: string;
  batchTitle?: string;
  archived?: boolean;
  savedOnDeviceAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
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
  totalZipBundles: number;
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

export interface FormatInfo {
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

export type AppLink = {
  label: string;
  url: string;
};

export const bagbackLinks: AppLink[] = [
  { label: 'Bagback Tech', url: 'https://bagbacktech.com' },
  { label: 'Mohamed Osama', url: 'https://mohamedosama.me' }
];

