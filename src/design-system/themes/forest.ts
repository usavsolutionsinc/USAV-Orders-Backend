import type { ThemePalette } from './registry';

/**
 * Forest — deep green dark. Pine-black canvas with green-cast neutrals and a
 * moss accent. `scheme: 'dark'` inherits the raw-neutral remap + dark
 * staff-accent overrides.
 */
export const forestPalette: ThemePalette = {
  name: 'forest',
  label: 'Forest',
  hint: 'Deep green dark — pine canvas, moss accents.',
  scheme: 'dark',
  preview: { canvas: '#0b1310', card: '#13201a', accent: '#3fbf75', text: '#ecf5ef' },
  page: { background: '#0b1310', foreground: '#dcebe1' },
  vars: {
    // Neutral chrome — green-cast
    'text-primary': '#ecf5ef',
    'text-secondary': '#c2d5c8',
    'text-soft': '#93ac9c',
    'text-faint': '#66816f',
    'background-canvas': '#0b1310',
    'background-surface': '#13201a',
    'surface-sunken': '#1c2d24',
    'surface-hover': '#1c2d24',
    'surface-strong': '#2b4234',
    'surface-inverse': '#2b4234',
    'surface-inverse-hover': '#3a5443',
    'surface-inverse-raised': '#47634f',
    'surface-inverse-soft': '#567459',
    'text-inverse': '#ecf5ef',
    'text-inverse-soft': '#c2d5c8',
    'border-subtle': '#22362b',
    'border-default': '#2b4234',
    'border-hairline': '#1c2d24',
    'border-emphasis': '#7d9787',
    'border-strong': '#c2d5c8',
    'border-inverse': '#3a5443',
    // Functional tones
    'text-success': '#5fd68f',
    'text-warning': '#f0a44c',
    'text-danger': '#f27d6c',
    'text-accent': '#9ecfae',
    'surface-success': 'rgba(95, 214, 143, 0.14)',
    'surface-warning': 'rgba(240, 164, 76, 0.14)',
    'surface-danger': 'rgba(242, 125, 108, 0.14)',
    'surface-accent': 'rgba(158, 207, 174, 0.14)',
    'border-success': 'rgba(95, 214, 143, 0.30)',
    'border-warning': 'rgba(240, 164, 76, 0.30)',
    'border-danger': 'rgba(242, 125, 108, 0.30)',
    'border-accent': 'rgba(158, 207, 174, 0.30)',
    // Extended tone text
    'text-info': '#85b8f5',
    'text-fulfillment': '#cbaef2',
    // Solid fills
    'fill-info': '#3f8cf2',
    'fill-success': '#37c46f',
    'fill-warning': '#ef8f2b',
    'fill-danger': '#ee6352',
    'fill-fulfillment': '#a877e8',
  },
  accent: {
    bg: '#2f9e5f',
    hover: '#3fbf75',
    light: 'rgba(63, 191, 117, 0.14)',
    border: 'rgba(63, 191, 117, 0.3)',
    text: '#5fd68f',
    shadow: 'rgba(63, 191, 117, 0.05)',
  },
};
