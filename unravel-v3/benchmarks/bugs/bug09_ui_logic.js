// Bug 09: UI_LOGIC — Object reference equality blocks React re-render
// Difficulty: Hard

export const metadata = {
    id: 'reference_equality_render',
    bugCategory: 'UI_LOGIC',
    userSymptom: 'Clicking "Add Tag" does nothing. The tag appears in console.log but never shows on screen.',
    trueRootCause: 'tags.push() mutates the existing array in place. React uses === reference equality to detect state changes. Since the array reference is the same object, React skips the re-render.',
    trueVariable: 'tags',
    trueFile: 'bug09_ui_logic.js',
    trueLine: 12,
    difficulty: 'hard',
};

export const code = `
import React, { useState } from 'react';

function TagEditor() {
  const [tags, setTags] = useState(['react', 'javascript']);
  const [input, setInput] = useState('');

  function addTag() {
    if (!input.trim()) return;

    // BUG: mutates the existing array in place
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
`;
