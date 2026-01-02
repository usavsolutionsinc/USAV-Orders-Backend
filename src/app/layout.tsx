import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "USAV Orders - Google Sheet",
    description: "USAV Orders Management via Google Sheets",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="antialiased" style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
                {children}
            </body>
        </html>
    );
}
