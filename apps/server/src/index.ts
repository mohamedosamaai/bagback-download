import express, { Request, Response } from 'express';
import cors from 'cors';
import { spawn, spawnSync } from 'child_process';
import { randomUUID as uuidv4 } from 'crypto';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import tls from 'tls';
import rateLimit from 'express-rate-limit';
import { Storage, Bucket } from '@google-cloud/storage';
import type { Job, FormatInfo, PlaylistItem } from '@bagback-download/core';
import {
  isValidJobId,
  getMediaContentType,
  buildContentDisposition,
  resolveSafeLocalFile,
  sanitizeJobForClient,
  parseByteRange,
  assertPublicTarget,
  validatePublicMediaUrl,
  detectPlatform,
} from './security';
import {
  initStats,
  refreshStatsFromGcs,
  setCachedYtdlpVersion,
  recordAnalyzeStat,
  recordDownloadStartStat,
  recordDownloadCompleteStat,
  recordDownloadFailStat,
  recordAutoSaveStat,
  recordZipBundleStat,
  getUsageStatsSnapshot,
} from './stats';
import { streamFilesToZip, createZipPassThrough, ZipInputEntry } from './zipStream';

const app = express();
const PORT = process.env.PORT || 4000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.resolve(__dirname, '..', 'downloads');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'static');
const GCS_BUCKET_NAME = (process.env.GCS_BUCKET || '').trim();
const JOB_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ARCHIVED_MAX_AGE_MS = 15 * 60 * 1000; // Purge saved-on-device server artifacts after 15 mins to minimize storage cost

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const gcsBucket: Bucket | null = GCS_BUCKET_NAME ? new Storage().bucket(GCS_BUCKET_NAME) : null;
const jobs = new Map<string, Job>();
const lastGcsSyncAt = new Map<string, number>();
const pausedJobs = new Set<string>();
const activeJobAborters = new Map<string, () => void>();
let gcsListCache: { jobs: Job[]; fetchedAt: number } = { jobs: [], fetchedAt: 0 };

/** Persists job metadata to GCS when GCS_BUCKET is configured, throttling intermediate progress writes. */
async function syncJobToGcs(job: Job, immediate = false): Promise<void> {
  if (!gcsBucket || !isValidJobId(job.id)) return;
  const now = Date.now();
  const prevSync = lastGcsSyncAt.get(job.id) || 0;
  if (!immediate && job.status === 'running' && now - prevSync < 3500) {
    return;
  }
  lastGcsSyncAt.set(job.id, now);
  try {
    const payload = sanitizeJobForClient(job);
    await gcsBucket.file(`jobs/${job.id}.json`).save(JSON.stringify(payload), {
      contentType: 'application/json',
      resumable: false,
      metadata: { cacheControl: 'no-store' },
    });
    gcsListCache.fetchedAt = 0;
  } catch (err: any) {
    console.warn(`[GCS] Failed syncing job ${job.id}:`, err?.message || err);
  }
}

/** Loads a single job record from GCS metadata if it is not present or stale in local memory. */
async function loadJobFromGcs(id: string): Promise<Job | undefined> {
  if (!gcsBucket || !isValidJobId(id)) return undefined;
  try {
    const file = gcsBucket.file(`jobs/${id}.json`);
    const [exists] = await file.exists();
    if (!exists) return undefined;
    const [buf] = await file.download();
    const parsed = JSON.parse(buf.toString('utf8')) as Job;
    if (!parsed || !isValidJobId(parsed.id)) return undefined;
    const local = jobs.get(id);
    if (!local || new Date(parsed.updatedAt).getTime() >= new Date(local.updatedAt).getTime()) {
      jobs.set(id, local?.filePath ? { ...parsed, filePath: local.filePath } : parsed);
    }
    return jobs.get(id);
  } catch (err: any) {
    console.warn(`[GCS] Failed loading job ${id}:`, err?.message || err);
    return undefined;
  }
}

/** Lists recent non-expired jobs from GCS across Cloud Run instances with a brief 2-second cache. */
async function listJobsFromGcs(): Promise<Job[]> {
  if (!gcsBucket) return [];
  const now = Date.now();
  if (now - gcsListCache.fetchedAt < 2000) {
    return gcsListCache.jobs;
  }
  try {
    const [files] = await gcsBucket.getFiles({ prefix: 'jobs/', maxResults: 50 });
    const recentFiles = files.filter((f) => {
      if (!/^jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(f.name)) {
        return false;
      }
      const updated = f.metadata?.updated ? new Date(f.metadata.updated).getTime() : now;
      return now - updated <= JOB_MAX_AGE_MS;
    });
    const loaded: Job[] = [];
    for (let i = 0; i < recentFiles.length; i += 10) {
      const batch = recentFiles.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(async (f) => {
          try {
            const [buf] = await f.download();
            const parsed = JSON.parse(buf.toString('utf8')) as Job;
            return parsed && isValidJobId(parsed.id) ? parsed : null;
          } catch {
            return null;
          }
        })
      );
      for (const item of results) {
        if (item) loaded.push(item);
      }
    }
    gcsListCache = { jobs: loaded, fetchedAt: Date.now() };
    return loaded;
  } catch (err: any) {
    console.warn('[GCS] Failed listing jobs:', err?.message || err);
    return gcsListCache.jobs;
  }
}

/** Merges local in-memory jobs with shared GCS job records ordered newest first. */
async function getMergedJobsList(): Promise<Job[]> {
  const merged = new Map<string, Job>();
  if (gcsBucket) {
    const remoteJobs = await listJobsFromGcs();
    for (const r of remoteJobs) {
      merged.set(r.id, r);
    }
  }
  for (const [id, local] of jobs.entries()) {
    const existing = merged.get(id);
    if (!existing || new Date(local.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      merged.set(id, sanitizeJobForClient(local));
    }
  }
  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Deletes both local temporary files and GCS objects for a job ID. */
async function deleteJobArtifacts(id: string, job?: Job): Promise<void> {
  if (!isValidJobId(id)) return;
  const localSafe = resolveSafeLocalFile(id, DOWNLOAD_DIR, job?.filePath);
  if (localSafe) {
    try { fs.unlinkSync(localSafe); } catch {}
  }
  if (fs.existsSync(DOWNLOAD_DIR)) {
    try {
      for (const f of fs.readdirSync(DOWNLOAD_DIR)) {
        if (f.startsWith(`${id}-`)) {
          try { fs.unlinkSync(path.join(DOWNLOAD_DIR, f)); } catch {}
        }
      }
    } catch {}
  }
  lastGcsSyncAt.delete(id);
  if (gcsBucket) {
    gcsListCache.fetchedAt = 0;
    const ops: Promise<unknown>[] = [
      gcsBucket.file(`jobs/${id}.json`).delete({ ignoreNotFound: true }),
      gcsBucket.deleteFiles({ prefix: `media/${id}/`, force: true }).catch(() => {}),
    ];
    if (job?.batchId && isValidJobId(job.batchId)) {
      ops.push(gcsBucket.deleteFiles({ prefix: `archives/${job.batchId}`, force: true }).catch(() => {}));
    }
    await Promise.allSettled(ops);
  }
  pausedJobs.delete(id);
  activeJobAborters.delete(id);
}

const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  'https://download.bagbacktech.com,https://bagbacktech.com,https://bagback-download.web.app,https://bagback-download.firebaseapp.com,http://localhost:5173,http://localhost:4000'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'HEAD', 'POST', 'DELETE'],
}));
app.use(express.json({ limit: '256kb' }));
app.use((_req: Request, res: Response, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/api', (_req: Request, res: Response, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

let sseClients: { id: number; res: Response }[] = [];

function broadcastJobs() {
  const list = Array.from(jobs.values())
    .map(sanitizeJobForClient)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const data = `data: ${JSON.stringify(list)}\n\n`;
  sseClients = sseClients.filter((client) => {
    try {
      client.res.write(data);
      return true;
    } catch (err) {
      console.error('[SSE] Broadcast error', err);
      return false;
    }
  });
}

function updateJob(id: string, patch: Partial<Job>, syncImmediate = false) {
  const job = jobs.get(id);
  if (!job) return;
  const statusChanged = Boolean(patch.status && patch.status !== job.status);
  const updated: Job = { ...job, ...patch, updatedAt: new Date().toISOString() };
  jobs.set(id, updated);
  broadcastJobs();
  void syncJobToGcs(updated, syncImmediate || statusChanged);
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

let potServerStarted = false;

/**
 * Starts the background Rust bgutil-pot HTTP server on 127.0.0.1:4416 if installed.
 */
function startPotProviderServer(): void {
  if (potServerStarted) return;
  const binPath = '/usr/local/bin/bgutil-pot';
  if (!fs.existsSync(binPath)) return;
  potServerStarted = true;
  try {
    const proc = spawn(binPath, ['server', '--host', '127.0.0.1', '--port', '4416'], {
      stdio: 'ignore',
      detached: true,
    });
    proc.on('error', (err) => {
      console.warn('[bgutil-pot] Failed to start server:', err.message);
      potServerStarted = false;
    });
    proc.on('exit', () => {
      potServerStarted = false;
      setTimeout(startPotProviderServer, 3000);
    });
    proc.unref();
  } catch (err) {
    console.warn('[bgutil-pot] Spawn exception:', err);
    potServerStarted = false;
  }
}

startPotProviderServer();

/**
 * Returns shared yt-dlp runtime and PO Token plugin flags.
 */
function getBaseEngineArgs(): string[] {
  startPotProviderServer();
  const args: string[] = ['--js-runtimes', 'deno', '--js-runtimes', 'node'];
  if (fs.existsSync('/etc/yt-dlp/plugins')) {
    args.push('--plugin-dirs', '/etc/yt-dlp/plugins');
  }
  return args;
}

let lastWorkingProxy: string | null = null;
let proxyCache: { proxies: string[]; timestamp: number } = { proxies: [], timestamp: 0 };

const ANDROID_CLIENT_VERSION = '20.03.32';
const ANDROID_USER_AGENT = `com.google.android.youtube/${ANDROID_CLIENT_VERSION} (Linux; U; Android 14) gzip`;

function makeAndroidPlayerBody(videoId: string): string {
  return JSON.stringify({
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: ANDROID_CLIENT_VERSION,
        androidSdkVersion: 34,
        hl: 'en',
        gl: 'US',
      },
    },
    videoId,
  });
}

/**
 * Fetches plain text from an HTTPS URL with a 3-second timeout.
 */
function fetchHttpsText(url: string): Promise<string> {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve('');
    });
  });
}

interface ProxyHttpOptions {
  method?: string;
  headers?: Record<string, string | number>;
  body?: string;
  connectTimeout?: number;
  timeout?: number;
  earlyExitAfterBytes?: number;
  onProgress?: (bytesRead: number) => void;
}

interface ProxyHttpResult {
  statusLine?: string;
  head?: string;
  body?: Buffer;
  err?: string;
}

/**
 * Executes an HTTPS request through an HTTP CONNECT proxy using HTTP/1.0 and follows 301/302 redirects.
 */
function proxyHttpRequest(
  host: string,
  port: number,
  targetUrl: string,
  opts: ProxyHttpOptions = {},
  redirects = 3
): Promise<ProxyHttpResult> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(targetUrl);
    } catch (e: any) {
      return resolve({ err: e?.message || 'Invalid URL' });
    }

    let done = false;
    let sock: any = null;
    let ts: tls.TLSSocket | null = null;
    const req = http.request({
      host,
      port,
      method: 'CONNECT',
      path: `${u.host}:443`,
      timeout: opts.connectTimeout || 3500,
    });

    const finish = (val: ProxyHttpResult | Promise<ProxyHttpResult>) => {
      if (!done) {
        done = true;
        clearTimeout(t);
        try { if (ts) ts.destroy(); } catch {}
        try { if (sock) sock.destroy(); } catch {}
        try { req.destroy(); } catch {}
        resolve(val);
      }
    };

    const t = setTimeout(() => finish({ err: 'timeout' }), opts.timeout || 20000);

    req.on('connect', (res, s) => {
      sock = s;
      if (res.statusCode !== 200) {
        return finish({ err: `connect ${res.statusCode}` });
      }
      ts = tls.connect({ socket: s, servername: u.host }, () => {
        let reqStr = `${opts.method || 'GET'} ${u.pathname}${u.search} HTTP/1.0\r\nHost: ${u.host}\r\n`;
        for (const [k, v] of Object.entries(opts.headers || {})) {
          reqStr += `${k}: ${v}\r\n`;
        }
        reqStr += 'Connection: close\r\n\r\n';
        ts!.write(reqStr);
        if (opts.body) ts!.write(opts.body);
      });

      const chunks: Buffer[] = [];
      let bodyBytes = 0;
      let headerParsed = false;

      ts.on('data', (d: Buffer) => {
        chunks.push(d);
        if (!headerParsed) {
          const joined = Buffer.concat(chunks);
          const sep = joined.indexOf('\r\n\r\n');
          if (sep !== -1) {
            headerParsed = true;
            bodyBytes = joined.length - (sep + 4);
            if (opts.onProgress) opts.onProgress(bodyBytes);
            if (opts.earlyExitAfterBytes && bodyBytes >= opts.earlyExitAfterBytes) {
              const head = joined.slice(0, sep).toString('latin1');
              const statusLine = head.split('\r\n')[0];
              const loc = head.match(/^Location:\s*(.+)$/im);
              if ((statusLine.includes(' 301 ') || statusLine.includes(' 302 ')) && loc && redirects > 0) {
                return finish(proxyHttpRequest(host, port, loc[1].trim(), opts, redirects - 1));
              }
              return finish({ statusLine, head, body: joined.slice(sep + 4) });
            }
          }
        } else {
          bodyBytes += d.length;
          if (opts.onProgress) opts.onProgress(bodyBytes);
          if (opts.earlyExitAfterBytes && bodyBytes >= opts.earlyExitAfterBytes) {
            const joined = Buffer.concat(chunks);
            const sep = joined.indexOf('\r\n\r\n');
            const head = joined.slice(0, sep).toString('latin1');
            const statusLine = head.split('\r\n')[0];
            return finish({ statusLine, head, body: joined.slice(sep + 4) });
          }
        }
      });

      ts.on('end', () => {
        const buf = Buffer.concat(chunks);
        const sep = buf.indexOf('\r\n\r\n');
        if (sep === -1) return finish({ err: 'no header sep' });
        const head = buf.slice(0, sep).toString('latin1');
        const body = buf.slice(sep + 4);
        const statusLine = head.split('\r\n')[0];
        const loc = head.match(/^Location:\s*(.+)$/im);
        if ((statusLine.includes(' 301 ') || statusLine.includes(' 302 ')) && loc && redirects > 0) {
          return finish(proxyHttpRequest(host, port, loc[1].trim(), opts, redirects - 1));
        }
        finish({ statusLine, head, body });
      });

      ts.on('error', (e) => finish({ err: e.message }));
    });

    req.on('error', (e) => finish({ err: e.message }));
    req.on('timeout', () => finish({ err: 'req timeout' }));
    req.end();
  });
}

const PROBE_BODY = makeAndroidPlayerBody('cFnDxdn6fhw');

/**
 * Verifies if an HTTP proxy can both extract YouTube player JSON and stream bytes from googlevideo.com.
 * Tier 1: Proxy returns playable streamingData AND HTTP 200/206 bytes on googlevideo.com.
 * Tier 2: Proxy completes fast TLS to YouTube player API.
 */
async function checkProxy(proxyStr: string): Promise<{ proxy: string; tier: 1 | 2 } | null> {
  const parts = proxyStr.split(':');
  if (parts.length !== 2) return null;
  const host = parts[0];
  const port = parseInt(parts[1], 10);
  if (!host || isNaN(port)) return null;

  const r1 = await proxyHttpRequest(
    host,
    port,
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      body: PROBE_BODY,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_USER_AGENT,
        'Content-Length': Buffer.byteLength(PROBE_BODY),
      },
      connectTimeout: 2500,
      timeout: 4500,
    }
  );

  if (!r1.body || r1.body.length === 0) return null;

  try {
    const j = JSON.parse(r1.body.toString('utf8'));
    const f18 = j.streamingData?.formats?.[0];
    if (f18?.url) {
      const r2 = await proxyHttpRequest(host, port, `${f18.url}&range=0-1023`, {
        headers: { 'User-Agent': ANDROID_USER_AGENT },
        connectTimeout: 2000,
        timeout: 3500,
        earlyExitAfterBytes: 128,
      });
      if (
        r2.statusLine &&
        (r2.statusLine.includes(' 200 ') || r2.statusLine.includes(' 206 ')) &&
        r2.body &&
        r2.body.length > 0
      ) {
        return { proxy: proxyStr, tier: 1 };
      }
      return { proxy: proxyStr, tier: 2 };
    }
    if (j.playabilityStatus) {
      return { proxy: proxyStr, tier: 2 };
    }
  } catch {
    // Ignore malformed JSON
  }
  return null;
}

/**
 * Fetches and caches stream-verified proxies ordered by Tier 1 (200/206 stream-verified) then Tier 2.
 */
async function fetchVerifiedProxies(forceRefresh = false): Promise<string[]> {
  if (
    !forceRefresh &&
    proxyCache.proxies.length > 0 &&
    Date.now() - proxyCache.timestamp < 5 * 60 * 1000
  ) {
    return lastWorkingProxy
      ? [lastWorkingProxy, ...proxyCache.proxies.filter((p) => p !== lastWorkingProxy)]
      : proxyCache.proxies;
  }

  const [feed1, feed2] = await Promise.all([
    fetchHttpsText('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=yes&anonymity=all'),
    fetchHttpsText('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all'),
  ]);

  const unique = Array.from(
    new Set(
      [...feed1.split(/\s+/), ...feed2.split(/\s+/)]
        .map((s) => s.trim())
        .filter((s) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(s))
    )
  ).slice(0, 110);

  const tier1: string[] = [];
  const tier2: string[] = [];

  await Promise.all(
    unique.map(async (p) => {
      const res = await checkProxy(p);
      if (!res) return;
      if (res.tier === 1) tier1.push(res.proxy);
      else tier2.push(res.proxy);
    })
  );

  const valid = [...tier1, ...tier2].slice(0, 12);
  if (valid.length > 0) {
    proxyCache = { proxies: valid, timestamp: Date.now() };
  }

  return lastWorkingProxy
    ? [lastWorkingProxy, ...valid.filter((p) => p !== lastWorkingProxy)]
    : valid;
}

// Pre-warm verified proxy cache on startup
fetchVerifiedProxies().catch(() => {});

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
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
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

/**
 * Checks if the target URL points to a playlist or contains a playlist parameter.
 */
function isPlaylistUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('list')) return true;
    if (/\/playlist\b|\/sets\//i.test(parsed.pathname)) return true;
    return false;
  } catch {
    return /[?&]list=|\/playlist\b|\/sets\//i.test(url);
  }
}

/**
 * Checks if the URL is a dedicated playlist page without a specific single video selected.
 */
function isPurePlaylistUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (/\/playlist\b|\/sets\//i.test(parsed.pathname)) return true;
    if (parsed.searchParams.has('list') && !parsed.searchParams.has('v') && !/youtu\.be\//i.test(url)) return true;
    return false;
  } catch {
    return /\/playlist\b|\/sets\//i.test(url);
  }
}

/**
 * Extracts playlist metadata and items (up to 50 items) using yt-dlp flat-playlist mode.
 */
async function extractPlaylistData(url: string): Promise<{
  title: string;
  thumbnail?: string;
  uploader?: string;
  items: PlaylistItem[];
} | null> {
  try {
    const args = [
      ...getBaseEngineArgs(),
      ...getCookiesArg(),
      '--flat-playlist',
      '--dump-single-json',
      '--yes-playlist',
      '--playlist-end', '50',
      '--no-warnings',
    ];
    const proxy = getCustomProxy();
    if (proxy) args.push('--proxy', proxy);
    args.push(url);

    const raw = await ytdlp(args);
    const info = JSON.parse(raw);
    if (!info || !Array.isArray(info.entries) || info.entries.length === 0) {
      return null;
    }

    const isYt = isYouTubeUrl(url);
    const items: PlaylistItem[] = info.entries
      .filter((e: any) => e && (e.id || e.url))
      .map((e: any, idx: number) => {
        const itemId = String(e.id || idx + 1);
        const itemUrl =
          e.url && /^https?:\/\//i.test(e.url)
            ? e.url
            : isYt && e.id
              ? `https://www.youtube.com/watch?v=${e.id}`
              : e.webpage_url || e.url || url;
        const thumb =
          e.thumbnail ||
          (Array.isArray(e.thumbnails) && e.thumbnails.length > 0
            ? e.thumbnails[e.thumbnails.length - 1].url
            : undefined) ||
          (isYt && e.id ? `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg` : undefined);
        return {
          id: itemId,
          title: e.title || `Track ${idx + 1}`,
          url: itemUrl,
          duration: typeof e.duration === 'number' ? e.duration : undefined,
          thumbnail: thumb,
          uploader: e.uploader || e.channel || info.uploader || info.channel,
        };
      });

    if (items.length === 0) return null;

    return {
      title: info.title || items[0].title || 'Playlist',
      thumbnail: items[0].thumbnail,
      uploader: info.uploader || info.channel || items[0].uploader,
      items,
    };
  } catch (err: any) {
    console.warn('[Playlist extraction failed]', err?.message || err);
    return null;
  }
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
  max: 300, // Limit each IP to 300 API requests per 15 minutes
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.set('trust proxy', 2);

// ─── Routes ───────────────────────────────────────────────────────────────

let healthYtdlpCache: { version: string; checkedAt: number } = { version: 'active', checkedAt: 0 };

app.get('/api/health', healthLimiter, async (_req: Request, res: Response) => {
  let diskOk = false;
  try {
    fs.accessSync(DOWNLOAD_DIR, fs.constants.W_OK);
    diskOk = true;
  } catch {
    diskOk = false;
  }

  let version = healthYtdlpCache.version;
  if (Date.now() - healthYtdlpCache.checkedAt > 60000 || version === 'active') {
    try {
      version = await ytdlp(['--version']);
      healthYtdlpCache = { version, checkedAt: Date.now() };
      setCachedYtdlpVersion(version);
    } catch {
      version = 'unavailable';
    }
  }

  let gcsStatus: 'ok' | 'degraded' | 'disabled' = 'disabled';
  if (gcsBucket) {
    try {
      const [exists] = await Promise.race([
        gcsBucket.exists(),
        new Promise<[boolean]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
      ]);
      gcsStatus = exists ? 'ok' : 'degraded';
    } catch {
      gcsStatus = 'degraded';
    }
  }

  const healthy = diskOk && version !== 'unavailable';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    ytdlp: version,
    disk: diskOk ? 'ok' : 'error',
    gcs: gcsStatus,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get('/api/stats', apiLimiter, async (_req: Request, res: Response) => {
  await refreshStatsFromGcs();
  res.json(
    getUsageStatsSnapshot({
      activeDownloads: activeDownloadsCount,
      queuedDownloads: pendingQueue.length,
      activeSseClients: sseClients.length,
      gcsEnabled: Boolean(gcsBucket),
    })
  );
});

app.post('/api/stats/event', apiLimiter, (req: Request, res: Response) => {
  const { event, count } = (req.body || {}) as { event?: string; count?: number };
  if (event !== 'autosave_file_saved' && event !== 'playlist_folder_saved') {
    res.status(400).json({ error: 'Unsupported telemetry event' });
    return;
  }
  const safeCount =
    typeof count === 'number' && Number.isFinite(count)
      ? Math.max(1, Math.min(50, Math.floor(count)))
      : 1;
  recordAutoSaveStat(safeCount);
  res.json({ recorded: true });
});

app.post('/api/analyze', apiLimiter, async (req: Request, res: Response) => {
  let { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  try {
    url = await assertPublicTarget(url);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Blocked or invalid URL' });
    return;
  }

  recordAnalyzeStat(detectPlatform(url));

  const defaultPresetFormats: FormatInfo[] = [
    { id: 'bestvideo+bestaudio/best', ext: 'mp4', resolution: '1080p (Best)', vcodec: 'h264' },
    { id: '720p', ext: 'mp4', resolution: '720p HD', vcodec: 'h264' },
    { id: '480p', ext: 'mp4', resolution: '480p SD', vcodec: 'h264' },
    { id: 'bestaudio/best', ext: 'mp3', resolution: 'Audio MP3', acodec: 'mp3' },
  ];

  // 0. Check for Playlist metadata if URL contains a playlist
  let playlistData: Awaited<ReturnType<typeof extractPlaylistData>> = null;
  if (isPlaylistUrl(url)) {
    playlistData = await extractPlaylistData(url);
    if (playlistData && isPurePlaylistUrl(url)) {
      res.json({
        title: playlistData.title,
        thumbnail: playlistData.thumbnail,
        uploader: playlistData.uploader,
        duration: 0,
        formats: defaultPresetFormats,
        isPlaylist: true,
        playlistTitle: playlistData.title,
        playlistCount: playlistData.items.length,
        playlistItems: playlistData.items,
      });
      return;
    }
  }

  const attachPlaylistFields = (payload: Record<string, any>) => {
    if (playlistData && playlistData.items.length > 0) {
      return {
        ...payload,
        isPlaylist: true,
        playlistTitle: playlistData.title,
        playlistCount: playlistData.items.length,
        playlistItems: playlistData.items,
      };
    }
    return payload;
  };

  // 1. Universal Media Extraction for Non-YouTube Platforms (SoundCloud, TikTok, Instagram, Twitter/X, Facebook, etc.)
  if (!isYouTubeUrl(url)) {
    try {
      const args = [
        ...getBaseEngineArgs(),
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

      res.json(attachPlaylistFields({
        title: info.title || 'Media Download',
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        formats: formats.length > 0 ? formats : defaultPresetFormats,
      }));
      return;
    } catch (err: any) {
      if (playlistData) {
        res.json({
          title: playlistData.title,
          thumbnail: playlistData.thumbnail,
          uploader: playlistData.uploader,
          duration: 0,
          formats: defaultPresetFormats,
          isPlaylist: true,
          playlistTitle: playlistData.title,
          playlistCount: playlistData.items.length,
          playlistItems: playlistData.items,
        });
        return;
      }

      // Retry non-YouTube extraction with Chrome TLS impersonation (curl_cffi) / direct media extension fallback
      try {
        const impArgs = [
          ...getBaseEngineArgs(),
          '--impersonate', 'chrome',
          ...getCookiesArg(),
          '--dump-json',
          '--no-playlist',
          '--flat-playlist',
        ];
        const proxy = getCustomProxy() || lastWorkingProxy || proxyCache.proxies[0];
        if (proxy) {
          impArgs.push('--proxy', /^(socks5h?|https?):\/\//i.test(proxy) ? proxy : `http://${proxy}`);
        }
        impArgs.push(url);
        const rawImp = await ytdlp(impArgs);
        const infoImp = JSON.parse(rawImp);
        const formatsImp: FormatInfo[] = (infoImp.formats || [])
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
        res.json(attachPlaylistFields({
          title: infoImp.title || 'Media Download',
          thumbnail: infoImp.thumbnail,
          duration: infoImp.duration,
          uploader: infoImp.uploader,
          formats: formatsImp.length > 0 ? formatsImp : defaultPresetFormats,
        }));
        return;
      } catch {
        // Check if URL directly points to a downloadable media file
        try {
          const parsedUrl = new URL(url);
          const extMatch = /\.(mp4|mp3|m4a|webm|mkv|mov|wav|ogg|aac|flac)$/i.exec(parsedUrl.pathname);
          if (extMatch) {
            const ext = extMatch[1].toLowerCase();
            const isAudioExt = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'].includes(ext);
            const rawName = decodeURIComponent(path.basename(parsedUrl.pathname, `.${ext}`) || 'Media File').slice(0, 80);
            res.json({
              title: rawName,
              duration: 0,
              uploader: parsedUrl.hostname,
              formats: [
                {
                  id: isAudioExt ? 'bestaudio/best' : 'bestvideo+bestaudio/best',
                  ext,
                  resolution: isAudioExt ? 'Audio' : 'Direct Media',
                  vcodec: isAudioExt ? 'none' : 'h264',
                  acodec: 'aac',
                },
              ],
            });
            return;
          }
        } catch {}
      }

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

  // 3. YouTube fast extraction with bgutil PO Token + VisionOS/Safari/MWeb
  const analyzeProxy = getCustomProxy();
  const clientStrategies =
    (fallbackOembedData || playlistData) && !analyzeProxy && getCookiesArg().length === 0
      ? []
      : [
          'mweb,web_safari,visionos;fetch_pot=always;webpage_skip=player_response',
          'tv,tv_simply,web_embedded,visionos;fetch_pot=always;webpage_skip=player_response',
        ];

  for (const clientStrategy of clientStrategies) {
    try {
      const args = [
        ...getBaseEngineArgs(),
        '--extractor-args', `youtube:player_client=${clientStrategy}`,
        ...getCookiesArg(),
        '--retries', '1',
        '--socket-timeout', '6',
        '--dump-json',
        '--no-playlist',
        '--flat-playlist',
      ];
      if (analyzeProxy) {
        args.push('--proxy', analyzeProxy);
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

      res.json(attachPlaylistFields({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        formats: formats.length > 0 ? formats : defaultPresetFormats,
      }));
      return;
    } catch (err: any) {
      console.warn(`[yt-dlp analyze strategy ${clientStrategy} (proxy=${analyzeProxy || 'direct'}) failed]`, err?.message || err);
    }
  }

  // 4. Resilient fallback if yt-dlp encounters bot protection but oembed or playlist data is available
  if (fallbackOembedData) {
    res.json(attachPlaylistFields({
      title: fallbackOembedData.title,
      thumbnail: fallbackOembedData.thumbnail_url,
      uploader: fallbackOembedData.author_name,
      duration: 0,
      formats: defaultPresetFormats,
    }));
    return;
  }

  if (playlistData) {
    res.json({
      title: playlistData.title,
      thumbnail: playlistData.thumbnail,
      uploader: playlistData.uploader,
      duration: 0,
      formats: defaultPresetFormats,
      isPlaylist: true,
      playlistTitle: playlistData.title,
      playlistCount: playlistData.items.length,
      playlistItems: playlistData.items,
    });
    return;
  }

  res.status(422).json({ error: 'Could not analyze URL. Please verify the link is public and accessible.' });
});

// ─── Download Queue Concurrency Controller ─────────────────────────────────
const MAX_CONCURRENT_DOWNLOADS = 2;
let activeDownloadsCount = 0;
const pendingQueue: Array<{ id: string; url: string; format: string; audioOnly: boolean }> = [];

/**
 * Processes the next queued download job while respecting MAX_CONCURRENT_DOWNLOADS.
 */
function processDownloadQueue(): void {
  while (activeDownloadsCount < MAX_CONCURRENT_DOWNLOADS && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (!next) break;
    if (!jobs.has(next.id)) continue;
    activeDownloadsCount++;
    runDownload(next.id, next.url, next.format, next.audioOnly)
      .catch(console.error)
      .finally(() => {
        activeDownloadsCount = Math.max(0, activeDownloadsCount - 1);
        processDownloadQueue();
      });
  }
}

app.post('/api/download', apiLimiter, async (req: Request, res: Response) => {
  let {
    url,
    format = 'bestvideo+bestaudio/best',
    audioOnly = false,
    title,
    items,
    playlist = false,
  } = req.body as {
    url?: string;
    format?: string;
    audioOnly?: boolean;
    title?: string;
    items?: Array<{ url: string; title?: string }>;
    playlist?: boolean;
  };

  if (Array.isArray(items) && items.length > 0) {
    const candidateItems = items
      .filter((item) => item && typeof item.url === 'string' && item.url.trim().length > 0)
      .slice(0, 50);

    const validatedHosts = new Map<string, boolean>();
    const validItems: Array<{ url: string; title?: string }> = [];
    for (const item of candidateItems) {
      const check = validatePublicMediaUrl(item.url);
      if (!check.valid || !check.normalizedUrl || !check.hostname) continue;
      let hostAllowed = validatedHosts.get(check.hostname);
      if (hostAllowed === undefined) {
        try {
          await assertPublicTarget(check.normalizedUrl);
          hostAllowed = true;
        } catch {
          hostAllowed = false;
        }
        validatedHosts.set(check.hostname, hostAllowed);
      }
      if (hostAllowed) {
        validItems.push({ url: check.normalizedUrl, title: item.title });
      }
    }

    if (validItems.length === 0) {
      res.status(400).json({ error: 'No valid public playlist items provided' });
      return;
    }

    const batchId = uuidv4();
    const cleanBatchTitle = (title || 'Playlist').trim().slice(0, 100);
    const ids: string[] = [];
    const now = Date.now();
    validItems.forEach((item, idx) => {
      const id = uuidv4();
      const timestamp = new Date(now + idx).toISOString();
      const job: Job = {
        id,
        url: item.url,
        title: item.title,
        status: 'queued',
        progress: 0,
        format,
        audioOnly,
        mediaType: audioOnly ? 'audio' : 'video',
        batchId,
        batchTitle: cleanBatchTitle,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      jobs.set(id, job);
      void syncJobToGcs(job, true);
      ids.push(id);
      pendingQueue.push({ id, url: item.url, format, audioOnly });
    });

    recordDownloadStartStat(ids.length, true);
    broadcastJobs();
    processDownloadQueue();
    res.json({ id: ids[0], ids, batchId, batchTitle: cleanBatchTitle, count: ids.length });
    return;
  }

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  try {
    url = await assertPublicTarget(url);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Blocked or invalid URL' });
    return;
  }

  if (playlist && isPlaylistUrl(url)) {
    const extracted = await extractPlaylistData(url);
    if (extracted && extracted.items.length > 0) {
      const safeExtracted = extracted.items
        .map((item) => ({ item, check: validatePublicMediaUrl(item.url) }))
        .filter((x) => x.check.valid && x.check.normalizedUrl)
        .slice(0, 50);

      if (safeExtracted.length > 0) {
        const batchId = uuidv4();
        const cleanBatchTitle = (extracted.title || title || 'Playlist').trim().slice(0, 100);
        const ids: string[] = [];
        const now = Date.now();
        safeExtracted.forEach(({ item, check }, idx) => {
          const itemUrl = check.normalizedUrl as string;
          const id = uuidv4();
          const timestamp = new Date(now + idx).toISOString();
          const job: Job = {
            id,
            url: itemUrl,
            title: item.title,
            status: 'queued',
            progress: 0,
            format,
            audioOnly,
            mediaType: audioOnly ? 'audio' : 'video',
            batchId,
            batchTitle: cleanBatchTitle,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          jobs.set(id, job);
          void syncJobToGcs(job, true);
          ids.push(id);
          pendingQueue.push({ id, url: itemUrl, format, audioOnly });
        });
        recordDownloadStartStat(ids.length, true);
        broadcastJobs();
        processDownloadQueue();
        res.json({ id: ids[0], ids, batchId, batchTitle: cleanBatchTitle, count: ids.length });
        return;
      }
    }
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const job: Job = {
    id,
    url,
    title,
    status: 'queued',
    progress: 0,
    format,
    audioOnly,
    mediaType: audioOnly ? 'audio' : 'video',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  void syncJobToGcs(job, true);
  pendingQueue.push({ id, url, format, audioOnly });
  recordDownloadStartStat(1, false);
  broadcastJobs();
  processDownloadQueue();

  res.json({ id });
});

/**
 * Extracts the 11-character YouTube video ID from any YouTube URL format.
 */
function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const v = parsed.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const m = parsed.pathname.match(/\/(?:shorts\/|embed\/|v\/|live\/)?([a-zA-Z0-9_-]{11})(?:\/|$)/);
    if (m) return m[1];
  } catch {
    const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Converts a downloaded MP4 file into a high-quality MP3 audio file using ffmpeg.
 */
function convertMp4ToMp3(inputMp4: string, outputMp3: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', inputMp4,
      '-vn',
      '-acodec', 'libmp3lame',
      '-q:a', '2',
      outputMp3,
    ]);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => {
      try {
        resolve(code === 0 && fs.existsSync(outputMp3) && fs.statSync(outputMp3).size > 0);
      } catch {
        resolve(false);
      }
    });
  });
}

/**
 * Downloads a YouTube video or audio directly via Android Innertube API using parallel range requests over a verified proxy.
 */
async function downloadYouTubeDirectAndroid(
  id: string,
  url: string,
  audioOnly: boolean,
  proxyStr: string,
  ffmpegAvailable: boolean
): Promise<{ success: boolean; lastError: string }> {
  const videoId = extractYouTubeId(url);
  if (!videoId) return { success: false, lastError: 'Invalid YouTube video ID' };

  const cleanProxy = proxyStr.replace(/^https?:\/\//i, '');
  const parts = cleanProxy.split(':');
  if (parts.length !== 2) return { success: false, lastError: 'Invalid proxy format' };
  const host = parts[0];
  const port = parseInt(parts[1], 10);
  if (!host || isNaN(port)) return { success: false, lastError: 'Invalid proxy host/port' };

  const body = makeAndroidPlayerBody(videoId);
  const r1 = await proxyHttpRequest(
    host,
    port,
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_USER_AGENT,
        'Content-Length': Buffer.byteLength(body),
      },
      connectTimeout: 3500,
      timeout: 7000,
    }
  );

  if (!r1.body || r1.body.length === 0) {
    return { success: false, lastError: r1.err || 'Empty player response' };
  }

  let playerJson: any;
  try {
    playerJson = JSON.parse(r1.body.toString('utf8'));
  } catch {
    return { success: false, lastError: 'Invalid player JSON' };
  }

  if (playerJson?.playabilityStatus?.status !== 'OK') {
    return {
      success: false,
      lastError: playerJson?.playabilityStatus?.reason || 'Sign in to confirm you are not a bot',
    };
  }

  const videoTitle: string | undefined = playerJson?.videoDetails?.title;
  if (videoTitle) {
    const currentJob = jobs.get(id);
    if (currentJob && !currentJob.title) {
      updateJob(id, { title: videoTitle });
    }
  }

  const formats: any[] = playerJson?.streamingData?.formats || [];
  const f18 = formats.find((f) => f.itag === 18 && f.url) || formats.find((f) => f.url);
  if (!f18?.url) {
    return { success: false, lastError: 'No progressive stream URL found' };
  }

  const totalLen = parseInt(f18.contentLength || '0', 10);
  const rawTempMp4 = path.join(DOWNLOAD_DIR, `tmp-${id}.mp4`);

  if (totalLen > 0) {
    const chunkSize = 3000000; // 3 MB per range chunk
    const ranges: Array<{ idx: number; start: number; end: number }> = [];
    let idx = 0;
    for (let start = 0; start < totalLen; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, totalLen - 1);
      ranges.push({ idx: idx++, start, end });
    }

    const chunkDone: boolean[] = new Array(ranges.length).fill(false);
    const chunkBytes: number[] = new Array(ranges.length).fill(0);
    let lastProgressReport = 0;

    const reportProgress = () => {
      const now = Date.now();
      if (now - lastProgressReport < 200) return;
      lastProgressReport = now;
      const downloaded = chunkBytes.reduce((acc, v) => acc + v, 0);
      const pct = Math.min(94, Math.max(1, Math.floor((downloaded / totalLen) * 94)));
      updateJob(id, { progress: pct });
    };

    const fileHandle = await fs.promises.open(rawTempMp4, 'w+');
    let cursor = 0;
    let failedError = '';

    try {
      const worker = async () => {
        while (cursor < ranges.length && !failedError) {
          const item = ranges[cursor++];
          const expectedLen = item.end - item.start + 1;
          let chunkOk = false;
          let lastChunkErr = '';

          for (let attempt = 0; attempt < 2 && !chunkOk && !failedError; attempt++) {
            chunkBytes[item.idx] = 0;
            const res = await proxyHttpRequest(
              host,
              port,
              `${f18.url}&range=${item.start}-${item.end}`,
              {
                headers: { 'User-Agent': ANDROID_USER_AGENT },
                connectTimeout: 4000,
                timeout: 30000,
                onProgress: (bytesRead) => {
                  chunkBytes[item.idx] = Math.min(expectedLen, bytesRead);
                  reportProgress();
                },
              }
            );

            if (
              res.body &&
              res.body.length === expectedLen &&
              res.statusLine &&
              (res.statusLine.includes(' 200 ') || res.statusLine.includes(' 206 '))
            ) {
              await fileHandle.write(res.body, 0, res.body.length, item.start);
              chunkDone[item.idx] = true;
              chunkBytes[item.idx] = expectedLen;
              reportProgress();
              chunkOk = true;
            } else {
              lastChunkErr = res.err || res.statusLine || 'Incomplete chunk';
            }
          }

          if (!chunkOk) {
            failedError = lastChunkErr || 'Chunk download failed';
            return;
          }
        }
      };

      const concurrency = Math.min(4, ranges.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      await fileHandle.close();
    }

    if (failedError || chunkDone.some((ok) => !ok)) {
      try { fs.unlinkSync(rawTempMp4); } catch {}
      return { success: false, lastError: failedError || 'Stream chunk failed' };
    }
  } else {
    const res = await proxyHttpRequest(host, port, f18.url, {
      headers: { 'User-Agent': ANDROID_USER_AGENT },
      connectTimeout: 4000,
      timeout: 45000,
    });
    if (
      !res.body ||
      res.body.length === 0 ||
      !res.statusLine ||
      (!res.statusLine.includes(' 200 ') && !res.statusLine.includes(' 206 '))
    ) {
      return { success: false, lastError: res.err || res.statusLine || 'Stream download failed' };
    }
    fs.writeFileSync(rawTempMp4, res.body);
  }

  const rawTitle = videoTitle || jobs.get(id)?.title || 'video';
  const safeTitle =
    rawTitle
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .trim()
      .slice(0, 80) || 'video';

  if (audioOnly && ffmpegAvailable) {
    const finalMp3 = path.join(DOWNLOAD_DIR, `${id}-audio.mp3`);
    try {
      updateJob(id, { progress: 96, fileName: `${safeTitle}.mp3` });
      const converted = await convertMp4ToMp3(rawTempMp4, finalMp3);
      try { fs.unlinkSync(rawTempMp4); } catch {}
      if (converted) {
        return { success: true, lastError: '' };
      }
    } catch (e: any) {
      try { fs.unlinkSync(rawTempMp4); } catch {}
      return { success: false, lastError: e?.message || 'Audio conversion failed' };
    }
  }

  const finalMp4 = path.join(DOWNLOAD_DIR, `${id}-video.mp4`);
  updateJob(id, { fileName: `${safeTitle}.mp4` });
  fs.renameSync(rawTempMp4, finalMp4);
  return { success: true, lastError: '' };
}

async function runDownload(id: string, url: string, format: string, audioOnly: boolean) {
  if (pausedJobs.has(id)) return;
  const startedAtMs = Date.now();
  const prevProgress = jobs.get(id)?.progress || 0;
  updateJob(id, { status: 'running', progress: prevProgress, error: undefined });

  // Auto-fail if stuck at 0% for more than 4 minutes
  const jobTimeout = setTimeout(() => {
    if (pausedJobs.has(id)) return;
    const currentJob = jobs.get(id);
    if (currentJob && currentJob.status === 'running' && currentJob.progress === 0) {
      activeJobAborters.get(id)?.();
      recordDownloadFailStat();
      updateJob(id, {
        status: 'failed',
        error: 'انتهت مهلة التحميل — قد يكون الرابط محظوراً أو المزود غير متاح'
      });
    }
  }, 4 * 60 * 1000);

  const realFormat = normalizeFormat(format);
  const outputTemplate = path.join(DOWNLOAD_DIR, `${id}-%(title).100s.%(ext)s`);
  const ffmpegAvailable = hasFfmpeg();
  const isYt = isYouTubeUrl(url);

  // Build yt-dlp arguments with universal support + bgutil PO Token + JS Runtimes + continue resume
  const buildArgs = (clientStrategy?: string, proxyOverride?: string, impersonate = false) => {
    const base: string[] = [...getBaseEngineArgs()];

    if (impersonate) {
      base.push('--impersonate', 'chrome');
    }

    if (isYt && clientStrategy) {
      base.push('--extractor-args', `youtube:player_client=${clientStrategy}`);
    }

    base.push(
      ...getCookiesArg(),
      '--continue',
      '--retries', proxyOverride ? '1' : '2',
      '--fragment-retries', proxyOverride ? '2' : '3',
      '--file-access-retries', '2',
      '--no-playlist',
      '--no-warnings',
      '--geo-bypass',
      '--socket-timeout', proxyOverride ? '8' : '12',
      '--progress',
      '--newline',
    );

    const proxy = proxyOverride
      ? (/^(socks5h?|https?):\/\//i.test(proxyOverride) ? proxyOverride : `http://${proxyOverride}`)
      : getCustomProxy();
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
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin',
        NO_PROXY: '127.0.0.1,localhost,::1',
        no_proxy: '127.0.0.1,localhost,::1',
      };
      const proc = spawn(binary, args, { env: childEnv });
      activeJobAborters.set(id, () => {
        try { proc.kill('SIGTERM'); } catch {}
      });

      const handleData = (data: Buffer) => {
        const text = data.toString();
        const lines = text.split(/[\r\n]+/);
        for (const line of lines) {
          const destMatch = line.match(/\[download\] Destination: .+[\\/][a-f0-9-]+-(.+)\.[a-z0-9]+$/i);
          if (destMatch) {
            const currentJob = jobs.get(id);
            if (currentJob && !currentJob.title) {
              updateJob(id, { title: destMatch[1] });
            }
          }
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
        activeJobAborters.delete(id);
        console.error('[yt-dlp spawn error]', err);
        resolve({ success: false, lastError: err.message });
      });

      proc.on('close', (code) => {
        activeJobAborters.delete(id);
        resolve({ success: code === 0, lastError: lastStderr });
      });
    });
  };

  let result: { success: boolean; lastError: string } = { success: false, lastError: '' };
  if (!isYt) {
    // Universal platforms: single fast execution, then TLS impersonation + proxy fallback if blocked
    result = await executeYtDlp(buildArgs());
    if (!result.success && !pausedJobs.has(id)) {
      const impProxy = lastWorkingProxy || proxyCache.proxies[0];
      result = await executeYtDlp(buildArgs(undefined, undefined, true));
      if (!result.success && !pausedJobs.has(id) && impProxy) {
        result = await executeYtDlp(buildArgs(undefined, impProxy, true));
      }
    }
  } else {
    const primaryStrat = 'mweb,web_safari,visionos;fetch_pot=always;webpage_skip=player_response';
    const triedProxies = new Set<string>();
    const customProxy = getCustomProxy();
    const hasDirectAuth = Boolean(customProxy) || getCookiesArg().length > 0;

    // 1. If custom proxy or cookies are configured, try direct/custom first
    if (hasDirectAuth) {
      if (customProxy) {
        result = await downloadYouTubeDirectAndroid(id, url, audioOnly, customProxy, ffmpegAvailable);
      }
      if (!result.success) {
        result = await executeYtDlp(buildArgs(primaryStrat));
      }
    }

    // 2. Try last known working proxy immediately via Direct Parallel Android Engine
    if (!result.success && lastWorkingProxy) {
      const candidate = lastWorkingProxy;
      triedProxies.add(candidate);
      result = await downloadYouTubeDirectAndroid(id, url, audioOnly, candidate, ffmpegAvailable);
      if (!result.success) {
        console.warn(`[YouTube cached proxy failed proxy=${candidate}]`, result.lastError);
        if (lastWorkingProxy === candidate) lastWorkingProxy = null;
      }
    }

    // 3. Try stream-verified proxy pool via Direct Parallel Android Engine
    if (!result.success) {
      try {
        let proxies = await fetchVerifiedProxies();
        if (proxies.length === 0) {
          proxies = await fetchVerifiedProxies(true);
        }
        for (const p of proxies) {
          if (triedProxies.has(p)) continue;
          triedProxies.add(p);
          result = await downloadYouTubeDirectAndroid(id, url, audioOnly, p, ffmpegAvailable);
          if (result.success) {
            lastWorkingProxy = p;
            break;
          }
          console.warn(`[YouTube Android engine failed proxy=${p}]`, result.lastError);
        }

        // Refresh pool once if all cached proxies failed
        if (!result.success) {
          const freshProxies = await fetchVerifiedProxies(true);
          for (const p of freshProxies) {
            if (triedProxies.has(p)) continue;
            triedProxies.add(p);
            result = await downloadYouTubeDirectAndroid(id, url, audioOnly, p, ffmpegAvailable);
            if (result.success) {
              lastWorkingProxy = p;
              break;
            }
            console.warn(`[YouTube fresh Android engine failed proxy=${p}]`, result.lastError);
          }
        }
      } catch (e) {
        console.warn('[Verified proxy fallback error]', e);
      }
    }

    // 4. Fallback to yt-dlp with bgutil-pot if direct Android engine did not complete
    if (!result.success) {
      const fallbackProxy = lastWorkingProxy || proxyCache.proxies[0];
      if (fallbackProxy) {
        result = await executeYtDlp(buildArgs(primaryStrat, fallbackProxy));
      }
      if (!result.success && !hasDirectAuth) {
        result = await executeYtDlp(buildArgs(primaryStrat));
      }
    }
  }

  const success = result.success;
  const lastError = result.lastError;

  clearTimeout(jobTimeout);
  activeJobAborters.delete(id);

  if (pausedJobs.has(id)) {
    updateJob(id, { status: 'paused' }, true);
    return;
  }

  const files = fs.readdirSync(DOWNLOAD_DIR).filter(
    (f) => f.startsWith(id) && !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.startsWith('tmp-')
  );
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
    const extractedName = validFile.replace(`${id}-`, '');
    const currentJob = jobs.get(id);
    const finalFileName = currentJob?.fileName || extractedName;
    const finalTitle = currentJob?.title || extractedName.replace(/\.[^/.]+$/, '');
    const contentType = getMediaContentType(finalFileName || validFile);

    if (gcsBucket) {
      updateJob(id, { progress: 98, fileName: finalFileName, title: finalTitle });
      const rawExt = path.extname(validFile) || path.extname(finalFileName) || '.mp4';
      const safeExt = /^\.[a-zA-Z0-9]{1,8}$/.test(rawExt) ? rawExt.toLowerCase() : '.mp4';
      const gcsObject = `media/${id}/${id}${safeExt}`;
      let uploaded = false;
      for (let attempt = 0; attempt < 2 && !uploaded; attempt++) {
        try {
          await gcsBucket.upload(filePath, {
            destination: gcsObject,
            resumable: stat.size > 5 * 1024 * 1024,
            metadata: {
              contentType,
              cacheControl: 'private, max-age=3600',
            },
          });
          uploaded = true;
        } catch (uploadErr: any) {
          console.error(`[GCS] Upload failed (attempt ${attempt + 1}) for ${id}:`, uploadErr?.message || uploadErr);
        }
      }

      if (uploaded) {
        try { fs.unlinkSync(filePath); } catch {}
        const baseJob = jobs.get(id);
        if (baseJob) {
          const completedJob: Job = {
            ...baseJob,
            status: 'completed',
            progress: 100,
            filePath: undefined,
            gcsObject,
            contentType,
            fileName: finalFileName,
            title: finalTitle,
            fileSize: stat.size,
            updatedAt: new Date().toISOString(),
          };
          jobs.set(id, completedJob);
          await syncJobToGcs(completedJob, true);
          recordDownloadCompleteStat(Date.now() - startedAtMs, stat.size);
          broadcastJobs();
        }
        return;
      }
    }

    recordDownloadCompleteStat(Date.now() - startedAtMs, stat.size);
    updateJob(id, {
      status: 'completed',
      progress: 100,
      filePath,
      contentType,
      fileName: finalFileName,
      title: finalTitle,
      fileSize: stat.size,
    }, true);
  } else if (success) {
    recordDownloadCompleteStat(Date.now() - startedAtMs, 0);
    updateJob(id, { status: 'completed', progress: 100 }, true);
  } else {
    recordDownloadFailStat();
    updateJob(id, {
      status: 'failed',
      error: sanitizeErrorMessage(lastError, url),
    }, true);
  }
}

app.get('/api/jobs', async (_req: Request, res: Response) => {
  const list = await getMergedJobsList();
  res.json(list);
});

app.get('/api/jobs/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 2000\n\n');

  // Hydrate shared state so reconnects across Cloud Run instances preserve active/completed jobs
  const list = await getMergedJobsList();
  for (const j of list) {
    if (!jobs.has(j.id)) {
      jobs.set(j.id, j);
    }
  }
  res.write(`data: ${JSON.stringify(list)}\n\n`);

  const clientId = Date.now() + Math.random();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  let closed = false;
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      cleanup();
    }
  }, 15000);

  // Gracefully end SSE stream before Firebase Hosting's 60s reverse-proxy timeout
  const maxLifetimeTimer = setTimeout(() => {
    cleanup();
    try { res.end(); } catch {}
  }, 45000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    clearTimeout(maxLifetimeTimer);
    sseClients = sseClients.filter((client) => client.id !== clientId);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
});

app.get('/api/jobs/:id', apiLimiter, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }
  let job = jobs.get(id);
  if (!job || (job.status !== 'completed' && job.status !== 'failed' && gcsBucket)) {
    const remote = await loadJobFromGcs(id);
    if (remote) job = remote;
  }
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(sanitizeJobForClient(job));
});

app.post('/api/jobs/:id/pause', apiLimiter, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }
  const job = jobs.get(id) || (await loadJobFromGcs(id));
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status === 'completed' || job.status === 'failed') {
    res.json(sanitizeJobForClient(job));
    return;
  }
  pausedJobs.add(id);
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
    if (pendingQueue[i].id === id) pendingQueue.splice(i, 1);
  }
  activeJobAborters.get(id)?.();
  updateJob(id, { status: 'paused' }, true);
  res.json(sanitizeJobForClient(jobs.get(id) || { ...job, status: 'paused' }));
});

app.post('/api/jobs/:id/resume', apiLimiter, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }
  const job = jobs.get(id) || (await loadJobFromGcs(id));
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status === 'completed' || job.status === 'running') {
    res.json(sanitizeJobForClient(job));
    return;
  }
  pausedJobs.delete(id);
  const audioOnly = Boolean(job.audioOnly || job.mediaType === 'audio' || job.format === 'bestaudio/best');
  const format = job.format || (audioOnly ? 'bestaudio/best' : 'bestvideo+bestaudio/best');
  jobs.set(id, { ...job, status: 'queued', error: undefined, updatedAt: new Date().toISOString() });
  if (!pendingQueue.some((p) => p.id === id)) {
    pendingQueue.push({ id, url: job.url, format, audioOnly });
  }
  void syncJobToGcs(jobs.get(id)!, true);
  broadcastJobs();
  processDownloadQueue();
  res.json(sanitizeJobForClient(jobs.get(id)!));
});

app.post('/api/jobs/:id/retry', apiLimiter, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }
  const job = jobs.get(id) || (await loadJobFromGcs(id));
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  pausedJobs.delete(id);
  const audioOnly = Boolean(job.audioOnly || job.mediaType === 'audio' || job.format === 'bestaudio/best');
  const format = job.format || (audioOnly ? 'bestaudio/best' : 'bestvideo+bestaudio/best');
  jobs.set(id, {
    ...job,
    status: 'queued',
    progress: 0,
    error: undefined,
    updatedAt: new Date().toISOString(),
  });
  if (!pendingQueue.some((p) => p.id === id)) {
    pendingQueue.push({ id, url: job.url, format, audioOnly });
  }
  void syncJobToGcs(jobs.get(id)!, true);
  broadcastJobs();
  processDownloadQueue();
  res.json(sanitizeJobForClient(jobs.get(id)!));
});

app.post('/api/jobs/:id/archived', apiLimiter, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }
  const job = jobs.get(id) || (await loadJobFromGcs(id));
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  const savedAt = job.savedOnDeviceAt || new Date().toISOString();
  const updated: Job = {
    ...job,
    archived: true,
    savedOnDeviceAt: savedAt,
    updatedAt: new Date().toISOString(),
  };
  jobs.set(id, updated);
  await syncJobToGcs(updated, true);
  broadcastJobs();
  res.json({ archived: true, id, savedOnDeviceAt: savedAt });
});

app.post('/api/batches/:batchId/archived', apiLimiter, async (req: Request, res: Response) => {
  const batchId = req.params.batchId;
  if (!isValidJobId(batchId)) {
    res.status(400).json({ error: 'Invalid batch ID' });
    return;
  }
  const list = await getMergedJobsList();
  const targets = list.filter((j) => j.batchId === batchId && j.status === 'completed');
  const savedAt = new Date().toISOString();
  await Promise.all(
    targets.map(async (item) => {
      const local = jobs.get(item.id);
      const updated: Job = {
        ...(local || item),
        archived: true,
        savedOnDeviceAt: item.savedOnDeviceAt || savedAt,
        updatedAt: savedAt,
      };
      jobs.set(item.id, updated);
      await syncJobToGcs(updated, true);
    })
  );
  broadcastJobs();
  res.json({ archived: true, count: targets.length, savedOnDeviceAt: savedAt });
});

app.get('/api/batches/:batchId/zip', apiLimiter, async (req: Request, res: Response) => {
  const batchId = req.params.batchId;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (!isValidJobId(batchId)) {
    res.status(400).json({ error: 'Invalid batch ID' });
    return;
  }

  const allJobs = await getMergedJobsList();
  const batchJobs = allJobs
    .filter((j) => j.batchId === batchId && j.status === 'completed')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (batchJobs.length === 0) {
    res.status(404).json({ error: 'No completed playlist files available' });
    return;
  }

  const zipTitle = (batchJobs[0].batchTitle || 'Bagback-Playlist').trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').slice(0, 80) || 'Bagback-Playlist';
  const disposition = buildContentDisposition(`${zipTitle}.zip`);

  // 1. Primary Cloud Run path: stream GCS objects into a cached GCS archive object & redirect 302 to Signed URL
  if (gcsBucket) {
    const archiveObject = `archives/${batchId}-${batchJobs.length}.zip`;
    const archiveFile = gcsBucket.file(archiveObject);
    try {
      const [exists] = await archiveFile.exists();
      if (!exists) {
        const entries: ZipInputEntry[] = [];
        for (const item of batchJobs) {
          if (item.gcsObject) {
            const mediaFile = gcsBucket.file(item.gcsObject);
            const [objExists] = await mediaFile.exists();
            if (objExists) {
              const ext = path.extname(item.gcsObject) || '.mp4';
              const entryName = item.fileName || `${item.title || item.id}${ext}`;
              entries.push({
                name: entryName,
                createStream: () => mediaFile.createReadStream(),
              });
            }
          }
        }
        if (entries.length === 0) {
          res.status(404).json({ error: 'Playlist media objects unavailable on storage' });
          return;
        }
        const writeStream = archiveFile.createWriteStream({
          resumable: true,
          metadata: {
            contentType: 'application/zip',
            cacheControl: 'private, max-age=3600',
          },
        });
        await streamFilesToZip(entries, writeStream);
      }

      const [signedUrl] = await archiveFile.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 2 * 60 * 60 * 1000,
        responseDisposition: disposition,
        responseType: 'application/zip',
      });
      const parsed = new URL(signedUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === 'storage.googleapis.com') {
        recordZipBundleStat();
        res.redirect(302, parsed.toString());
        return;
      }
    } catch (err: any) {
      console.error(`[ZIP] Failed building GCS playlist archive for ${batchId}:`, err?.message || err);
      res.status(500).json({ error: 'Failed creating playlist archive' });
      return;
    }
  }

  // 2. Local Docker fallback: stream ZIP straight from local validated files
  const localEntries: ZipInputEntry[] = [];
  for (const item of batchJobs) {
    const localJob = jobs.get(item.id) || item;
    const safeLocal = resolveSafeLocalFile(item.id, DOWNLOAD_DIR, localJob.filePath);
    if (safeLocal) {
      const entryName = item.fileName || path.basename(safeLocal).replace(`${item.id}-`, '');
      localEntries.push({
        name: entryName,
        createStream: () => fs.createReadStream(safeLocal),
      });
    }
  }

  if (localEntries.length === 0) {
    res.status(404).json({ error: 'Playlist files not found on disk' });
    return;
  }

  recordZipBundleStat();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', disposition);
  createZipPassThrough(localEntries).pipe(res);
});

app.get('/api/jobs/:id/file', apiLimiter, async (req: Request, res: Response) => {
  const id = req.params.id;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Origin');

  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }

  let job = jobs.get(id);
  if (!job || (job.status !== 'completed' && gcsBucket)) {
    const remote = await loadJobFromGcs(id);
    if (remote) job = remote;
  }

  if (!job || job.status !== 'completed') {
    res.status(404).json({ error: 'File not ready' });
    return;
  }

  const downloadName = job.fileName || `${job.title || 'download'}.mp4`;
  const contentType = job.contentType || getMediaContentType(downloadName);
  const disposition = buildContentDisposition(downloadName);

  // 1. Primary cloud path: redirect directly to short-lived GCS Signed URL (supports unlimited size + Range resume)
  if (gcsBucket && job.gcsObject) {
    try {
      const gcsFile = gcsBucket.file(job.gcsObject);
      const [exists] = await gcsFile.exists();
      if (exists) {
        const [signedUrl] = await gcsFile.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 2 * 60 * 60 * 1000,
          responseDisposition: disposition,
          responseType: contentType,
        });
        const parsed = new URL(signedUrl);
        if (parsed.protocol === 'https:' && parsed.hostname === 'storage.googleapis.com') {
          res.redirect(302, parsed.toString());
          return;
        }
      }
    } catch (err: any) {
      console.error(`[GCS] Signed URL generation failed for ${id}:`, err?.message || err);
    }
  }

  // 2. Local / Docker disk fallback with full HTTP 206 Range + HEAD support
  const safeLocalPath = resolveSafeLocalFile(id, DOWNLOAD_DIR, job.filePath);
  if (!safeLocalPath) {
    res.status(404).json({ error: 'File not found on storage' });
    return;
  }

  const stat = fs.statSync(safeLocalPath);
  const totalSize = stat.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', disposition);

  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', totalSize);
    res.status(200).end();
    return;
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const parsedRange = parseByteRange(rangeHeader, totalSize);
    if (!parsedRange.ok) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.status(416).end();
      return;
    }
    const { start, end } = parsedRange;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(safeLocalPath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', totalSize);
  fs.createReadStream(safeLocalPath).pipe(res);
});

app.delete('/api/jobs', apiLimiter, async (_req: Request, res: Response) => {
  const idsToDelete = new Set<string>(jobs.keys());
  if (gcsBucket) {
    const remote = await listJobsFromGcs();
    for (const r of remote) idsToDelete.add(r.id);
  }
  await Promise.all(Array.from(idsToDelete).map((id) => deleteJobArtifacts(id, jobs.get(id))));
  jobs.clear();
  broadcastJobs();
  res.json({ cleared: true });
});

app.delete('/api/jobs/:id', apiLimiter, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidJobId(id)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }
  const job = jobs.get(id) || (await loadJobFromGcs(id));
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  await deleteJobArtifacts(id, job);
  jobs.delete(id);
  broadcastJobs();
  res.json({ deleted: true });
});

if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', apiLimiter, (_req: Request, res: Response) => {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Frontend not built');
    }
  });
}

// ─── Auto-Cleanup Job ──────────────────────────────────────────────────────────

const CLEANUP_INTERVAL = 5 * 60 * 1000; // Every 5 minutes for rapid archived cost cleanup

function isJobExpired(job: Job, now: number): boolean {
  if (job.archived && job.savedOnDeviceAt) {
    return now - new Date(job.savedOnDeviceAt).getTime() > ARCHIVED_MAX_AGE_MS;
  }
  return now - new Date(job.createdAt).getTime() > JOB_MAX_AGE_MS;
}

setInterval(() => {
  const now = Date.now();
  let deletedCount = 0;
  for (const [id, job] of jobs.entries()) {
    if (isJobExpired(job, now)) {
      deletedCount += 1;
      void deleteJobArtifacts(id, job);
      jobs.delete(id);
    }
  }
  if (gcsBucket) {
    void listJobsFromGcs().then((remote) => {
      for (const r of remote) {
        if (isJobExpired(r, now)) {
          void deleteJobArtifacts(r.id, r);
          jobs.delete(r.id);
        }
      }
    });
  }
  if (deletedCount > 0) {
    console.log(`[Cleanup] Purged ${deletedCount} expired/archived job(s)`);
    broadcastJobs();
  }
}, CLEANUP_INTERVAL);

app.listen(PORT, () => {
  console.log(`[Bagback Download Server] listening on port ${PORT}`);
  console.log(`[Bagback Download Server] download dir: ${DOWNLOAD_DIR}`);
  console.log(`[Bagback Download Server] static dir: ${STATIC_DIR}`);
  console.log(`[Bagback Download Server] GCS bucket: ${GCS_BUCKET_NAME || 'disabled (local mode)'}`);
  void initStats(gcsBucket);
  void ytdlp(['--version'])
    .then((ver) => {
      healthYtdlpCache = { version: ver, checkedAt: Date.now() };
      setCachedYtdlpVersion(ver);
    })
    .catch(() => {});
});
