'use client';

import { useEffect } from 'react';
import { initPostHog } from '@/lib/analytics/posthog';

/**
 * Mounts PostHog telemetry on the client. Completely inert (renders children,
 * does nothing) unless NEXT_PUBLIC_POSTHOG_KEY is set — and never throws if
 * `posthog-js` isn't installed.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        initPostHog();
    }, []);

    return <>{children}</>;
}
