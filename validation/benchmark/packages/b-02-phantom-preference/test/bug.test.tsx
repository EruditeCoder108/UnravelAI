/**
 * B-02: The Phantom Preference — bug.test.tsx
 *
 * Proves that updateNotifications() mutates the nested notifications
 * object in-place via Object.assign on a shallow-spread copy, meaning:
 *   1. The "previous" state snapshot is retroactively corrupted
 *   2. Two independently initialised preference snapshots share state
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferenceStore } from '../src/store/preferenceStore';

beforeEach(() => {
  // Reset Zustand store to defaults before each test
  usePreferenceStore.getState().resetToDefaults();
});

describe('B-02 updateNotifications — shared reference mutation', () => {
  it('should not retroactively mutate a snapshot taken before the update', () => {
    const store = usePreferenceStore.getState();

    // Take a snapshot of the notifications object BEFORE any update
    const snapshotBefore = store.preferences.notifications;

    // Sanity check: sound is true by default
    expect(snapshotBefore.sound).toBe(true);

    // Now update sound to false
    store.updateNotifications({ sound: false });

    // The snapshot captured before the update should be UNCHANGED —
    // it represents the state at the time of capture.
    // BUG: Object.assign mutates snapshotBefore.sound too, so this FAILS.
    expect(snapshotBefore.sound).toBe(true);
  });

  it('should produce a new notifications object reference on each update', () => {
    const store = usePreferenceStore.getState();
    const refBefore = store.preferences.notifications;

    store.updateNotifications({ email: false });

    const refAfter = usePreferenceStore.getState().preferences.notifications;

    // A correct implementation creates a new notifications object so Zustand
    // can detect changes in selectors that check reference equality.
    // BUG: Object.assign mutates the shared object — refBefore === refAfter.
    expect(refAfter).not.toBe(refBefore);
  });

  it('should not affect a second store subscriber that captured preferences before the update', () => {
    // Simulate two components subscribed to the store at different times.
    // Component A captures the preference reference on mount.
    // Component B then calls updateNotifications.
    // Component A's captured reference should be unaffected.
    const componentASnapshot = usePreferenceStore.getState().preferences;
    const notificationsA = componentASnapshot.notifications;

    // Component B updates
    usePreferenceStore.getState().updateNotifications({ sound: false, push: true });

    // Component A's snapshot should still reflect the original values.
    // BUG: notificationsA is the same object — it now shows sound=false, push=true.
    expect(notificationsA.sound).toBe(true);
    expect(notificationsA.push).toBe(false);
  });
});
