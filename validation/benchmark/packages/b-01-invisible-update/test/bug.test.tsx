/**
 * B-01: The Invisible Update — bug.test.tsx
 *
 * Proves that useTaskStore.addTask() and completeTask() mutate the
 * tasks array in-place, so Zustand never notifies subscribers and
 * the UI never re-renders.
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TaskDashboard } from '../src/components/TaskDashboard';
import { useTaskStore } from '../src/store/taskStore';

beforeEach(() => {
  useTaskStore.setState({ tasks: [], isLoading: false });
});

describe('B-01 TaskDashboard — in-place mutation prevents re-render', () => {
  it('should display a newly added task in the list', () => {
    render(<TaskDashboard />);

    fireEvent.change(screen.getByTestId('task-input'), {
      target: { value: 'Write tests' },
    });
    fireEvent.click(screen.getByTestId('add-button'));

    // BUG: list never re-renders — task count stays at 0
    expect(screen.getByTestId('task-count').textContent).toContain('1 tasks');
    expect(screen.getByTestId('task-list').children).toHaveLength(1);
  });

  it('should update task status to done after completing it', async () => {
    // Pre-populate store with one task
    useTaskStore.setState({
      tasks: [{ id: 'task-1', title: 'Existing task', completed: false, createdAt: 0 }],
    });

    render(<TaskDashboard />);

    fireEvent.click(screen.getByTestId('complete-task-1'));

    // BUG: status never updates in the UI
    expect(screen.getByTestId('task-status-task-1').textContent).toBe('done');
  });

  it('store state IS actually modified (proving bug is in notification, not logic)', () => {
    const store = useTaskStore.getState();
    store.addTask('Silent task');

    // The task WAS added to the array — logic is correct
    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Silent task');

    // But the array reference is the same object — Zustand sees no change
    // This is what prevents the re-render
    const tasksRef1 = useTaskStore.getState().tasks;
    store.addTask('Another silent task');
    const tasksRef2 = useTaskStore.getState().tasks;

    // BUG: same reference → Zustand skips notification
    expect(tasksRef1).not.toBe(tasksRef2); // this FAILS — they are the same object
  });
});
