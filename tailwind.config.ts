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

/**
 * Theme-registry color: a Tailwind v3 "function color". With no alpha modifier
 * Tailwind passes `opacityValue = 'var(--tw-*-opacity)'` — we return the plain
 * `var()` (byte-identical CSS to a string color, zero regression). With a
 * modifier (`bg-surface-card/90`) it passes the number — we wrap in
 * `color-mix()` so alpha works over hex/rgba CSS variables (which `<alpha-value>`
 * substitution cannot do). Chrome 111+/Safari 16.2+ — fine for this app.
 */
const themed = (cssVar: string) =>
    (({ opacityValue }: { opacityValue?: string }) =>
        opacityValue === undefined || opacityValue.startsWith('var(')
            ? `var(${cssVar})`
            : `color-mix(in srgb, var(${cssVar}) calc(${opacityValue} * 100%), transparent)`) as unknown as string;

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
                // Dynamic Staff Accent Theme:
                'accent-bg': themed('--ds-color-accent-bg'),
                'accent-hover': themed('--ds-color-accent-hover'),
                'accent-light': themed('--ds-color-accent-light'),
                'accent-border': themed('--ds-color-accent-border'),
                'accent-text': themed('--ds-color-accent-text'),
                'accent-shadow': themed('--ds-color-accent-shadow'),
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
                'text-default': themed('--ds-color-text-primary'),
                'text-muted': themed('--ds-color-text-secondary'),
                'text-soft': themed('--ds-color-text-soft'),
                'text-faint': themed('--ds-color-text-faint'),
                'surface-canvas': themed('--ds-color-background-canvas'),
                'surface-card': themed('--ds-color-background-surface'),
                'surface-sunken': themed('--ds-color-surface-sunken'),
                // Interaction wash (row hover) — lighter than card on dark,
                // canvas-toned on light. The codemod target for hover:bg-gray-50.
                'surface-hover': themed('--ds-color-surface-hover'),
                // Tracks / skeletons / avatar placeholders (≈ gray-200).
                'surface-strong': themed('--ds-color-surface-strong'),
                // Inverted chrome — dark pills/action bars/headers that must
                // stay distinct-but-themed (mid-slate on dark, near-black on
                // light). Text on them = text-inverse / text-inverse-soft.
                'surface-inverse': themed('--ds-color-surface-inverse'),
                'surface-inverse-hover': themed('--ds-color-surface-inverse-hover'),
                // Chip resting ON an inverse bar (≈ gray-700 fill).
                'surface-inverse-raised': themed('--ds-color-surface-inverse-raised'),
                // Muted standalone dark fill (≈ gray-600 fill).
                'surface-inverse-soft': themed('--ds-color-surface-inverse-soft'),
                'text-inverse': themed('--ds-color-text-inverse'),
                'text-inverse-soft': themed('--ds-color-text-inverse-soft'),
                // ── Fixed, scheme-INDEPENDENT stage/overlay vocabulary ──
                // These are deliberately identical in every theme (plain hex, so
                // Tailwind's native alpha modifiers work: bg-scrim/40, bg-glass/10).
                // scrim  — modal/photo backdrop washes (was bg-black/NN, bg-gray-900/NN)
                // glass  — light glass highlight on colored/dark fills (was bg-white/5..40)
                // stage  — immersive media chrome: camera viewfinders, photo
                //          lightboxes, fullscreen scanners. Always dark, in every
                //          theme — the stage serves the media, not the palette.
                scrim: '#020617',
                glass: '#ffffff',
                stage: {
                    DEFAULT: '#000000', // viewfinder / lightbox backdrop
                    raised: '#1f2937', // control pills on the stage (≈ gray-800)
                    soft: '#d1d5db', // secondary text/icons on the stage (≈ gray-300)
                    contrast: '#ffffff', // shutter buttons / max-contrast elements
                },
                'border-soft': themed('--ds-color-border-subtle'),
                'border-default': themed('--ds-color-border-default'),
                // Near-invisible hairlines (≈ border-gray-100).
                'border-hairline': themed('--ds-color-border-hairline'),
                // Emphasis border (≈ gray-400: dashed drop-zones, dotted underlines).
                'border-emphasis': themed('--ds-color-border-emphasis'),
                // Max-emphasis border (≈ gray-900 selection outlines).
                'border-strong': themed('--ds-color-border-strong'),
                // Border on inverted chrome (≈ gray-700 on a gray-900 bar).
                'border-inverse': themed('--ds-color-border-inverse'),
                // Functional tones — status pills/badges:
                // bg-surface-success + text-text-success + border-border-success.
                'text-success': themed('--ds-color-text-success'),
                'text-warning': themed('--ds-color-text-warning'),
                'text-danger': themed('--ds-color-text-danger'),
                'text-accent': themed('--ds-color-text-accent'),
                'surface-success': themed('--ds-color-surface-success'),
                'surface-warning': themed('--ds-color-surface-warning'),
                'surface-danger': themed('--ds-color-surface-danger'),
                'surface-accent': themed('--ds-color-surface-accent'),
                'border-success': themed('--ds-color-border-success'),
                'border-warning': themed('--ds-color-border-warning'),
                'border-danger': themed('--ds-color-border-danger'),
                'border-accent': themed('--ds-color-border-accent'),
                // Extended tone text (dashboard categories / informational accents).
                'text-info': themed('--ds-color-text-info'),
                'text-fulfillment': themed('--ds-color-text-fulfillment'),
                // Solid tone fills — progress bars, accent lines, saturated
                // indicators (bg-fill-info, …). Themed per palette.
                'fill-info': themed('--ds-color-fill-info'),
                'fill-success': themed('--ds-color-fill-success'),
                'fill-warning': themed('--ds-color-fill-warning'),
                'fill-danger': themed('--ds-color-fill-danger'),
                'fill-fulfillment': themed('--ds-color-fill-fulfillment'),
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
