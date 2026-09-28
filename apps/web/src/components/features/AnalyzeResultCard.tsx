import React, { useState } from 'react';
import { AnalyzeResult, Format } from '../../types';
import { TFunction } from '../../lib/translations';
import { DownloadIcon, PlaylistIcon } from '../ui/Icons';

interface AnalyzeResultCardProps {
  result: AnalyzeResult;
  url: string;
  onDownload: (opts: {
    url: string;
    format: string;
    audioOnly: boolean;
    title?: string;
    items?: Array<{ url: string; title?: string }>;
  }) => Promise<void>;
  t: TFunction;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Displays analyzed media or playlist details and allows choosing Video/Audio quality and playlist items.
 */
export function AnalyzeResultCard({
  result,
  url,
  onDownload,
  t,
}: AnalyzeResultCardProps) {
  const hasPlaylist = Boolean(result.isPlaylist && result.playlistItems && result.playlistItems.length > 0);
  const [playlistMode, setPlaylistMode] = useState<boolean>(hasPlaylist);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    result.playlistItems ? result.playlistItems.map((item) => item.id) : []
  );
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

  const toggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (!result.playlistItems) return;
    if (selectedIds.length === result.playlistItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(result.playlistItems.map((item) => item.id));
    }
  };

  const handleStart = async () => {
    setLoading(true);
    const chosenFormat = audioOnly ? 'bestaudio/best' : selectedFormat;
    if (hasPlaylist && playlistMode && result.playlistItems) {
      const selectedItems = result.playlistItems
        .filter((item) => selectedIds.includes(item.id))
        .map((item) => ({ url: item.url, title: item.title }));
      await onDownload({
        url,
        format: chosenFormat,
        audioOnly,
        title: result.playlistTitle || result.title,
        items: selectedItems,
      });
    } else {
      await onDownload({
        url,
        format: chosenFormat,
        audioOnly,
        title: result.title,
      });
    }
    setLoading(false);
  };

  const displayTitle = hasPlaylist && playlistMode && result.playlistTitle
    ? result.playlistTitle
    : result.title;

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
          <h3>{displayTitle}</h3>
          <div className="media-meta">
            {result.uploader && (
              <span className="media-badge">{result.uploader}</span>
            )}
            {hasPlaylist && result.playlistItems ? (
              <span className="media-badge">
                <PlaylistIcon /> {result.playlistItems.length} {t('playlistBadge')}
              </span>
            ) : result.duration ? (
              <span className="media-badge">{formatDuration(result.duration)}</span>
            ) : null}
          </div>
        </div>
      </div>

      {hasPlaylist && result.playlistItems && (
        <div className="options-row" style={{ marginBottom: '12px', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className={`option-chip ${playlistMode ? 'selected' : ''}`}
            onClick={() => setPlaylistMode(true)}
          >
            <PlaylistIcon /> {t('playlistTab')} ({result.playlistItems.length})
          </button>
          <button
            type="button"
            className={`option-chip ${!playlistMode ? 'selected' : ''}`}
            onClick={() => setPlaylistMode(false)}
          >
            {t('singleVideoTab')}
          </button>
        </div>
      )}

      <div className="options-row" style={{ marginBottom: '16px', justifyContent: 'flex-start' }}>
        <button
          type="button"
          className={`option-chip ${!audioOnly ? 'selected' : ''}`}
          onClick={() => setAudioOnly(false)}
        >
          {t('videoTab')}
        </button>
        <button
          type="button"
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
                type="button"
                key={f.id}
                className={`format-option ${selectedFormat === f.id ? 'selected' : ''}`}
                onClick={() => setSelectedFormat(f.id)}
              >
                <span className="format-res">{f.resolution}</span>
                <span className="format-ext">{f.ext}{f.fps ? ` ${f.fps}fps` : ''}</span>
              </button>
            ))}
            <button
              type="button"
              className={`format-option ${selectedFormat === 'bestvideo+bestaudio/best' ? 'selected' : ''}`}
              onClick={() => setSelectedFormat('bestvideo+bestaudio/best')}
            >
              <span className="format-res">{t('bestQuality')}</span>
              <span className="format-ext">Auto</span>
            </button>
          </div>
        </div>
      )}

      {hasPlaylist && playlistMode && result.playlistItems && (
        <div className="formats-section">
          <div className="section-header" style={{ marginBottom: '8px' }}>
            <div className="formats-label" style={{ marginBottom: 0 }}>
              {t('playlistItemsLabel')} ({selectedIds.length}/{result.playlistItems.length})
            </div>
            <button
              type="button"
              className="option-chip"
              onClick={toggleSelectAll}
            >
              {selectedIds.length === result.playlistItems.length
                ? t('deselectAllItems')
                : t('selectAllItems')}
            </button>
          </div>
          <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {result.playlistItems.map((item, idx) => {
              const isSelected = selectedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleItem(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleItem(item.id);
                    }
                  }}
                  className={`format-option ${isSelected ? 'selected' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', gap: '10px' }}
                >
                  <span className="format-res" dir="ltr" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {idx + 1}. {item.title}
                  </span>
                  {item.duration ? (
                    <span className="format-ext" style={{ marginTop: 0 }}>
                      {formatDuration(item.duration)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="download-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleStart}
          disabled={loading || (hasPlaylist && playlistMode && selectedIds.length === 0)}
        >
          {loading ? (
            <><span className="spinner" /> {t('addingDownload')}</>
          ) : hasPlaylist && playlistMode ? (
            <><DownloadIcon /> {audioOnly ? t('startPlaylistAudio') : t('startPlaylistVideo')} ({selectedIds.length})</>
          ) : (
            <><DownloadIcon /> {t('startDownload')}</>
          )}
        </button>
      </div>
    </div>
  );
}
export default AnalyzeResultCard;

