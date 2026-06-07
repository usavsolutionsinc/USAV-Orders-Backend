'use client';

import { useEffect } from 'react';
import { applyAppearance } from '@/lib/settings/appearance';

/**
 * Mounted once at the root layout — applies the saved Appearance settings
 * (density, font scale) to the document on every app load so a user's
 * preferences persist across reloads.
 */
export function AppearanceApplier() {
  useEffect(() => { applyAppearance(); }, []);
  return null;
}
