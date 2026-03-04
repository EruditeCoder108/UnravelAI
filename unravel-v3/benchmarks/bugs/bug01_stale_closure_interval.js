// Bug 01: STALE_CLOSURE — setInterval capturing stale state
// Difficulty: Medium

export const metadata = {
    id: 'stale_closure_interval',
    bugCategory: 'STALE_CLOSURE',
    userSymptom: 'Counter shows 1 every second instead of incrementing. The number never goes above 1.',
    trueRootCause: 'setInterval callback captures the initial value of count (0) from the closure. Every tick computes 0 + 1 = 1.',
    trueVariable: 'count',
    trueFile: 'bug01_stale_closure_interval.js',
    trueLine: 12,
    difficulty: 'medium',
};

export const code = `
import React, { useState, useEffect } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      // BUG: captures stale 'count' = 0 from closure
      setCount(count + 1);  // line 12 — always 0 + 1 = 1
    }, 1000);

    return () => clearInterval(id);
  }, []); // empty deps = closure never refreshes

  return <div>Count: {count}</div>;
}

export default Counter;
`;
