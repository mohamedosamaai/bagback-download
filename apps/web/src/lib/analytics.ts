const GA_MEASUREMENT_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID || '').trim();
const VALID_GA_ID_RE = /^(G|AW|DC)-[A-Z0-9]{4,16}$/i;

let analyticsInitialized = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function isGaEnabled(): boolean {
  return VALID_GA_ID_RE.test(GA_MEASUREMENT_ID);
}

/** Loads Google Analytics 4 cleanly once when VITE_GA_MEASUREMENT_ID is configured. */
export function initAnalytics(): void {
  if (typeof window === 'undefined' || analyticsInitialized || !isGaEnabled()) return;
  analyticsInitialized = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: true,
  });

  if (!document.getElementById('bagback-ga4-script')) {
    const script = document.createElement('script');
    script.id = 'bagback-ga4-script';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.appendChild(script);
  }
}

export function trackPageView(pagePath: string): void {
  if (!isGaEnabled() || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_title: document.title,
  });
}

export function trackAnalyticsEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (!isGaEnabled() || typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, params || {});
}
