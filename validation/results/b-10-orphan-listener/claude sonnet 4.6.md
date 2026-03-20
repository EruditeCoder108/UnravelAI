This one I want to be straight with you about rather than give a confident-sounding wrong answer.

What the code actually does. useScrollAnalytics is written correctly for the standard case. The useEffect adds one listener on mount, the const onScroll reference is captured by the cleanup closure, and removeEventListener receives that exact same reference — so removal works. When pageId changes, the cleanup removes the old listener before the effect re-runs and adds a new one. Net count stays at 1 throughout. The removeEventListener options mismatch (adding with { passive: true }, removing without options) is not a problem — only the capture flag matters for listener identity matching in modern browsers, and both calls default to capture: false.
What I can verify is wrong from these files. There is one clear, verifiable bug: the scroll handler fires on every individual scroll event with no throttle or debounce. A single scroll gesture generates 50–100+ native scroll events. With no rate limiting at the source, analyticsService.track() gets called that many times per gesture. Adding rateLimitMs: 500 to AnalyticsService reduced but didn't eliminate duplicates because it applies a blanket time gate to all events — it's the wrong layer, and it also broke legitimate tracking of genuine scroll depth changes.
What I cannot explain from these files. The symptom "N events per scroll gesture where N equals the number of page navigations" describes listener accumulation — each navigation adds a listener that is never removed. The code as written should not produce this. I traced every path: dep changes trigger cleanup correctly, function references are stable within each effect execution, StrictMode double-invocation should net out to one listener. The only structural explanation that fits the symptom is that multiple PageView instances are simultaneously mounted — for example, a route transition that keeps the previous page in the tree while the new one mounts. That would mean each navigation adds a new listener (from the new instance) without removing the old one (because the old instance hasn't unmounted yet). That's consistent with PR #601 being the introduction point because before it, there was nothing to accumulate. But this would be a router/layout architecture issue that is not visible in the three files you've shared.
What to check next. Add console.log('listener added') inside the effect and console.log('listener removed') inside the cleanup, then navigate through several pages and count. If removals consistently lag behind additions, the old PageView instances are staying mounted. Also check whether your router wraps pages in a transition or animation component that delays unmounting. If removals and additions are symmetric, the accumulation is coming from somewhere else entirely — possibly the parent creating a new AnalyticsService instance on some renders in a way that causes two concurrent effect lifecycles.
The actionable fix for the confirmed problem. Throttle at the source in useScrollAnalytics.ts:
diff--- useScrollAnalytics.ts
  useEffect(() => {
+   let lastFired = 0;
    const onScroll = () => {
+     const now = Date.now();
+     if (now - lastFired < 100) return;  // ~10 events per second max
+     lastFired = now;
      const scrollHeight = document.body.scrollHeight - window.innerHeight;
      const depth = scrollHeight > 0
        ? Math.round((window.scrollY / scrollHeight) * 100)
        : 0;
      analyticsService.track('scroll_depth', { pageId, depth });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pageId, analyticsService]);
This caps scroll tracking at roughly 10 events per second regardless of how fast the user scrolls or how many listeners are active. The lastFired variable lives inside the closure — no ref needed, no external state, no cross-effect leakage. This is the right layer for this rate limit: it's specific to scroll depth tracking, not a blanket gate on all analytics events.
The accumulation-with-navigation issue needs the parent code and router to diagnose definitively. If you can share the router setup or the parent component that renders PageView, I can tell you exactly where the extra listeners are coming from. Sonnet 4.6