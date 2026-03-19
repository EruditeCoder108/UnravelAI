import { ThemeSettings } from '../store/preferenceStore';

/**
 * Applies theme settings to CSS custom properties on the document root.
 * Called whenever theme preferences change.
 */
export class ThemeService {
  private static applied: ThemeSettings | null = null;

  static apply(theme: ThemeSettings): void {
    if (
      ThemeService.applied &&
      ThemeService.applied.mode === theme.mode &&
      ThemeService.applied.accent === theme.accent &&
      ThemeService.applied.fontSize === theme.fontSize
    ) {
      return; // no-op if settings haven't changed
    }

    document.documentElement.style.setProperty('--color-accent', theme.accent);
    document.documentElement.style.setProperty(
      '--font-size-base',
      `${theme.fontSize}px`
    );

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effectiveMode =
      theme.mode === 'system' ? (prefersDark ? 'dark' : 'light') : theme.mode;
    document.documentElement.setAttribute('data-theme', effectiveMode);

    ThemeService.applied = { ...theme };
    console.debug('[ThemeService] Applied theme:', effectiveMode, theme.accent);
  }

  static reset(): void {
    ThemeService.applied = null;
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--color-accent');
    document.documentElement.style.removeProperty('--font-size-base');
  }
}
