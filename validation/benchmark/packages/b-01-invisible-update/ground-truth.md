## Root Cause
**File:** `src/store/taskStore.ts` **Line:** 24  
`tasks.push(newTask)` mutates the existing array in-place. Zustand compares
state references with `Object.is` — the array reference never changes, so
no subscriber is notified and no re-render occurs.

## Causal Chain
1. User calls `addTask('New task')` → `taskStore.addTask` runs
2. `tasks.push(newTask)` appends to the existing array — same reference
3. `set({ tasks })` passes the **same array object** back into state
4. Zustand runs `Object.is(prev.tasks, next.tasks)` → `true` → no update
5. `TaskDashboard` subscriber never fires — UI frozen
Hops: 2 files (store → component, causation in store)

## Key AST Signals
- Mutation chain: `tasks` written via `Array.prototype.push` at `taskStore.ts L24` — write that does not produce a new reference
- Reads: `useTasks.ts` reads `tasks` via selector — receives same reference every call
- No `[...tasks]` or `tasks.concat()` spread anywhere in the write path

## The Fix
```diff
- tasks.push(newTask);
- set({ tasks });
+ set({ tasks: [...tasks, newTask] });
```

## Why the Fix Works
Spread syntax creates a new array with all existing elements plus the new one.
The new array has a different object identity — `Object.is(prev, next)` returns
`false` — so Zustand notifies all subscribers and React re-renders components
that select from `tasks`.

## Proximate Fixation Trap
The reporter blames `useTasks.ts` because the hook is the observable boundary —
it's where "Zustand isn't notifying" becomes visible. The hook's `useCallback`
dependencies and the component's `useEffect` both look plausible as culprits.
The actual bug is in `taskStore.ts` — the mutation happens before the hook
is ever involved. Zustand never emits; the hook never receives; the component
never renders. The hook is innocent.

## Benchmark Metadata
- Category: `STATE_MUTATION`
- Difficulty: Easy
- Files: 3
- File hops from symptom to root cause: 2 (component → hook → store)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance
