import type { Metadata } from "next";
import "./globals.css";
import Providers from "../components/Providers";
import Navigation from "../components/Navigation";

export const metadata: Metadata = {
    title: "USAV Orders Backend",
    description: "USAV Orders Management System",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="antialiased" style={{ margin: 0, padding: 0, overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>
                <Providers>
                    <Navigation />
                    <main style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                        {children}
                    </main>
                </Providers>
            </body>
        </html>
    );
}
