/**
 * Color-theme application — the runtime half of theming. Pure +
 * framework-agnostic so the boot script, the React sync, and any toggle share
 * one source of truth. The themed values live in the theme registry
 * (src/design-system/themes/registry.ts — generated into <head> by
 * app/layout.tsx); this module only flips the `data-theme` /
 * `data-color-scheme` attributes and mirrors the choice to localStorage for
 * no-flash reloads.
 *
 * Light is the default and is represented by the ABSENCE of both attributes,
 * so existing light users are entirely unaffected.
 */

import {
  DARK_SCHEME_THEME_NAMES,
  THEME_NAMES,
  isThemeName,
  resolveTheme,
  type ThemeName,
} from '@/design-system/themes/registry';

export const THEME_STORAGE_KEY = 'ds-theme';

/** Back-compat alias — prefer `ThemeName` from the registry in new code. */
export type AppTheme = ThemeName;

/**
 * Apply a registry theme to <html> and cache it. `light` / null / unknown
 * values clear both attributes (light is the absence of a theme).
 */
export function applyTheme(theme: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  const palette = resolveTheme(theme);

  if (palette.name === 'light') {
    el.removeAttribute('data-theme');
    el.removeAttribute('data-color-scheme');
  } else {
    el.setAttribute('data-theme', palette.name);
    // `data-color-scheme="dark"` scopes the raw-neutral compatibility remap
    // (src/styles/globals.css) + dark staff-accent overrides for EVERY
    // dark-family theme — set from the palette, never hardcoded per theme.
    if (palette.scheme === 'dark') el.setAttribute('data-color-scheme', 'dark');
    else el.removeAttribute('data-color-scheme');
  }

  try {
    if (palette.name === 'light') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, palette.name);
  } catch {
    /* private mode / storage disabled — attributes are still applied */
  }
}

/** Apply an accent theme class to <html> (e.g. `theme-green`). Clears previous theme class. */
export function applyAccentTheme(theme: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  // Remove any existing theme- classes
  for (const className of Array.from(el.classList)) {
    if (className.startsWith('theme-')) {
      el.classList.remove(className);
    }
  }
  if (theme) {
    el.classList.add(`theme-${theme}`);
  }
}

export { isThemeName, THEME_NAMES, type ThemeName };

/**
 * Inline boot script (runs in <head> before first paint) — applies the cached
 * theme so a returning themed staffer never sees a light flash before the
 * React sync hydrates from the server. Kept tiny and dependency-free; the
 * valid-name and dark-scheme lists are inlined from the registry at build
 * time, so a new registered theme needs zero changes here.
 */
export const THEME_BOOT_SCRIPT =
  `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
  `if(t&&t!=='light'&&${JSON.stringify(THEME_NAMES)}.indexOf(t)>-1){` +
  `document.documentElement.setAttribute('data-theme',t);` +
  `if(${JSON.stringify(DARK_SCHEME_THEME_NAMES)}.indexOf(t)>-1){` +
  `document.documentElement.setAttribute('data-color-scheme','dark');}}}catch(e){}`;
