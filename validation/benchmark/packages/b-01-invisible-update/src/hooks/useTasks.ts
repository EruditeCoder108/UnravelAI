import { useCallback } from 'react';
import { useTaskStore, Task } from '../store/taskStore';

/**
 * Provides task data and actions to components.
 * Wraps store actions in useCallback for stable references.
 */
export function useTasks() {
  const tasks = useTaskStore((state) => state.tasks);
  const isLoading = useTaskStore((state) => state.isLoading);
  const _addTask = useTaskStore((state) => state.addTask);
  const _completeTask = useTaskStore((state) => state.completeTask);
  const _removeTask = useTaskStore((state) => state.removeTask);

  const addTask = useCallback(
    (title: string) => {
      if (!title.trim()) return;
      _addTask(title.trim());
    },
    [_addTask]
  );

  const completeTask = useCallback(
    (id: string) => {
      _completeTask(id);
    },
    [_completeTask]
  );

  const removeTask = useCallback(
    (id: string) => {
      _removeTask(id);
    },
    [_removeTask]
  );

  const pendingCount = tasks.filter((t: Task) => !t.completed).length;
  const completedCount = tasks.filter((t: Task) => t.completed).length;

  return {
    tasks,
    isLoading,
    pendingCount,
    completedCount,
    addTask,
    completeTask,
    removeTask,
  };
}
