// Bug 10: STALE_CLOSURE — useEffect missing vital dependency
// Difficulty: Medium (different shape than Bug 01)

export const metadata = {
    id: 'stale_closure_effect_deps',
    bugCategory: 'STALE_CLOSURE',
    userSymptom: 'Chat auto-scroll always scrolls to the position of the FIRST message, not the latest. New messages appear but the scroll position is wrong.',
    trueRootCause: 'useEffect captures the initial value of messages.length from the closure. The dependency array is empty, so the effect never re-runs when messages change. scrollToIndex always uses the stale value 0.',
    trueVariable: 'messages',
    trueFile: 'bug10_stale_closure_effect.js',
    trueLine: 14,
    difficulty: 'medium',
};

export const code = `
import React, { useState, useEffect, useRef } from 'react';

function ChatWindow() {
  const [messages, setMessages] = useState([]);
  const listRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    // BUG: captures initial messages.length = 0 from closure
    // Empty deps [] means this never re-runs when messages change
    function scrollToLatest() {
      if (listRef.current) {
        const scrollToIndex = messages.length - 1; // line 14 — always -1 (stale)
        const el = listRef.current.children[scrollToIndex];
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }
    }

    scrollToLatest();
  }, []); // Missing dependency: messages

  function addMessage(text) {
    setMessages(prev => [...prev, { id: Date.now(), text }]);
  }

  return (
    <div>
      <div ref={listRef} style={{ height: '300px', overflow: 'auto' }}>
        {messages.map(msg => (
          <div key={msg.id}>{msg.text}</div>
        ))}
      </div>
      <button onClick={() => addMessage('Hello ' + Date.now())}>Send</button>
    </div>
  );
}

export default ChatWindow;
`;
