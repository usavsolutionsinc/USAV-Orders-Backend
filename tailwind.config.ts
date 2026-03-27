import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/design-system/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/utils/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
            },
            fontFamily: {
                sans: ['var(--ds-font-sans)', 'DM Sans', 'Inter', 'system-ui', 'sans-serif'],
                mono: ['var(--ds-font-mono)', 'SFMono-Regular', 'SF Mono', 'Consolas', 'monospace'],
            },
        },
    },
    plugins: [],
};
export default config;
