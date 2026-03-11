import React, { useState, useEffect } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1);  // line 12 — always 0 + 1 = 1
    }, 1000);

    return () => clearInterval(id);
  }, []); // empty deps = closure never refreshes

  return <div>Count: {count}</div>;
}

export default Counter;
