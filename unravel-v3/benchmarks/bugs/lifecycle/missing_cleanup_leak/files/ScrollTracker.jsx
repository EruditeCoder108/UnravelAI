import React, { useEffect, useState } from 'react';

function ScrollTracker() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    function handleScroll() {
      setScrollY(window.scrollY);
      console.log('Scroll position:', window.scrollY);
    }

    window.addEventListener('scroll', handleScroll); // line 11
    // Every time this component mounts, another listener is added
  }, []);

  return <div style={{ height: '200vh' }}>Scroll: {scrollY}px</div>;
}

export default ScrollTracker;
