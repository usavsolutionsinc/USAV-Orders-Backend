import type { ThemePalette } from './registry';

/**
 * Mono — strict grayscale (zinc family, no blue cast). Chrome, identity
 * accents, and informational tones all collapse to neutral; ONLY the
 * success / warning / danger triad keeps a deep, desaturated hue — on a
 * warehouse floor, status color is safety information, not decoration.
 *
 * The `accent` block deliberately collapses the per-staff accent to near-black
 * (it outranks `.theme-<accent>` by specificity) — choosing mono means
 * choosing monochrome.
 */
export const monoPalette: ThemePalette = {
  name: 'mono',
  label: 'Mono',
  hint: 'Strict grayscale — quiet, print-like.',
  scheme: 'light',
  preview: { canvas: '#fafafa', card: '#ffffff', accent: '#18181b', text: '#18181b' },
  page: { background: '#fafafa', foreground: '#18181b' },
  vars: {
    // Neutral chrome (zinc — a true gray, distinct from light's cool slate)
    'text-primary': '#18181b',
    'text-secondary': '#52525b',
    'text-soft': '#6b6b74', // ≥4.5 on card AND the sunken wash (contrast-audited)
    'text-faint': '#82828b', // ≥3.0 on card (decorative tier)
    'background-canvas': '#fafafa',
    'background-surface': '#ffffff',
    'surface-sunken': '#f4f4f5',
    'surface-hover': '#f4f4f5',
    'surface-strong': '#e4e4e7',
    'surface-inverse': '#18181b',
    'surface-inverse-hover': '#3f3f46',
    'surface-inverse-raised': '#52525b',
    'surface-inverse-soft': '#71717a',
    'text-inverse': '#fafafa',
    'text-inverse-soft': '#d4d4d8',
    'border-subtle': '#e4e4e7',
    'border-default': '#d4d4d8',
    'border-hairline': '#f4f4f5',
    'border-emphasis': '#a1a1aa',
    'border-strong': '#18181b',
    'border-inverse': '#3f3f46',
    // Functional tones — gray pill fills; deep muted hue lives in the text only
    'text-success': '#166534',
    'text-warning': '#9a3412',
    'text-danger': '#991b1b',
    'text-accent': '#27272a',
    'surface-success': '#f4f4f5',
    'surface-warning': '#f4f4f5',
    'surface-danger': '#f4f4f5',
    'surface-accent': '#f4f4f5',
    'border-success': '#d4d4d8',
    'border-warning': '#d4d4d8',
    'border-danger': '#d4d4d8',
    'border-accent': '#a1a1aa',
    // Extended tone text — informational tones go gray in mono
    'text-info': '#3f3f46',
    'text-fulfillment': '#3f3f46',
    // Solid fills — grayscale except the safety triad
    'fill-info': '#52525b',
    'fill-success': '#166534',
    'fill-warning': '#9a3412',
    'fill-danger': '#991b1b',
    'fill-fulfillment': '#71717a',
  },
  accent: {
    bg: '#18181b',
    hover: '#3f3f46',
    light: '#f4f4f5',
    border: '#e4e4e7',
    text: '#18181b',
    shadow: 'rgba(24, 24, 27, 0.08)',
  },
};
