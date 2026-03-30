'use client';

import "./globals.css";
import Providers from "../components/Providers";
import { ResponsiveLayout } from "../components/layout/ResponsiveLayout";
import { HeaderProvider } from "../contexts/HeaderContext";
import { FbaWorkspaceProvider } from "../contexts/FbaWorkspaceContext";
import { designTokenStyleText } from '@/styles/tokens';

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {

    return (
        <html lang="en">
            <head>
                <title>USAV Orders Backend</title>
                <meta name="description" content="USAV Orders Management System" />
                <link rel="icon" type="image/png" href="/favicon.png" />
                <style id="app-design-tokens">{designTokenStyleText}</style>
            </head>
            <body className="antialiased" style={{ margin: 0, padding: 0, overflow: 'hidden', height: '100vh' }}>
                <Providers>
                    <HeaderProvider>
                        <FbaWorkspaceProvider>
                            <ResponsiveLayout>
                                {children}
                            </ResponsiveLayout>
                        </FbaWorkspaceProvider>
                    </HeaderProvider>
                </Providers>
            </body>
        </html>
    );
}
