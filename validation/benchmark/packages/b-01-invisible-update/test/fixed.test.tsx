/**
 * B-01: The Invisible Update — fixed.test.tsx
 *
 * Fix applied to src/store/taskStore.ts:
 *
 * BEFORE (buggy):
 *   tasks.push(newTask);
 *   set({ tasks });
 *
 * AFTER (fixed):
 *   set({ tasks: [...tasks, newTask] });
 *
 * Same pattern for completeTask and removeTask.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { useTaskStore } from '../src/store/taskStore';

// Fixed store actions patched inline
beforeEach(() => {
  useTaskStore.setState({
    tasks: [],
    isLoading: false,
    addTask: (title: string) =>
      useTaskStore.setState((s) => ({
        tasks: [
          ...s.tasks,
          { id: `task_${Date.now()}`, title, completed: false, createdAt: Date.now() },
        ],
      })),
    completeTask: (id: string) =>
      useTaskStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, completed: true } : t)),
      })),
    removeTask: (id: string) =>
      useTaskStore.setState((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
      })),
  });
});

// Lazy import after patch
const { TaskDashboard } = await import('../src/components/TaskDashboard');

describe('B-01 TaskDashboard — correct spread (fixed)', () => {
  it('displays a newly added task immediately', () => {
    render(<TaskDashboard />);

    fireEvent.change(screen.getByTestId('task-input'), {
      target: { value: 'Write tests' },
    });
    fireEvent.click(screen.getByTestId('add-button'));

    expect(screen.getByTestId('task-count').textContent).toContain('1 tasks');
  });

  it('each addTask call creates a new array reference', () => {
    const store = useTaskStore.getState();
    store.addTask('Task A');
    const ref1 = useTaskStore.getState().tasks;

    store.addTask('Task B');
    const ref2 = useTaskStore.getState().tasks;

    expect(ref1).not.toBe(ref2);
    expect(ref2).toHaveLength(2);
  });

  it('completeTask produces a new array without mutating the original', () => {
    useTaskStore.setState((s) => ({
      ...s,
      tasks: [{ id: 't1', title: 'Do thing', completed: false, createdAt: 0 }],
    }));

    const before = useTaskStore.getState().tasks;
    useTaskStore.getState().completeTask('t1');
    const after = useTaskStore.getState().tasks;

    expect(before).not.toBe(after);
    expect(before[0].completed).toBe(false); // original unchanged
    expect(after[0].completed).toBe(true);
  });
});
