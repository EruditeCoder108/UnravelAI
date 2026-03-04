// Bug 04: EVENT_LIFECYCLE — Event listener added, never removed
// Difficulty: Medium

export const metadata = {
    id: 'missing_cleanup_leak',
    bugCategory: 'EVENT_LIFECYCLE',
    userSymptom: 'App gets slower over time. Console shows the scroll handler firing multiple times per scroll event after navigating between pages.',
    trueRootCause: 'useEffect adds a scroll event listener but has no cleanup return. Every re-mount adds another listener, creating a memory leak and duplicate handlers.',
    trueVariable: 'handleScroll',
    trueFile: 'bug04_event_lifecycle.js',
    trueLine: 11,
    difficulty: 'medium',
};

export const code = `
import React, { useEffect, useState } from 'react';

function ScrollTracker() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    function handleScroll() {
      setScrollY(window.scrollY);
      console.log('Scroll position:', window.scrollY);
    }

    window.addEventListener('scroll', handleScroll); // line 11
    // BUG: no cleanup — no return () => window.removeEventListener(...)
    // Every time this component mounts, another listener is added
  }, []);

  return <div style={{ height: '200vh' }}>Scroll: {scrollY}px</div>;
}

export default ScrollTracker;
`;
