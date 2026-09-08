import React, { useEffect } from 'react';
import { CloudIcon } from './Icons';

interface DropboxSaverProps {
  url: string;
  filename: string;
  title: string;
}

export function DropboxSaver({ url, filename, title }: DropboxSaverProps) {
  useEffect(() => {
    if (!document.getElementById('dropboxjs')) {
      const script = document.createElement('script');
      script.src = 'https://www.dropbox.com/static/api/2/dropins.js';
      script.id = 'dropboxjs';
      const appKey = import.meta.env.VITE_DROPBOX_APP_KEY || 'YOUR_DROPBOX_APP_KEY';
      script.setAttribute('data-app-key', appKey);
      document.body.appendChild(script);
    }
  }, []);

  const handleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!(window as any).Dropbox) {
      alert('Dropbox SDK not loaded or AdBlocker preventing it.');
      return;
    }
    const options = {
      files: [{ url: url, filename: filename }],
      success: function () {},
      cancel: function () {},
      error: function (errorMessage: string) {
        console.error('[Dropbox Saver Error]', errorMessage);
      }
    };
    (window as any).Dropbox.save(options);
  };

  return (
    <button className="icon-btn dropbox-btn" onClick={handleSave} title={title}>
      <CloudIcon />
    </button>
  );
}
export default DropboxSaver;
