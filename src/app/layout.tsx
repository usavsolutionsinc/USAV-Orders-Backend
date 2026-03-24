'use client';

import { Suspense } from 'react';
import "./globals.css";
import Providers from "../components/Providers";
import DashboardSidebar from "../components/DashboardSidebar";
import { HeaderProvider } from "../contexts/HeaderContext";
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
                        <div className="flex h-full w-full overflow-hidden">
                            {/* Global Sidebar - Now permanent on the left */}
                            <Suspense fallback={null}>
                                <DashboardSidebar />
                            </Suspense>

                            {/* Main Content Area */}
                            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
                                {/* Optional Header overlay or replacement if needed for panelContent */}
                                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                                    {children}
                                </main>
                            </div>
                        </div>
                    </HeaderProvider>
                </Providers>
            </body>
        </html>
    );
}
