import React, { useState, useRef } from 'react';
import { Job } from '../../types';
import { TFunction } from '../../lib/translations';
import {
  FolderIcon,
  DownloadIcon,
  PlaylistIcon,
  TrashIcon,
  CheckIcon,
  RetryIcon,
  PauseIcon,
  PlayIcon,
  AlertIcon,
} from '../ui/Icons';
import { JobCard } from './JobCard';
import {
  DirectoryHandleLike,
  supportsDirectoryPicker,
  saveJobToDirectory,
  sanitizeFsName,
  showBrowserSaveNotification,
} from '../../lib/autoSave';
import { api } from '../../lib/api';
import { trackAnalyticsEvent } from '../../lib/analytics';

interface PlaylistBatchCardProps {
  batchId: string;
  batchTitle: string;
  jobs: Job[];
  folderHandle: DirectoryHandleLike | null;
  folderName: string;
  savedJobIds: Set<string>;
  onMarkSaved: (job: Job) => void;
  onMarkBatchSaved: (batchId: string, batchJobs: Job[]) => void;
  onRequestFolder: () => Promise<DirectoryHandleLike | null>;
  onDeleteJob: (id: string) => Promise<void>;
  onDeleteBatch: (ids: string[]) => Promise<void>;
  onPauseJob: (id: string) => void;
  onResumeJob: (id: string) => void;
  onRetryJob: (id: string) => void;
  t: TFunction;
}

export function PlaylistBatchCard({
  batchId,
  batchTitle,
  jobs,
  folderHandle,
  folderName,
  savedJobIds,
  onMarkSaved,
  onMarkBatchSaved,
  onRequestFolder,
  onDeleteJob,
  onDeleteBatch,
  onPauseJob,
  onResumeJob,
  onRetryJob,
  t,
}: PlaylistBatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [packingZip, setPackingZip] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [saveProgressText, setSaveProgressText] = useState('');
  const cancelRef = useRef(false);

  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const failedJobs = jobs.filter((j) => j.status === 'failed');
  const pausedJobs = jobs.filter((j) => j.status === 'paused');
  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const savedCount = completedJobs.filter((j) => savedJobIds.has(j.id) || Boolean(j.archived)).length;
  const unsavedCompleted = completedJobs.filter((j) => !savedJobIds.has(j.id) && !j.archived);

  const overallProgress =
    jobs.length > 0
      ? Math.round(jobs.reduce((acc, j) => acc + (j.status === 'completed' ? 100 : j.progress || 0), 0) / jobs.length)
      : 0;

  // One-click single ZIP archive download (works everywhere without per-song popups)
  const handleDownloadAsSingleZip = async () => {
    if (completedJobs.length === 0 || packingZip) return;
    setPackingZip(true);
    try {
      const zipName = `${sanitizeFsName(batchTitle, 'Playlist')}.zip`;
      if (api.isMockMode()) {
        const blob = new Blob([`Mock Playlist ZIP: ${batchTitle} (${completedJobs.length} files)`], {
          type: 'application/zip',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const a = document.createElement('a');
        a.href = `/api/batches/${batchId}/zip`;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      onMarkBatchSaved(batchId, completedJobs);
      void api.reportStatEvent('playlist_folder_saved', completedJobs.length);
      trackAnalyticsEvent('playlist_zip_download', { count: completedJobs.length });
      showBrowserSaveNotification(t('autoSaveNotifTitle'), `${batchTitle}.zip`);
    } finally {
      setTimeout(() => setPackingZip(false), 1200);
    }
  };

  // Optional zero-compression desktop Folder API writer
  const handleSaveUnzippedToFolder = async () => {
    const listToSave = unsavedCompleted.length > 0 ? unsavedCompleted : completedJobs;
    if (listToSave.length === 0) return;

    cancelRef.current = false;
    setSavingFolder(true);

    try {
      let targetHandle = folderHandle;
      if (supportsDirectoryPicker() && !targetHandle) {
        targetHandle = await onRequestFolder();
      }
      if (!targetHandle) {
        setSavingFolder(false);
        return;
      }

      let count = 0;
      for (const job of listToSave) {
        if (cancelRef.current) break;
        count += 1;
        setSaveProgressText(`${count} / ${listToSave.length}`);
        await saveJobToDirectory(targetHandle, job, api.isMockMode());
        onMarkSaved(job);
      }

      if (!cancelRef.current && count > 0) {
        void api.reportStatEvent('playlist_folder_saved', count);
        trackAnalyticsEvent('playlist_folder_saved', { count });
        showBrowserSaveNotification(t('autoSaveNotifTitle'), `${batchTitle} (${count})`);
      }
    } catch (err) {
      console.error('[PlaylistBatchCard] Folder write failed:', err);
    } finally {
      setSavingFolder(false);
      setSaveProgressText('');
    }
  };

  const handleRetryFailed = () => {
    for (const j of failedJobs) onRetryJob(j.id);
  };

  const handlePauseAll = () => {
    for (const j of activeJobs) onPauseJob(j.id);
  };

  const handleResumeAll = () => {
    for (const j of pausedJobs) onResumeJob(j.id);
  };

  return (
    <div className="batch-card">
      <div className="batch-header">
        <div className="batch-title-wrap">
          <span className="batch-icon">
            <PlaylistIcon />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="batch-title" dir="auto">{batchTitle}</div>
            <div className="batch-meta">
              <span>{completedJobs.length} / {jobs.length} {t('statusCompleted')}</span>
              {activeJobs.length > 0 && <span>· {activeJobs.length} {t('statusRunning')}</span>}
              {savedCount > 0 && (
                <span className="saved-pill">
                  <CheckIcon /> {savedCount} {t('savedOnDevice')}
                </span>
              )}
              {unsavedCompleted.length > 0 && (
                <span className="unsaved-pill">
                  <AlertIcon /> {unsavedCompleted.length} {t('readyToSaveCount')}
                </span>
              )}
              {pausedJobs.length > 0 && (
                <span className="status-text paused">· {pausedJobs.length} {t('pausedCountLabel')}</span>
              )}
              {failedJobs.length > 0 && (
                <span className="status-text failed">· {failedJobs.length} {t('failedCountLabel')}</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="icon-btn delete-btn"
          onClick={() => onDeleteBatch(jobs.map((j) => j.id))}
          title={t('deleteItem')}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="progress-bar-bg" style={{ marginTop: '10px' }}>
        <div className="progress-bar-fill" style={{ width: `${overallProgress}%` }} />
      </div>

      <div className="batch-actions-row">
        {completedJobs.length > 0 && (
          <button
            type="button"
            className="btn btn-primary batch-save-btn"
            onClick={handleDownloadAsSingleZip}
            disabled={packingZip}
          >
            {packingZip ? (
              <><span className="spinner" /> {t('packingZipBtn')}</>
            ) : (
              <><DownloadIcon /> {t('downloadPlaylistZip')} ({completedJobs.length})</>
            )}
          </button>
        )}

        {completedJobs.length > 0 && supportsDirectoryPicker() && folderHandle && folderName && !savingFolder && (
          <button
            type="button"
            className="option-chip"
            onClick={handleSaveUnzippedToFolder}
          >
            <FolderIcon /> {t('saveToFolderUnzipped')} ({unsavedCompleted.length || completedJobs.length})
          </button>
        )}

        {savingFolder && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { cancelRef.current = true; }}
          >
            <span className="spinner" /> {t('savingBatchProgress')} {saveProgressText} · {t('cancelAction')}
          </button>
        )}

        {activeJobs.length > 0 && (
          <button type="button" className="option-chip" onClick={handlePauseAll}>
            <PauseIcon /> {t('pauseBtn')}
          </button>
        )}

        {pausedJobs.length > 0 && (
          <button type="button" className="option-chip selected" onClick={handleResumeAll}>
            <PlayIcon /> {t('resumeBtn')} ({pausedJobs.length})
          </button>
        )}

        {failedJobs.length > 0 && (
          <button type="button" className="option-chip" onClick={handleRetryFailed}>
            <RetryIcon /> {t('retryBtn')} ({failedJobs.length})
          </button>
        )}

        <button
          type="button"
          className="option-chip"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('hideTracks') : `${t('showTracks')} (${jobs.length})`}
        </button>
      </div>

      {expanded && (
        <div className="batch-tracks-list">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onDelete={onDeleteJob}
              onPause={onPauseJob}
              onResume={onResumeJob}
              onRetry={onRetryJob}
              isSavedToDevice={savedJobIds.has(job.id) || Boolean(job.archived)}
              onManualSaved={onMarkSaved}
              folderHandle={folderHandle}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default PlaylistBatchCard;
