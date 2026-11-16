import React, { useState, useRef } from 'react';
import { Job } from '../../types';
import { TFunction } from '../../lib/translations';
import { FolderIcon, DownloadIcon, PlaylistIcon, TrashIcon, CheckIcon } from '../ui/Icons';
import { JobCard } from './JobCard';
import {
  DirectoryHandleLike,
  supportsDirectoryPicker,
  saveJobToDirectory,
  triggerBrowserDownload,
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
  onMarkSaved: (id: string) => void;
  onRequestFolder: () => Promise<DirectoryHandleLike | null>;
  onDeleteJob: (id: string) => Promise<void>;
  onDeleteBatch: (ids: string[]) => Promise<void>;
  t: TFunction;
}

export function PlaylistBatchCard({
  batchTitle,
  jobs,
  folderHandle,
  folderName,
  savedJobIds,
  onMarkSaved,
  onRequestFolder,
  onDeleteJob,
  onDeleteBatch,
  t,
}: PlaylistBatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);
  const [saveProgressText, setSaveProgressText] = useState('');
  const cancelRef = useRef(false);

  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const failedJobs = jobs.filter((j) => j.status === 'failed');
  const pendingCount = jobs.length - completedJobs.length - failedJobs.length;
  const savedCount = completedJobs.filter((j) => savedJobIds.has(j.id)).length;
  const overallProgress =
    jobs.length > 0
      ? Math.round(jobs.reduce((acc, j) => acc + (j.status === 'completed' ? 100 : j.progress || 0), 0) / jobs.length)
      : 0;

  const unsavedCompleted = completedJobs.filter((j) => !savedJobIds.has(j.id));

  const handleSaveAllSequentially = async () => {
    const listToSave = unsavedCompleted.length > 0 ? unsavedCompleted : completedJobs;
    if (listToSave.length === 0) return;

    cancelRef.current = false;
    setSavingBatch(true);

    try {
      let targetHandle = folderHandle;
      if (supportsDirectoryPicker() && !targetHandle) {
        targetHandle = await onRequestFolder();
      }

      let count = 0;
      for (const job of listToSave) {
        if (cancelRef.current) break;
        count += 1;
        setSaveProgressText(`${count} / ${listToSave.length}`);

        if (targetHandle) {
          await saveJobToDirectory(targetHandle, job, api.isMockMode());
          onMarkSaved(job.id);
        } else {
          triggerBrowserDownload(job, api.isMockMode());
          onMarkSaved(job.id);
          // Stagger sequential browser downloads to avoid browser popup throttling
          if (count < listToSave.length) {
            await new Promise((r) => setTimeout(r, 850));
          }
        }
      }

      if (!cancelRef.current && count > 0) {
        void api.reportStatEvent('playlist_folder_saved', count);
        trackAnalyticsEvent('playlist_batch_saved', {
          count,
          folder_mode: Boolean(targetHandle),
        });
        showBrowserSaveNotification(
          t('autoSaveNotifTitle'),
          `${batchTitle} (${count})`
        );
      }
    } catch (err) {
      console.error('[PlaylistBatchCard] Sequential save failed:', err);
    } finally {
      setSavingBatch(false);
      setSaveProgressText('');
    }
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
              {pendingCount > 0 && <span>· {pendingCount} {t('statusRunning')}</span>}
              {savedCount > 0 && (
                <span className="saved-pill">
                  <CheckIcon /> {savedCount} {t('savedOnDevice')}
                </span>
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
        {completedJobs.length > 0 && !savingBatch && (
          <button
            type="button"
            className="btn btn-primary batch-save-btn"
            onClick={handleSaveAllSequentially}
          >
            {supportsDirectoryPicker() ? <FolderIcon /> : <DownloadIcon />}
            {folderHandle && folderName
              ? `${t('saveBatchToFolder')} (${unsavedCompleted.length || completedJobs.length})`
              : `${t('saveBatchSequentially')} (${unsavedCompleted.length || completedJobs.length})`}
          </button>
        )}

        {savingBatch && (
          <button
            type="button"
            className="btn btn-ghost batch-save-btn"
            onClick={() => { cancelRef.current = true; }}
          >
            <span className="spinner" /> {t('savingBatchProgress')} {saveProgressText} · {t('cancelAction')}
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
              isSavedToDevice={savedJobIds.has(job.id)}
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
