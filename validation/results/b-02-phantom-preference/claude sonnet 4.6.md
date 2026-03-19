
Root Cause
The bug is in preferenceStore.ts, not usePreferences.ts. The updateNotifications and updatePrivacy actions use Object.assign to mutate a nested object on a shallow copy of preferences:
tsconst next = { ...state.preferences };      // new top-level object...
Object.assign(next.notifications, updates); // ...but notifications is still the SAME reference
return { preferences: next, isDirty: true };
{ ...state.preferences } only clones one level deep. next.notifications still points to the same object in memory. So Object.assign mutates the original nested object directly — meaning any code that captured a reference to the old preferences.notifications (like PreferencesPanel's localDraft state and the prevPrefsRef in the hook) now silently reflects the new values. That's why snapshots taken before an update show the updated data.
updateTheme happens to be written correctly already — it spreads the nested object: theme: { ...state.preferences.theme, ...updates }.
The fix is to apply the same pattern to updateNotifications and updatePrivacy:
tsupdateNotifications: (updates) =>
  set((state) => ({
    preferences: {
      ...state.preferences,
      notifications: { ...state.preferences.notifications, ...updates }, // ✅ new reference
    },
    isDirty: true,
  })),

updatePrivacy: (updates) =>
  set((state) => ({
    preferences: {
      ...state.preferences,
      privacy: { ...state.preferences.privacy, ...updates }, // ✅ new reference
    },
    isDirty: true,
  })),
No changes needed in usePreferences.ts, PreferencesPanel.tsx, or anywhere else.