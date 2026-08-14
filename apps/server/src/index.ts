import express, { Request, Response } from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 4000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), 'bagback-downloads');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'static');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

interface Job {
  id: string;
  url: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
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

interface FormatInfo {
  id: string;
  ext: string;
  resolution?: string;
  fps?: number;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
}

const jobs = new Map<string, Job>();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.json());

let sseClients: { id: number; res: Response }[] = [];

function broadcastJobs() {
  const list = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const data = `data: ${JSON.stringify(list)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.res.write(data);
    } catch (err) {
      console.error('[SSE] Broadcast error', err);
    }
  });
}

function updateJob(id: string, patch: Partial<Job>) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, ...patch, updatedAt: new Date().toISOString() });
  broadcastJobs();
}

function checkProxy(proxyStr: string): Promise<string | null> {
  return new Promise((resolve) => {
    const parts = proxyStr.split(':');
    if (parts.length !== 2) return resolve(null);
    const host = parts[0];
    const port = parseInt(parts[1], 10);

    const req = http.request({
      host,
      port,
      method: 'CONNECT',
      path: 'www.google.com:443',
      timeout: 1200,
    });

    req.on('connect', (_res, socket) => {
      socket.destroy();
      resolve(proxyStr);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

async function fetchVerifiedProxies(): Promise<string[]> {
  return new Promise((resolve) => {
    const req = https.get(
      'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=1500&country=all&ssl=all&anonymity=all',
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', async () => {
          const list = data
            .split(/[\r\n]+/)
            .map((s) => s.trim())
            .filter((line) => line.includes(':'))
            .slice(0, 40);

          const checks = list.map(checkProxy);
          const results = await Promise.all(checks);
          const working = results.filter((p): p is string => Boolean(p));
          resolve(working);
        });
      }
    );
    req.on('error', () => resolve([]));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve([]);
    });
  });
}

function normalizeFormat(format: string): string {
  if (format === '720p') return 'bestvideo[height<=720]+bestaudio/best[height<=720]/b/best';
  if (format === '480p') return 'bestvideo[height<=480]+bestaudio/best[height<=480]/b/best';
  if (format === '360p') return 'bestvideo[height<=360]+bestaudio/best[height<=360]/b/best';
  if (format === 'bestaudio/best' || format === 'mp3') return 'bestaudio/best';
  if (format && format !== 'bestvideo+bestaudio/best') return format;
  return 'b/bv*+ba/best';
}

function ytdlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin' } });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });
  });
}

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 120, // Limit each IP to 120 requests per 15 minutes
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.set('trust proxy', 1);

// ─── Routes ───────────────────────────────────────────────────────────────

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const version = await ytdlp(['--version']);
    res.json({ status: 'ok', ytdlp: version });
  } catch {
    res.json({ status: 'ok', ytdlp: 'active' });
  }
});

app.post('/api/analyze', apiLimiter, async (req: Request, res: Response) => {
  let { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  // 1. YouTube OEmbed First (instant metadata)
  if (isYouTubeUrl(url)) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const response = await fetch(oembedUrl);
      if (response.ok) {
        const oembed: any = await response.json();
        res.json({
          title: oembed.title,
          thumbnail: oembed.thumbnail_url,
          uploader: oembed.author_name,
          duration: 0,
          formats: [
            { id: 'bestvideo+bestaudio/best', ext: 'mp4', resolution: '1080p (Best)' },
            { id: '720p', ext: 'mp4', resolution: '720p HD' },
            { id: '480p', ext: 'mp4', resolution: '480p SD' },
            { id: 'bestaudio/best', ext: 'mp3', resolution: 'Audio MP3' },
          ],
        });
        return;
      }
    } catch (e) {
      console.warn('[YouTube OEmbed failed, trying yt-dlp]', e);
    }
  }

  // 2. Try yt-dlp directly
  try {
    const raw = await ytdlp([
      '--extractor-args', 'youtube:player_client=android,web',
      '--dump-json',
      '--no-playlist',
      '--flat-playlist',
      url,
    ]);
    const info = JSON.parse(raw);

    const formats: FormatInfo[] = (info.formats || [])
      .filter((f: any) => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none'))
      .map((f: any) => ({
        id: f.format_id,
        ext: f.ext,
        resolution: f.resolution || (f.height ? `${f.height}p` : undefined),
        fps: f.fps,
        filesize: f.filesize,
        vcodec: f.vcodec,
        acodec: f.acodec,
      }))
      .slice(0, 20);

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      formats,
    });
    return;
  } catch (err) {
    console.warn('[Direct yt-dlp analyze failed, retrying with verified proxy]', err);
  }

  // 3. Retry with verified working proxy pool
  const verifiedProxies = await fetchVerifiedProxies();
  for (const proxy of verifiedProxies) {
    try {
      const raw = await ytdlp([
        '--extractor-args', 'youtube:player_client=android,web',
        '--proxy', `http://${proxy}`,
        '--dump-json',
        '--no-playlist',
        '--flat-playlist',
        url,
      ]);
      const info = JSON.parse(raw);

      const formats: FormatInfo[] = (info.formats || [])
        .filter((f: any) => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none'))
        .map((f: any) => ({
          id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : undefined),
          fps: f.fps,
          filesize: f.filesize,
          vcodec: f.vcodec,
          acodec: f.acodec,
        }))
        .slice(0, 20);

      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        formats,
      });
      return;
    } catch (proxyErr) {
      console.warn(`[Proxy analyze failed with ${proxy}]`, proxyErr);
    }
  }

  res.status(422).json({ error: 'Could not analyze URL. Please verify the link is public and accessible.' });
});

app.post('/api/download', apiLimiter, (req: Request, res: Response) => {
  let { url, format = 'bestvideo+bestaudio/best', audioOnly = false } = req.body as {
    url?: string;
    format?: string;
    audioOnly?: boolean;
  };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const job: Job = {
    id,
    url,
    status: 'queued',
    progress: 0,
    format,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);

  runDownload(id, url, format, audioOnly).catch(console.error);

  res.json({ id });
});

async function runDownload(id: string, url: string, format: string, audioOnly: boolean) {
  updateJob(id, { status: 'running', progress: 5 });

  const realFormat = normalizeFormat(format);
  const outputTemplate = path.join(DOWNLOAD_DIR, `${id}-%(title).100s.%(ext)s`);

  // Build base yt-dlp arguments
  const buildArgs = (proxyUrl?: string) => {
    const base: string[] = [
      '--extractor-args', 'youtube:player_client=android,web',
      '--retries', '10',
      '--fragment-retries', '10',
      '--file-access-retries', '5',
      '--no-playlist',
      '--progress',
      '--newline',
    ];

    if (proxyUrl) {
      base.push('--proxy', `http://${proxyUrl}`);
    }

    if (audioOnly) {
      base.push(
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outputTemplate,
        url
      );
    } else {
      base.push(
        '-f', realFormat,
        '--merge-output-format', 'mp4',
        '-o', outputTemplate,
        url
      );
    }

    return base;
  };

  const executeYtDlp = (args: string[]): Promise<boolean> => {
    return new Promise((resolve) => {
      const proc = spawn('yt-dlp', args, {
        env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin' },
      });

      const handleData = (data: Buffer) => {
        const text = data.toString();
        const lines = text.split(/[\r\n]+/);
        for (const line of lines) {
          const progMatch = line.match(/(?:\[download\])?\s*([\d\.]+)%/i);
          if (progMatch) {
            const p = parseFloat(progMatch[1]);
            if (!isNaN(p) && p >= 0 && p <= 100) {
              updateJob(id, { progress: Math.min(99, Math.max(5, p)) });
            }
          } else if (/\[(Merger|ExtractAudio|Fixup|VideoConvertor)\]/i.test(line)) {
            updateJob(id, { progress: 95 });
          }
        }
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', handleData);

      proc.on('close', (code) => {
        resolve(code === 0);
      });
    });
  };

  // Step 1: Try direct download first
  let success = await executeYtDlp(buildArgs());

  // Step 2: If direct download failed on YouTube, query fast verified working proxies
  if (!success && isYouTubeUrl(url)) {
    console.warn('[Direct download failed, attempting fast proxy fallback]');
    try {
      const verifiedProxies = (await fetchVerifiedProxies()).slice(0, 3);
      for (const proxy of verifiedProxies) {
        success = await executeYtDlp(buildArgs(proxy));
        if (success) break;
      }
    } catch (e) {
      console.warn('[Proxy fallback error]', e);
    }
  }

  if (success) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.startsWith(id));
    const file = files[0];
    if (file) {
      const filePath = path.join(DOWNLOAD_DIR, file);
      const stat = fs.statSync(filePath);
      updateJob(id, {
        status: 'completed',
        progress: 100,
        filePath,
        fileName: file.replace(`${id}-`, ''),
        fileSize: stat.size,
      });
    } else {
      updateJob(id, { status: 'completed', progress: 100 });
    }
  } else {
    updateJob(id, { status: 'failed', error: 'Download could not be completed' });
  }
}

app.get('/api/jobs', (_req: Request, res: Response) => {
  const list = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(list);
});

app.get('/api/jobs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send the initial list immediately
  const list = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.write(`data: ${JSON.stringify(list)}\n\n`);

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeatTimer);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    sseClients = sseClients.filter((client) => client.id !== clientId);
  });
});

app.get('/api/jobs/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

app.get('/api/jobs/:id/file', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'completed' || !job.filePath) {
    res.status(404).json({ error: 'File not ready' });
    return;
  }
  if (!fs.existsSync(job.filePath)) {
    res.status(404).json({ error: 'File not found on disk' });
    return;
  }

  const stat = fs.statSync(job.filePath);
  const ext = path.extname(job.filePath).slice(1);
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    m4a: 'audio/mp4',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(job.fileName || 'download')}"`,
  );
  fs.createReadStream(job.filePath).pipe(res);
});

app.delete('/api/jobs/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.filePath && fs.existsSync(job.filePath)) {
    fs.unlinkSync(job.filePath);
  }
  jobs.delete(req.params.id);
  res.json({ deleted: true });
});

if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', (_req: Request, res: Response) => {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Frontend not built');
    }
  });
}

// ─── Auto-Cleanup Job ──────────────────────────────────────────────────────────

const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const MAX_AGE = 2 * 60 * 60 * 1000; // 2 hours

setInterval(() => {
  const now = Date.now();
  console.log('[Cleanup] Running periodic cleanup job...');
  for (const [id, job] of jobs.entries()) {
    const jobAge = now - new Date(job.createdAt).getTime();
    if (jobAge > MAX_AGE) {
      console.log(`[Cleanup] Deleting old job ${id}`);
      if (job.filePath && fs.existsSync(job.filePath)) {
        try {
          fs.unlinkSync(job.filePath);
        } catch (e) {
          console.error(`[Cleanup] Error deleting file ${job.filePath}`, e);
        }
      }
      jobs.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

app.listen(PORT, () => {
  console.log(`[Bagback Download Server] listening on port ${PORT}`);
  console.log(`[Bagback Download Server] download dir: ${DOWNLOAD_DIR}`);
  console.log(`[Bagback Download Server] static dir: ${STATIC_DIR}`);
});
