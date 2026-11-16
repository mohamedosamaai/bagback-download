import React, { useState } from 'react';
import { Job } from '../../types';
import { TFunction } from '../../lib/translations';
import {
  DownloadIcon,
  TrashIcon,
  CheckIcon,
  FolderIcon,
  PauseIcon,
  PlayIcon,
  RetryIcon,
  VideoIcon,
  MusicIcon,
  AlertIcon,
} from '../ui/Icons';
import { api } from '../../lib/api';
import { DirectoryHandleLike, saveJobToDirectory, triggerBrowserDownload } from '../../lib/autoSave';

interface JobCardProps {
  job: Job;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onRetry?: (id: string) => void;
  isSavedToDevice?: boolean;
  onManualSaved?: (job: Job) => void;
  folderHandle?: DirectoryHandleLike | null;
  t: TFunction;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function truncateUrl(url: string, max = 45): string {
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > max ? display.slice(0, max) + '…' : display;
  } catch {
    return url.slice(0, max) + (url.length > max ? '…' : '');
  }
}

export function JobCard({
  job,
  onDelete,
  onPause,
  onResume,
  onRetry,
  isSavedToDevice = false,
  onManualSaved,
  folderHandle = null,
  t,
}: JobCardProps) {
  const [savingToFolder, setSavingToFolder] = useState(false);

  const isAudio =
    job.mediaType === 'audio' ||
    Boolean(job.audioOnly) ||
    job.format === 'bestaudio/best' ||
    /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(job.fileName || '');

  const handleDownload = async () => {
    if (folderHandle) {
      try {
        setSavingToFolder(true);
        await saveJobToDirectory(folderHandle, job, api.isMockMode());
        onManualSaved?.(job);
        setSavingToFolder(false);
        return;
      } catch {
        setSavingToFolder(false);
      }
    }
    triggerBrowserDownload(job, api.isMockMode());
    onManualSaved?.(job);
  };

  const getStatusLabel = (status: Job['status']) => {
    if (status === 'queued') return t('statusQueued');
    if (status === 'running') return t('statusRunning');
    if (status === 'paused') return t('statusPaused');
    if (status === 'completed') return t('statusCompleted');
    return t('statusFailed');
  };

  return (
    <div className={`job-card ${job.status === 'completed' ? 'completed' : ''}`}>
      <div className="job-header">
        <div className={`job-status-dot ${job.status}`} />
        <div className="job-info">
          <div className="job-title-row">
            <span className="media-type-chip" title={isAudio ? 'Audio' : 'Video'}>
              {isAudio ? <MusicIcon /> : <VideoIcon />}
            </span>
            <div className="job-title" dir="ltr">
              {job.title || truncateUrl(job.url)}
            </div>
          </div>
          <div className="job-url" dir="ltr">{truncateUrl(job.url)}</div>
        </div>
        <div className="job-actions">
          {(job.status === 'running' || job.status === 'queued') && onPause && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onPause(job.id)}
              title={t('pauseBtn')}
              aria-label={t('pauseBtn')}
            >
              <PauseIcon />
            </button>
          )}
          {job.status === 'paused' && onResume && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onResume(job.id)}
              title={t('resumeBtn')}
              aria-label={t('resumeBtn')}
            >
              <PlayIcon />
            </button>
          )}
          {(job.status === 'failed' || job.status === 'paused') && onRetry && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onRetry(job.id)}
              title={t('retryBtn')}
              aria-label={t('retryBtn')}
            >
              <RetryIcon />
            </button>
          )}
          {job.status === 'completed' && (
            <button
              type="button"
              className="icon-btn download-btn"
              onClick={handleDownload}
              disabled={savingToFolder}
              title={folderHandle ? t('saveToChosenFolder') : t('openFile')}
            >
              {savingToFolder ? <span className="spinner" /> : folderHandle ? <FolderIcon /> : <DownloadIcon />}
            </button>
          )}
          <button
            type="button"
            className="icon-btn delete-btn"
            onClick={() => onDelete(job.id)}
            title={t('deleteItem')}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className="progress-wrap">
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${job.progress}%` }} />
        </div>
        <div className="progress-meta">
          <span className={`status-text ${job.status}`}>
            {getStatusLabel(job.status)}
            {job.status === 'running' && ` — ${Math.round(job.progress)}%`}
            {job.status === 'completed' && (
              isSavedToDevice ? (
                <span className="saved-pill">
                  <CheckIcon /> {t('savedToDeviceBadge')}
                </span>
              ) : (
                <span className="unsaved-pill">
                  <AlertIcon /> {t('notSavedYetBadge')}
                </span>
              )
            )}
          </span>
          <span className="file-size">
            {job.status === 'completed' && job.fileSize
              ? formatSize(job.fileSize)
              : ''}
          </span>
        </div>
        {job.status === 'failed' && job.error && (
          <div className="job-error-msg">
            {job.error}
          </div>
        )}
      </div>

      {job.status === 'completed' && (
        <div className="completed-action-row">
          <button
            type="button"
            className="btn-save-device"
            onClick={handleDownload}
            disabled={savingToFolder}
          >
            {savingToFolder ? <span className="spinner" /> : folderHandle ? <FolderIcon /> : <DownloadIcon />}
            <span>{folderHandle ? t('saveToChosenFolder') : t('saveToDevice')}</span>
          </button>
        </div>
      )}

      {job.status === 'failed' && onRetry && (
        <div className="completed-action-row">
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%' }}
            onClick={() => onRetry(job.id)}
          >
            <RetryIcon /> <span>{t('retryBtn')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
export default JobCard;
