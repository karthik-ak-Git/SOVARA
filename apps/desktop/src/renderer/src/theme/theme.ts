export type ThemePreference = 'light'

/**
 * Sovara is intentionally light-only. Keep the preference seam centralized so
 * the renderer, settings, and native controls never drift apart.
 */
export function applyThemePreference(_preference: ThemePreference = 'light'): 'light' {
  const root = document.documentElement
  root.dataset.theme = 'light'
  root.dataset.themePreference = 'light'
  root.style.colorScheme = 'light'
  return 'light'
}
