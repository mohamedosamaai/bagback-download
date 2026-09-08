import React, { useState } from 'react';
import { AnalyzeResult, Format } from '../../types';
import { TFunction } from '../../lib/translations';
import { DownloadIcon } from '../ui/Icons';

interface AnalyzeResultCardProps {
  result: AnalyzeResult;
  url: string;
  onDownload: (opts: { url: string; format: string; audioOnly: boolean }) => Promise<void>;
  t: TFunction;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AnalyzeResultCard({
  result,
  url,
  onDownload,
  t,
}: AnalyzeResultCardProps) {
  const [audioOnly, setAudioOnly] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('bestvideo+bestaudio/best');
  const [loading, setLoading] = useState(false);

  const videoFormats = result.formats
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.resolution)
    .reduce((acc: Format[], f) => {
      if (!acc.find((x) => x.resolution === f.resolution)) acc.push(f);
      return acc;
    }, [])
    .slice(0, 6);

  const handleStart = async () => {
    setLoading(true);
    await onDownload({ url, format: audioOnly ? 'bestaudio/best' : selectedFormat, audioOnly });
    setLoading(false);
  };

  return (
    <div className="analyze-result">
      <div className="media-preview">
        {result.thumbnail && (
          <img
            src={result.thumbnail}
            alt="preview"
            className="media-thumb"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div className="media-info">
          <h3>{result.title}</h3>
          <div className="media-meta">
            {result.uploader && (
              <span className="media-badge">🎬 {result.uploader}</span>
            )}
            {result.duration ? (
              <span className="media-badge">⏱ {formatDuration(result.duration)}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="options-row" style={{ marginBottom: '16px' }}>
        <button
          className={`option-chip ${!audioOnly ? 'selected' : ''}`}
          onClick={() => setAudioOnly(false)}
        >
          {t('videoTab')}
        </button>
        <button
          className={`option-chip ${audioOnly ? 'selected' : ''}`}
          onClick={() => setAudioOnly(true)}
        >
          {t('audioTab')}
        </button>
      </div>

      {!audioOnly && videoFormats.length > 0 && (
        <div className="formats-section">
          <div className="formats-label">{t('selectQuality')}</div>
          <div className="formats-grid">
            {videoFormats.map((f) => (
              <button
                key={f.id}
                className={`format-option ${selectedFormat === f.id ? 'selected' : ''}`}
                onClick={() => setSelectedFormat(f.id)}
              >
                <span className="format-res">{f.resolution}</span>
                <span className="format-ext">{f.ext}{f.fps ? ` ${f.fps}fps` : ''}</span>
              </button>
            ))}
            <button
              className={`format-option ${selectedFormat === 'bestvideo+bestaudio/best' ? 'selected' : ''}`}
              onClick={() => setSelectedFormat('bestvideo+bestaudio/best')}
            >
              <span className="format-res">{t('bestQuality')}</span>
              <span className="format-ext">Auto</span>
            </button>
          </div>
        </div>
      )}

      <div className="download-actions">
        <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
          {loading ? (
            <><span className="spinner" /> {t('addingDownload')}</>
          ) : (
            <><DownloadIcon /> {t('startDownload')}</>
          )}
        </button>
      </div>
    </div>
  );
}
export default AnalyzeResultCard;
