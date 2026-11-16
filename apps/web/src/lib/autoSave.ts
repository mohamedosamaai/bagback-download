import { Job } from '../types';

const DB_NAME = 'bagback-download-fs';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'default-folder';

export interface DirectoryHandleLike {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<WritableStream & { write(data: unknown): Promise<void>; close(): Promise<void> }>;
  }>;
  queryPermission?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

/** Returns true when the browser supports direct folder selection (Chrome/Edge desktop). */
export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed opening handle store'));
  });
}

export async function loadStoredDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as DirectoryHandleLike) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function storeDirectoryHandle(handle: DirectoryHandleLike): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore storage persistence errors
  }
}

export async function clearStoredDirectoryHandle(): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}

export async function queryDirectoryPermission(
  handle: DirectoryHandleLike | null
): Promise<'granted' | 'prompt' | 'denied'> {
  if (!handle || typeof handle.queryPermission !== 'function') return 'prompt';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

export async function requestDirectoryPermission(handle: DirectoryHandleLike): Promise<boolean> {
  try {
    const cur = await queryDirectoryPermission(handle);
    if (cur === 'granted') return true;
    if (typeof handle.requestPermission === 'function') {
      const res = await handle.requestPermission({ mode: 'readwrite' });
      return res === 'granted';
    }
    return false;
  } catch {
    return false;
  }
}

/** Prompts the user once to select a local download directory with write consent. */
export async function pickAutoSaveDirectory(): Promise<DirectoryHandleLike | null> {
  if (!supportsDirectoryPicker()) return null;
  const picker = (window as unknown as {
    showDirectoryPicker: (opts?: { mode?: 'read' | 'readwrite'; id?: string; startIn?: string }) => Promise<DirectoryHandleLike>;
  }).showDirectoryPicker;

  const handle = await picker({
    id: 'bagback-downloads',
    mode: 'readwrite',
    startIn: 'downloads',
  });
  await storeDirectoryHandle(handle);
  return handle;
}

const RESERVED_WIN_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Sanitizes a filename or folder name safely for Windows, macOS, Linux, and mobile filesystems. */
export function sanitizeFsName(raw: string, fallback = 'download'): string {
  const cleaned = (raw || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);

  if (!cleaned || cleaned === '.' || cleaned === '..' || RESERVED_WIN_NAMES.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

/** Triggers a standard browser anchor download using our no-store / Signed URL endpoint. */
export function triggerBrowserDownload(job: Job, isMock = false): void {
  if (isMock) {
    const blob = new Blob(
      [`Bagback Download Mock File\nTitle: ${job.title || job.id}\nURL: ${job.url}\n`],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFsName(job.fileName || `${job.title || 'download'}.txt`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  const a = document.createElement('a');
  a.href = `/api/jobs/${job.id}/file`;
  a.download = sanitizeFsName(job.fileName || `${job.title || 'download'}.mp4`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Streams a completed job directly into the user-approved local directory (or playlist subfolder). */
export async function saveJobToDirectory(
  rootHandle: DirectoryHandleLike,
  job: Job,
  isMock = false
): Promise<string> {
  const hasPermission = await requestDirectoryPermission(rootHandle);
  if (!hasPermission) {
    throw new Error('Folder write permission was not granted');
  }

  let targetDir = rootHandle;
  if (job.batchTitle) {
    const folderName = sanitizeFsName(job.batchTitle, 'Playlist');
    targetDir = await rootHandle.getDirectoryHandle(folderName, { create: true });
  }

  const rawFileName = job.fileName || `${job.title || job.id}.mp4`;
  const safeFileName = sanitizeFsName(rawFileName, `${job.id}.mp4`);
  const fileHandle = await targetDir.getFileHandle(safeFileName, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    if (isMock) {
      const content = new Blob([`Bagback Download Mock\nTitle: ${job.title}\nFile: ${safeFileName}\n`], {
        type: 'text/plain',
      });
      await writable.write(content);
      await writable.close();
      return job.batchTitle ? `${sanitizeFsName(job.batchTitle, 'Playlist')}/${safeFileName}` : safeFileName;
    }

    const res = await fetch(`/api/jobs/${job.id}/file`, { mode: 'cors', redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Download failed with HTTP ${res.status}`);
    }

    if (res.body && typeof res.body.pipeTo === 'function') {
      await res.body.pipeTo(writable);
    } else {
      const buf = await res.arrayBuffer();
      await writable.write(buf);
      await writable.close();
    }
    return job.batchTitle ? `${sanitizeFsName(job.batchTitle, 'Playlist')}/${safeFileName}` : safeFileName;
  } catch (err) {
    try {
      await writable.close();
    } catch {
      // Ignore cleanup close error
    }
    throw err;
  }
}

export async function requestNotificationPermissionSafe(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    if (Notification.permission === 'granted') return 'granted';
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function showBrowserSaveNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: '/apple-icon.png',
      tag: 'bagback-autosave',
    });
  } catch {
    // Some mobile contexts disallow direct Notification constructor
  }
}
