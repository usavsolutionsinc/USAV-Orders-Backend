import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
    dest: "public",
    cacheOnFrontEndNav: true,
    aggressiveFrontEndNavCaching: true,
    reloadOnOnline: true,
    disable: process.env.NODE_ENV === "development",
    // Served when a navigation request fails AND we have no cached version of
    // the target route. Mostly relevant for receivers/pickers walking out of
    // Wi-Fi range. The shell + last-cached responses still render.
    fallbacks: {
        document: "/offline",
    },
    workboxOptions: {
        disableDevLogs: true,
        runtimeCaching: [
            {
                urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                handler: "CacheFirst",
                options: { cacheName: "google-fonts", expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 } },
            },
            {
                urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                handler: "CacheFirst",
                options: { cacheName: "gstatic-fonts", expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 } },
            },
            {
                urlPattern: /\/api\/(?!auth).*/i,
                handler: "NetworkFirst",
                options: { cacheName: "api-cache", networkTimeoutSeconds: 10, expiration: { maxEntries: 128, maxAgeSeconds: 24 * 60 * 60 } },
            },
        ],
    },
});

const nextConfig: NextConfig = {
    turbopack: {},
    outputFileTracingRoot: process.cwd(),
    experimental: {
        webpackMemoryOptimizations: true,
        optimizePackageImports: [
            'framer-motion',
            'lucide-react',
            'sonner',
            'date-fns',
            'date-fns-tz',
            '@dnd-kit/core',
            '@dnd-kit/sortable',
            '@dnd-kit/utilities',
            '@tanstack/react-query',
            'react-markdown',
        ],
    },
    productionBrowserSourceMaps: false,
    serverExternalPackages: [
        '@googleapis/sheets',
        'google-auth-library',
        'googleapis-common',
        'pg',
        'nodemailer',
        'drizzle-orm',
        'drizzle-kit',
    ],
};

export default withPWA(nextConfig);
