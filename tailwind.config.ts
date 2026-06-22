import type { Config } from "tailwindcss";
// NOTE: the explicit `.ts` extension is required. Next 16's `next dev
// --turbopack` loads this config through Turbopack's PostCSS pipeline, whose
// resolver does NOT try the `.ts` extension when guessing an extensionless
// import — so a bare `./src/.../z-index` raises a non-fatal "Module not found"
// and the z-* utilities silently fail to generate in dev. The `--webpack`
// build (jiti loader) resolves either form. Keep the extension. See tsconfig
// `allowImportingTsExtensions`.
import { zIndex } from "./src/design-system/tokens/z-index.ts";

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
        // src/lib holds styling SoTs (e.g. outbound-state.ts's status dot/pill
        // classes). Without this, classes used ONLY here (e.g. orphan's color)
        // are never generated and render invisible.
        "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
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
                // Convention: the color key carries the role prefix, so usage
                // doubles it — `text-text-default`, `bg-surface-canvas`,
                // `border-border-soft`. Keeps neutral + functional families
                // symmetric. CSS vars are curated in src/styles/globals.css.
                'text-default': 'var(--ds-color-text-primary)',
                'text-muted': 'var(--ds-color-text-secondary)',
                'text-soft': 'var(--ds-color-text-soft)',
                'text-faint': 'var(--ds-color-text-faint)',
                'surface-canvas': 'var(--ds-color-background-canvas)',
                'surface-card': 'var(--ds-color-background-surface)',
                'surface-sunken': 'var(--ds-color-surface-sunken)',
                'border-soft': 'var(--ds-color-border-subtle)',
                'border-default': 'var(--ds-color-border-default)',
                // Functional tones — status pills/badges:
                // bg-surface-success + text-text-success + border-border-success.
                'text-success': 'var(--ds-color-text-success)',
                'text-warning': 'var(--ds-color-text-warning)',
                'text-danger': 'var(--ds-color-text-danger)',
                'text-accent': 'var(--ds-color-text-accent)',
                'surface-success': 'var(--ds-color-surface-success)',
                'surface-warning': 'var(--ds-color-surface-warning)',
                'surface-danger': 'var(--ds-color-surface-danger)',
                'surface-accent': 'var(--ds-color-surface-accent)',
                'border-success': 'var(--ds-color-border-success)',
                'border-warning': 'var(--ds-color-border-warning)',
                'border-danger': 'var(--ds-color-border-danger)',
                'border-accent': 'var(--ds-color-border-accent)',
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
