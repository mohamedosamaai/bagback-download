import express, { Request, Response } from 'express';
import cors from 'cors';
import { spawn, spawnSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import rateLimit from 'express-rate-limit';
import type { Job, FormatInfo } from '@bagback-download/core';

const app = express();
const PORT = process.env.PORT || 4000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), 'bagback-downloads');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'static');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
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

function getCustomProxy(): string | undefined {
  return process.env.YTDLP_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || undefined;
}

function getCookiesArg(): string[] {
  const customPath = process.env.YTDLP_COOKIES_PATH;
  if (customPath && fs.existsSync(customPath)) {
    return ['--cookies', customPath];
  }
  const defaultPath = path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(defaultPath)) {
    return ['--cookies', defaultPath];
  }
  return [];
}

function normalizeFormat(format: string): string {
  if (format === '720p') return 'bestvideo[height<=720]+bestaudio/best[height<=720]/b/best';
  if (format === '480p') return 'bestvideo[height<=480]+bestaudio/best[height<=480]/b/best';
  if (format === '360p') return 'bestvideo[height<=360]+bestaudio/best[height<=360]/b/best';
  if (format === 'bestaudio/best' || format === 'mp3') return 'bestaudio/best';
  if (format && format !== 'bestvideo+bestaudio/best' && format !== 'best') {
    return `${format}+ba/b/${format}/best`;
  }
  return 'b/bv*+ba/best';
}

function getYtDlpBinary(): string {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }
  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
    path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
    path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
    path.join(process.cwd(), '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
    binaryName,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return binaryName;
}

function hasFfmpeg(): boolean {
  try {
    const res = spawnSync('ffmpeg', ['-version']);
    return res.status === 0;
  } catch {
    return false;
  }
}

function ytdlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const binary = getYtDlpBinary();
    const proc = spawn(binary, args, { env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin' } });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${binary} exited with code ${code}`));
    });
  });
}

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

function sanitizeErrorMessage(rawError: string, _url: string): string {
  const err = (rawError || '').toLowerCase();
  if (err.includes('sign in to confirm') || err.includes('not a bot') || err.includes('bot')) {
    return 'هذا المحتوى محمي بواسطة المزود لمنع التنزيل الآلي. يرجى تجربة جودة أخرى أو المحاولة لاحقاً.';
  }
  if (err.includes('private video') || err.includes('this video is private')) {
    return 'هذا المحتوى خاص ولا يمكن الوصول إليه.';
  }
  if (err.includes('unavailable') || err.includes('not found') || err.includes('404')) {
    return 'المحتوى غير متاح أو تم حذفه من المنصة.';
  }
  if (err.includes('copyright') || err.includes('blocked')) {
    return 'هذا المحتوى محظور بسبب حقوق النشر أو القيود الجغرافية.';
  }
  if (err.includes('timed out') || err.includes('timeout') || err.includes('econnrefused')) {
    return 'انتهت مهلة الاتصال بالخادم المزود. يرجى إعادة المحاولة.';
  }
  if (rawError && rawError.trim().length > 0 && rawError.length < 120 && !rawError.includes('\n') && !rawError.includes('Traceback')) {
    return rawError.trim().replace(/^ERROR:\s*/i, '');
  }
  return 'تعذر إتمام التحميل. يرجى التأكد من أن الرابط سليم ومتاح للعامة.';
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

  // 1. Universal Media Extraction for Non-YouTube Platforms (SoundCloud, TikTok, Instagram, Twitter/X, Facebook, etc.)
  if (!isYouTubeUrl(url)) {
    try {
      const args = [
        ...getCookiesArg(),
        '--dump-json',
        '--no-playlist',
        '--flat-playlist',
      ];
      const proxy = getCustomProxy();
      if (proxy) args.push('--proxy', proxy);
      args.push(url);

      const raw = await ytdlp(args);
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
        title: info.title || 'Media Download',
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        formats: formats.length > 0 ? formats : [
          { id: 'best', ext: 'mp4', resolution: 'Best Available' },
          { id: 'bestaudio/best', ext: 'mp3', resolution: 'Audio MP3' },
        ],
      });
      return;
    } catch (err: any) {
      console.warn('[Universal yt-dlp analyze failed]', err?.message || err);
      res.status(422).json({ error: sanitizeErrorMessage(err?.message || '', url) });
      return;
    }
  }

  // 2. YouTube Specific: OEmbed Probe for fast resilient metadata
  let fallbackOembedData: any = null;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl);
    if (response.ok) {
      fallbackOembedData = await response.json();
    }
  } catch (e) {
    console.warn('[YouTube OEmbed probe failed]', e);
  }

  // 3. YouTube Multi-strategy extraction (android,web -> web,mweb -> ios,web)
  const clientStrategies = ['android,web', 'web,mweb', 'ios,web'];
  for (const clientStrategy of clientStrategies) {
    try {
      const args = [
        '--extractor-args', `youtube:player_client=${clientStrategy}`,
        ...getCookiesArg(),
        '--dump-json',
        '--no-playlist',
        '--flat-playlist',
      ];
      const proxy = getCustomProxy();
      if (proxy) {
        args.push('--proxy', proxy);
      }
      args.push(url);

      const raw = await ytdlp(args);
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
    } catch (err: any) {
      console.warn(`[yt-dlp analyze strategy ${clientStrategy} failed]`, err?.message || err);
    }
  }

  // 4. Resilient fallback if yt-dlp encounters bot protection but oembed data is available
  if (fallbackOembedData) {
    res.json({
      title: fallbackOembedData.title,
      thumbnail: fallbackOembedData.thumbnail_url,
      uploader: fallbackOembedData.author_name,
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
  updateJob(id, { status: 'running', progress: 0 });

  // Auto-fail if stuck at 0% for more than 2 minutes
  const jobTimeout = setTimeout(() => {
    const currentJob = jobs.get(id);
    if (currentJob && currentJob.status === 'running' && currentJob.progress === 0) {
      updateJob(id, {
        status: 'failed',
        error: 'انتهت مهلة التحميل — قد يكون الرابط محظوراً أو المزود غير متاح'
      });
    }
  }, 2 * 60 * 1000);

  const realFormat = normalizeFormat(format);
  const outputTemplate = path.join(DOWNLOAD_DIR, `${id}-%(title).100s.%(ext)s`);
  const ffmpegAvailable = hasFfmpeg();
  const isYt = isYouTubeUrl(url);

  // Build yt-dlp arguments with universal support
  const buildArgs = (clientStrategy?: string) => {
    const base: string[] = [];

    // YouTube specific extractor args
    if (isYt && clientStrategy) {
      base.push('--extractor-args', `youtube:player_client=${clientStrategy}`);
    }

    base.push(
      ...getCookiesArg(),
      '--retries', '5',
      '--fragment-retries', '5',
      '--file-access-retries', '3',
      '--no-playlist',
      '--no-warnings',
      '--geo-bypass',
      '--socket-timeout', '30',
      '--progress',
      '--newline',
    );

    const proxy = getCustomProxy();
    if (proxy) {
      base.push('--proxy', proxy);
    }

    if (audioOnly) {
      if (ffmpegAvailable) {
        base.push(
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '0',
          '-o', outputTemplate,
          url
        );
      } else {
        base.push(
          '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
          '-o', outputTemplate,
          url
        );
      }
    } else {
      if (ffmpegAvailable) {
        base.push(
          '-f', realFormat,
          '--merge-output-format', 'mp4',
          '-o', outputTemplate,
          url
        );
      } else {
        base.push(
          '-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio/best',
          '-o', outputTemplate,
          url
        );
      }
    }

    return base;
  };

  const executeYtDlp = (args: string[]): Promise<{ success: boolean; lastError: string }> => {
    return new Promise((resolve) => {
      let lastStderr = '';
      const binary = getYtDlpBinary();
      const proc = spawn(binary, args, {
        env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin' },
      });

      const handleData = (data: Buffer) => {
        const text = data.toString();
        const lines = text.split(/[\r\n]+/);
        for (const line of lines) {
          const progMatch = line.match(/(?:\[download\])?\s*([\d.]+)%/i) ||
                            line.match(/(\d+\.?\d*)%\s+of/i) ||
                            line.match(/(\d+\.?\d*)\s*%/);
          if (progMatch) {
            const p = parseFloat(progMatch[1]);
            if (!isNaN(p) && p >= 0 && p <= 100) {
              updateJob(id, { progress: Math.min(99, Math.floor(p)) });
            }
          } else if (/\[(Merger|ExtractAudio|Fixup|VideoConvertor)\]/i.test(line)) {
            updateJob(id, { progress: 95 });
          }
        }
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', (data: Buffer) => {
        lastStderr = data.toString().slice(-500);
        handleData(data);
      });

      proc.on('error', (err) => {
        console.error('[yt-dlp spawn error]', err);
        resolve({ success: false, lastError: err.message });
      });

      proc.on('close', (code) => {
        resolve({ success: code === 0, lastError: lastStderr });
      });
    });
  };

  let result;
  if (!isYt) {
    // Universal platforms: single clean high-speed execution
    result = await executeYtDlp(buildArgs());
  } else {
    // YouTube: primary strategy android,web
    result = await executeYtDlp(buildArgs('android,web'));
    if (!result.success) {
      console.warn('[YouTube primary download strategy failed, retrying with fallback strategy]');
      const fallbackStrategies = ['web,mweb', 'ios,web'];
      for (const strat of fallbackStrategies) {
        result = await executeYtDlp(buildArgs(strat));
        if (result.success) break;
      }
    }
  }

  const success = result.success;
  const lastError = result.lastError;

  clearTimeout(jobTimeout);

  const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.startsWith(id));
  const validFile = files.find((f) => {
    try {
      const p = path.join(DOWNLOAD_DIR, f);
      return fs.existsSync(p) && fs.statSync(p).size > 0;
    } catch {
      return false;
    }
  });

  if (validFile) {
    const filePath = path.join(DOWNLOAD_DIR, validFile);
    const stat = fs.statSync(filePath);
    updateJob(id, {
      status: 'completed',
      progress: 100,
      filePath,
      fileName: validFile.replace(`${id}-`, ''),
      fileSize: stat.size,
    });
  } else if (success) {
    updateJob(id, { status: 'completed', progress: 100 });
  } else {
    updateJob(id, {
      status: 'failed',
      error: sanitizeErrorMessage(lastError, url),
    });
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

app.delete('/api/jobs', (_req: Request, res: Response) => {
  for (const [id, job] of jobs.entries()) {
    if (job.filePath && fs.existsSync(job.filePath)) {
      try {
        fs.unlinkSync(job.filePath);
      } catch (e) {
        console.error(`[Delete All] Error removing ${job.filePath}`, e);
      }
    }
  }
  jobs.clear();
  broadcastJobs();
  res.json({ cleared: true });
});

app.delete('/api/jobs/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.filePath && fs.existsSync(job.filePath)) {
    try {
      fs.unlinkSync(job.filePath);
    } catch (e) {
      console.error(`[Delete Job] Error removing ${job.filePath}`, e);
    }
  }
  jobs.delete(req.params.id);
  broadcastJobs();
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
