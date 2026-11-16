import React, { useEffect, useRef } from 'react';
import { TFunction } from '../../lib/translations';

interface AdBannerProps {
  position: 'top' | 'bottom';
  t: TFunction;
}

const AD_PROVIDER = (import.meta.env.VITE_AD_PROVIDER || 'none').trim().toLowerCase();
const ADSENSE_CLIENT = (import.meta.env.VITE_ADSENSE_CLIENT || '').trim();
const ADSENSE_SLOT_TOP = (import.meta.env.VITE_ADSENSE_SLOT_TOP || '').trim();
const ADSENSE_SLOT_BOTTOM = (import.meta.env.VITE_ADSENSE_SLOT_BOTTOM || '').trim();
const CUSTOM_SCRIPT_SRC = (import.meta.env.VITE_AD_SCRIPT_SRC || '').trim();
const CUSTOM_CONTAINER_ID = (import.meta.env.VITE_AD_CONTAINER_ID || '').trim();

function isValidAdsenseClient(val: string): boolean {
  return /^ca-pub-\d{10,20}$/.test(val);
}

function isValidAdSlot(val: string): boolean {
  return /^\d{6,20}$/.test(val);
}

function isSafeHttpsScript(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeDomId(val: string): boolean {
  return /^[a-zA-Z0-9_-]{3,80}$/.test(val);
}

/**
 * Polite, non-intrusive display banner slot supporting Google AdSense or external ad networks
 * configured safely via Vite environment variables (zero popunders or fake download overlays).
 */
export function AdBanner({ position, t }: AdBannerProps) {
  const adsenseSlot = position === 'top' ? ADSENSE_SLOT_TOP : ADSENSE_SLOT_BOTTOM;
  const adsenseReady =
    AD_PROVIDER === 'adsense' &&
    isValidAdsenseClient(ADSENSE_CLIENT) &&
    isValidAdSlot(adsenseSlot);

  const customReady =
    AD_PROVIDER === 'custom' &&
    isSafeHttpsScript(CUSTOM_SCRIPT_SRC) &&
    isSafeDomId(CUSTOM_CONTAINER_ID);

  const pushedRef = useRef(false);

  useEffect(() => {
    if (adsenseReady) {
      if (!document.getElementById('bagback-adsense-sdk')) {
        const script = document.createElement('script');
        script.id = 'bagback-adsense-sdk';
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
        document.head.appendChild(script);
      }
      if (!pushedRef.current) {
        pushedRef.current = true;
        try {
          const w = window as unknown as { adsbygoogle?: unknown[] };
          w.adsbygoogle = w.adsbygoogle || [];
          w.adsbygoogle.push({});
        } catch {
          // Ignore blocked ad blocker errors
        }
      }
    } else if (customReady && position === 'bottom') {
      if (!document.getElementById('bagback-custom-ad-sdk')) {
        const script = document.createElement('script');
        script.id = 'bagback-custom-ad-sdk';
        script.async = true;
        script.setAttribute('data-cfasync', 'false');
        script.src = CUSTOM_SCRIPT_SRC;
        document.body.appendChild(script);
      }
    }
  }, [adsenseReady, customReady, position]);

  if (!adsenseReady && (!customReady || position !== 'bottom')) {
    return null;
  }

  return (
    <aside className="ad-slot-card" aria-label={t('adLabel')}>
      <div className="ad-slot-header">
        <span className="ad-badge">{t('adLabel')}</span>
      </div>
      <div className="ad-slot-frame">
        {adsenseReady ? (
          <ins
            className="adsbygoogle"
            style={{ display: 'block', minHeight: '90px', width: '100%' }}
            data-ad-client={ADSENSE_CLIENT}
            data-ad-slot={adsenseSlot}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        ) : (
          <div id={CUSTOM_CONTAINER_ID} style={{ minHeight: '90px', width: '100%' }} />
        )}
      </div>
    </aside>
  );
}

export default AdBanner;
