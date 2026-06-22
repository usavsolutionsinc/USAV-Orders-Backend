'use client';

import { useEffect } from 'react';
import { useStaffPreferences } from '@/hooks/useStaffPreferences';
import { applyTheme } from '@/lib/theme/theme';

/**
 * Bridges the server-backed staff_preferences `theme` to the live `data-theme`
 * attribute. Mount once inside the authenticated tree (beside ScanHotkeySync).
 *
 * The boot script in <head> already applied the localStorage-cached theme
 * before paint (no flash); this reconciles to the durable cross-device server
 * value once it loads. Absent server value → light (the default).
 *
 * Renders nothing.
 */
export function ThemeSync() {
  const { prefs } = useStaffPreferences();

  useEffect(() => {
    if (!prefs) return; // server prefs not loaded yet — keep the boot value
    applyTheme(prefs.theme ?? 'light');
  }, [prefs]);

  return null;
}
