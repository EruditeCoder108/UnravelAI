import { useEffect } from 'react';
import { AnalyticsService } from '../services/AnalyticsService';

/**
 * Tracks scroll depth for a given page and reports it to analytics.
 *
 * Registers a passive scroll listener on window and cleans it up when
 * the component unmounts or pageId/analyticsService changes.
 */
export function useScrollAnalytics(
  pageId: string,
  analyticsService: AnalyticsService
): void {
  useEffect(() => {
    const onScroll = () => {
      const scrollHeight = document.body.scrollHeight - window.innerHeight;
      const depth = scrollHeight > 0
        ? Math.round((window.scrollY / scrollHeight) * 100)
        : 0;
      analyticsService.track('scroll_depth', { pageId, depth });
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    return () => window.removeEventListener('scroll', onScroll);
  }, [pageId, analyticsService]);
}
