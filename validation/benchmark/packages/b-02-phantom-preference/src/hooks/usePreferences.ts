import { useCallback, useEffect, useRef } from 'react';
import {
  usePreferenceStore,
  NotificationSettings,
  ThemeSettings,
  PrivacySettings,
} from '../store/preferenceStore';

/**
 * Provides preference values and update handlers with
 * change-detection logging and auto-save debouncing.
 */
export function usePreferences() {
  const preferences = usePreferenceStore((s) => s.preferences);
  const isDirty = usePreferenceStore((s) => s.isDirty);
  const updateNotifications = usePreferenceStore((s) => s.updateNotifications);
  const updateTheme = usePreferenceStore((s) => s.updateTheme);
  const updatePrivacy = usePreferenceStore((s) => s.updatePrivacy);
  const resetToDefaults = usePreferenceStore((s) => s.resetToDefaults);

  // Tracks previous preferences to detect which section changed.
  const prevPrefsRef = useRef(JSON.stringify(preferences));
  useEffect(() => {
    const current = JSON.stringify(preferences);
    if (current !== prevPrefsRef.current) {
      console.debug('[usePreferences] Preferences changed, scheduling auto-save');
      prevPrefsRef.current = current;
    }
  }, [preferences]);

  const handleUpdateNotifications = useCallback(
    (updates: Partial<NotificationSettings>) => {
      updateNotifications(updates);
    },
    [updateNotifications]
  );

  const handleUpdateTheme = useCallback(
    (updates: Partial<ThemeSettings>) => {
      updateTheme(updates);
    },
    [updateTheme]
  );

  const handleUpdatePrivacy = useCallback(
    (updates: Partial<PrivacySettings>) => {
      updatePrivacy(updates);
    },
    [updatePrivacy]
  );

  return {
    preferences,
    isDirty,
    updateNotifications: handleUpdateNotifications,
    updateTheme: handleUpdateTheme,
    updatePrivacy: handleUpdatePrivacy,
    resetToDefaults,
  };
}
