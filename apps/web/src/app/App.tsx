import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lang, Job, HistoryItem } from '../types';
import { useTranslation, dict } from '../lib/translations';
import { api } from '../lib/api';
import { Header } from '../components/layouts/Header';
import { Footer } from '../components/layouts/Footer';
import { JobCard } from '../components/features/JobCard';
import { AnalyzeResultCard } from '../components/features/AnalyzeResultCard';
import { InfoModal } from '../components/ui/InfoModal';
import { CheckIcon, SearchIcon, HistoryIcon } from '../components/ui/Icons';

export function App() {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('bagback-lang') as Lang) || 'ar';
  });
  const [url, setUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('url') || '';
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<any | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [localHistory, setLocalHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('bagback-local-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeModal, setActiveModal] = useState<'terms' | 'privacy' | 'cleanRoom' | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('bagback-theme') as 'light' | 'dark') || 'dark';
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const t = useTranslation(lang);

  // Update HTML attributes when language/theme updates
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('bagback-lang', lang);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bagback-theme', theme);
  }, [lang, theme]);

  // Sync with jobs stream (SSE or Mock Interval)
  useEffect(() => {
    const unsubscribe = api.streamJobs((data) => {
      setJobs(data);
    });

    return () => {
      unsubscribe();
    };
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
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setAnalyzing(false);
    }
  }, [url]);

  // Auto-analyze on load if URL is passed in query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get('url');
    if (paramUrl) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setUrl(paramUrl);
      handleAnalyze(paramUrl);
    }
  }, [handleAnalyze]);

  const handleDownload = useCallback(async (opts: { url: string; format: string; audioOnly: boolean }) => {
    try {
      if (analyzeResult) {
        setLocalHistory(prev => {
          const newItem: HistoryItem = {
            id: Date.now().toString(),
            url: opts.url,
            title: analyzeResult.title,
            thumbnail: analyzeResult.thumbnail,
            timestamp: Date.now()
          };
          const filtered = prev.filter(h => h.url !== opts.url);
          const updated = [newItem, ...filtered].slice(0, 20);
          localStorage.setItem('bagback-local-history', JSON.stringify(updated));
          return updated;
        });
      }

      await api.download(opts);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAnalyze();
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

  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const doneJobs = jobs.filter((j) => j.status === 'completed' || j.status === 'failed');

  return (
    <div className="app">
      <Header
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
        t={t}
      />

      <main className="main">
        <div className="container">
          <div className="hero">
            <div className="hero-eyebrow">
              <CheckIcon /> {t('tagline')}
            </div>
            <h1>{t('appName')}</h1>
            <p className="hero-desc">{t('subtagline')}</p>
          </div>

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
                onKeyDown={handleKeyDown}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="btn btn-primary"
                onClick={() => handleAnalyze()}
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
              <button className="option-chip" onClick={handlePaste}>
                {t('pasteClipboard')}
              </button>
              <span className="supported-hint">{t('supportedSites')}</span>
            </div>
          </div>

          {analyzeError && (
            <div className="error-msg">
              ⚠️ {analyzeError}
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

          {(activeJobs.length > 0 || doneJobs.length > 0) && (
            <div className="queue-section">
              {activeJobs.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <div className="section-header">
                    <div className="section-title">
                      {t('downloading')}
                      <span className="badge">{activeJobs.length}</span>
                    </div>
                  </div>
                  {activeJobs.map((job) => (
                    <JobCard key={job.id} job={job} onDelete={handleDelete} t={t} />
                  ))}
                </div>
              )}

              {doneJobs.length > 0 && (
                <div>
                  <div className="section-header">
                    <div className="section-title">
                      {t('history')}
                      <span className="badge">{doneJobs.length}</span>
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '12px', padding: '5px 12px' }}
                      onClick={() => Promise.all(doneJobs.map((j) => handleDelete(j.id)))}
                    >
                      {t('clearAll')}
                    </button>
                  </div>
                  {doneJobs.map((job) => (
                    <JobCard key={job.id} job={job} onDelete={handleDelete} t={t} />
                  ))}
                </div>
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
                  <div
                    key={item.id}
                    className="history-card"
                    onClick={() => {
                      setUrl(item.url);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
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
        </div>
      </main>

      <Footer setActiveModal={setActiveModal} t={t} />

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
    </div>
  );
}
export default App;
