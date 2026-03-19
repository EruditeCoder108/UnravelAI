## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- React 18.2, Vite 5.1
- Appeared after PR #601 ("add scroll depth analytics to all page views")

## Symptom
The analytics dashboard shows scroll_depth events firing 3–8 times per
actual scroll gesture, and the count grows with session length. A user
who has navigated through 5 pages has 5x the expected scroll event volume.
Our analytics API is hitting rate limits as a result.

The issue started immediately after the scroll tracking was added. In
development (React StrictMode) we saw 2 events per scroll from the first
page load. In production it starts at 1 and grows with navigation.

I believe the issue is in `AnalyticsService.ts`. The `track()` method
has no deduplication — if `scroll_depth` is called in rapid succession it
records every call. We should add a debounce or a minimum time between
identical events to prevent the API from being flooded. The service also
has no rate limiting by default (rateLimitMs defaults to 0).

## Stack trace
No crash. Excessive API calls visible in network tab and analytics dashboard.
scroll_depth event fires N times per scroll where N = number of page navigations.

## What I tried
- Added `rateLimitMs: 500` to `AnalyticsService` constructor — reduced
  duplicate events but didn't eliminate them, and broke legitimate rapid
  scroll tracking
- Added `console.log` in `useScrollAnalytics` to count how many times the
  effect runs — runs once per render, which looks correct
- Checked `PageView.tsx` to see if it was calling `useScrollAnalytics`
  multiple times — it only calls it once

The bug must be in `AnalyticsService.ts` — the `track()` method needs
deduplication logic to prevent the same event from being recorded
multiple times within a short window.
