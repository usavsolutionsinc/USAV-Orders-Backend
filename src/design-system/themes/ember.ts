import type { ThemePalette } from './registry';

/**
 * Ember — warm dark. Deep coal-brown canvas, amber-warm text, and an ember
 * orange fallback accent. `scheme: 'dark'` inherits the raw-neutral remap +
 * dark staff-accent overrides.
 */
export const emberPalette: ThemePalette = {
  name: 'ember',
  label: 'Ember',
  hint: 'Warm dark — coal canvas, amber glow.',
  scheme: 'dark',
  preview: { canvas: '#16100c', card: '#211913', accent: '#ff922b', text: '#f7ede4' },
  page: { background: '#16100c', foreground: '#e9dccf' },
  vars: {
    // Neutral chrome — warm coal
    'text-primary': '#f7ede4',
    'text-secondary': '#d8c7b8',
    'text-soft': '#ab9887',
    'text-faint': '#7d6c5b',
    'background-canvas': '#16100c',
    'background-surface': '#211913',
    'surface-sunken': '#2e231a',
    'surface-hover': '#2e231a',
    'surface-strong': '#453626',
    'surface-inverse': '#453626',
    'surface-inverse-hover': '#5a4936',
    'surface-inverse-raised': '#6b573f',
    'surface-inverse-soft': '#7d6749',
    'text-inverse': '#f7ede4',
    'text-inverse-soft': '#d8c7b8',
    'border-subtle': '#32271d',
    'border-default': '#453626',
    'border-hairline': '#2e231a',
    'border-emphasis': '#9c8971',
    'border-strong': '#d8c7b8',
    'border-inverse': '#5a4936',
    // Functional tones — warm-shifted brights over low-alpha embers
    'text-success': '#5ad48b',
    'text-warning': '#ffa94d',
    'text-danger': '#ff8a7a',
    'text-accent': '#e8b380',
    'surface-success': 'rgba(52, 199, 123, 0.15)',
    'surface-warning': 'rgba(255, 146, 43, 0.16)',
    'surface-danger': 'rgba(255, 107, 90, 0.16)',
    'surface-accent': 'rgba(232, 179, 128, 0.16)',
    'border-success': 'rgba(90, 212, 139, 0.30)',
    'border-warning': 'rgba(255, 169, 77, 0.30)',
    'border-danger': 'rgba(255, 138, 122, 0.30)',
    'border-accent': 'rgba(232, 179, 128, 0.30)',
    // Extended tone text
    'text-info': '#93b4fd',
    'text-fulfillment': '#d0a6f8',
    // Solid fills
    'fill-info': '#4c7dfb',
    'fill-success': '#34c77b',
    'fill-warning': '#ff922b',
    'fill-danger': '#ff6b5a',
    'fill-fulfillment': '#b06ef0',
  },
  accent: {
    bg: '#e8590c',
    hover: '#ff7028',
    light: 'rgba(255, 146, 43, 0.15)',
    border: 'rgba(255, 146, 43, 0.3)',
    text: '#ffa94d',
    shadow: 'rgba(255, 146, 43, 0.05)',
  },
};
