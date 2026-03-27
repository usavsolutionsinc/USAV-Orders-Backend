import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Only compile pages when they're actually requested in dev
    experimental: {
        webpackMemoryOptimizations: true,
    },
    // Reduce source map overhead in dev
    productionBrowserSourceMaps: false,
    // Tree-shake server-only packages out of client bundles
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

export default nextConfig;
