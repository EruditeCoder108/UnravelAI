import React, { useState } from 'react';
import { useTasks } from '../hooks/useTasks';

/**
 * Renders the task list and provides add/complete controls.
 */
export function TaskDashboard() {
  const { tasks, isLoading, pendingCount, addTask, completeTask } = useTasks();
  const [input, setInput] = useState('');

  function handleAdd() {
    if (!input.trim()) return;
    addTask(input);
    setInput('');
  }

  if (isLoading) {
    return <div data-testid="loading">Loading tasks...</div>;
  }

  return (
    <div data-testid="task-dashboard">
      <div data-testid="task-count">{tasks.length} tasks ({pendingCount} pending)</div>

      <div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="New task"
          data-testid="task-input"
        />
        <button onClick={handleAdd} data-testid="add-button">
          Add
        </button>
      </div>

      <ul data-testid="task-list">
        {tasks.map((task) => (
          <li key={task.id} data-testid={`task-${task.id}`}>
            <span data-testid={`task-title-${task.id}`}>{task.title}</span>
            <span data-testid={`task-status-${task.id}`}>
              {task.completed ? 'done' : 'pending'}
            </span>
            {!task.completed && (
              <button
                onClick={() => completeTask(task.id)}
                data-testid={`complete-${task.id}`}
              >
                Complete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
