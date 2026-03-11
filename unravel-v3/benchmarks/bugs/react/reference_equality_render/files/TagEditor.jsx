import React, { useState } from 'react';

function TagEditor() {
  const [tags, setTags] = useState(['react', 'javascript']);
  const [input, setInput] = useState('');

  function addTag() {
    if (!input.trim()) return;

    tags.push(input.trim());  // line 12
    setTags(tags);  // same reference — React sees oldState === newState, skips render

    console.log('Tags after push:', tags); // shows the new tag in console
    setInput('');
  }

  return (
    <div>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Add a tag..."
      />
      <button onClick={addTag}>Add Tag</button>
      <div>
        {tags.map(tag => (
          <span key={tag} style={{ margin: '4px', padding: '4px 8px', background: '#eee' }}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

export default TagEditor;
