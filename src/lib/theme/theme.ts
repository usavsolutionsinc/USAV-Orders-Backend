/**
 * Color-theme application — the runtime half of T2 (dark mode). Pure +
 * framework-agnostic so the boot script, the React sync, and any toggle share
 * one source of truth. The themed values themselves live in
 * src/styles/globals.css (`html[data-theme='dark']`); this only flips the
 * `data-theme` attribute and mirrors it to localStorage for no-flash reloads.
 *
 * Light is the default and is represented by the ABSENCE of the attribute, so
 * existing light users are entirely unaffected.
 */

export const THEME_STORAGE_KEY = 'ds-theme';

export type AppTheme = 'light' | 'dark';

/** Apply a theme to <html> and cache it. `light`/null clears the attribute. */
export function applyTheme(theme: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (theme === 'dark') {
    el.setAttribute('data-theme', 'dark');
  } else {
    el.removeAttribute('data-theme');
  }
  try {
    if (theme === 'dark') localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* private mode / storage disabled — attribute is still applied */
  }
}

/**
 * Inline boot script (runs in <head> before first paint) — applies the cached
 * theme so a returning dark-mode staffer never sees a light flash before the
 * React sync hydrates from the server. Kept tiny and dependency-free.
 */
export const THEME_BOOT_SCRIPT =
  `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}`;
