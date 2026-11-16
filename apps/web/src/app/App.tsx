import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Lang, Job, HistoryItem } from '../types';
import { useTranslation } from '../lib/translations';
import { api } from '../lib/api';
import { Header } from '../components/layouts/Header';
import { Footer } from '../components/layouts/Footer';
import { JobCard } from '../components/features/JobCard';
import { PlaylistBatchCard } from '../components/features/PlaylistBatchCard';
import { AnalyzeResultCard } from '../components/features/AnalyzeResultCard';
import { StatsDashboard } from '../components/features/StatsDashboard';
import { AdBanner } from '../components/ui/AdBanner';
import { InfoModal } from '../components/ui/InfoModal';
import {
  CheckIcon,
  SearchIcon,
  HistoryIcon,
  ClipboardIcon,
  AlertIcon,
  FolderIcon,
  BellIcon,
  VideoIcon,
  MusicIcon,
  PlaylistIcon,
  PhoneInstallIcon,
  CloseIcon,
} from '../components/ui/Icons';
import {
  DirectoryHandleLike,
  supportsDirectoryPicker,
  loadStoredDirectoryHandle,
  clearStoredDirectoryHandle,
  queryDirectoryPermission,
  requestDirectoryPermission,
  pickAutoSaveDirectory,
  saveJobToDirectory,
  triggerBrowserDownload,
  requestNotificationPermissionSafe,
  showBrowserSaveNotification,
} from '../lib/autoSave';
import { initAnalytics, trackPageView, trackAnalyticsEvent } from '../lib/analytics';

const SAVED_IDS_STORAGE_KEY = 'bagback-saved-job-ids';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type QueueEntry =
  | { kind: 'single'; sortTime: number; job: Job }
  | { kind: 'batch'; sortTime: number; batchId: string; batchTitle: string; jobs: Job[] };

function extractSharedUrl(params: URLSearchParams): string {
  const direct = params.get('url');
  if (direct) return direct;
  const text = params.get('text');
  if (text) {
    const m = text.match(/https?:\/\/\S+/i);
    if (m) return m[0];
  }
  return '';
}

export function App() {
  const [route, setRoute] = useState<'/' | '/stats'>(() =>
    typeof window !== 'undefined' && window.location.pathname === '/stats' ? '/stats' : '/'
  );
  const [lang, setLang] = useState<Lang>(() => {
    const qLang = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lang') : null;
    if (qLang === 'ar' || qLang === 'en') return qLang;
    return (localStorage.getItem('bagback-lang') as Lang) || 'ar';
  });
  const [url, setUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return extractSharedUrl(params);
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<any | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [localHistory, setLocalHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('bagback-local-history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<'terms' | 'privacy' | 'cleanRoom' | 'installGuide' | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('bagback-theme') as 'light' | 'dark') || 'dark';
  });
  const [isStandalone, setIsStandalone] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone))
  );
  const [installBannerDismissed, setInstallBannerDismissed] = useState<boolean>(false);

  // Auto-save & Notifications State
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    return localStorage.getItem('bagback-autosave-enabled') === 'true';
  });
  const [folderHandle, setFolderHandle] = useState<DirectoryHandleLike | null>(null);
  const [folderName, setFolderName] = useState<string>(() => localStorage.getItem('bagback-autosave-folder') || '');
  const [folderPermissionState, setFolderPermissionState] = useState<'granted' | 'prompt' | 'denied'>('prompt');
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SAVED_IDS_STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [saveToast, setSaveToast] = useState<string>('');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const initialSnapshotSeenRef = useRef(false);
  const autoSaveAttemptedRef = useRef<Set<string>>(new Set());
  const folderApiSupported = useMemo(() => supportsDirectoryPicker(), []);

  const t = useTranslation(lang);

  // Initialize GA4 & restore IndexedDB folder handle cleanly
  useEffect(() => {
    initAnalytics();
    trackPageView(window.location.pathname);

    const onPopState = () => {
      const next = window.location.pathname === '/stats' ? '/stats' : '/';
      setRoute(next);
      trackPageView(next);
    };
    window.addEventListener('popstate', onPopState);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    if (supportsDirectoryPicker()) {
      void loadStoredDirectoryHandle().then(async (handle) => {
        if (handle) {
          setFolderHandle(handle);
          setFolderName(handle.name);
          const perm = await queryDirectoryPermission(handle);
          setFolderPermissionState(perm);
        }
      });
    }

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Update HTML lang, dir, theme & noindex on /stats
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('bagback-lang', lang);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bagback-theme', theme);
    document.title =
      lang === 'ar'
        ? 'Bagback Download — تحميل فيديو وصوت وقوائم تشغيل مجاناً | Free Video & MP3 Downloader'
        : 'Bagback Download — Free Video, Audio (MP3) & Playlist Downloader';
  }, [lang, theme]);

  useEffect(() => {
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) {
      robotsMeta.setAttribute(
        'content',
        route === '/stats'
          ? 'noindex, nofollow'
          : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
      );
    }
  }, [route]);

  const navigateTo = useCallback((target: '/' | '/stats') => {
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target);
    }
    setRoute(target);
    trackPageView(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const markJobSaved = useCallback((id: string) => {
    setSavedJobIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      const bounded = Array.from(next).slice(-100);
      localStorage.setItem(SAVED_IDS_STORAGE_KEY, JSON.stringify(bounded));
      return new Set(bounded);
    });
  }, []);

  // Auto-save newly completed jobs in active session when approved
  const processAutoSaveForJob = useCallback(
    async (job: Job) => {
      if (folderApiSupported && folderHandle) {
        const perm = await queryDirectoryPermission(folderHandle);
        if (perm !== 'granted') {
          setFolderPermissionState(perm);
          return;
        }
        try {
          const savedPath = await saveJobToDirectory(folderHandle, job, api.isMockMode());
          markJobSaved(job.id);
          void api.reportStatEvent('autosave_file_saved', 1);
          trackAnalyticsEvent('autosave_folder_write', { batch: Boolean(job.batchId) });
          const label = job.title || savedPath;
          setSaveToast(`${t('autoSaveSavedToast')} ${label}`);
          showBrowserSaveNotification(t('autoSaveNotifTitle'), label);
          setTimeout(() => setSaveToast(''), 5000);
        } catch (err) {
          console.warn('[AutoSave] Folder write skipped:', err);
        }
      } else if (!folderApiSupported && autoSaveEnabled) {
        triggerBrowserDownload(job, api.isMockMode());
        markJobSaved(job.id);
        trackAnalyticsEvent('autosave_browser_trigger', { batch: Boolean(job.batchId) });
        const label = job.title || job.fileName || 'Download';
        setSaveToast(`${t('autoSaveSavedToast')} ${label}`);
        showBrowserSaveNotification(t('autoSaveNotifTitle'), label);
        setTimeout(() => setSaveToast(''), 5000);
      }
    },
    [folderApiSupported, folderHandle, autoSaveEnabled, markJobSaved, t]
  );

  // Sync with jobs stream (SSE or Mock Interval)
  useEffect(() => {
    const unsubscribe = api.streamJobs((data) => {
      if (!initialSnapshotSeenRef.current) {
        initialSnapshotSeenRef.current = true;
        for (const j of data) {
          if (j.status === 'completed') {
            autoSaveAttemptedRef.current.add(j.id);
          }
        }
      } else if (autoSaveEnabled) {
        for (const j of data) {
          if (
            j.status === 'completed' &&
            !autoSaveAttemptedRef.current.has(j.id) &&
            !savedJobIds.has(j.id)
          ) {
            autoSaveAttemptedRef.current.add(j.id);
            void processAutoSaveForJob(j);
          }
        }
      }
      setJobs(data);
    });

    return () => {
      unsubscribe();
    };
  }, [autoSaveEnabled, savedJobIds, processAutoSaveForJob]);

  const handleRequestAutoSaveFolder = useCallback(async (): Promise<DirectoryHandleLike | null> => {
    try {
      const handle = await pickAutoSaveDirectory();
      if (!handle) return null;
      setFolderHandle(handle);
      setFolderName(handle.name);
      setFolderPermissionState('granted');
      setAutoSaveEnabled(true);
      localStorage.setItem('bagback-autosave-enabled', 'true');
      localStorage.setItem('bagback-autosave-folder', handle.name);
      const nPerm = await requestNotificationPermissionSafe();
      setNotifPermission(nPerm);
      if (nPerm === 'granted') {
        showBrowserSaveNotification(t('autoSaveNotifTitle'), handle.name);
      }
      trackAnalyticsEvent('autosave_enabled', { mode: 'folder' });
      return handle;
    } catch {
      return null;
    }
  }, [t]);

  const handleEnableFallbackAutoSave = useCallback(async () => {
    const next = !autoSaveEnabled;
    setAutoSaveEnabled(next);
    localStorage.setItem('bagback-autosave-enabled', String(next));
    if (next) {
      const nPerm = await requestNotificationPermissionSafe();
      setNotifPermission(nPerm);
      trackAnalyticsEvent('autosave_enabled', { mode: 'browser_trigger' });
    }
  }, [autoSaveEnabled]);

  const handleRegrantFolder = useCallback(async () => {
    if (!folderHandle) {
      await handleRequestAutoSaveFolder();
      return;
    }
    const ok = await requestDirectoryPermission(folderHandle);
    setFolderPermissionState(ok ? 'granted' : 'prompt');
    if (ok) {
      setAutoSaveEnabled(true);
      localStorage.setItem('bagback-autosave-enabled', 'true');
    }
  }, [folderHandle, handleRequestAutoSaveFolder]);

  const handleDisableAutoSave = useCallback(async () => {
    setAutoSaveEnabled(false);
    setFolderHandle(null);
    setFolderName('');
    setFolderPermissionState('prompt');
    localStorage.setItem('bagback-autosave-enabled', 'false');
    localStorage.removeItem('bagback-autosave-folder');
    await clearStoredDirectoryHandle();
  }, []);

  const handleEnableNotifications = useCallback(async () => {
    const perm = await requestNotificationPermissionSafe();
    setNotifPermission(perm);
  }, []);

  const handleAnalyze = useCallback(async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl || url).trim();
    if (!targetUrl) {
      inputRef.current?.focus();
      return;
    }
    setAnalyzeError('');
    setAnalyzeResult(null);
    setAnalyzing(true);
    try {
      const data = await api.analyze(targetUrl);
      setAnalyzeResult(data);
      trackAnalyticsEvent('analyze_success', { is_playlist: Boolean(data.isPlaylist) });
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setAnalyzing(false);
    }
  }, [url]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramUrl = extractSharedUrl(params);
    if (paramUrl) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setUrl(paramUrl);
      void handleAnalyze(paramUrl);
    }
  }, [handleAnalyze]);

  const handleDownload = useCallback(async (opts: {
    url: string;
    format: string;
    audioOnly: boolean;
    title?: string;
    items?: Array<{ url: string; title?: string }>;
  }) => {
    try {
      if (analyzeResult) {
        setLocalHistory((prev) => {
          const newItem: HistoryItem = {
            id: Date.now().toString(),
            url: opts.url,
            title: analyzeResult.title,
            thumbnail: analyzeResult.thumbnail,
            timestamp: Date.now(),
          };
          const filtered = prev.filter((h) => h.url !== opts.url);
          const updated = [newItem, ...filtered].slice(0, 20);
          localStorage.setItem('bagback-local-history', JSON.stringify(updated));
          return updated;
        });
      }

      const res = await api.download(opts);
      trackAnalyticsEvent('download_queued', {
        audio_only: opts.audioOnly,
        count: res.ids ? res.ids.length : 1,
      });
      setAnalyzeResult(null);
      setUrl('');
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Failed to start download');
    }
  }, [analyzeResult]);

  const handleDelete = useCallback(async (id: string) => {
    await api.deleteJob(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const handleDeleteBatch = useCallback(async (ids: string[]) => {
    await Promise.all(ids.map((id) => api.deleteJob(id).catch(() => {})));
    const idSet = new Set(ids);
    setJobs((prev) => prev.filter((j) => !idSet.has(j.id)));
  }, []);

  const handleClearAll = useCallback(async () => {
    await api.clearAllJobs();
    setJobs([]);
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setInstallPrompt(null);
          setIsStandalone(true);
        }
        return;
      } catch {
        // Fallback to manual install guide
      }
    }
    setActiveModal('installGuide');
  }, [installPrompt]);

  const handleCopyHistoryLink = (item: HistoryItem) => {
    navigator.clipboard
      .writeText(item.url)
      .then(() => {
        setCopiedId(item.id);
        setTimeout(() => setCopiedId(null), 2000);
      })
      .catch(() => {});
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith('http')) {
        setUrl(text);
        setAnalyzeResult(null);
        setAnalyzeError('');
      }
    } catch {
      // Clipboard permission denied
    }
  };

  const truncateUrl = (urlStr: string, max = 30) => {
    try {
      const u = new URL(urlStr);
      const display = u.hostname + u.pathname;
      return display.length > max ? display.slice(0, max) + '…' : display;
    } catch {
      return urlStr.slice(0, max) + (urlStr.length > max ? '…' : '');
    }
  };

  // Group playlist batches while keeping standalone jobs clean
  const queueEntries = useMemo<QueueEntry[]>(() => {
    const batchGroups = new Map<string, Job[]>();
    const singles: Job[] = [];
    for (const j of jobs) {
      if (j.batchId) {
        const list = batchGroups.get(j.batchId) || [];
        list.push(j);
        batchGroups.set(j.batchId, list);
      } else {
        singles.push(j);
      }
    }
    const entries: QueueEntry[] = [];
    for (const [batchId, groupJobs] of batchGroups.entries()) {
      if (groupJobs.length === 1 && !groupJobs[0].batchTitle) {
        entries.push({
          kind: 'single',
          sortTime: new Date(groupJobs[0].createdAt).getTime(),
          job: groupJobs[0],
        });
      } else {
        const newestTime = Math.max(...groupJobs.map((g) => new Date(g.createdAt).getTime()));
        entries.push({
          kind: 'batch',
          sortTime: newestTime,
          batchId,
          batchTitle: groupJobs[0].batchTitle || 'Playlist',
          jobs: groupJobs.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
        });
      }
    }
    for (const s of singles) {
      entries.push({
        kind: 'single',
        sortTime: new Date(s.createdAt).getTime(),
        job: s,
      });
    }
    return entries.sort((a, b) => b.sortTime - a.sortTime);
  }, [jobs]);

  return (
    <div className="app">
      <Header
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
        onNavigateStats={() => navigateTo(route === '/stats' ? '/' : '/stats')}
        onNavigateHome={() => navigateTo('/')}
        onInstallApp={handleInstallApp}
        canInstallApp={!isStandalone}
        t={t}
      />

      <main className="main">
        <div className="container">
          {route === '/stats' ? (
            <StatsDashboard onBack={() => navigateTo('/')} t={t} />
          ) : (
            <>
              {!isStandalone && !installBannerDismissed && (
                <div className="pwa-install-banner">
                  <div className="pwa-banner-main">
                    <img src="/logo.png" alt="Bagback Download" className="pwa-banner-icon" />
                    <div className="pwa-banner-text">
                      <div className="pwa-banner-title">{t('installBannerTitle')}</div>
                      <div className="pwa-banner-desc">{t('installBannerDesc')}</div>
                    </div>
                  </div>
                  <div className="pwa-banner-actions">
                    <button type="button" className="btn btn-primary pwa-install-cta" onClick={handleInstallApp}>
                      <PhoneInstallIcon /> {t('installNowBtn')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn pwa-dismiss-btn"
                      onClick={() => setInstallBannerDismissed(true)}
                      aria-label={t('dismissInstall')}
                      title={t('dismissInstall')}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </div>
              )}

              <div className="hero">
                <h1>{t('appName')}</h1>
                <p className="hero-desc">{t('subtagline')}</p>
              </div>

              <AdBanner position="top" t={t} />

              <div className="input-card">
                <div className="url-input-wrap">
                  <input
                    ref={inputRef}
                    type="url"
                    className="url-input"
                    placeholder={t('inputPlaceholder')}
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setAnalyzeResult(null);
                      setAnalyzeError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAnalyze();
                    }}
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={() => void handleAnalyze()}
                    disabled={analyzing || !url.trim()}
                  >
                    {analyzing ? (
                      <><span className="spinner" /> {t('analyzing')}</>
                    ) : (
                      <><SearchIcon /> {t('analyze')}</>
                    )}
                  </button>
                </div>

                <div className="options-row">
                  <button type="button" className="option-chip" onClick={handlePaste}>
                    <ClipboardIcon /> {t('pasteClipboard')}
                  </button>
                  <span className="supported-hint">{t('supportedSites')}</span>
                </div>
              </div>

              {/* Auto-Save Consent & Notifications Bar */}
              <div className="autosave-bar">
                {folderApiSupported ? (
                  autoSaveEnabled && folderHandle ? (
                    <div className="autosave-bar-row">
                      <span className="autosave-status">
                        <FolderIcon />
                        <span>{t('autoSaveActiveFolder')} <strong dir="ltr">{folderName}</strong></span>
                      </span>
                      <div className="autosave-actions">
                        {folderPermissionState !== 'granted' && (
                          <button type="button" className="option-chip selected" onClick={handleRegrantFolder}>
                            {t('autoSaveRegrant')}
                          </button>
                        )}
                        <button type="button" className="option-chip" onClick={handleRequestAutoSaveFolder}>
                          {t('autoSaveChangeFolder')}
                        </button>
                        <button type="button" className="option-chip" onClick={handleDisableAutoSave}>
                          {t('autoSaveDisable')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="autosave-bar-row">
                      <button
                        type="button"
                        className="option-chip selected"
                        onClick={handleRequestAutoSaveFolder}
                      >
                        <FolderIcon /> {t('autoSaveEnableFolder')}
                      </button>
                      {notifPermission !== 'unsupported' && notifPermission !== 'granted' && (
                        <button type="button" className="option-chip" onClick={handleEnableNotifications}>
                          <BellIcon /> {t('autoSaveNotifBtn')}
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="autosave-bar-row">
                    <button
                      type="button"
                      className={`option-chip ${autoSaveEnabled ? 'selected' : ''}`}
                      onClick={handleEnableFallbackAutoSave}
                    >
                      <CheckIcon /> {autoSaveEnabled ? t('autoSaveActiveFallback') : t('autoSaveEnableFallback')}
                    </button>
                    {notifPermission !== 'unsupported' && notifPermission !== 'granted' && (
                      <button type="button" className="option-chip" onClick={handleEnableNotifications}>
                        <BellIcon /> {t('autoSaveNotifBtn')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {saveToast && (
                <div className="toast-banner" role="status">
                  <CheckIcon /> <span>{saveToast}</span>
                </div>
              )}

              {analyzeError && (
                <div className="error-msg">
                  <AlertIcon /> <span>{analyzeError}</span>
                </div>
              )}

              {analyzeResult && (
                <AnalyzeResultCard
                  result={analyzeResult}
                  url={url}
                  onDownload={handleDownload}
                  t={t}
                />
              )}

              {queueEntries.length > 0 && (
                <div className="queue-section">
                  <div className="section-header">
                    <div className="section-title">
                      {t('downloading')} / {t('history')}
                      <span className="badge">{jobs.length}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '12px', padding: '5px 12px', minHeight: '32px' }}
                      onClick={handleClearAll}
                    >
                      {t('clearAll')}
                    </button>
                  </div>

                  {queueEntries.map((entry) =>
                    entry.kind === 'batch' ? (
                      <PlaylistBatchCard
                        key={entry.batchId}
                        batchId={entry.batchId}
                        batchTitle={entry.batchTitle}
                        jobs={entry.jobs}
                        folderHandle={folderHandle}
                        folderName={folderName}
                        savedJobIds={savedJobIds}
                        onMarkSaved={markJobSaved}
                        onRequestFolder={handleRequestAutoSaveFolder}
                        onDeleteJob={handleDelete}
                        onDeleteBatch={handleDeleteBatch}
                        t={t}
                      />
                    ) : (
                      <JobCard
                        key={entry.job.id}
                        job={entry.job}
                        onDelete={handleDelete}
                        isSavedToDevice={savedJobIds.has(entry.job.id)}
                        onManualSaved={markJobSaved}
                        folderHandle={folderHandle}
                        t={t}
                      />
                    )
                  )}
                </div>
              )}

              {localHistory.length > 0 && (
                <div className="queue-section" style={{ marginTop: '24px' }}>
                  <div className="section-header">
                    <div className="section-title">
                      <HistoryIcon /> {t('localHistoryTitle')}
                      <span className="badge">{localHistory.length}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '12px', padding: '5px 12px' }}
                      onClick={() => {
                        setLocalHistory([]);
                        localStorage.removeItem('bagback-local-history');
                      }}
                    >
                      {t('clearLocalHistory')}
                    </button>
                  </div>
                  <div className="history-grid">
                    {localHistory.map((item) => (
                      <div key={item.id} className="history-card">
                        {item.thumbnail ? (
                          <div className="history-thumb-wrap">
                            <img src={item.thumbnail} alt={item.title} className="history-thumb" />
                          </div>
                        ) : (
                          <div className="history-thumb-wrap empty">
                            <HistoryIcon />
                          </div>
                        )}
                        <div className="history-info">
                          <div className="history-title" dir="ltr">{item.title}</div>
                          <div className="history-url" dir="ltr">{truncateUrl(item.url, 25)}</div>
                        </div>
                        <div className="history-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => {
                              setUrl(item.url);
                              void handleAnalyze(item.url);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            title={t('reDownload')}
                            aria-label={t('reDownload')}
                          >
                            <SearchIcon />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => handleCopyHistoryLink(item)}
                            title={copiedId === item.id ? t('copied') : t('copyLink')}
                            aria-label={t('copyLink')}
                          >
                            {copiedId === item.id ? <CheckIcon /> : <ClipboardIcon />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {jobs.length === 0 && !analyzeResult && (
                <div className="empty-state">
                  <div className="empty-icon">
                    <img
                      src="/apple-icon.png"
                      alt="Bagback Download Logo"
                      style={{ width: '64px', height: '64px', objectFit: 'contain', opacity: 0.8 }}
                    />
                  </div>
                  <p>{t('emptyQueue')}</p>
                </div>
              )}

              <AdBanner position="bottom" t={t} />

              {/* SEO Capabilities & Bilingual FAQ Section */}
              <section className="seo-guide-section">
                <h2 className="seo-section-title">{t('seoSectionTitle')}</h2>
                <div className="seo-features-grid">
                  <article className="seo-feature-card">
                    <div className="seo-feature-head">
                      <VideoIcon />
                      <h3>{t('seoFeat1Title')}</h3>
                    </div>
                    <p>{t('seoFeat1Desc')}</p>
                  </article>
                  <article className="seo-feature-card">
                    <div className="seo-feature-head">
                      <MusicIcon />
                      <h3>{t('seoFeat2Title')}</h3>
                    </div>
                    <p>{t('seoFeat2Desc')}</p>
                  </article>
                  <article className="seo-feature-card">
                    <div className="seo-feature-head">
                      <PlaylistIcon />
                      <h3>{t('seoFeat3Title')}</h3>
                    </div>
                    <p>{t('seoFeat3Desc')}</p>
                  </article>
                </div>

                <div className="seo-faq-block">
                  <h2 className="seo-section-title">{t('seoFaqTitle')}</h2>
                  <div className="seo-faq-list">
                    <details className="seo-faq-item">
                      <summary>{t('seoFaq1Q')}</summary>
                      <p>{t('seoFaq1A')}</p>
                    </details>
                    <details className="seo-faq-item">
                      <summary>{t('seoFaq2Q')}</summary>
                      <p>{t('seoFaq2A')}</p>
                    </details>
                    <details className="seo-faq-item">
                      <summary>{t('seoFaq3Q')}</summary>
                      <p>{t('seoFaq3A')}</p>
                    </details>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      <Footer
        setActiveModal={setActiveModal}
        onOpenStats={() => navigateTo('/stats')}
        t={t}
      />

      {activeModal === 'terms' && (
        <InfoModal
          title={t('termsTitle')}
          body={t('termsBody')}
          onClose={() => setActiveModal(null)}
          t={t}
        />
      )}
      {activeModal === 'privacy' && (
        <InfoModal
          title={t('privacyTitle')}
          body={t('privacyBody')}
          onClose={() => setActiveModal(null)}
          t={t}
        />
      )}
      {activeModal === 'cleanRoom' && (
        <InfoModal
          title={t('cleanRoomTitle')}
          body={t('cleanRoomBody')}
          onClose={() => setActiveModal(null)}
          t={t}
        />
      )}
      {activeModal === 'installGuide' && (
        <InfoModal
          title={t('installIosTitle')}
          body={t('installIosBody')}
          onClose={() => setActiveModal(null)}
          t={t}
        />
      )}
    </div>
  );
}
export default App;
