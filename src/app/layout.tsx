import type { Metadata } from "next";
import "./globals.css";

import Providers from "../components/Providers";
import Navigation from "../components/Navigation";

export const metadata: Metadata = {
    title: "USAV Backend",
    description: "USAV Backend",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="antialiased">
                <Providers>
                    <Navigation />
                    {children}
                </Providers>
            </body>
        </html>
    );
}
