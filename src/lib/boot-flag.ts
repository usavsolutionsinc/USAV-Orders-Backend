'use client';

/**
 * One-shot "this navigation is a fresh sign-in" flag.
 *
 * Sign-in sets it immediately before the hard `window.location.assign(...)`
 * redirect; the destination route's BootGate reads-and-clears it to decide
 * whether to hold the loading splash while it warms the page's data. It lives
 * in sessionStorage so it survives the full-document navigation but not a later
 * manual refresh (we don't want to replay the splash on every refresh).
 */
const BOOT_FLAG_KEY = 'usav:boot-splash';

export function armBootSplash(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(BOOT_FLAG_KEY, '1');
  } catch {
    /* private mode / disabled storage — splash just won't hold, no harm */
  }
}

/** Returns true once per arm, clearing the flag so it doesn't fire again. */
export function consumeBootSplash(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const armed = window.sessionStorage.getItem(BOOT_FLAG_KEY) === '1';
    if (armed) window.sessionStorage.removeItem(BOOT_FLAG_KEY);
    return armed;
  } catch {
    return false;
  }
}
