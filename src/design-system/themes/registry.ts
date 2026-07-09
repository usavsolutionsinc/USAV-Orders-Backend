/**
 * Theme registry — the single source of truth for every color theme.
 *
 * A theme is a complete `ThemePalette`: every `--ds-color-*` custom property
 * the Tailwind semantic aliases consume (see tailwind.config.ts `colors`),
 * plus the page-level `--background` / `--foreground` pair. Adding a theme is
 * a pure configuration exercise:
 *
 *   1. author `themes/<name>.ts` exporting a `ThemePalette` (the `ThemeVars`
 *      Record type forces full coverage — a missing variable is a type error),
 *   2. register it in `THEME_PALETTES` below and widen `ThemeName`,
 *   3. done — the CSS is generated (`themePaletteStyleText`, injected by
 *      app/layout.tsx), the boot script picks it up (src/lib/theme/theme.ts),
 *      and the Appearance settings switcher lists it automatically.
 *
 * Two attributes are stamped on <html> by src/lib/theme/theme.ts:
 *   - `data-theme="<name>"`      → selects the palette's variable block.
 *   - `data-color-scheme="dark"` → set for `scheme: 'dark'` palettes only;
 *     scopes the raw-Tailwind-neutral compatibility remap in
 *     src/styles/globals.css and the dark staff-accent overrides, so ANY
 *     future dark-family theme inherits both for free.
 *
 * Light is the default: represented by the ABSENCE of both attributes, its
 * variables live in the generated `:root` block.
 */

// ── Palette contract ────────────────────────────────────────────────────────

export type ThemeScheme = 'light' | 'dark';

export type ThemeName =
  | 'light'
  | 'dark'
  | 'mono'
  | 'slate'
  | 'paper'
  | 'ember'
  | 'cyberpunk'
  | 'forest';

/**
 * Every theme-varying `--ds-color-*` suffix. Neutrals first (chrome), then the
 * functional tone families (status pills, solid fills). Values are plain CSS
 * colors (hex / rgba).
 */
export const THEME_VAR_KEYS = [
  // Neutral chrome
  'text-primary',
  'text-secondary',
  'text-soft',
  'text-faint',
  'background-canvas',
  'background-surface',
  'surface-sunken',
  'surface-hover',
  'surface-strong',
  // Inverted chrome (dark pills / action bars / headers) + text on it.
  // Ladder: inverse (darkest) → inverse-hover → inverse-raised (chip resting
  // ON an inverse bar) → inverse-soft (muted standalone dark fill ≈ gray-600).
  'surface-inverse',
  'surface-inverse-hover',
  'surface-inverse-raised',
  'surface-inverse-soft',
  'text-inverse',
  'text-inverse-soft',
  'border-subtle',
  'border-default',
  'border-hairline',
  'border-emphasis',
  'border-strong',
  'border-inverse',
  // Functional tones — pastel pill trio (bg-surface-x + text-text-x + border-border-x)
  'text-success',
  'text-warning',
  'text-danger',
  'text-accent',
  'surface-success',
  'surface-warning',
  'surface-danger',
  'surface-accent',
  'border-success',
  'border-warning',
  'border-danger',
  'border-accent',
  // Extended tone text (dashboard categories, informational accents)
  'text-info',
  'text-fulfillment',
  // Solid fills (progress bars, accent lines, saturated indicators)
  'fill-info',
  'fill-success',
  'fill-warning',
  'fill-danger',
  'fill-fulfillment',
] as const;

export type ThemeVarKey = (typeof THEME_VAR_KEYS)[number];

/** Full variable coverage is enforced by the Record type — no partial themes. */
export type ThemeVars = Record<ThemeVarKey, string>;

/** The dynamic staff-accent variable set (`--ds-color-accent-*`). */
export interface AccentVars {
  bg: string;
  hover: string;
  light: string;
  border: string;
  text: string;
  shadow: string;
}

export interface ThemePalette {
  name: ThemeName;
  /** Human name shown in the Appearance switcher. */
  label: string;
  /** One-line description shown under the label in the switcher. */
  hint: string;
  /**
   * Color family. `dark` opts the theme into the raw-neutral compatibility
   * remap + dark staff-accent overrides (via `data-color-scheme="dark"`) and
   * `color-scheme: dark` for native widgets.
   */
  scheme: ThemeScheme;
  /** Swatch colors for the switcher preview chip. */
  preview: { canvas: string; card: string; accent: string; text: string };
  vars: ThemeVars;
  /**
   * Page-level vars consumed by `body` (src/app/globals.css). `background`
   * doubles as the canvas behind transparent rows.
   */
  page: { background: string; foreground: string };
  /**
   * Optional theme-owned staff-accent defaults. When present they are emitted
   * inside the theme's variable block, which OUTRANKS the per-staff
   * `.theme-<accent>` classes (0,1,1 vs 0,1,0) — i.e. the theme "collapses"
   * staff accents (mono does this to stay strictly monochrome). Dark-scheme
   * themes still get per-accent dark overrides at higher specificity, so for
   * them this is only the signed-out / fallback accent. Omit to let the
   * per-staff accent classes win (light, slate).
   */
  accent?: AccentVars;
}

// ── Staff accents (the `theme-<name>` classes) ─────────────────────────────
// One entry per staff accent, with a light and a dark-scheme variant. The
// generator emits `.theme-<name>` (light) and
// `html[data-color-scheme='dark'] .theme-<name>` (any dark-family theme).

export const ACCENT_NAMES = [
  'green',
  'blue',
  'purple',
  'yellow',
  'black',
  'red',
  'lightblue',
  'pink',
] as const;

export type AccentName = (typeof ACCENT_NAMES)[number];

export const STAFF_ACCENTS: Record<AccentName, { light: AccentVars; dark: AccentVars }> = {
  green: {
    light: { bg: '#059669', hover: '#047857', light: '#ecfdf5', border: '#d1fae5', text: '#059669', shadow: 'rgba(5, 150, 105, 0.1)' },
    dark: { bg: '#10b981', hover: '#34d399', light: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)', text: '#34d399', shadow: 'rgba(16, 185, 129, 0.05)' },
  },
  blue: {
    light: { bg: '#2563eb', hover: '#1d4ed8', light: '#eff6ff', border: '#dbeafe', text: '#2563eb', shadow: 'rgba(37, 99, 235, 0.1)' },
    dark: { bg: '#3b82f6', hover: '#60a5fa', light: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.3)', text: '#60a5fa', shadow: 'rgba(59, 130, 246, 0.05)' },
  },
  purple: {
    light: { bg: '#9333ea', hover: '#7e22ce', light: '#faf5ff', border: '#f3e8ff', text: '#9333ea', shadow: 'rgba(147, 51, 234, 0.1)' },
    dark: { bg: '#a855f7', hover: '#c084fc', light: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.3)', text: '#c084fc', shadow: 'rgba(168, 85, 247, 0.05)' },
  },
  yellow: {
    light: { bg: '#f59e0b', hover: '#d97706', light: '#fffbeb', border: '#fef3c7', text: '#d97706', shadow: 'rgba(217, 119, 6, 0.1)' },
    dark: { bg: '#f59e0b', hover: '#fbbf24', light: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)', text: '#fbbf24', shadow: 'rgba(245, 158, 11, 0.05)' },
  },
  black: {
    light: { bg: '#0f172a', hover: '#1e293b', light: '#f8fafc', border: '#e2e8f0', text: '#0f172a', shadow: 'rgba(15, 23, 42, 0.1)' },
    dark: { bg: '#f1f5f9', hover: '#e2e8f0', light: 'rgba(255, 255, 255, 0.05)', border: 'rgba(255, 255, 255, 0.15)', text: '#f1f5f9', shadow: 'rgba(255, 255, 255, 0.02)' },
  },
  red: {
    light: { bg: '#dc2626', hover: '#b91c1c', light: '#fef2f2', border: '#fee2e2', text: '#dc2626', shadow: 'rgba(220, 38, 38, 0.1)' },
    dark: { bg: '#ef4444', hover: '#f87171', light: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', text: '#f87171', shadow: 'rgba(239, 68, 68, 0.05)' },
  },
  lightblue: {
    light: { bg: '#38bdf8', hover: '#0ea5e9', light: '#f0f9ff', border: '#e0f2fe', text: '#0ea5e9', shadow: 'rgba(14, 165, 233, 0.1)' },
    dark: { bg: '#38bdf8', hover: '#7dd3fc', light: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.3)', text: '#7dd3fc', shadow: 'rgba(56, 189, 248, 0.05)' },
  },
  pink: {
    light: { bg: '#ec4899', hover: '#db2777', light: '#fdf2f8', border: '#fce7f3', text: '#ec4899', shadow: 'rgba(236, 72, 153, 0.1)' },
    dark: { bg: '#ec4899', hover: '#f472b6', light: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.3)', text: '#f472b6', shadow: 'rgba(236, 72, 153, 0.05)' },
  },
};

// ── Registry ────────────────────────────────────────────────────────────────

import { lightPalette } from './light';
import { darkPalette } from './dark';
import { monoPalette } from './mono';
import { slatePalette } from './slate';
import { paperPalette } from './paper';
import { emberPalette } from './ember';
import { cyberpunkPalette } from './cyberpunk';
import { forestPalette } from './forest';

export const THEME_PALETTES: Record<ThemeName, ThemePalette> = {
  light: lightPalette,
  dark: darkPalette,
  mono: monoPalette,
  slate: slatePalette,
  paper: paperPalette,
  ember: emberPalette,
  cyberpunk: cyberpunkPalette,
  forest: forestPalette,
};

export const THEME_NAMES = Object.keys(THEME_PALETTES) as ThemeName[];

export const DARK_SCHEME_THEME_NAMES = THEME_NAMES.filter(
  (name) => THEME_PALETTES[name].scheme === 'dark',
);

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in THEME_PALETTES;
}

/** Resolve any stored/user value to a palette; unknown values fall back to light. */
export function resolveTheme(value: unknown): ThemePalette {
  return isThemeName(value) ? THEME_PALETTES[value] : THEME_PALETTES.light;
}

// ── CSS generation ──────────────────────────────────────────────────────────

function varDeclarations(palette: ThemePalette, indent = '  '): string {
  const lines: string[] = [];
  for (const key of THEME_VAR_KEYS) {
    lines.push(`${indent}--ds-color-${key}: ${palette.vars[key]};`);
  }
  if (palette.accent) {
    lines.push(...accentDeclarations(palette.accent, indent));
  }
  lines.push(`${indent}--background: ${palette.page.background};`);
  lines.push(`${indent}--foreground: ${palette.page.foreground};`);
  return lines.join('\n');
}

function accentDeclarations(accent: AccentVars, indent = '  '): string[] {
  return [
    `${indent}--ds-color-accent-bg: ${accent.bg};`,
    `${indent}--ds-color-accent-hover: ${accent.hover};`,
    `${indent}--ds-color-accent-light: ${accent.light};`,
    `${indent}--ds-color-accent-border: ${accent.border};`,
    `${indent}--ds-color-accent-text: ${accent.text};`,
    `${indent}--ds-color-accent-shadow: ${accent.shadow};`,
  ];
}

/**
 * The full generated theme stylesheet, injected once by app/layout.tsx as
 * `<style id="app-theme-palettes">`. Structure (specificity does the rest):
 *
 *   :root { light vars + default (blue) accent }         — 0,1,0
 *   .theme-<accent> { light accent vars }                 — 0,1,0 (later ⇒ wins)
 *   html[data-theme='<name>'] { theme vars }              — 0,1,1 (beats both)
 *   html[data-color-scheme='dark'] .theme-<accent> { … }  — 0,2,1 (dark accents win)
 */
export function themeRegistryCssText(): string {
  const blocks: string[] = [];

  // Light (default) — plain :root, kept below html[data-theme] specificity so
  // any explicit theme wins regardless of stylesheet order.
  blocks.push(
    `:root {\n${varDeclarations(THEME_PALETTES.light)}\n${accentDeclarations(
      STAFF_ACCENTS.blue.light,
    ).join('\n')}\n}`,
  );

  // Staff accent classes — light variants.
  for (const name of ACCENT_NAMES) {
    blocks.push(`.theme-${name} {\n${accentDeclarations(STAFF_ACCENTS[name].light).join('\n')}\n}`);
  }

  // Explicit theme blocks.
  for (const themeName of THEME_NAMES) {
    if (themeName === 'light') continue;
    const palette = THEME_PALETTES[themeName];
    blocks.push(`html[data-theme='${themeName}'] {\n${varDeclarations(palette)}\n}`);
  }

  // Staff accent overrides for every dark-family theme (scoped by scheme, not
  // by theme name, so a future dark theme needs zero extra CSS).
  for (const name of ACCENT_NAMES) {
    blocks.push(
      `html[data-color-scheme='dark'] .theme-${name} {\n${accentDeclarations(
        STAFF_ACCENTS[name].dark,
      ).join('\n')}\n}`,
    );
  }

  // Native widget rendering (scrollbars, date pickers, checkboxes) follows the
  // active scheme.
  blocks.push(`html[data-color-scheme='dark'] { color-scheme: dark; }`);

  return blocks.join('\n\n');
}

export const themePaletteStyleText = themeRegistryCssText();
