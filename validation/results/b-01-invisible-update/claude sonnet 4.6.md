Root Cause

The bug is actually in taskStore.ts, not useTasks.ts. All three store actions (addTask, completeTask, removeTask) mutate the existing array/objects in place before calling set(). Zustand uses shallow equality to detect changes — if the array reference hasn't changed, it won't notify subscribers.

ts// addTask — mutates the array directly, then sets the same reference

const { tasks } = get();

tasks.push(newTask);   // ← mutates in place

set({ tasks });        // ← same array ref, Zustand sees no change



// completeTask — mutates the object, same problem

task.completed = true; // ← mutates in place

set({ tasks });        // ← same ref, no notification

The comment in useTasks.ts ("the staleness is in the store, not here") was actually correct all along — the author just looked in the wrong file.

The fix is to return new array/object references in every action:

