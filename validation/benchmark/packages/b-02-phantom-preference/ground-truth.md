## Root Cause
**File:** `src/store/preferenceStore.ts` **Lines:** 47–51  
`updateNotifications` does `const next = { ...state.preferences }` (shallow spread)
then `Object.assign(next.notifications, updates)`. The spread copies the
`notifications` reference — not the object — so `next.notifications` and
`state.preferences.notifications` point at the same object in memory.
`Object.assign` mutates it in place, retroactively changing every reference
to that object anywhere in the application.

## Causal Chain
1. `PreferencesPanel` (user A) calls `updateNotifications({ sound: false })`
2. `preferenceStore.updateNotifications` runs: `const next = { ...state.preferences }`
3. `next.notifications` is the **same object reference** as the old `state.preferences.notifications`
4. `Object.assign(next.notifications, { sound: false })` mutates the shared object
5. Every variable that holds a reference to the old `notifications` object now reflects `sound: false`
6. `PreferencesPanel` (user B), mounted earlier with its own snapshot, sees contaminated data
Hops: 3 files (component → hook → store, mutation in store)

## Key AST Signals
- Mutation chain: `next.notifications` written via `Object.assign` at `preferenceStore.ts L50`
  — write that mutates existing object, does not produce a new reference
- Contrast: `updateTheme` at L57 uses `{ ...state.preferences.theme, ...updates }` — correct deep spread
- No `{ ...state.preferences.notifications }` spread in `updateNotifications` path
- `updatePrivacy` has the identical shallow-spread bug at L64

## The Fix
```diff
  updateNotifications: (updates) =>
-   set((state) => {
-     const next = { ...state.preferences };
-     Object.assign(next.notifications, updates);
-     return { preferences: next, isDirty: true };
-   }),
+   set((state) => ({
+     preferences: {
+       ...state.preferences,
+       notifications: { ...state.preferences.notifications, ...updates },
+     },
+     isDirty: true,
+   })),
```
Same fix pattern for `updatePrivacy`.

## Why the Fix Works
`{ ...state.preferences.notifications, ...updates }` creates a brand-new
object each time. The new `preferences` object contains a new `notifications`
object. All previous references to the old `notifications` remain valid and
unmodified. Zustand reference-equality checks correctly detect the change.

## Proximate Fixation Trap
The reporter blames `usePreferences.ts` because the hook is where both components
converge — it's the common abstraction layer, and the `JSON.stringify` comparison
in its `useEffect` genuinely looks like it could create cross-instance coupling.
The actual bug is in `preferenceStore.ts` — specifically the asymmetry between
`updateTheme` (correct deep spread) and `updateNotifications` (shallow spread +
Object.assign). The inconsistency across three actions in the same file is the
hardest part of the diagnosis.

## Benchmark Metadata
- Category: `STATE_MUTATION`
- Difficulty: Hard
- Files: 5
- File hops from symptom to root cause: 3 (component → hook → store)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
