/**
 * PostHog analytics — thin, no-op-by-default client wrapper.
 *
 * Telemetry is OPT-IN via env. Until `NEXT_PUBLIC_POSTHOG_KEY` is provisioned,
 * every function here is a no-op and `posthog-js` is never imported — so the
 * build and runtime are completely unaffected whether or not the package is
 * installed.
 *
 * Design notes:
 * - `posthog-js` is NOT a dependency. We load it lazily via a dynamic import
 *   guarded by try/catch. The specifier is built at runtime so the bundler
 *   cannot statically resolve (and therefore cannot fail to resolve) it.
 * - The import only ever runs in the browser, and only when a key is set.
 */

'use client';

import { useEffect, useRef } from 'react';

type PostHogLike = {
    init: (key: string, opts: Record<string, unknown>) => void;
    capture: (event: string, props?: Record<string, unknown>) => void;
    identify: (id: string, traits?: Record<string, unknown>) => void;
    group?: (type: string, key: string, traits?: Record<string, unknown>) => void;
};

const POSTHOG_KEY =
    typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_POSTHOG_KEY : undefined;
const POSTHOG_HOST =
    (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_POSTHOG_HOST : undefined) ||
    'https://us.i.posthog.com';

/** True only when a key is configured AND we're in a browser. */
function isEnabled(): boolean {
    return Boolean(POSTHOG_KEY) && typeof window !== 'undefined';
}

let client: PostHogLike | null = null;
let initPromise: Promise<PostHogLike | null> | null = null;

/**
 * Lazily resolve the posthog-js client. Returns null if the key is unset, the
 * package isn't installed, or anything goes wrong — never throws.
 */
async function getClient(): Promise<PostHogLike | null> {
    if (!isEnabled()) return null;
    if (client) return client;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            // Built at runtime so the bundler can't statically resolve (or fail
            // to resolve) the optional dependency at build time.
            const specifier = ['posthog', 'js'].join('-');
            const mod: unknown = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
            const ph = ((mod as { default?: PostHogLike })?.default ?? mod) as PostHogLike;
            if (!ph || typeof ph.init !== 'function') return null;
            ph.init(POSTHOG_KEY as string, {
                api_host: POSTHOG_HOST,
                capture_pageview: true,
                autocapture: false,
                persistence: 'localStorage+cookie',
            });
            client = ph;
            return client;
        } catch {
            // Package absent or init failed — degrade silently to a no-op.
            return null;
        }
    })();

    return initPromise;
}

/** Initialize PostHog. No-op unless NEXT_PUBLIC_POSTHOG_KEY is set. */
export function initPostHog(): void {
    if (!isEnabled()) return;
    void getClient();
}

/** Capture a product/feature-adoption event. No-op when the key is missing. */
export function captureEvent(name: string, props?: Record<string, unknown>): void {
    if (!isEnabled()) return;
    void getClient().then((ph) => {
        try {
            ph?.capture(name, props);
        } catch {
            /* never throw from telemetry */
        }
    });
}

/**
 * Associate the current session with an org (multi-tenant group analytics).
 * No-op when the key is missing.
 */
export function identifyOrg(orgId: string, traits?: Record<string, unknown>): void {
    if (!isEnabled() || !orgId) return;
    void getClient().then((ph) => {
        try {
            // Prefer group analytics for org-level rollups; fall back to identify.
            if (typeof ph?.group === 'function') {
                ph.group('organization', orgId, traits);
            } else {
                ph?.identify(orgId, traits);
            }
        } catch {
            /* never throw from telemetry */
        }
    });
}

/**
 * Fire a `feature_used` event at most once per browser session per feature.
 * Provided for later wiring; not currently mounted on any hot page.
 */
export function useCaptureFeatureUse(feature: string): void {
    const firedRef = useRef(false);
    useEffect(() => {
        if (!feature || firedRef.current) return;
        if (!isEnabled()) return;
        const sessionKey = `ph_feature_used:${feature}`;
        try {
            if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) {
                firedRef.current = true;
                return;
            }
            captureEvent('feature_used', { feature });
            firedRef.current = true;
            sessionStorage?.setItem(sessionKey, '1');
        } catch {
            // sessionStorage may be unavailable; still fire once per mount.
            if (!firedRef.current) {
                captureEvent('feature_used', { feature });
                firedRef.current = true;
            }
        }
    }, [feature]);
}
