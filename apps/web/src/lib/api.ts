import { AnalyzeResult, Job, UsageStats } from '../types';
import { getMockMetadata } from '../mocks/handlers';

export interface DownloadService {
  analyze(url: string): Promise<AnalyzeResult>;
  download(opts: { url: string; format: string; audioOnly: boolean; title?: string; items?: Array<{ url: string; title?: string }> }): Promise<{ id: string; ids?: string[]; batchId?: string; batchTitle?: string }>;
  getJobs(): Promise<Job[]>;
  deleteJob(id: string): Promise<{ deleted: boolean }>;
  clearAllJobs(): Promise<{ cleared: boolean }>;
  pauseJob(id: string): Promise<Job>;
  resumeJob(id: string): Promise<Job>;
  retryJob(id: string): Promise<Job>;
  markJobArchived(id: string): Promise<{ archived: boolean; savedOnDeviceAt?: string }>;
  markBatchArchived(batchId: string): Promise<{ archived: boolean; count: number; savedOnDeviceAt?: string }>;
  streamJobs(callback: (jobs: Job[]) => void): () => void;
  getStats(): Promise<UsageStats>;
  reportStatEvent(event: 'autosave_file_saved' | 'playlist_folder_saved', count?: number): Promise<void>;
  isMockMode(): boolean;
}

export class RealDownloadService implements DownloadService {
  private API = '/api';

  async analyze(url: string): Promise<AnalyzeResult> {
    const res = await fetch(`${this.API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to analyze URL');
    return data;
  }

  async download(opts: { url: string; format: string; audioOnly: boolean; title?: string; items?: Array<{ url: string; title?: string }> }): Promise<{ id: string; ids?: string[]; batchId?: string; batchTitle?: string }> {
    const res = await fetch(`${this.API}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start download');
    return data;
  }

  async getStats(): Promise<UsageStats> {
    const res = await fetch(`${this.API}/stats`);
    if (!res.ok) throw new Error('Failed to load usage statistics');
    return res.json();
  }

  async reportStatEvent(event: 'autosave_file_saved' | 'playlist_folder_saved', count = 1): Promise<void> {
    try {
      await fetch(`${this.API}/stats/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, count }),
      });
    } catch {
      // Non-critical client telemetry
    }
  }

  async getJobs(): Promise<Job[]> {
    const res = await fetch(`${this.API}/jobs`);
    if (!res.ok) throw new Error('Failed to fetch jobs');
    return res.json();
  }

  async deleteJob(id: string): Promise<{ deleted: boolean }> {
    const res = await fetch(`${this.API}/jobs/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete job');
    return res.json();
  }

  async clearAllJobs(): Promise<{ cleared: boolean }> {
    const res = await fetch(`${this.API}/jobs`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear jobs');
    return res.json();
  }

  async pauseJob(id: string): Promise<Job> {
    const res = await fetch(`${this.API}/jobs/${id}/pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to pause job');
    return res.json();
  }

  async resumeJob(id: string): Promise<Job> {
    const res = await fetch(`${this.API}/jobs/${id}/resume`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to resume job');
    return res.json();
  }

  async retryJob(id: string): Promise<Job> {
    const res = await fetch(`${this.API}/jobs/${id}/retry`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to retry job');
    return res.json();
  }

  async markJobArchived(id: string): Promise<{ archived: boolean; savedOnDeviceAt?: string }> {
    try {
      const res = await fetch(`${this.API}/jobs/${id}/archived`, { method: 'POST' });
      if (!res.ok) return { archived: false };
      return res.json();
    } catch {
      return { archived: false };
    }
  }

  async markBatchArchived(batchId: string): Promise<{ archived: boolean; count: number; savedOnDeviceAt?: string }> {
    try {
      const res = await fetch(`${this.API}/batches/${batchId}/archived`, { method: 'POST' });
      if (!res.ok) return { archived: false, count: 0 };
      return res.json();
    } catch {
      return { archived: false, count: 0 };
    }
  }

  streamJobs(callback: (jobs: Job[]) => void): () => void {
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connectSSE = () => {
      if (stopped) return;
      try {
        eventSource = new EventSource(`${this.API}/jobs/stream`);
        eventSource.onmessage = (e) => {
          try {
            const data: Job[] = JSON.parse(e.data);
            callback(data);
          } catch (err) {
            console.error('Failed to parse SSE data', err);
          }
        };
        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (!stopped) {
            reconnectTimer = window.setTimeout(connectSSE, 3000);
          }
        };
      } catch {
        if (!stopped) {
          reconnectTimer = window.setTimeout(connectSSE, 3000);
        }
      }
    };

    connectSSE();

    const pollInterval = window.setInterval(async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${this.API}/jobs`);
        if (res.ok) {
          const list: Job[] = await res.json();
          callback(list);
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 2500);

    return () => {
      stopped = true;
      if (eventSource) eventSource.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      clearInterval(pollInterval);
    };
  }

  isMockMode(): boolean {
    return false;
  }
}

export class MockDownloadService implements DownloadService {
  private jobs: Job[] = [];
  private subscribers: ((jobs: Job[]) => void)[] = [];

  constructor() {
    const saved = localStorage.getItem('bagback-mock-jobs');
    if (saved) {
      try {
        this.jobs = JSON.parse(saved);
        // Clean up active jobs from previous sessions
        this.jobs = this.jobs.map(j => {
          if (j.status === 'running' || j.status === 'queued') {
            return { ...j, status: 'failed', error: 'Interrupted session' };
          }
          return j;
        });
      } catch {
        this.jobs = [];
      }
    }
  }

  private notify() {
    localStorage.setItem('bagback-mock-jobs', JSON.stringify(this.jobs));
    this.subscribers.forEach(cb => cb([...this.jobs]));
  }

  async analyze(url: string): Promise<AnalyzeResult> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('Invalid URL. Must start with http:// or https://');
    }
    return getMockMetadata(url);
  }

  async download(opts: { url: string; format: string; audioOnly: boolean }): Promise<{ id: string }> {
    const id = 'mock-' + Math.random().toString(36).substring(2, 11);
    const meta = getMockMetadata(opts.url);
    const newJob: Job = {
      id,
      url: opts.url,
      status: 'queued',
      progress: 0,
      title: meta.title,
      createdAt: new Date().toISOString(),
    };
    
    this.jobs.unshift(newJob);
    this.notify();

    this.simulateProgress(id);

    return { id };
  }

  private simulateProgress(id: string) {
    let progress = 0;
    
    const update = () => {
      const jobIdx = this.jobs.findIndex(j => j.id === id);
      if (jobIdx === -1) return;

      const job = this.jobs[jobIdx];
      if (job.status === 'queued') {
        job.status = 'running';
        job.progress = 5;
        this.notify();
        setTimeout(update, 1200);
      } else if (job.status === 'running') {
        progress += Math.floor(Math.random() * 15) + 10;
        if (progress >= 100) {
          job.status = 'completed';
          job.progress = 100;
          job.fileSize = Math.floor(Math.random() * 35 * 1024 * 1024) + 8 * 1024 * 1024;
          job.fileName = `${job.title?.substring(0, 30) || 'download'}.${job.url.includes('audio') || job.title?.toLowerCase().includes('audio') ? 'mp3' : 'mp4'}`;
          this.notify();
        } else {
          job.progress = progress;
          this.notify();
          setTimeout(update, 800);
        }
      }
    };

    setTimeout(update, 600);
  }

  async getJobs(): Promise<Job[]> {
    return [...this.jobs];
  }

  async getStats(): Promise<UsageStats> {
    const completed = this.jobs.filter((j) => j.status === 'completed').length;
    const failed = this.jobs.filter((j) => j.status === 'failed').length;
    const totalBytes = this.jobs.reduce((acc, j) => acc + (j.fileSize || 0), 0);
    return {
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalAnalyses: this.jobs.length + 12,
      totalDownloadsStarted: this.jobs.length,
      totalDownloadsCompleted: completed,
      totalDownloadsFailed: failed,
      totalPlaylistsQueued: 1,
      totalAutoSavedFiles: 0,
      totalBytesProcessed: totalBytes,
      avgDurationMs: 4200,
      platforms: { youtube: Math.max(1, this.jobs.length) },
      daily: [
        {
          date: new Date().toISOString().slice(0, 10),
          analyses: this.jobs.length + 12,
          downloadsStarted: this.jobs.length,
          downloadsCompleted: completed,
          downloadsFailed: failed,
          bytesProcessed: totalBytes,
        },
      ],
      runtime: {
        activeDownloads: this.jobs.filter((j) => j.status === 'running').length,
        queuedDownloads: this.jobs.filter((j) => j.status === 'queued').length,
        activeSseClients: 1,
        uptimeSeconds: 3600,
        ytdlpVersion: 'mock-mode',
        gcsEnabled: false,
      },
    };
  }

  async reportStatEvent(_event: 'autosave_file_saved' | 'playlist_folder_saved', _count?: number): Promise<void> {
    // No-op in mock mode
  }

  async deleteJob(id: string): Promise<{ deleted: boolean }> {
    this.jobs = this.jobs.filter(j => j.id !== id);
    this.notify();
    return { deleted: true };
  }

  async clearAllJobs(): Promise<{ cleared: boolean }> {
    this.jobs = [];
    this.notify();
    return { cleared: true };
  }

  async pauseJob(id: string): Promise<Job> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) {
      job.status = 'paused';
      this.notify();
      return { ...job };
    }
    throw new Error('Job not found');
  }

  async resumeJob(id: string): Promise<Job> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) {
      job.status = 'running';
      this.notify();
      this.simulateProgress(id);
      return { ...job };
    }
    throw new Error('Job not found');
  }

  async retryJob(id: string): Promise<Job> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) {
      job.status = 'queued';
      job.progress = 0;
      job.error = undefined;
      this.notify();
      this.simulateProgress(id);
      return { ...job };
    }
    throw new Error('Job not found');
  }

  async markJobArchived(id: string): Promise<{ archived: boolean; savedOnDeviceAt?: string }> {
    const job = this.jobs.find((j) => j.id === id);
    const savedOnDeviceAt = new Date().toISOString();
    if (job) {
      job.archived = true;
      job.savedOnDeviceAt = savedOnDeviceAt;
      this.notify();
    }
    return { archived: true, savedOnDeviceAt };
  }

  async markBatchArchived(batchId: string): Promise<{ archived: boolean; count: number; savedOnDeviceAt?: string }> {
    const savedOnDeviceAt = new Date().toISOString();
    let count = 0;
    for (const j of this.jobs) {
      if (j.batchId === batchId && j.status === 'completed') {
        j.archived = true;
        j.savedOnDeviceAt = savedOnDeviceAt;
        count += 1;
      }
    }
    this.notify();
    return { archived: true, count, savedOnDeviceAt };
  }

  streamJobs(callback: (jobs: Job[]) => void): () => void {
    this.subscribers.push(callback);
    callback([...this.jobs]);
    
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  isMockMode(): boolean {
    return true;
  }
}

function isCloudDemoHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'github.io' ||
    h.endsWith('.github.io') ||
    h === 'vercel.app' ||
    h.endsWith('.vercel.app') ||
    h === 'stackblitz.io' ||
    h.endsWith('.stackblitz.io') ||
    h === 'codesandbox.io' ||
    h.endsWith('.codesandbox.io')
  );
}

const isMock =
  import.meta.env.VITE_USE_MOCKS === 'true' ||
  (typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('mock') === 'true' ||
      isCloudDemoHost(window.location.hostname)));

export const api: DownloadService = isMock ? new MockDownloadService() : new RealDownloadService();
export const API_URL = '/api';
