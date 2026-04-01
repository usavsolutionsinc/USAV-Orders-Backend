import type { Config } from "tailwindcss";

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
            },
            fontFamily: {
                sans: ['var(--ds-font-sans)', 'DM Sans', 'Inter', 'system-ui', 'sans-serif'],
                mono: ['var(--ds-font-mono)', 'SFMono-Regular', 'SF Mono', 'Consolas', 'monospace'],
            },
            borderRadius: {
                station: '8px',
            },
        },
    },
    plugins: [],
};
export default config;
