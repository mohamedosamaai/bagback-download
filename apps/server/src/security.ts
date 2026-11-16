import dns from 'dns';
import fs from 'fs';
import net from 'net';
import path from 'path';
import type { Job } from '@bagback-download/core';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates that a job ID is strictly a UUID v4-formatted identifier. */
export function isValidJobId(id: string | undefined): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Resolves the MIME type from a media filename or path extension. */
export function getMediaContentType(fileNameOrPath: string): string {
  const ext = path.extname(fileNameOrPath).slice(1).toLowerCase();
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    m4a: 'audio/mp4',
    mov: 'video/quicktime',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/** Builds an RFC 5987 attachment Content-Disposition header safe against header injection. */
export function buildContentDisposition(rawFileName: string): string {
  const sanitized = (rawFileName || 'download').replace(/[\r\n\x00-\x1F"/\\]+/g, '_').trim() || 'download';
  const ext = path.extname(sanitized).replace(/[^a-zA-Z0-9.]/g, '');
  const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, '').replace(/[";]+/g, '_').trim() || `bagback-download${ext}`;
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(sanitized)}`;
}

/** Verifies and resolves a local downloaded file path strictly inside downloadDir for a validated job ID. */
export function resolveSafeLocalFile(id: string, downloadDir: string, filePath?: string): string | null {
  if (!isValidJobId(id) || !filePath) return null;
  const resolvedRoot = path.resolve(downloadDir);
  const resolvedTarget = path.resolve(filePath);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) return null;
  if (!path.basename(resolvedTarget).startsWith(`${id}-`)) return null;
  return fs.existsSync(resolvedTarget) ? resolvedTarget : null;
}

/** Serializes a job without exposing internal server filesystem paths. */
export function sanitizeJobForClient(job: Job): Job {
  const { filePath: _omit, ...safeJob } = job;
  return safeJob;
}

/** Parses an HTTP Range bytes header safely against totalSize. */
export function parseByteRange(
  rangeHeader: string,
  totalSize: number
): { ok: true; start: number; end: number } | { ok: false } {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || totalSize <= 0) return { ok: false };
  if (!match[1] && !match[2]) return { ok: false };

  const start = match[1] ? parseInt(match[1], 10) : Math.max(0, totalSize - parseInt(match[2], 10));
  const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), totalSize - 1) : totalSize - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= totalSize) {
    return { ok: false };
  }
  return { ok: true, start, end };
}

function isForbiddenIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast & reserved/broadcast
  return false;
}

/** Checks whether an IPv4 or IPv6 address belongs to loopback, private, link-local, metadata, or reserved space. */
export function isForbiddenIpAddress(rawIp: string): boolean {
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const version = net.isIP(cleaned);
  if (version === 4) return isForbiddenIpv4(cleaned);
  if (version !== 6) return true;

  if (cleaned === '::' || cleaned === '::1') return true;
  if (cleaned.startsWith('fc') || cleaned.startsWith('fd')) return true; // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]:/.test(cleaned)) return true; // fe80::/10 link-local
  if (cleaned.startsWith('ff')) return true; // multicast

  // IPv4-mapped IPv6 dotted form: ::ffff:127.0.0.1
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(cleaned);
  if (mappedDotted) return isForbiddenIpv4(mappedDotted[1]);

  // IPv4-mapped IPv6 hex form: ::ffff:7f00:1 or ::ffff:7f00:0001
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(cleaned);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isForbiddenIpv4(ipv4);
  }

  return false;
}

const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Validates public HTTP/HTTPS media URLs syntactically against SSRF patterns. */
export function validatePublicMediaUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  hostname?: string;
  reason?: string;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Invalid URL' };
  }
  let candidate = rawUrl.trim();
  if (!candidate || candidate.length > 2048) {
    return { valid: false, reason: 'URL exceeds allowed length' };
  }
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, reason: 'Malformed URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTP and HTTPS links are accepted' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Credentials in URL are not allowed' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    FORBIDDEN_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    return { valid: false, reason: 'Private or internal hosts are blocked' };
  }

  if (net.isIP(host)) {
    if (isForbiddenIpAddress(host)) {
      return { valid: false, reason: 'Private IP addresses are blocked' };
    }
  } else if (!host.includes('.')) {
    return { valid: false, reason: 'Valid public domain is required' };
  }

  return { valid: true, normalizedUrl: parsed.toString(), hostname: host };
}

/** Validates syntactic public URL safety plus DNS lookup to block SSRF to private/metadata IPs. */
export async function assertPublicTarget(rawUrl: string): Promise<string> {
  const check = validatePublicMediaUrl(rawUrl);
  if (!check.valid || !check.normalizedUrl || !check.hostname) {
    throw new Error(check.reason || 'Invalid or disallowed URL');
  }
  if (net.isIP(check.hostname)) {
    return check.normalizedUrl;
  }

  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(check.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve target domain');
  }

  if (!records || records.length === 0) {
    throw new Error('Could not resolve target domain');
  }
  for (const rec of records) {
    if (isForbiddenIpAddress(rec.address)) {
      throw new Error('Target domain resolves to a restricted network address');
    }
  }
  return check.normalizedUrl;
}

/** Maps a target media URL into an anonymized platform bucket without storing the URL. */
export function detectPlatform(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('youtube.') || host === 'youtu.be' || host.endsWith('.youtu.be')) return 'youtube';
    if (host.includes('tiktok.')) return 'tiktok';
    if (host.includes('instagram.')) return 'instagram';
    if (host.includes('facebook.') || host === 'fb.watch') return 'facebook';
    if (host === 'x.com' || host.endsWith('.x.com') || host.includes('twitter.')) return 'twitter';
    if (host.includes('soundcloud.')) return 'soundcloud';
    if (host.includes('twitch.')) return 'twitch';
    if (host.includes('vimeo.')) return 'vimeo';
    if (host.includes('reddit.') || host === 'redd.it') return 'reddit';
    return 'other';
  } catch {
    return 'other';
  }
}
