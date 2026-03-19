import { create } from 'zustand';

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

interface TaskState {
  tasks: Task[];
  isLoading: boolean;
  addTask: (title: string) => void;
  completeTask: (id: string) => void;
  removeTask: (id: string) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  isLoading: false,

  addTask: (title: string) => {
    const { tasks } = get();
    const newTask: Task = {
      id: `task_${Date.now()}`,
      title,
      completed: false,
      createdAt: Date.now(),
    };
    tasks.push(newTask);
    set({ tasks });
  },

  completeTask: (id: string) => {
    const { tasks } = get();
    const task = tasks.find((t) => t.id === id);
    if (task) {
      task.completed = true;
    }
    set({ tasks });
  },

  removeTask: (id: string) => {
    const { tasks } = get();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx !== -1) tasks.splice(idx, 1);
    set({ tasks });
  },
}));
