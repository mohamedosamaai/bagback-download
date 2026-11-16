import React from 'react';
import { Lang } from '../../types';
import { TFunction } from '../../lib/translations';
import { SunIcon, MoonIcon, GlobeIcon, ChartIcon, PhoneInstallIcon } from '../ui/Icons';

interface HeaderProps {
  lang: Lang;
  setLang: (lang: Lang) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  onNavigateStats?: () => void;
  onNavigateHome?: () => void;
  onInstallApp?: () => void;
  canInstallApp?: boolean;
  t: TFunction;
}

export function Header({
  lang,
  setLang,
  theme,
  setTheme,
  onNavigateStats,
  onNavigateHome,
  onInstallApp,
  canInstallApp = false,
  t,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="header-inner">
        <a
          href="/"
          className="logo"
          aria-label="Bagback Download"
          onClick={(e) => {
            if (onNavigateHome) {
              e.preventDefault();
              onNavigateHome();
            }
          }}
        >
          <img
            src="/logo.png"
            alt="Bagback Download Logo"
            className="logo-image"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.endsWith('/apple-icon.png')) {
                img.src = '/apple-icon.png';
              }
            }}
          />
          <div className="logo-text-group">
            <span className="logo-title">{t('brandName')}</span>
            <span className="logo-subtitle">{t('brandSuffix')}</span>
          </div>
        </a>
        <nav className="header-nav">
          {canInstallApp && onInstallApp && (
            <button
              type="button"
              className="nav-btn install-nav-btn"
              onClick={onInstallApp}
            >
              <PhoneInstallIcon /> {t('installApp')}
            </button>
          )}
          {onNavigateStats && (
            <button
              type="button"
              className="nav-btn"
              onClick={onNavigateStats}
              title={t('statsLink')}
            >
              <ChartIcon />
            </button>
          )}
          <button
            type="button"
            className="nav-btn lang-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            type="button"
            className="nav-btn lang-btn"
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          >
            <GlobeIcon /> {t('langSwitch')}
          </button>
          <a href="https://bagbacktech.com" target="_blank" rel="noreferrer" className="nav-link">
            <button type="button" className="nav-btn">{t('bagbackTech')}</button>
          </a>
          <a href="https://github.com/mohamedosamaai/bagback-download" target="_blank" rel="noreferrer" className="nav-link">
            <button type="button" className="nav-btn">{t('github')}</button>
          </a>
        </nav>
      </div>
    </header>
  );
}
export default Header;
