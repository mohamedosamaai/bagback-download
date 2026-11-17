import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { UsageStats, ArchivedDeviceItem, HistoryItem, Job } from '../../types';
import { TFunction } from '../../lib/translations';
import { api } from '../../lib/api';
import {
  ChartIcon,
  ShieldIcon,
  ShareIcon,
  CheckIcon,
  RetryIcon,
  VideoIcon,
  MusicIcon,
  ArchiveIcon,
  FolderIcon,
} from '../ui/Icons';
import { AdBanner } from '../ui/AdBanner';

interface StatsDashboardProps {
  onBack: () => void;
  t: TFunction;
  savedArchive?: ArchivedDeviceItem[];
  localHistory?: HistoryItem[];
  jobs?: Job[];
  autoSaveEnabled?: boolean;
  folderName?: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

/**
 * Live showcase dashboard presenting both real global platform performance metrics
 * and the current user's personal saved media & device storage summary.
 */
export function StatsDashboard({
  onBack,
  t,
  savedArchive = [],
  localHistory = [],
  jobs = [],
  autoSaveEnabled = false,
  folderName = '',
}: StatsDashboardProps) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [shareCopied, setShareCopied] = useState(false);

  const loadStats = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const data = await api.getStats();
      setStats(data);
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed loading usage statistics');
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStats(false);
    const timer = setInterval(() => void loadStats(false), 10000);
    return () => clearInterval(timer);
  }, [loadStats]);

  const handleShareStats = useCallback(async () => {
    const shareUrl = 'https://download.bagbacktech.com/stats';
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: t('statsTitle'),
          text: t('statsSubtitle'),
          url: shareUrl,
        });
        return;
      }
    } catch {
      // User dismissed or Web Share unavailable; fall back to clipboard
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      }
    } catch {
      // Clipboard blocked
    }
  }, [t]);

  // Real personal user stats computed strictly from browser storage + active queue
  const personalStats = useMemo(() => {
    let videoCount = 0;
    let audioCount = 0;
    let savedBytes = 0;

    for (const item of savedArchive) {
      if (item.mediaType === 'audio') {
        audioCount += 1;
      } else {
        videoCount += 1;
      }
      savedBytes += Math.max(0, Number(item.fileSize) || 0);
    }

    const readyNow = jobs.filter((j) => j.status === 'completed' && !j.archived).length;
    const totalMediaCount = videoCount + audioCount;
    const videoPct = totalMediaCount > 0 ? Math.round((videoCount / totalMediaCount) * 100) : 0;
    const audioPct = totalMediaCount > 0 ? 100 - videoPct : 0;
    const recentItems = [...savedArchive].slice(0, 4);

    return {
      savedCount: savedArchive.length,
      savedBytes,
      videoCount,
      audioCount,
      totalMediaCount,
      videoPct,
      audioPct,
      readyNow,
      analyzedHistoryCount: localHistory.length,
      recentItems,
    };
  }, [savedArchive, localHistory, jobs]);

  const maxDaily = stats
    ? Math.max(1, ...stats.daily.map((d) => Math.max(d.analyses, d.downloadsCompleted)))
    : 1;

  const platformEntries = stats
    ? Object.entries(stats.platforms).sort((a, b) => b[1] - a[1])
    : [];
  const totalPlatformCount = platformEntries.reduce((sum, [, count]) => sum + count, 0) || 1;

  const totalFinished = stats ? stats.totalDownloadsCompleted + stats.totalDownloadsFailed : 0;
  const successRate =
    totalFinished > 0 && stats
      ? Math.round((stats.totalDownloadsCompleted / totalFinished) * 100)
      : 100;

  return (
    <section className="stats-dashboard" aria-label={t('statsTitle')}>
      <div className="stats-top-bar">
        <div className="stats-title-group">
          <h1 className="stats-heading">
            <ChartIcon />
            <span>{t('statsTitle')}</span>
          </h1>
          <p className="stats-subtitle">{t('statsSubtitle')}</p>
        </div>

        <div className="stats-top-actions">
          <div className="stats-status-pill">
            <ShieldIcon />
            <span>{t('statsLiveBadge')}</span>
            {stats && <span className="stats-pill-sep">· Uptime {formatUptime(stats.runtime.uptimeSeconds)}</span>}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadStats(true)}
            disabled={refreshing}
          >
            <RetryIcon />
            <span>{t('statsRefreshBtn')}</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleShareStats()}>
            {shareCopied ? <CheckIcon /> : <ShareIcon />}
            <span>{shareCopied ? t('statsShareCopied') : t('statsShareBtn')}</span>
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onBack}>
            {t('backToHome')}
          </button>
        </div>
      </div>

      {/* Section 1: Global Platform Showcase */}
      <div className="stats-section-block">
        <h2 className="stats-section-label">{t('statsPlatformSectionTitle')}</h2>

        {loading && !stats && <div className="empty-state">{t('analyzing')}</div>}
        {error && !stats && <div className="error-msg">{error}</div>}

        {stats && (
          <>
            <div className="stats-kpi-grid">
              <div className="stats-kpi-card stats-kpi-highlight">
                <div className="stats-kpi-label">{t('statsCompletedDownloads')}</div>
                <div className="stats-kpi-value" dir="ltr">{stats.totalDownloadsCompleted.toLocaleString()}</div>
                <div className="stats-kpi-sub">
                  {successRate}% {t('statsSuccessRate')}
                </div>
              </div>

              <div className="stats-kpi-card">
                <div className="stats-kpi-label">{t('statsTotalAnalyses')}</div>
                <div className="stats-kpi-value" dir="ltr">{stats.totalAnalyses.toLocaleString()}</div>
                <div className="stats-kpi-sub">
                  {platformEntries.length} {t('statsPlatformsCountSub')}
                </div>
              </div>

              <div className="stats-kpi-card">
                <div className="stats-kpi-label">{t('statsPlaylistsTitle')}</div>
                <div className="stats-kpi-value" dir="ltr">{stats.totalPlaylistsQueued.toLocaleString()}</div>
                <div className="stats-kpi-sub">
                  {stats.totalZipBundles.toLocaleString()} {t('statsZipBundlesSub')}
                </div>
              </div>

              <div className="stats-kpi-card">
                <div className="stats-kpi-label">{t('statsBandwidthSaved')}</div>
                <div className="stats-kpi-value" dir="ltr">{formatBytes(stats.totalBytesProcessed)}</div>
                <div className="stats-kpi-sub">
                  {stats.totalAutoSavedFiles.toLocaleString()} {t('statsAutoSaved')}
                </div>
              </div>

              <div className="stats-kpi-card">
                <div className="stats-kpi-label">{t('statsAvgSpeed')}</div>
                <div className="stats-kpi-value" dir="ltr">
                  {stats.avgDurationMs > 0 ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                </div>
                <div className="stats-kpi-sub">
                  yt-dlp {stats.runtime.ytdlpVersion}
                </div>
              </div>

              <div className="stats-kpi-card">
                <div className="stats-kpi-label">{t('statsLiveRuntime')}</div>
                <div className="stats-kpi-value" dir="ltr">
                  {stats.runtime.activeDownloads} / {stats.runtime.activeSseClients}
                </div>
                <div className="stats-kpi-sub">{t('statsActiveLabel')}</div>
              </div>
            </div>

            <div className="stats-two-col">
              <div className="stats-panel">
                <h2>{t('statsDailyTrend')}</h2>
                {stats.daily.length === 0 ? (
                  <p className="stats-empty">{t('statsNoDataYet')}</p>
                ) : (
                  <div className="stats-bars-chart">
                    {stats.daily.map((day) => {
                      const analysesH = Math.max(6, Math.round((day.analyses / maxDaily) * 100));
                      const completedH = Math.max(
                        4,
                        Math.round((day.downloadsCompleted / maxDaily) * 100)
                      );
                      return (
                        <div key={day.date} className="stats-day-col" title={`${day.date}`}>
                          <div className="stats-day-bars">
                            <span
                              className="stats-bar analyses"
                              style={{ height: `${analysesH}%` }}
                              title={`${t('statsTotalAnalyses')}: ${day.analyses}`}
                            />
                            <span
                              className="stats-bar completed"
                              style={{ height: `${completedH}%` }}
                              title={`${t('statsCompletedDownloads')}: ${day.downloadsCompleted}`}
                            />
                          </div>
                          <span className="stats-day-label">{day.date.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="stats-legend">
                  <span>
                    <i className="legend-dot analyses" /> {t('statsTotalAnalyses')}
                  </span>
                  <span>
                    <i className="legend-dot completed" /> {t('statsCompletedDownloads')}
                  </span>
                </div>
              </div>

              <div className="stats-panel">
                <h2>{t('statsPlatformsBreakdown')}</h2>
                {platformEntries.length === 0 ? (
                  <p className="stats-empty">{t('statsNoDataYet')}</p>
                ) : (
                  <div className="stats-platforms-list">
                    {platformEntries.map(([name, count]) => {
                      const pct = Math.round((count / totalPlatformCount) * 100);
                      return (
                        <div key={name} className="stats-platform-row">
                          <div className="stats-platform-head">
                            <span style={{ textTransform: 'capitalize' }}>{name}</span>
                            <span>
                              {count.toLocaleString()} ({pct}%)
                            </span>
                          </div>
                          <div className="progress-track">
                            <div className="progress-fill completed" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="stats-panel stats-system-bar">
              <div className="stats-sys-item">
                <ShieldIcon />
                <span>
                  yt-dlp: <strong>{stats.runtime.ytdlpVersion}</strong>
                </span>
              </div>
              <div className="stats-sys-item">
                <span>
                  GCS Storage: <strong>{stats.runtime.gcsEnabled ? 'Active' : 'Local Mode'}</strong>
                </span>
              </div>
              <div className="stats-sys-item">
                <span>
                  Avg Speed Time:{' '}
                  <strong>
                    {stats.avgDurationMs > 0 ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                  </strong>
                </span>
              </div>
              <div className="stats-sys-item">
                <span>
                  Uptime: <strong>{formatUptime(stats.runtime.uptimeSeconds)}</strong>
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Section 2: Personal User Activity & Device Savings */}
      <div className="stats-section-block">
        <h2 className="stats-section-label">{t('statsPersonalSectionTitle')}</h2>

        <div className="stats-personal-grid">
          <div className="stats-kpi-card">
            <div className="stats-kpi-label">{t('statsPersonalSavedFiles')}</div>
            <div className="stats-kpi-value" dir="ltr">{personalStats.savedCount.toLocaleString()}</div>
            <div className="stats-kpi-sub">
              {personalStats.videoCount} {t('videoTab')} · {personalStats.audioCount} {t('tabAudio')}
            </div>
          </div>

          <div className="stats-kpi-card">
            <div className="stats-kpi-label">{t('statsPersonalSavedVolume')}</div>
            <div className="stats-kpi-value" dir="ltr">{formatBytes(personalStats.savedBytes)}</div>
            <div className="stats-kpi-sub">{t('archiveCleanupHint')}</div>
          </div>

          <div className="stats-kpi-card">
            <div className="stats-kpi-label">{t('statsPersonalReadyCount')}</div>
            <div className="stats-kpi-value" dir="ltr">
              {personalStats.readyNow} / {personalStats.analyzedHistoryCount}
            </div>
            <div className="stats-kpi-sub">{t('readyToSaveCount')}</div>
          </div>

          <div className="stats-kpi-card">
            <div className="stats-kpi-label">{t('statsPersonalAutoSaveStatus')}</div>
            <div className="stats-personal-mode">
              <FolderIcon />
              <span>
                {autoSaveEnabled
                  ? `${t('statsPersonalAutoSaveOn')} ${folderName || t('autoSaveActiveFallback')}`
                  : t('statsPersonalAutoSaveOff')}
              </span>
            </div>
          </div>
        </div>

        <div className="stats-two-col">
          <div className="stats-panel">
            <h2>{t('statsPersonalAudioVideo')}</h2>
            {personalStats.totalMediaCount === 0 ? (
              <div className="stats-personal-empty">
                <p>{t('statsPersonalEmpty')}</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={onBack}>
                  {t('backToHome')}
                </button>
              </div>
            ) : (
              <div className="stats-split-wrapper">
                <div className="stats-split-bar" aria-label={t('statsPersonalAudioVideo')}>
                  {personalStats.videoPct > 0 && (
                    <span
                      className="stats-split-video"
                      style={{ width: `${personalStats.videoPct}%` }}
                      title={`${t('videoTab')}: ${personalStats.videoPct}%`}
                    />
                  )}
                  {personalStats.audioPct > 0 && (
                    <span
                      className="stats-split-audio"
                      style={{ width: `${personalStats.audioPct}%` }}
                      title={`${t('tabAudio')}: ${personalStats.audioPct}%`}
                    />
                  )}
                </div>
                <div className="stats-legend">
                  <span>
                    <VideoIcon /> {t('videoTab')}: {personalStats.videoCount} ({personalStats.videoPct}%)
                  </span>
                  <span>
                    <MusicIcon /> {t('tabAudio')}: {personalStats.audioCount} ({personalStats.audioPct}%)
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="stats-panel">
            <h2>{t('statsPersonalRecentTitle')}</h2>
            {personalStats.recentItems.length === 0 ? (
              <p className="stats-empty">{t('archiveEmpty')}</p>
            ) : (
              <div className="stats-recent-list">
                {personalStats.recentItems.map((item) => (
                  <div key={item.id} className="stats-recent-row">
                    <span className="media-type-chip" aria-hidden="true">
                      {item.mediaType === 'audio' ? <MusicIcon /> : <ArchiveIcon />}
                    </span>
                    <div className="stats-recent-meta">
                      <div className="stats-recent-title">{item.title}</div>
                      <div className="stats-recent-sub">
                        {item.fileSize ? formatBytes(item.fileSize) : item.fileName}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <AdBanner position="bottom" t={t} />
    </section>
  );
}

export default StatsDashboard;
