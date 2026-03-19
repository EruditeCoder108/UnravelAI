import { create } from 'zustand';

export interface NotificationSettings {
  sound: boolean;
  email: boolean;
  push: boolean;
  frequency: 'immediate' | 'digest' | 'weekly';
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'system';
  accent: string;
  fontSize: number;
}

export interface PrivacySettings {
  showOnline: boolean;
  shareAnalytics: boolean;
}

export interface UserPreferences {
  theme: ThemeSettings;
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  language: string;
}

interface PreferenceState {
  preferences: UserPreferences;
  isDirty: boolean;
  updateNotifications: (updates: Partial<NotificationSettings>) => void;
  updateTheme: (updates: Partial<ThemeSettings>) => void;
  updatePrivacy: (updates: Partial<PrivacySettings>) => void;
  resetToDefaults: () => void;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: { mode: 'system', accent: '#6366f1', fontSize: 14 },
  notifications: { sound: true, email: true, push: false, frequency: 'immediate' },
  privacy: { showOnline: true, shareAnalytics: false },
  language: 'en',
};

export const usePreferenceStore = create<PreferenceState>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  isDirty: false,

  updateNotifications: (updates) =>
    set((state) => {
      const next = { ...state.preferences };
      Object.assign(next.notifications, updates);
      return { preferences: next, isDirty: true };
    }),

  updateTheme: (updates) =>
    set((state) => ({
      preferences: {
        ...state.preferences,
        theme: { ...state.preferences.theme, ...updates },
      },
      isDirty: true,
    })),

  updatePrivacy: (updates) =>
    set((state) => {
      const next = { ...state.preferences };
      Object.assign(next.privacy, updates);
      return { preferences: next, isDirty: true };
    }),

  resetToDefaults: () =>
    set({
      preferences: structuredClone(DEFAULT_PREFERENCES),
      isDirty: false,
    }),
}));
