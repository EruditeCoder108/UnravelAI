import React, { useState, useEffect } from 'react';
import { usePreferences } from '../hooks/usePreferences';

/**
 * Settings panel that renders notification, theme, and privacy sections.
 * Each section edits a different slice of UserPreferences.
 */
export function PreferencesPanel({ userId }: { userId: string }) {
  const { preferences, isDirty, updateNotifications, updateTheme, resetToDefaults } =
    usePreferences();

  const [localDraft, setLocalDraft] = useState(preferences.notifications);
  useEffect(() => {
    // Re-sync draft when preferences change externally (e.g. another tab)
    setLocalDraft(preferences.notifications);
  }, [preferences.notifications]);

  function handleSoundToggle() {
    updateNotifications({ sound: !localDraft.sound });
  }

  function handleEmailToggle() {
    updateNotifications({ email: !localDraft.email });
  }

  function handleFrequencyChange(freq: 'immediate' | 'digest' | 'weekly') {
    updateNotifications({ frequency: freq });
  }

  return (
    <div data-testid={`preferences-panel-${userId}`}>
      <div data-testid="notification-section">
        <label>
          <input
            type="checkbox"
            checked={localDraft.sound}
            onChange={handleSoundToggle}
            data-testid="sound-toggle"
          />
          Sound notifications
        </label>
        <label>
          <input
            type="checkbox"
            checked={localDraft.email}
            onChange={handleEmailToggle}
            data-testid="email-toggle"
          />
          Email notifications
        </label>
        <select
          value={localDraft.frequency}
          onChange={(e) =>
            handleFrequencyChange(e.target.value as 'immediate' | 'digest' | 'weekly')
          }
          data-testid="frequency-select"
        >
          <option value="immediate">Immediate</option>
          <option value="digest">Daily digest</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>

      <div data-testid="theme-section">
        <select
          value={preferences.theme.mode}
          onChange={(e) =>
            updateTheme({ mode: e.target.value as 'light' | 'dark' | 'system' })
          }
          data-testid="theme-mode-select"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </div>

      {isDirty && (
        <button onClick={resetToDefaults} data-testid="reset-button">
          Reset to defaults
        </button>
      )}
    </div>
  );
}
