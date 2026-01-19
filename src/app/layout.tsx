'use client';

import "./globals.css";
import Providers from "../components/Providers";
import StationNav from "../components/station/StationNav";
import { Menu } from "../components/Icons";
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
                    {/* Hamburger Button */}
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className={`fixed top-4 left-4 z-[200] p-2.5 rounded-xl shadow-lg transition-all duration-300 border backdrop-blur-md ${
                            sidebarOpen 
                                ? 'bg-white/10 border-white/20 text-white translate-x-[220px]' 
                                : 'bg-white/80 border-gray-200 text-gray-900 hover:scale-110 hover:bg-white'
                        }`}
                        aria-label="Toggle menu"
                    >
                        <Menu className="w-5 h-5" />
                    </button>

                    {/* Global Sidebar */}
                    <StationNav isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

                    {/* Main Content */}
                    <main style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                        {children}
                    </main>
                </Providers>
            </body>
        </html>
    );
}
