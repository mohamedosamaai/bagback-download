export type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  progress: number;
  title?: string;
  format?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
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

export type AppLink = {
  label: string;
  url: string;
};

export const bagbackLinks: AppLink[] = [
  { label: 'Bagback Tech', url: 'https://bagbacktech.com' },
  { label: 'Mohamed Osama', url: 'https://mohamedosama.me' }
];

