'use client';

import "./globals.css";
import Providers from "../components/Providers";
import StationNav from "../components/station/StationNav";
import Header from "../components/Header";
import { HeaderProvider } from "../contexts/HeaderContext";
import { useState } from "react";

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <html lang="en">
            <head>
                <title>USAV Orders Backend</title>
                <meta name="description" content="USAV Orders Management System" />
            </head>
            <body className="antialiased" style={{ margin: 0, padding: 0, overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>
                <Providers>
                    <HeaderProvider>
                        {/* Header Bar */}
                        <Header 
                            onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
                            sidebarOpen={sidebarOpen}
                        />

                        {/* Global Sidebar */}
                        <StationNav isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

                        {/* Main Content */}
                        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', marginTop: '56px' }}>
                            {children}
                        </main>
                    </HeaderProvider>
                </Providers>
            </body>
        </html>
    );
}
