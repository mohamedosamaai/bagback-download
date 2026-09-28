export type Lang = 'ar' | 'en';

export interface Job {
  id: string;
  url: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  title?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  createdAt: string;
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
