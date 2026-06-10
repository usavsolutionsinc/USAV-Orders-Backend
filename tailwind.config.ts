import type { Config } from "tailwindcss";
import { zIndex } from "./src/design-system/tokens/z-index";

// Expose the centralized z-index scale as semantic Tailwind utilities
// (z-panel, z-modal, z-popover, z-toast, z-tooltip, …) so components stop
// reaching for arbitrary z-[NNN] values. Maps numeric tokens → string scale.
const zIndexScale = Object.fromEntries(
    Object.entries(zIndex).map(([name, value]) => [name, String(value)]),
);

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/design-system/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/utils/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                // USAV brand navy
                navy: {
                    50:  '#f0f4fb',
                    100: '#dde6f5',
                    200: '#bacbeb',
                    300: '#8ca7db',
                    400: '#5b7fc8',
                    500: '#3a60b5',
                    600: '#2a4d9a',
                    700: '#1a3a6b',
                    800: '#0f1f3d',
                    900: '#0c1b33',
                },
                // Semantic aliases bound to design-system CSS variables.
                // Dark mode swaps via [data-theme='dark'] in globals.css.
                'text-default': 'var(--ds-color-text-primary)',
                'text-muted': 'var(--ds-color-text-secondary)',
                'surface-canvas': 'var(--ds-color-background-canvas)',
                'surface-card': 'var(--ds-color-background-surface)',
                'border-soft': 'var(--ds-color-border-subtle)',
            },
            fontFamily: {
                sans: ['var(--ds-font-sans)', 'DM Sans', 'Inter', 'system-ui', 'sans-serif'],
                mono: ['var(--ds-font-mono)', 'SFMono-Regular', 'SF Mono', 'Consolas', 'monospace'],
            },
            fontSize: {
                // Sub-12px scale used pervasively in station/sidebar UI.
                // `mini` and `eyebrow` are the uppercase-tracker patterns
                // (font-black uppercase tracking-widest) — not general body text.
                mini: ['8px', { lineHeight: '1.2' }],
                eyebrow: ['9px', { lineHeight: '1.2' }],
                micro: ['10px', { lineHeight: '1.2' }],
                caption: ['11px', { lineHeight: '1.3' }],
                label: ['12px', { lineHeight: '1.4' }],
            },
            borderRadius: {
                station: '8px',
            },
            zIndex: zIndexScale,
        },
    },
    plugins: [],
};
export default config;
