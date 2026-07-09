import type { ThemePalette } from './registry';

/**
 * Cyberpunk — neon violet dark. Deep violet-black canvas, electric functional
 * tones, magenta fallback accent. All neon text sits on near-black, so AA
 * contrast is comfortably met despite the saturation. `scheme: 'dark'`
 * inherits the raw-neutral remap + dark staff-accent overrides.
 */
export const cyberpunkPalette: ThemePalette = {
  name: 'cyberpunk',
  label: 'Cyberpunk',
  hint: 'Neon violet dark — electric accents on near-black.',
  scheme: 'dark',
  preview: { canvas: '#0a0716', card: '#140f26', accent: '#d946ef', text: '#f2ecff' },
  page: { background: '#0a0716', foreground: '#e6defc' },
  vars: {
    // Neutral chrome — violet-cast
    'text-primary': '#f2ecff',
    'text-secondary': '#c9bfe8',
    'text-soft': '#9d8fd0',
    'text-faint': '#746799',
    'background-canvas': '#0a0716',
    'background-surface': '#140f26',
    'surface-sunken': '#1e1836',
    'surface-hover': '#1e1836',
    'surface-strong': '#2d2450',
    'surface-inverse': '#2d2450',
    'surface-inverse-hover': '#3a2f66',
    'surface-inverse-raised': '#453a75',
    'surface-inverse-soft': '#55488c',
    'text-inverse': '#f2ecff',
    'text-inverse-soft': '#c9bfe8',
    'border-subtle': '#251d44',
    'border-default': '#352a5e',
    'border-hairline': '#1e1836',
    'border-emphasis': '#8578b8',
    'border-strong': '#c9bfe8',
    'border-inverse': '#453a75',
    // Functional tones — neon over low-alpha glows
    'text-success': '#4af2a1',
    'text-warning': '#ffb14d',
    'text-danger': '#ff5c8a',
    'text-accent': '#67e8f9',
    'surface-success': 'rgba(74, 242, 161, 0.13)',
    'surface-warning': 'rgba(255, 177, 77, 0.13)',
    'surface-danger': 'rgba(255, 92, 138, 0.14)',
    'surface-accent': 'rgba(103, 232, 249, 0.12)',
    'border-success': 'rgba(74, 242, 161, 0.32)',
    'border-warning': 'rgba(255, 177, 77, 0.32)',
    'border-danger': 'rgba(255, 92, 138, 0.32)',
    'border-accent': 'rgba(103, 232, 249, 0.32)',
    // Extended tone text
    'text-info': '#7dd3fc',
    'text-fulfillment': '#d8b4fe',
    // Solid fills
    'fill-info': '#38bdf8',
    'fill-success': '#2fe08d',
    'fill-warning': '#ff9f2e',
    'fill-danger': '#ff5c8a',
    'fill-fulfillment': '#c084fc',
  },
  accent: {
    bg: '#d946ef',
    hover: '#e879f9',
    light: 'rgba(217, 70, 239, 0.15)',
    border: 'rgba(217, 70, 239, 0.3)',
    text: '#e879f9',
    shadow: 'rgba(217, 70, 239, 0.05)',
  },
};
