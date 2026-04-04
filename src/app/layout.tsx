'use client';

import "./globals.css";
import Providers from "../components/Providers";
import { ResponsiveLayout } from "../components/layout/ResponsiveLayout";
import { HeaderProvider } from "../contexts/HeaderContext";
import { FbaWorkspaceProvider } from "../contexts/FbaWorkspaceContext";
import { designTokenStyleText } from '@/styles/tokens';
import { OfflineBanner } from "../components/station/OfflineBanner";
import { InstallPrompt } from "../components/station/InstallPrompt";

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {

    return (
        <html lang="en">
            <head>
                <title>USAV Solutions</title>
                <meta name="description" content="USAV Solutions — Station Operations" />
                <link rel="icon" type="image/png" href="/favicon.png" />
                {/* PWA */}
                <link rel="manifest" href="/manifest.json" />
                <meta name="application-name" content="USAV Solutions" />
                {/* NOTE: apple-mobile-web-app-capable removed — iOS standalone mode blocks getUserMedia (camera).
                    Using minimal-ui in manifest.json instead so camera/barcode scanning works. */}
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="USAV" />
                <meta name="theme-color" content="#0f1f3d" />
                <meta name="mobile-web-app-capable" content="yes" />
                {/* Viewport — cover notch, prevent zoom on input focus */}
                <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
                <style id="app-design-tokens">{designTokenStyleText}</style>
            </head>
            <body className="antialiased" style={{ margin: 0, padding: 0, overflow: 'hidden', height: '100vh' }}>
                <OfflineBanner />
                <Providers>
                    <HeaderProvider>
                        <FbaWorkspaceProvider>
                            <ResponsiveLayout>
                                {children}
                            </ResponsiveLayout>
                        </FbaWorkspaceProvider>
                    </HeaderProvider>
                </Providers>
                <InstallPrompt />
            </body>
        </html>
    );
}
