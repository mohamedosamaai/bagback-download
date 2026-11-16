import React, { useEffect, useState } from 'react';
import { UsageStats } from '../../types';
import { TFunction } from '../../lib/translations';
import { api } from '../../lib/api';
import { ChartIcon, ShieldIcon } from '../ui/Icons';

interface StatsDashboardProps {
  onBack: () => void;
  t: TFunction;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function StatsDashboard({ onBack, t }: StatsDashboardProps) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await api.getStats();
        if (active) {
          setStats(data);
          setError('');
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load stats');
          setLoading(false);
        }
      }
    };

    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const totalPlatformCount = stats
    ? Object.values(stats.platforms).reduce((acc, v) => acc + v, 0)
    : 0;

  const platformEntries = stats
    ? Object.entries(stats.platforms).sort((a, b) => b[1] - a[1])
    : [];

  const maxDailyVal = stats && stats.daily.length > 0
    ? Math.max(1, ...stats.daily.map((d) => Math.max(d.analyses, d.downloadsCompleted)))
    : 1;

  const totalFinished = stats ? stats.totalDownloadsCompleted + stats.totalDownloadsFailed : 0;
  const successRate =
    totalFinished > 0 && stats
      ? Math.round((stats.totalDownloadsCompleted / totalFinished) * 100)
      : 100;

  return (
    <section className="stats-dashboard" aria-label={t('statsTitle')}>
      <div className="stats-top-bar">
        <div>
          <h1 className="stats-heading">
            <ChartIcon /> {t('statsTitle')}
          </h1>
          <p className="stats-subtitle">{t('statsSubtitle')}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          {t('backToHome')}
        </button>
      </div>

      {loading && !stats && (
        <div className="input-card" style={{ textAlign: 'center', padding: '32px' }}>
          <span className="spinner" style={{ display: 'inline-block' }} />
        </div>
      )}

      {error && (
        <div className="error-msg">{error}</div>
      )}

      {stats && (
        <>
          <div className="stats-kpi-grid">
            <div className="stats-kpi-card">
              <div className="stats-kpi-label">{t('statsCompletedDownloads')}</div>
              <div className="stats-kpi-value">{stats.totalDownloadsCompleted.toLocaleString()}</div>
              <div className="stats-kpi-sub">{successRate}% {t('statsSuccessRate')}</div>
            </div>
            <div className="stats-kpi-card">
              <div className="stats-kpi-label">{t('statsTotalAnalyses')}</div>
              <div className="stats-kpi-value">{stats.totalAnalyses.toLocaleString()}</div>
              <div className="stats-kpi-sub">{stats.totalPlaylistsQueued.toLocaleString()} {t('statsPlaylists')}</div>
            </div>
            <div className="stats-kpi-card">
              <div className="stats-kpi-label">{t('statsBandwidthSaved')}</div>
              <div className="stats-kpi-value">{formatBytes(stats.totalBytesProcessed)}</div>
              <div className="stats-kpi-sub">{stats.totalAutoSavedFiles.toLocaleString()} {t('statsAutoSaved')}</div>
            </div>
            <div className="stats-kpi-card">
              <div className="stats-kpi-label">{t('statsLiveRuntime')}</div>
              <div className="stats-kpi-value">{stats.runtime.activeDownloads} / {stats.runtime.activeSseClients}</div>
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
                    const analysesHeight = Math.max(8, Math.round((day.analyses / maxDailyVal) * 100));
                    const completedHeight = Math.max(4, Math.round((day.downloadsCompleted / maxDailyVal) * 100));
                    return (
                      <div key={day.date} className="stats-day-col" title={`${day.date}: ${day.analyses} / ${day.downloadsCompleted}`}>
                        <div className="stats-day-bars">
                          <div className="stats-bar analyses" style={{ height: `${analysesHeight}%` }} />
                          <div className="stats-bar completed" style={{ height: `${completedHeight}%` }} />
                        </div>
                        <span className="stats-day-label">{day.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="stats-legend">
                <span><i className="legend-dot analyses" /> {t('statsTotalAnalyses')}</span>
                <span><i className="legend-dot completed" /> {t('statsCompletedDownloads')}</span>
              </div>
            </div>

            <div className="stats-panel">
              <h2>{t('statsPlatformsBreakdown')}</h2>
              {platformEntries.length === 0 ? (
                <p className="stats-empty">{t('statsNoDataYet')}</p>
              ) : (
                <div className="stats-platforms-list">
                  {platformEntries.map(([name, count]) => {
                    const pct = totalPlatformCount > 0 ? Math.round((count / totalPlatformCount) * 100) : 0;
                    return (
                      <div key={name} className="stats-platform-row">
                        <div className="stats-platform-head">
                          <span style={{ textTransform: 'capitalize' }}>{name}</span>
                          <span>{count.toLocaleString()} ({pct}%)</span>
                        </div>
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
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
              <span>yt-dlp: <strong>{stats.runtime.ytdlpVersion}</strong></span>
            </div>
            <div className="stats-sys-item">
              <span>GCS Storage: <strong>{stats.runtime.gcsEnabled ? 'Active' : 'Local'}</strong></span>
            </div>
            <div className="stats-sys-item">
              <span>Avg Speed Time: <strong>{stats.avgDurationMs > 0 ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : '—'}</strong></span>
            </div>
            <div className="stats-sys-item">
              <span>Uptime: <strong>{formatUptime(stats.runtime.uptimeSeconds)}</strong></span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default StatsDashboard;
