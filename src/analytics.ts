type AnalyticsEvent = 'page_view' | 'app_open';

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: AnalyticsEvent) => void;
  }
}

export function trackEvent(eventName: AnalyticsEvent): void {
  window.gtag?.('event', eventName);
}
