import type { Bucket } from '@google-cloud/storage';
import type { DailyStat, UsageStats } from '@bagback-download/core';

interface PersistedStatsState {
  startedAt: string;
  updatedAt: string;
  totalAnalyses: number;
  totalDownloadsStarted: number;
  totalDownloadsCompleted: number;
  totalDownloadsFailed: number;
  totalPlaylistsQueued: number;
  totalAutoSavedFiles: number;
  totalBytesProcessed: number;
  totalDurationMs: number;
  durationSamples: number;
  platforms: Record<string, number>;
  daily: Record<string, DailyStat>;
}

const STATS_OBJECT = 'analytics/summary.json';
const processStartTimeMs = Date.now();

let bucketRef: Bucket | null = null;
let lastSyncAt = 0;
let syncTimer: NodeJS.Timeout | null = null;
let cachedYtdlpVersion = 'active';
let lastRemoteRefreshAt = 0;

const state: PersistedStatsState = {
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalAnalyses: 0,
  totalDownloadsStarted: 0,
  totalDownloadsCompleted: 0,
  totalDownloadsFailed: 0,
  totalPlaylistsQueued: 0,
  totalAutoSavedFiles: 0,
  totalBytesProcessed: 0,
  totalDurationMs: 0,
  durationSamples: 0,
  platforms: {},
  daily: {},
};

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateDaily(dateKey: string): DailyStat {
  if (!state.daily[dateKey]) {
    state.daily[dateKey] = {
      date: dateKey,
      analyses: 0,
      downloadsStarted: 0,
      downloadsCompleted: 0,
      downloadsFailed: 0,
      bytesProcessed: 0,
    };
  }
  return state.daily[dateKey];
}

function pruneOldDailyStats(): void {
  const keys = Object.keys(state.daily).sort();
  if (keys.length > 30) {
    for (const oldKey of keys.slice(0, keys.length - 30)) {
      delete state.daily[oldKey];
    }
  }
}

function mergeRemoteState(remote: Partial<PersistedStatsState>): void {
  if (!remote || typeof remote !== 'object') return;
  if (remote.startedAt && remote.startedAt < state.startedAt) {
    state.startedAt = remote.startedAt;
  }
  state.totalAnalyses = Math.max(state.totalAnalyses, Number(remote.totalAnalyses) || 0);
  state.totalDownloadsStarted = Math.max(state.totalDownloadsStarted, Number(remote.totalDownloadsStarted) || 0);
  state.totalDownloadsCompleted = Math.max(state.totalDownloadsCompleted, Number(remote.totalDownloadsCompleted) || 0);
  state.totalDownloadsFailed = Math.max(state.totalDownloadsFailed, Number(remote.totalDownloadsFailed) || 0);
  state.totalPlaylistsQueued = Math.max(state.totalPlaylistsQueued, Number(remote.totalPlaylistsQueued) || 0);
  state.totalAutoSavedFiles = Math.max(state.totalAutoSavedFiles, Number(remote.totalAutoSavedFiles) || 0);
  state.totalBytesProcessed = Math.max(state.totalBytesProcessed, Number(remote.totalBytesProcessed) || 0);
  state.totalDurationMs = Math.max(state.totalDurationMs, Number(remote.totalDurationMs) || 0);
  state.durationSamples = Math.max(state.durationSamples, Number(remote.durationSamples) || 0);

  if (remote.platforms && typeof remote.platforms === 'object') {
    for (const [k, v] of Object.entries(remote.platforms)) {
      const n = Number(v) || 0;
      if (n > (state.platforms[k] || 0)) {
        state.platforms[k] = n;
      }
    }
  }

  if (remote.daily && typeof remote.daily === 'object') {
    for (const [dayKey, dayObj] of Object.entries(remote.daily)) {
      if (!dayObj || typeof dayObj !== 'object') continue;
      const cur = getOrCreateDaily(dayKey);
      cur.analyses = Math.max(cur.analyses, Number(dayObj.analyses) || 0);
      cur.downloadsStarted = Math.max(cur.downloadsStarted, Number(dayObj.downloadsStarted) || 0);
      cur.downloadsCompleted = Math.max(cur.downloadsCompleted, Number(dayObj.downloadsCompleted) || 0);
      cur.downloadsFailed = Math.max(cur.downloadsFailed, Number(dayObj.downloadsFailed) || 0);
      cur.bytesProcessed = Math.max(cur.bytesProcessed, Number(dayObj.bytesProcessed) || 0);
    }
    pruneOldDailyStats();
  }
}

async function flushStatsToGcs(): Promise<void> {
  if (!bucketRef) return;
  lastSyncAt = Date.now();
  try {
    await bucketRef.file(STATS_OBJECT).save(JSON.stringify(state), {
      contentType: 'application/json',
      resumable: false,
      metadata: { cacheControl: 'no-store' },
    });
  } catch (err: any) {
    console.warn('[Stats] Failed persisting summary to GCS:', err?.message || err);
  }
}

function scheduleStatsSync(immediate = false): void {
  state.updatedAt = new Date().toISOString();
  if (!bucketRef) return;
  if (immediate || Date.now() - lastSyncAt > 5000) {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    void flushStatsToGcs();
    return;
  }
  if (!syncTimer) {
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void flushStatsToGcs();
    }, 3000);
  }
}

/** Loads persisted usage stats from GCS on startup and caches yt-dlp version cleanly. */
export async function initStats(bucket: Bucket | null, initialYtdlpVersion = 'active'): Promise<void> {
  bucketRef = bucket;
  cachedYtdlpVersion = initialYtdlpVersion;
  if (!bucketRef) return;
  try {
    const file = bucketRef.file(STATS_OBJECT);
    const [exists] = await file.exists();
    if (!exists) return;
    const [buf] = await file.download();
    mergeRemoteState(JSON.parse(buf.toString('utf8')));
    lastRemoteRefreshAt = Date.now();
  } catch (err: any) {
    console.warn('[Stats] Initial GCS stats load failed:', err?.message || err);
  }
}

/** Updates cached yt-dlp version shown on telemetry and health checks. */
export function setCachedYtdlpVersion(version: string): void {
  if (version) cachedYtdlpVersion = version;
}

/** Refreshes stats from GCS with a short 10s cache so multiple instances converge cleanly. */
export async function refreshStatsFromGcs(): Promise<void> {
  if (!bucketRef || Date.now() - lastRemoteRefreshAt < 10000) return;
  lastRemoteRefreshAt = Date.now();
  try {
    const file = bucketRef.file(STATS_OBJECT);
    const [exists] = await file.exists();
    if (!exists) return;
    const [buf] = await file.download();
    mergeRemoteState(JSON.parse(buf.toString('utf8')));
  } catch {
    // Ignore transient GCS read errors
  }
}

export function recordAnalyzeStat(platform: string): void {
  const safePlatform = /^[a-z0-9_-]{1,24}$/i.test(platform) ? platform.toLowerCase() : 'other';
  state.totalAnalyses += 1;
  state.platforms[safePlatform] = (state.platforms[safePlatform] || 0) + 1;
  getOrCreateDaily(getTodayKey()).analyses += 1;
  pruneOldDailyStats();
  scheduleStatsSync();
}

export function recordDownloadStartStat(itemCount = 1, isPlaylistBatch = false): void {
  const count = Math.max(1, itemCount);
  state.totalDownloadsStarted += count;
  if (isPlaylistBatch) state.totalPlaylistsQueued += 1;
  getOrCreateDaily(getTodayKey()).downloadsStarted += count;
  pruneOldDailyStats();
  scheduleStatsSync();
}

export function recordDownloadCompleteStat(durationMs: number, bytes: number): void {
  state.totalDownloadsCompleted += 1;
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const safeDuration = Math.max(0, Math.min(600000, Number(durationMs) || 0));
  state.totalBytesProcessed += safeBytes;
  state.totalDurationMs += safeDuration;
  state.durationSamples += 1;
  const day = getOrCreateDaily(getTodayKey());
  day.downloadsCompleted += 1;
  day.bytesProcessed += safeBytes;
  pruneOldDailyStats();
  scheduleStatsSync(true);
}

export function recordDownloadFailStat(): void {
  state.totalDownloadsFailed += 1;
  getOrCreateDaily(getTodayKey()).downloadsFailed += 1;
  pruneOldDailyStats();
  scheduleStatsSync();
}

export function recordAutoSaveStat(filesSaved = 1): void {
  state.totalAutoSavedFiles += Math.max(1, filesSaved);
  scheduleStatsSync();
}

/** Builds a clean read-only UsageStats payload for the /api/stats telemetry endpoint. */
export function getUsageStatsSnapshot(runtime: {
  activeDownloads: number;
  queuedDownloads: number;
  activeSseClients: number;
  gcsEnabled: boolean;
}): UsageStats {
  const daily = Object.keys(state.daily)
    .sort()
    .slice(-14)
    .map((k) => state.daily[k]);

  return {
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    totalAnalyses: state.totalAnalyses,
    totalDownloadsStarted: state.totalDownloadsStarted,
    totalDownloadsCompleted: state.totalDownloadsCompleted,
    totalDownloadsFailed: state.totalDownloadsFailed,
    totalPlaylistsQueued: state.totalPlaylistsQueued,
    totalAutoSavedFiles: state.totalAutoSavedFiles,
    totalBytesProcessed: state.totalBytesProcessed,
    avgDurationMs:
      state.durationSamples > 0 ? Math.round(state.totalDurationMs / state.durationSamples) : 0,
    platforms: { ...state.platforms },
    daily,
    runtime: {
      activeDownloads: runtime.activeDownloads,
      queuedDownloads: runtime.queuedDownloads,
      activeSseClients: runtime.activeSseClients,
      uptimeSeconds: Math.floor((Date.now() - processStartTimeMs) / 1000),
      ytdlpVersion: cachedYtdlpVersion,
      gcsEnabled: runtime.gcsEnabled,
    },
  };
}
