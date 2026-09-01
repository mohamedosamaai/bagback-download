"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const child_process_1 = require("child_process");
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path_1.default.join(os_1.default.tmpdir(), 'bagback-downloads');
const STATIC_DIR = process.env.STATIC_DIR || path_1.default.join(__dirname, '..', 'static');
if (!fs_1.default.existsSync(DOWNLOAD_DIR)) {
    fs_1.default.mkdirSync(DOWNLOAD_DIR, { recursive: true, mode: 0o700 });
}
const jobs = new Map();
// ─── Rate Limiters ───────────────────────────────────────────────────────────
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 120, // Limit each IP to 120 requests per 15 minutes
    message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});
const fileLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: 'Too many file operations, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.set('trust proxy', 1);
// ─── CORS Configuration ───────────────────────────────────────────────────────
const defaultAllowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4000',
    'https://download.bagbacktech.com',
    'https://bagbacktech.com',
];
const configuredOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : defaultAllowedOrigins;
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || configuredOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(null, false);
        }
    },
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true,
}));
app.use(express_1.default.json());
let sseClients = [];
function broadcastJobs() {
    const list = Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const data = `data: ${JSON.stringify(list)}\n\n`;
    sseClients.forEach((client) => {
        try {
            client.res.write(data);
        }
        catch (err) {
            console.error('[SSE] Broadcast error', err);
        }
    });
}
function updateJob(id, patch) {
    const job = jobs.get(id);
    if (!job)
        return;
    jobs.set(id, { ...job, ...patch, updatedAt: new Date().toISOString() });
    broadcastJobs();
}
function checkProxy(proxyStr) {
    return new Promise((resolve) => {
        const parts = proxyStr.split(':');
        if (parts.length !== 2)
            return resolve(null);
        const host = parts[0].trim();
        const port = parseInt(parts[1], 10);
        if (!host || isNaN(port) || port <= 0 || port > 65535)
            return resolve(null);
        const req = http_1.default.request({
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
async function fetchVerifiedProxies() {
    return new Promise((resolve) => {
        const req = https_1.default.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=1500&country=all&ssl=all&anonymity=all', (res) => {
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
                const working = results.filter((p) => Boolean(p));
                resolve(working);
            });
        });
        req.on('error', () => resolve([]));
        req.setTimeout(3000, () => {
            req.destroy();
            resolve([]);
        });
    });
}
function normalizeFormat(format) {
    if (format === '720p')
        return 'bestvideo[height<=720]+bestaudio/best[height<=720]/b/best';
    if (format === '480p')
        return 'bestvideo[height<=480]+bestaudio/best[height<=480]/b/best';
    if (format === '360p')
        return 'bestvideo[height<=360]+bestaudio/best[height<=360]/b/best';
    if (format === 'bestaudio/best' || format === 'mp3')
        return 'bestaudio/best';
    if (format && format !== 'bestvideo+bestaudio/best')
        return format;
    return 'b/bv*+ba/best';
}
function getYtDlpBinary() {
    if (process.env.YTDLP_PATH && fs_1.default.existsSync(process.env.YTDLP_PATH)) {
        return process.env.YTDLP_PATH;
    }
    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const candidates = [
        path_1.default.join(__dirname, '..', '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
        path_1.default.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
        path_1.default.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
        path_1.default.join(process.cwd(), '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
        binaryName,
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate)) {
            return candidate;
        }
    }
    return binaryName;
}
function ytdlp(args) {
    return new Promise((resolve, reject) => {
        const binary = getYtDlpBinary();
        const proc = (0, child_process_1.spawn)(binary, args, { env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin' } });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('error', (err) => {
            reject(err);
        });
        proc.on('close', (code) => {
            if (code === 0)
                resolve(stdout.trim());
            else
                reject(new Error(stderr.trim() || `${binary} exited with code ${code}`));
        });
    });
}
function isYouTubeUrl(urlStr) {
    try {
        const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
        const host = parsed.hostname.toLowerCase();
        return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be');
    }
    catch {
        return false;
    }
}
function sanitizeUrl(rawUrl) {
    try {
        const trimmed = rawUrl.trim();
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const parsed = new URL(withProtocol);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    }
    catch {
        return null;
    }
}
// ─── Routes ───────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
    try {
        const version = await ytdlp(['--version']);
        res.json({ status: 'ok', ytdlp: version });
    }
    catch {
        res.json({ status: 'ok', ytdlp: 'active' });
    }
});
app.post('/api/analyze', apiLimiter, async (req, res) => {
    const { url: rawUrl } = req.body;
    if (!rawUrl || typeof rawUrl !== 'string') {
        res.status(400).json({ error: 'Invalid URL' });
        return;
    }
    const url = sanitizeUrl(rawUrl);
    if (!url) {
        res.status(400).json({ error: 'Invalid URL format' });
        return;
    }
    // 1. YouTube OEmbed First (instant metadata)
    if (isYouTubeUrl(url)) {
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const response = await fetch(oembedUrl);
            if (response.ok) {
                const oembed = await response.json();
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
        }
        catch (e) {
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
        const formats = (info.formats || [])
            .filter((f) => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none'))
            .map((f) => ({
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
    }
    catch (err) {
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
            const formats = (info.formats || [])
                .filter((f) => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none'))
                .map((f) => ({
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
        }
        catch (proxyErr) {
            console.warn(`[Proxy analyze failed with ${proxy}]`, proxyErr);
        }
    }
    res.status(422).json({ error: 'Could not analyze URL. Please verify the link is public and accessible.' });
});
app.post('/api/download', apiLimiter, (req, res) => {
    const { url: rawUrl, format = 'bestvideo+bestaudio/best', audioOnly = false } = req.body;
    if (!rawUrl || typeof rawUrl !== 'string') {
        res.status(400).json({ error: 'Invalid URL' });
        return;
    }
    const url = sanitizeUrl(rawUrl);
    if (!url) {
        res.status(400).json({ error: 'Invalid URL format' });
        return;
    }
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    const job = {
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
function hasFfmpeg() {
    try {
        const res = (0, child_process_1.spawnSync)('ffmpeg', ['-version']);
        return res.status === 0;
    }
    catch {
        return false;
    }
}
async function runDownload(id, url, format, audioOnly) {
    updateJob(id, { status: 'running', progress: 5 });
    const realFormat = normalizeFormat(format);
    const outputTemplate = path_1.default.join(DOWNLOAD_DIR, `${id}-%(title).100s.%(ext)s`);
    const ffmpegAvailable = hasFfmpeg();
    // Build base yt-dlp arguments
    const buildArgs = (proxyUrl) => {
        const base = [
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
            if (ffmpegAvailable) {
                base.push('-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputTemplate, url);
            }
            else {
                base.push('-f', 'bestaudio/best', '-o', outputTemplate, url);
            }
        }
        else {
            if (ffmpegAvailable) {
                base.push('-f', realFormat, '--merge-output-format', 'mp4', '-o', outputTemplate, url);
            }
            else {
                base.push('-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio/best', '-o', outputTemplate, url);
            }
        }
        return base;
    };
    const executeYtDlp = (args) => {
        return new Promise((resolve) => {
            const binary = getYtDlpBinary();
            const proc = (0, child_process_1.spawn)(binary, args, {
                env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin' },
            });
            const handleData = (data) => {
                const text = data.toString();
                const lines = text.split(/[\r\n]+/);
                for (const line of lines) {
                    const progMatch = line.match(/(?:\[download\])?\s*([\d\.]+)%/i);
                    if (progMatch) {
                        const p = parseFloat(progMatch[1]);
                        if (!isNaN(p) && p >= 0 && p <= 100) {
                            updateJob(id, { progress: Math.min(99, Math.max(5, p)) });
                        }
                    }
                    else if (/\[(Merger|ExtractAudio|Fixup|VideoConvertor)\]/i.test(line)) {
                        updateJob(id, { progress: 95 });
                    }
                }
            };
            proc.stdout.on('data', handleData);
            proc.stderr.on('data', handleData);
            proc.on('error', (err) => {
                console.error('[yt-dlp spawn error]', err);
                resolve(false);
            });
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
                if (success)
                    break;
            }
        }
        catch (e) {
            console.warn('[Proxy fallback error]', e);
        }
    }
    const files = fs_1.default.readdirSync(DOWNLOAD_DIR).filter((f) => f.startsWith(id));
    const validFile = files.find((f) => {
        try {
            const p = path_1.default.join(DOWNLOAD_DIR, f);
            return fs_1.default.existsSync(p) && fs_1.default.statSync(p).size > 0;
        }
        catch {
            return false;
        }
    });
    if (validFile) {
        const filePath = path_1.default.join(DOWNLOAD_DIR, validFile);
        const stat = fs_1.default.statSync(filePath);
        updateJob(id, {
            status: 'completed',
            progress: 100,
            filePath,
            fileName: validFile.replace(`${id}-`, ''),
            fileSize: stat.size,
        });
    }
    else if (success) {
        updateJob(id, { status: 'completed', progress: 100 });
    }
    else {
        updateJob(id, { status: 'failed', error: 'Download could not be completed' });
    }
}
app.get('/api/jobs', apiLimiter, (_req, res) => {
    const list = Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(list);
});
app.get('/api/jobs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    // Send the initial list immediately
    const list = Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.write(`data: ${JSON.stringify(list)}\n\n`);
    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);
    const heartbeatTimer = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        }
        catch {
            clearInterval(heartbeatTimer);
        }
    }, 15000);
    req.on('close', () => {
        clearInterval(heartbeatTimer);
        sseClients = sseClients.filter((client) => client.id !== clientId);
    });
});
app.get('/api/jobs/:id', apiLimiter, (req, res) => {
    const jobId = req.params.id;
    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
        res.status(400).json({ error: 'Invalid Job ID format' });
        return;
    }
    const job = jobs.get(jobId);
    if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
    }
    res.json(job);
});
app.get('/api/jobs/:id/file', fileLimiter, (req, res) => {
    const jobId = req.params.id;
    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
        res.status(400).json({ error: 'Invalid Job ID format' });
        return;
    }
    const job = jobs.get(jobId);
    if (!job || job.status !== 'completed' || !job.filePath) {
        res.status(404).json({ error: 'File not ready' });
        return;
    }
    const safeDirPath = path_1.default.resolve(DOWNLOAD_DIR);
    const resolvedFilePath = path_1.default.resolve(job.filePath);
    if (!resolvedFilePath.startsWith(safeDirPath)) {
        res.status(403).json({ error: 'Access denied: invalid file path' });
        return;
    }
    if (!fs_1.default.existsSync(resolvedFilePath)) {
        res.status(404).json({ error: 'File not found on disk' });
        return;
    }
    const stat = fs_1.default.statSync(resolvedFilePath);
    const ext = path_1.default.extname(resolvedFilePath).slice(1);
    const mimeMap = {
        mp4: 'video/mp4',
        mp3: 'audio/mpeg',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        m4a: 'audio/mp4',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const safeFileName = (job.fileName || 'download').replace(/[\r\n"/\\]/g, '_');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFileName)}"`);
    fs_1.default.createReadStream(resolvedFilePath).pipe(res);
});
app.delete('/api/jobs/:id', fileLimiter, (req, res) => {
    const jobId = req.params.id;
    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
        res.status(400).json({ error: 'Invalid Job ID format' });
        return;
    }
    const job = jobs.get(jobId);
    if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
    }
    if (job.filePath) {
        const safeDirPath = path_1.default.resolve(DOWNLOAD_DIR);
        const resolvedFilePath = path_1.default.resolve(job.filePath);
        if (resolvedFilePath.startsWith(safeDirPath) && fs_1.default.existsSync(resolvedFilePath)) {
            try {
                fs_1.default.unlinkSync(resolvedFilePath);
            }
            catch (err) {
                console.error(`[Delete] Error unlinking file ${resolvedFilePath}`, err);
            }
        }
    }
    jobs.delete(jobId);
    res.json({ deleted: true });
});
if (fs_1.default.existsSync(STATIC_DIR)) {
    app.use(express_1.default.static(STATIC_DIR));
    app.get('*', apiLimiter, (_req, res) => {
        const indexPath = path_1.default.join(STATIC_DIR, 'index.html');
        if (fs_1.default.existsSync(indexPath)) {
            res.sendFile(indexPath);
        }
        else {
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
            if (job.filePath) {
                const safeDirPath = path_1.default.resolve(DOWNLOAD_DIR);
                const resolvedFilePath = path_1.default.resolve(job.filePath);
                if (resolvedFilePath.startsWith(safeDirPath) && fs_1.default.existsSync(resolvedFilePath)) {
                    try {
                        fs_1.default.unlinkSync(resolvedFilePath);
                    }
                    catch (e) {
                        console.error(`[Cleanup] Error deleting file ${resolvedFilePath}`, e);
                    }
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
