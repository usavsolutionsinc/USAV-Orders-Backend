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
import { ScanHotkeySync } from "../components/scan/ScanHotkeySync";
import { ThemeSync } from "../components/theme/ThemeSync";
import { AuthenticatedAblyProvider } from "../components/providers/AuthenticatedAblyProvider";
import { AssistantProvider } from "../components/assistant/AssistantProvider";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/theme";
import { BOOT_SPLASH_SCRIPT } from "@/lib/boot-splash-script";
import { designTokenStyleText } from '@/styles/tokens';
import { themePaletteStyleText } from '@/design-system/themes/registry';
import { OfflineBanner } from "../components/layout/OfflineBanner";
import { InstallPrompt } from "../components/station/InstallPrompt";
import { AppearanceApplier } from "../components/settings/AppearanceApplier";
import { ElectronDragStrip } from "../components/electron/ElectronDragStrip";
import { getInitialAuthUser } from "@/lib/auth/server-session";
import { Analytics } from "@vercel/analytics/next";
import { PostHogProvider } from "../components/analytics/PostHogProvider";
import { PRODUCT_NAME } from "@/lib/branding/constants";

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const initialUser = await getInitialAuthUser();
    // Signed-out / first paint: platform brand only. Signed-in: the workspace
    // takes over the tab (per-page "{Page} · {org}" titles are set client-side
    // by each route as they adopt it — see docs/cycle-forge-branding-spec.md §3).
    const documentTitle = initialUser ? initialUser.organizationName : PRODUCT_NAME;

    // suppressHydrationWarning on <html>: THEME_BOOT_SCRIPT (in <head> below)
    // stamps data-theme / data-color-scheme on <html> before hydration to avoid a
    // theme flash, so the SSR markup (no attrs) intentionally differs from the
    // booted DOM. The flag is scoped to this one element's attributes.
    return (
        <html lang="en" className="h-full overflow-hidden" suppressHydrationWarning>
            <head>
                <title>{documentTitle}</title>
                <meta name="description" content={`${PRODUCT_NAME} — Reseller Operations`} />
                <link rel="icon" type="image/png" href="/favicon.png" />
                {/* PWA */}
                <link rel="manifest" href="/manifest.json" />
                <meta name="application-name" content={PRODUCT_NAME} />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content={PRODUCT_NAME} />
                <meta name="theme-color" content="#ffffff" />
                <meta name="mobile-web-app-capable" content="yes" />
                {/* Viewport — cover notch, prevent zoom on input focus */}
                <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
                <style id="app-design-tokens">{designTokenStyleText}</style>
                {/* Generated theme palettes (light/dark/mono/slate + staff
                    accents) from the theme registry — the single owner of every
                    theme-varying --ds-color-* variable. */}
                <style id="app-theme-palettes">{themePaletteStyleText}</style>
                {/* Applies the cached theme before paint (no light→dark flash). */}
                <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
                {/* Paints the loading splash before hydration on a fresh sign-in
                    (one-shot flag), bridging the white gap until <BootGate> mounts
                    its own splash. Without this the dashboard's first paint is a
                    blank shell and the splash flickers off and back on. */}
                <script dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_SCRIPT }} />
            </head>
            <body className="antialiased m-0 overflow-hidden bg-surface-card">
                <ElectronDragStrip />
                {/*
                  Pin the app to the visual viewport. Body must NOT carry safe-area
                  padding or min-height:100vh — both caused first-load gaps (URL bar
                  vs dvh) and clipped the mobile header when nested shells also used
                  100dvh / h-full. Safe areas live on mobile chrome instead.
                */}
                <div id="app-root" className="fixed inset-0 flex min-h-0 flex-col overflow-hidden">
                    <OfflineBanner />
                    <PostHogProvider>
                    <Providers>
                        <AuthProvider initial={initialUser}>
                            <AuthenticatedAblyProvider>
                                <ActivityInboxProvider>
                                <StaffColorsProvider>
                                <StaffSwitcherProvider>
                                    <HeaderProvider>
                                        <FbaWorkspaceProvider>
                                            <StudioWorkspaceProvider>
                                                <AssistantProvider>
                                                    <ResponsiveLayout>
                                                        {children}
                                                    </ResponsiveLayout>
                                                </AssistantProvider>
                                            </StudioWorkspaceProvider>
                                        </FbaWorkspaceProvider>
                                    </HeaderProvider>
                                    <SwitchStaffSheet />
                                    <ScanHotkeySync />
                                    <ThemeSync />
                                </StaffSwitcherProvider>
                                </StaffColorsProvider>
                                </ActivityInboxProvider>
                            </AuthenticatedAblyProvider>
                        </AuthProvider>
                    </Providers>
                    </PostHogProvider>
                </div>
                <InstallPrompt />
                <AppearanceApplier />
                <Analytics />
            </body>
        </html>
    );
}
