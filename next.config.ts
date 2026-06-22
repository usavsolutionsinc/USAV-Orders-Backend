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
    // Remote hosts allowed through the next/image optimizer. The mobile
    // receiving gallery (PhotoGalleryView) renders photos with <Image>, which
    // rejects any un-listed host. NAS photos are served over the Cloudflare
    // Tunnel hostname; legacy receiving photos live in Vercel Blob.
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: 'nas-photos.michaelgarisek.com' },
            { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
            // GCS-backed photos (PHOTOS_GCS_BUCKET: usav-photos-prod / -dev).
            // Without this, next/image throws "hostname not configured" and the
            // mobile photo gallery hits its error boundary.
            { protocol: 'https', hostname: 'storage.googleapis.com', pathname: '/usav-photos-prod/**' },
            { protocol: 'https', hostname: 'storage.googleapis.com', pathname: '/usav-photos-dev/**' },
        ],
    },
    // Allow cross-device dev access through Cloudflare quick tunnels
    // (pnpm dev:tunnel) and LAN IPs. Without this, Next 15+ blocks HMR and
    // dev asset requests from origins other than localhost.
    allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app', '192.168.*', '*.michaelgarisek.com'],
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
    // Phase C of the Products / Inventory / Warehouse rename. /sku-stock is
    // the legacy path; the same content now lives at /inventory. Order matters:
    // longer-prefix rules (e.g. /location) must precede the bare :sku catch.
    async redirects() {
        return [
            { source: '/sku-stock', destination: '/inventory', permanent: true },
            { source: '/sku-stock/location/:path*', destination: '/inventory/location/:path*', permanent: true },
            { source: '/sku-stock/:sku', destination: '/inventory/sku/:sku', permanent: true },
        ];
    },
    serverExternalPackages: [
        '@googleapis/sheets',
        'google-auth-library',
        'googleapis-common',
        'pg',
        'nodemailer',
        'drizzle-orm',
        'drizzle-kit',
        // sharp ships per-platform native binaries + an optional wasm32 fallback;
        // letting webpack bundle it makes the build choke trying to resolve
        // '@img/sharp-wasm32/versions'. Require it at runtime instead.
        'sharp',
        // isomorphic-dompurify pulls in jsdom, which reads data files (e.g.
        // browser/default-stylesheet.css) via __dirname-relative fs calls.
        // Bundling breaks those paths at page-data collection, so keep both
        // external and let Node require them from node_modules at runtime.
        'isomorphic-dompurify',
        'jsdom',
    ],
};

export default withPWA(nextConfig);
