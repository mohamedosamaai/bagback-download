import React from 'react';
import { TFunction } from '../../lib/translations';

interface FooterProps {
  setActiveModal: (modal: 'terms' | 'privacy' | 'cleanRoom' | null) => void;
  onOpenStats?: () => void;
  t: TFunction;
}

const RAW_SUPPORT_URL = (import.meta.env.VITE_SUPPORT_URL || '').trim();
let SAFE_SUPPORT_URL = '';
try {
  if (RAW_SUPPORT_URL && new URL(RAW_SUPPORT_URL).protocol === 'https:') {
    SAFE_SUPPORT_URL = RAW_SUPPORT_URL;
  }
} catch {
  SAFE_SUPPORT_URL = '';
}

export function Footer({ setActiveModal, onOpenStats, t }: FooterProps) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <a href="https://bagbacktech.com" target="_blank" rel="noreferrer">
            Bagback Digital Solutions
          </a>{' '}
          · MIT License
        </div>

        <div className="footer-links">
          {onOpenStats && (
            <button type="button" className="footer-link-btn" onClick={onOpenStats}>
              {t('statsLink')}
            </button>
          )}
          {SAFE_SUPPORT_URL && (
            <a href={SAFE_SUPPORT_URL} target="_blank" rel="sponsored noopener noreferrer">
              {t('supportProject')}
            </a>
          )}
          <button type="button" className="footer-link-btn" onClick={() => setActiveModal('terms')}>
            {t('termsBtn')}
          </button>
          <button className="footer-link-btn" onClick={() => setActiveModal('privacy')}>
            {t('privacyBtn')}
          </button>
          <button className="footer-link-btn" onClick={() => setActiveModal('cleanRoom')}>
            {t('cleanRoomBtn')}
          </button>
          <a href="https://mohamedosama.me" target="_blank" rel="noreferrer">
            {t('portfolio')}
          </a>
        </div>
      </div>
    </footer>
  );
}
export default Footer;
