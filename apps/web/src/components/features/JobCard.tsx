import React, { useState } from 'react';
import { Job } from '../../types';
import { TFunction } from '../../lib/translations';
import { DownloadIcon, TrashIcon, CheckIcon, FolderIcon } from '../ui/Icons';
import { api } from '../../lib/api';
import { DirectoryHandleLike, saveJobToDirectory, triggerBrowserDownload } from '../../lib/autoSave';

interface JobCardProps {
  job: Job;
  onDelete: (id: string) => void;
  isSavedToDevice?: boolean;
  onManualSaved?: (id: string) => void;
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
  isSavedToDevice = false,
  onManualSaved,
  folderHandle = null,
  t,
}: JobCardProps) {
  const [savingToFolder, setSavingToFolder] = useState(false);

  const handleDownload = async () => {
    if (folderHandle) {
      try {
        setSavingToFolder(true);
        await saveJobToDirectory(folderHandle, job, api.isMockMode());
        onManualSaved?.(job.id);
        setSavingToFolder(false);
        return;
      } catch {
        setSavingToFolder(false);
      }
    }
    triggerBrowserDownload(job, api.isMockMode());
    onManualSaved?.(job.id);
  };

  const getStatusLabel = (status: Job['status']) => {
    if (status === 'queued') return t('statusQueued');
    if (status === 'running') return t('statusRunning');
    if (status === 'completed') return t('statusCompleted');
    return t('statusFailed');
  };

  return (
    <div className={`job-card ${job.status === 'completed' ? 'completed' : ''}`}>
      <div className="job-header">
        <div className={`job-status-dot ${job.status}`} />
        <div className="job-info">
          <div className="job-title" dir="ltr">
            {job.title || truncateUrl(job.url)}
          </div>
          <div className="job-url" dir="ltr">{truncateUrl(job.url)}</div>
        </div>
        <div className="job-actions">
          {job.status === 'completed' && (
            <button
              className="icon-btn download-btn"
              onClick={handleDownload}
              disabled={savingToFolder}
              title={folderHandle ? t('saveToChosenFolder') : t('openFile')}
            >
              {savingToFolder ? <span className="spinner" /> : folderHandle ? <FolderIcon /> : <DownloadIcon />}
            </button>
          )}
          <button
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
            {job.status === 'completed' && isSavedToDevice && (
              <span className="saved-pill">
                <CheckIcon /> {t('savedOnDevice')}
              </span>
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
    </div>
  );
}
export default JobCard;
