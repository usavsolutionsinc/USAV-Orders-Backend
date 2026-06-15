import "./globals.css";
import Providers from "../components/Providers";
import { ResponsiveLayout } from "../components/layout/ResponsiveLayout";
import { HeaderProvider } from "../contexts/HeaderContext";
import { FbaWorkspaceProvider } from "../contexts/FbaWorkspaceContext";
import { StudioWorkspaceProvider } from "../components/studio/StudioWorkspaceContext";
import { AuthProvider } from "../contexts/AuthContext";
import { ActivityInboxProvider } from "../contexts/ActivityInboxContext";
import { StaffColorsProvider } from "../contexts/StaffColorsProvider";
import { StaffSwitcherProvider } from "../contexts/StaffSwitcherContext";
import { SwitchStaffSheet } from "../components/auth/SwitchStaffSheet";
import { designTokenStyleText } from '@/styles/tokens';
import { OfflineBanner } from "../components/station/OfflineBanner";
import { InstallPrompt } from "../components/station/InstallPrompt";
import { AppearanceApplier } from "../components/settings/AppearanceApplier";
import { ElectronDragStrip } from "../components/electron/ElectronDragStrip";
import { getInitialAuthUser } from "@/lib/auth/server-session";

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const initialUser = await getInitialAuthUser();

    return (
        <html lang="en">
            <head>
                <title>USAV Solutions</title>
                <meta name="description" content="USAV Solutions — Station Operations" />
                <link rel="icon" type="image/png" href="/favicon.png" />
                {/* PWA */}
                <link rel="manifest" href="/manifest.json" />
                <meta name="application-name" content="USAV Solutions" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="USAV" />
                <meta name="theme-color" content="#ffffff" />
                <meta name="mobile-web-app-capable" content="yes" />
                {/* Viewport — cover notch, prevent zoom on input focus */}
                <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
                <style id="app-design-tokens">{designTokenStyleText}</style>
            </head>
            <body className="antialiased" style={{ margin: 0, padding: 0, overflow: 'hidden', height: '100dvh', minHeight: '100vh', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
                <ElectronDragStrip />
                <OfflineBanner />
                <Providers>
                    <AuthProvider initial={initialUser}>
                        <ActivityInboxProvider>
                        <StaffColorsProvider>
                        <StaffSwitcherProvider>
                            <HeaderProvider>
                                <FbaWorkspaceProvider>
                                    <StudioWorkspaceProvider>
                                        <ResponsiveLayout>
                                            {children}
                                        </ResponsiveLayout>
                                    </StudioWorkspaceProvider>
                                </FbaWorkspaceProvider>
                            </HeaderProvider>
                            <SwitchStaffSheet />
                        </StaffSwitcherProvider>
                        </StaffColorsProvider>
                        </ActivityInboxProvider>
                    </AuthProvider>
                </Providers>
                <InstallPrompt />
                <AppearanceApplier />
            </body>
        </html>
    );
}
