## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- React 18.2, Zustand 4.5, Vite 5.1
- Reproduced consistently since the refactor in PR #312 ("migrate task list to Zustand")

## Symptom
The task dashboard doesn't re-render when tasks are added or completed.
`addTask()` and `completeTask()` both return without errors but the UI
stays frozen. I added a `console.log` inside the `TaskDashboard` component
and confirmed it only renders once on mount — never again.

I think the issue is in `useTasks.ts` — the hook seems to be calling
the store correctly but there might be a memoization problem. The
`useEffect` that watches the task list may have a stale dependency.
Alternatively the `isLoading` guard could be swallowing the update.

## Stack trace
No crash — pure silent failure. The store actions complete without throwing.

## What I tried
- Removed the `isLoading` guard from `TaskDashboard.tsx` — no change
- Added `console.log(tasks)` inside `useTasks` — shows the same array every render
- Forced a re-render by toggling a local `useState` counter — that works fine,
  which confirms the component itself renders correctly when told to
- Checked `useTasks.ts` dependencies on `useCallback` — they look right

The bug must be in `useTasks.ts` — the hook is selecting from the store but
something is preventing Zustand from notifying subscribers when tasks change.
