import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const security = require('../dist/security.js');

test('isValidJobId strictly enforces UUID format', () => {
  assert.equal(security.isValidJobId('0656c014-491d-449d-ac43-3b4547252b18'), true);
  assert.equal(security.isValidJobId('../etc/passwd'), false);
  assert.equal(security.isValidJobId('not-a-uuid'), false);
  assert.equal(security.isValidJobId(undefined), false);
});

test('isForbiddenIpAddress blocks private, loopback, metadata, and IPv4-mapped IPv6 targets', () => {
  assert.equal(security.isForbiddenIpAddress('127.0.0.1'), true);
  assert.equal(security.isForbiddenIpAddress('10.0.5.1'), true);
  assert.equal(security.isForbiddenIpAddress('172.16.0.10'), true);
  assert.equal(security.isForbiddenIpAddress('192.168.1.1'), true);
  assert.equal(security.isForbiddenIpAddress('169.254.169.254'), true);
  assert.equal(security.isForbiddenIpAddress('100.64.0.1'), true);
  assert.equal(security.isForbiddenIpAddress('::1'), true);
  assert.equal(security.isForbiddenIpAddress('fe80::1'), true);
  assert.equal(security.isForbiddenIpAddress('fd00::1'), true);
  assert.equal(security.isForbiddenIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(security.isForbiddenIpAddress('::ffff:7f00:1'), true);
  assert.equal(security.isForbiddenIpAddress('::ffff:a9fe:a9fe'), true);

  // Public IPs remain allowed
  assert.equal(security.isForbiddenIpAddress('8.8.8.8'), false);
  assert.equal(security.isForbiddenIpAddress('142.250.190.46'), false);
  assert.equal(security.isForbiddenIpAddress('2606:4700:4700::1111'), false);
});

test('validatePublicMediaUrl rejects internal/SSRF URLs and accepts public media links', () => {
  assert.equal(security.validatePublicMediaUrl('http://localhost:4000/api').valid, false);
  assert.equal(security.validatePublicMediaUrl('http://metadata.google.internal/computeMetadata/v1/').valid, false);
  assert.equal(security.validatePublicMediaUrl('http://169.254.169.254/latest').valid, false);
  assert.equal(security.validatePublicMediaUrl('https://user:pass@youtube.com/watch?v=1').valid, false);
  assert.equal(security.validatePublicMediaUrl('file:///etc/passwd').valid, false);

  const ok = security.validatePublicMediaUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.equal(ok.valid, true);
  assert.equal(ok.hostname, 'www.youtube.com');
});

test('buildContentDisposition sanitizes CRLF/quotes and preserves UTF-8 Arabic names', () => {
  const header = security.buildContentDisposition('فيلم "تجريبي"\r\nX-Injected: 1.mp4');
  assert.equal(header.includes('\r'), false);
  assert.equal(header.includes('\n'), false);
  assert.ok(header.startsWith('attachment; filename="'));
  assert.ok(header.includes("filename*=UTF-8''"));
});

test('resolveSafeLocalFile prevents path traversal outside DOWNLOAD_DIR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bagback-test-'));
  const id = '0656c014-491d-449d-ac43-3b4547252b18';
  const validPath = path.join(dir, `${id}-video.mp4`);
  const foreignPath = path.join(dir, 'other-file.mp4');
  fs.writeFileSync(validPath, 'ok');
  fs.writeFileSync(foreignPath, 'no');

  try {
    assert.equal(security.resolveSafeLocalFile(id, dir, validPath), validPath);
    assert.equal(security.resolveSafeLocalFile(id, dir, foreignPath), null);
    assert.equal(security.resolveSafeLocalFile(id, dir, path.join(dir, '..', 'outside.mp4')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseByteRange handles valid, suffix, open-ended, and invalid ranges', () => {
  assert.deepEqual(security.parseByteRange('bytes=0-99', 1000), { ok: true, start: 0, end: 99 });
  assert.deepEqual(security.parseByteRange('bytes=500-', 1000), { ok: true, start: 500, end: 999 });
  assert.deepEqual(security.parseByteRange('bytes=-100', 1000), { ok: true, start: 900, end: 999 });
  assert.deepEqual(security.parseByteRange('bytes=900-5000', 1000), { ok: true, start: 900, end: 999 });
  assert.equal(security.parseByteRange('bytes=1200-1500', 1000).ok, false);
  assert.equal(security.parseByteRange('bytes=-', 1000).ok, false);
  assert.equal(security.parseByteRange('items=0-5', 1000).ok, false);
});

test('detectPlatform categorizes URLs without storing raw links', () => {
  assert.equal(security.detectPlatform('https://youtu.be/abc'), 'youtube');
  assert.equal(security.detectPlatform('https://www.tiktok.com/@user/video/1'), 'tiktok');
  assert.equal(security.detectPlatform('https://www.instagram.com/reel/123'), 'instagram');
  assert.equal(security.detectPlatform('https://x.com/user/status/1'), 'twitter');
  assert.equal(security.detectPlatform('https://example.org/file.mp4'), 'other');
});
