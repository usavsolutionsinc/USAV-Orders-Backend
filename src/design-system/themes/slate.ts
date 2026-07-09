import type { ThemePalette } from './registry';

/**
 * Slate — cool industrial. A deeper steel canvas than light (cards float on a
 * visible slate field), text pulled toward blue-gray, functional tones one
 * step deeper so they hold contrast on the busier canvas.
 *
 * No `accent` block: staff accents apply as in light.
 */
export const slatePalette: ThemePalette = {
  name: 'slate',
  label: 'Slate',
  hint: 'Cool industrial — steel canvas, crisp cards.',
  scheme: 'light',
  preview: { canvas: '#e9eef4', card: '#fbfdfe', accent: '#1e3a5f', text: '#101c2c' },
  page: { background: '#e9eef4', foreground: '#101c2c' },
  vars: {
    // Neutral chrome — steel-shifted slate
    'text-primary': '#101c2c',
    'text-secondary': '#40566e',
    'text-soft': '#53687f', // ≥4.5 on card AND the sunken wash (contrast-audited)
    'text-faint': '#7b91a7', // ≥3.0 on card (decorative tier)
    'background-canvas': '#e9eef4',
    'background-surface': '#fbfdfe',
    'surface-sunken': '#dce5ed',
    'surface-hover': '#eef3f8',
    'surface-strong': '#c9d6e2',
    'surface-inverse': '#1c2b3d',
    'surface-inverse-hover': '#2b3e54',
    'surface-inverse-raised': '#3a4f66',
    'surface-inverse-soft': '#4c637c',
    'text-inverse': '#f3f7fb',
    'text-inverse-soft': '#c3d0dd',
    'border-subtle': '#ccd8e3',
    'border-default': '#aebfd0',
    'border-hairline': '#e2e9f0',
    'border-emphasis': '#8ba0b5',
    'border-strong': '#101c2c',
    'border-inverse': '#3a4f66',
    // Functional tones — one step deeper than light for the busier canvas
    'text-success': '#15803d',
    'text-warning': '#c2410c',
    'text-danger': '#b91c1c',
    'text-accent': '#1e3a5f',
    'surface-success': '#e9f6ee',
    'surface-warning': '#fdf0e4',
    'surface-danger': '#fdeaea',
    'surface-accent': '#e8eef6',
    'border-success': '#4ade80',
    'border-warning': '#fb923c',
    'border-danger': '#f87171',
    'border-accent': '#2c4a70',
    // Extended tone text
    'text-info': '#1d4ed8',
    'text-fulfillment': '#7e22ce',
    // Solid fills
    'fill-info': '#1d4ed8',
    'fill-success': '#15803d',
    'fill-warning': '#ea580c',
    'fill-danger': '#dc2626',
    'fill-fulfillment': '#9333ea',
  },
};
