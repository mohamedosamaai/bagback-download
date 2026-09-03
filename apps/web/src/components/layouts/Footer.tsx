import React from 'react';
import { TFunction } from '../../lib/translations';

interface FooterProps {
  setActiveModal: (modal: 'terms' | 'privacy' | 'cleanRoom' | null) => void;
  t: TFunction;
}

export function Footer({ setActiveModal, t }: FooterProps) {
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
          <button className="footer-link-btn" onClick={() => setActiveModal('terms')}>
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
