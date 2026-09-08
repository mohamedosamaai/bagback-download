import { AnalyzeResult, Job } from '../types';
import { getMockMetadata } from '../mocks/handlers';

export interface DownloadService {
  analyze(url: string): Promise<AnalyzeResult>;
  download(opts: { url: string; format: string; audioOnly: boolean }): Promise<{ id: string }>;
  getJobs(): Promise<Job[]>;
  deleteJob(id: string): Promise<{ deleted: boolean }>;
  streamJobs(callback: (jobs: Job[]) => void): () => void;
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

  async download(opts: { url: string; format: string; audioOnly: boolean }): Promise<{ id: string }> {
    const res = await fetch(`${this.API}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start download');
    return data;
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

  streamJobs(callback: (jobs: Job[]) => void): () => void {
    const eventSource = new EventSource(`${this.API}/jobs/stream`);
    
    eventSource.onmessage = (e) => {
      try {
        const data: Job[] = JSON.parse(e.data);
        callback(data);
      } catch (err) {
        console.error('Failed to parse SSE data', err);
      }
    };

    return () => {
      eventSource.close();
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

  async deleteJob(id: string): Promise<{ deleted: boolean }> {
    this.jobs = this.jobs.filter(j => j.id !== id);
    this.notify();
    return { deleted: true };
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
