import React from 'react';
import { Job } from '../../types';
import { TFunction } from '../../lib/translations';
import { DownloadIcon, TrashIcon } from '../ui/Icons';
import { DropboxSaver } from '../ui/DropboxSaver';
import { api } from '../../lib/api';

interface JobCardProps {
  job: Job;
  onDelete: (id: string) => void;
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

export function JobCard({ job, onDelete, t }: JobCardProps) {
  const handleDownload = () => {
    if (api.isMockMode()) {
      const content = `Bagback Download Mock File:\n\nTitle: ${job.title || 'Unknown Media'}\nURL: ${job.url}\nJob ID: ${job.id}\nFile Name: ${job.fileName}\nSize: ${formatSize(job.fileSize)}\nTimestamp: ${job.createdAt}\n\nThank you for using Bagback Download (by Mohamed Osama)!`;
      const blob = new Blob([content], { type: 'text/plain' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = job.fileName || 'download.txt';
      a.click();
      URL.revokeObjectURL(blobUrl);
    } else {
      const a = document.createElement('a');
      a.href = `/api/jobs/${job.id}/file`;
      a.download = job.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const getDropboxUrl = () => {
    if (api.isMockMode()) {
      return 'https://raw.githubusercontent.com/mohamedosamaai/bagback-download/main/apps/web/public/apple-icon.png';
    }
    return `${window.location.origin}/api/jobs/${job.id}/file`;
  };

  const getStatusLabel = (status: Job['status']) => {
    if (status === 'queued') return t('statusQueued');
    if (status === 'running') return t('statusRunning');
    if (status === 'completed') return t('statusCompleted');
    return t('statusFailed');
  };

  return (
    <div className="job-card">
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
            <>
              <button
                className="icon-btn download-btn"
                onClick={handleDownload}
                title={t('openFile')}
              >
                <DownloadIcon />
              </button>
              <DropboxSaver
                url={getDropboxUrl()}
                filename={job.fileName || 'download'}
                title={t('saveToDropbox')}
              />
            </>
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
            {job.status === 'running' && ` — ${job.progress.toFixed(0)}%`}
          </span>
          <span className="file-size">
            {job.status === 'completed' && job.fileSize
              ? formatSize(job.fileSize)
              : job.error
              ? job.error.slice(0, 50)
              : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
export default JobCard;
