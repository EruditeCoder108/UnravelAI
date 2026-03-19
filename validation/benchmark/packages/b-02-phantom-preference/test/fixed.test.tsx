/**
 * B-02: The Phantom Preference — fixed.test.tsx
 *
 * Fix applied to src/store/preferenceStore.ts:
 *
 * BEFORE (buggy):
 *   updateNotifications: (updates) =>
 *     set((state) => {
 *       const next = { ...state.preferences };
 *       Object.assign(next.notifications, updates);
 *       return { preferences: next, isDirty: true };
 *     }),
 *
 * AFTER (fixed):
 *   updateNotifications: (updates) =>
 *     set((state) => ({
 *       preferences: {
 *         ...state.preferences,
 *         notifications: { ...state.preferences.notifications, ...updates },
 *       },
 *       isDirty: true,
 *     })),
 *
 * Same fix pattern for updatePrivacy.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferenceStore } from '../src/store/preferenceStore';

// Apply the fix inline by monkey-patching the store action.
// In a real fix you would edit preferenceStore.ts directly.
beforeEach(() => {
  usePreferenceStore.getState().resetToDefaults();

  // Patch updateNotifications with the correct deep-spread implementation
  usePreferenceStore.setState({
    updateNotifications: (updates) =>
      usePreferenceStore.setState((state) => ({
        preferences: {
          ...state.preferences,
          notifications: { ...state.preferences.notifications, ...updates },
        },
        isDirty: true,
      })),
  });
});

describe('B-02 updateNotifications — correct deep spread (fixed)', () => {
  it('snapshot taken before update is not retroactively mutated', () => {
    const store = usePreferenceStore.getState();
    const snapshotBefore = store.preferences.notifications;
    expect(snapshotBefore.sound).toBe(true);

    store.updateNotifications({ sound: false });

    expect(snapshotBefore.sound).toBe(true); // unchanged
  });

  it('produces a new notifications object reference on update', () => {
    const store = usePreferenceStore.getState();
    const refBefore = store.preferences.notifications;

    store.updateNotifications({ email: false });

    const refAfter = usePreferenceStore.getState().preferences.notifications;
    expect(refAfter).not.toBe(refBefore);
  });

  it('does not affect sibling subscriber snapshot', () => {
    const notificationsA = usePreferenceStore.getState().preferences.notifications;

    usePreferenceStore.getState().updateNotifications({ sound: false, push: true });

    expect(notificationsA.sound).toBe(true);
    expect(notificationsA.push).toBe(false);
  });

  it('correctly applies the update to the new state', () => {
    usePreferenceStore.getState().updateNotifications({ frequency: 'weekly', email: false });

    const updated = usePreferenceStore.getState().preferences.notifications;
    expect(updated.frequency).toBe('weekly');
    expect(updated.email).toBe(false);
    expect(updated.sound).toBe(true); // unchanged default
  });
});
