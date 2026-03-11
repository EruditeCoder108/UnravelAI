import React, { useState, useEffect, useRef } from 'react';

function ChatWindow() {
  const [messages, setMessages] = useState([]);
  const listRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
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
