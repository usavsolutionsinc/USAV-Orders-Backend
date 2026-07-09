import type { ThemePalette } from './registry';

/**
 * Dark — low-light theme. Values are byte-for-byte the ones previously
 * hand-curated in src/styles/globals.css `html[data-theme='dark']`.
 *
 * `scheme: 'dark'` stamps `data-color-scheme="dark"` on <html>, which scopes
 * the raw-Tailwind-neutral compatibility remap in src/styles/globals.css, the
 * dark staff-accent overrides, and `color-scheme: dark` for native widgets.
 *
 * The `accent` block is the signed-out / fallback accent (blue); per-staff
 * accents win via the generated `html[data-color-scheme='dark'] .theme-*`
 * overrides.
 */
export const darkPalette: ThemePalette = {
  name: 'dark',
  label: 'Dark',
  hint: 'Low-light — easier on the eyes.',
  scheme: 'dark',
  preview: { canvas: '#020617', card: '#0f172a', accent: '#3b82f6', text: '#f8fafc' },
  page: { background: '#020617', foreground: '#e2e8f0' },
  vars: {
    // Neutral chrome
    'text-primary': '#f8fafc',
    'text-secondary': '#cbd5e1',
    'text-soft': '#94a3b8',
    'text-faint': '#64748b',
    'background-canvas': '#020617',
    'background-surface': '#0f172a',
    'surface-sunken': '#1e293b',
    'surface-hover': '#1e293b', // hover lightens on dark (mirrors the old remap)
    'surface-strong': '#334155',
    // Inverted chrome stays DISTINCT from the card on dark: mid-slate, exactly
    // what the compatibility remap rewrote gray-900/800 fills to.
    'surface-inverse': '#334155',
    'surface-inverse-hover': '#475569',
    'surface-inverse-raised': '#526079',
    'surface-inverse-soft': '#64748b',
    'text-inverse': '#f1f5f9',
    'text-inverse-soft': '#cbd5e1',
    'border-subtle': '#1e293b',
    'border-default': '#334155',
    'border-hairline': '#1e293b',
    'border-emphasis': '#94a3b8',
    'border-strong': '#cbd5e1', // selection outlines flip light on dark
    'border-inverse': '#475569',
    // Functional tones — text lightens to -400; surfaces/borders become
    // low-alpha hue tints so they read on a dark canvas.
    'text-success': '#4ade80',
    'text-warning': '#fb923c',
    'text-danger': '#f87171',
    'text-accent': '#8ca7db',
    'surface-success': 'rgba(34, 197, 94, 0.15)',
    'surface-warning': 'rgba(249, 115, 22, 0.15)',
    'surface-danger': 'rgba(239, 68, 68, 0.15)',
    'surface-accent': 'rgba(58, 96, 181, 0.18)',
    'border-success': 'rgba(74, 222, 128, 0.30)',
    'border-warning': 'rgba(251, 146, 60, 0.30)',
    'border-danger': 'rgba(248, 113, 113, 0.30)',
    'border-accent': 'rgba(140, 167, 219, 0.30)',
    // Extended tone text — -300 shades (same ramp the neutral remap uses)
    'text-info': '#93c5fd',
    'text-fulfillment': '#d8b4fe',
    // Solid fills — one step brighter than light so they carry on dark
    'fill-info': '#3b82f6',
    'fill-success': '#22c55e',
    'fill-warning': '#fb923c',
    'fill-danger': '#f87171',
    'fill-fulfillment': '#c084fc',
  },
  accent: {
    bg: '#3b82f6',
    hover: '#60a5fa',
    light: 'rgba(59, 130, 246, 0.15)',
    border: 'rgba(59, 130, 246, 0.3)',
    text: '#60a5fa',
    shadow: 'rgba(59, 130, 246, 0.05)',
  },
};
