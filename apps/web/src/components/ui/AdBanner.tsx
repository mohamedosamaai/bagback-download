import React, { useEffect, useRef, useState } from 'react';
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
const AD_IFRAME_HOST = (import.meta.env.VITE_AD_IFRAME_HOST || '').trim();
const AD_DESKTOP_KEY = (import.meta.env.VITE_AD_DESKTOP_KEY || '').trim();
const AD_MOBILE_KEY = (import.meta.env.VITE_AD_MOBILE_KEY || '').trim();
const AD_RECT_KEY = (import.meta.env.VITE_AD_RECT_KEY || '').trim();
const AD_SOCIAL_BAR_SRC = (import.meta.env.VITE_AD_SOCIAL_BAR_SRC || '').trim();
const SPONSOR_TITLE = (import.meta.env.VITE_SPONSOR_TITLE || '').trim();
const SPONSOR_DESC = (import.meta.env.VITE_SPONSOR_DESC || '').trim();
const SPONSOR_URL = (import.meta.env.VITE_SPONSOR_URL || '').trim();
const SPONSOR_CTA = (import.meta.env.VITE_SPONSOR_CTA || '').trim();

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

function isValidAdHost(val: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(val) && val.length <= 120;
}

function isValidAdKey(val: string): boolean {
  return /^[a-f0-9]{16,64}$/i.test(val);
}

function buildBannerIframeDoc(host: string, key: string, width: number, height: number): string {
  const safeW = Math.max(120, Math.min(1000, Math.floor(width)));
  const safeH = Math.max(50, Math.min(650, Math.floor(height)));
  return [
    '<!doctype html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#121714;color:#a1a1aa;display:flex;align-items:center;justify-content:center;overflow:hidden;}</style></head><body>',
    `<script>atOptions={'key':'${key}','format':'iframe','height':${safeH},'width':${safeW},'params':{}};</script>`,
    `<script async src="https://${host}/22/${key}"></script>`,
    '</body></html>',
  ].join('');
}

/**
 * Polite, non-intrusive display banner slot supporting Google AdSense, Adsterra responsive iframes/native banners,
 * and affiliate/sponsor cards configured strictly via Vite environment variables.
 */
export function AdBanner({ position, t }: AdBannerProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const adsenseSlot = position === 'top' ? ADSENSE_SLOT_TOP : ADSENSE_SLOT_BOTTOM;
  const adsenseReady =
    AD_PROVIDER === 'adsense' &&
    isValidAdsenseClient(ADSENSE_CLIENT) &&
    isValidAdSlot(adsenseSlot);

  const isCustomProvider = AD_PROVIDER === 'custom' || AD_PROVIDER === 'adsterra';
  const hostValid = isValidAdHost(AD_IFRAME_HOST);
  const topKey = isDesktop
    ? (isValidAdKey(AD_DESKTOP_KEY) ? AD_DESKTOP_KEY : '')
    : (isValidAdKey(AD_MOBILE_KEY) ? AD_MOBILE_KEY : '');
  const topBannerReady = isCustomProvider && position === 'top' && hostValid && Boolean(topKey);
  const topBannerDims = isDesktop ? { width: 728, height: 90 } : { width: 320, height: 50 };

  const nativeReady =
    isCustomProvider &&
    position === 'bottom' &&
    isSafeHttpsScript(CUSTOM_SCRIPT_SRC) &&
    isSafeDomId(CUSTOM_CONTAINER_ID);
  const rectBannerReady =
    isCustomProvider && position === 'bottom' && hostValid && isValidAdKey(AD_RECT_KEY);
  const socialBarReady =
    isCustomProvider && position === 'bottom' && isSafeHttpsScript(AD_SOCIAL_BAR_SRC);

  const sponsorReady =
    AD_PROVIDER === 'sponsor' &&
    position === 'bottom' &&
    SPONSOR_TITLE.length >= 2 &&
    isSafeHttpsScript(SPONSOR_URL);

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
    } else if (nativeReady) {
      if (!document.getElementById('bagback-custom-ad-sdk')) {
        const script = document.createElement('script');
        script.id = 'bagback-custom-ad-sdk';
        script.async = true;
        script.setAttribute('data-cfasync', 'false');
        script.src = CUSTOM_SCRIPT_SRC;
        document.body.appendChild(script);
      }
    }

    if (socialBarReady && !document.getElementById('bagback-social-ad-sdk')) {
      const sbScript = document.createElement('script');
      sbScript.id = 'bagback-social-ad-sdk';
      sbScript.async = true;
      sbScript.setAttribute('data-cfasync', 'false');
      sbScript.src = AD_SOCIAL_BAR_SRC;
      document.body.appendChild(sbScript);
    }
  }, [adsenseReady, nativeReady, socialBarReady]);

  if (!adsenseReady && !topBannerReady && !nativeReady && !rectBannerReady && !sponsorReady) {
    return null;
  }

  return (
    <aside className="ad-slot-card" aria-label={sponsorReady ? t('sponsorLabel') : t('adLabel')}>
      <div className="ad-slot-header">
        <span className="ad-badge">{sponsorReady ? t('sponsorLabel') : t('adLabel')}</span>
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
        ) : sponsorReady ? (
          <a
            href={SPONSOR_URL}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="sponsor-banner-link"
          >
            <div className="sponsor-banner-copy">
              <strong>{SPONSOR_TITLE}</strong>
              {SPONSOR_DESC && <span>{SPONSOR_DESC}</span>}
            </div>
            {SPONSOR_CTA && <span className="sponsor-banner-cta">{SPONSOR_CTA}</span>}
          </a>
        ) : topBannerReady ? (
          <iframe
            key={`top-${topBannerDims.width}x${topBannerDims.height}`}
            title={t('adLabel')}
            className="ad-iframe-frame"
            width={topBannerDims.width}
            height={topBannerDims.height}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            scrolling="no"
            srcDoc={buildBannerIframeDoc(
              AD_IFRAME_HOST,
              topKey,
              topBannerDims.width,
              topBannerDims.height
            )}
          />
        ) : (
          <div className="ad-bottom-stack">
            {nativeReady && (
              <div id={CUSTOM_CONTAINER_ID} className="ad-native-host" dir="ltr" />
            )}
            {rectBannerReady && !nativeReady && (
              <iframe
                title={t('adLabel')}
                className="ad-iframe-frame"
                width={300}
                height={250}
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                scrolling="no"
                srcDoc={buildBannerIframeDoc(AD_IFRAME_HOST, AD_RECT_KEY, 300, 250)}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export default AdBanner;
