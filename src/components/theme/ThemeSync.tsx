'use client';

import { useEffect } from 'react';
import { useStaffPreferences } from '@/hooks/useStaffPreferences';
import { applyTheme, applyAccentTheme } from '@/lib/theme/theme';
import { useAuth } from '@/contexts/AuthContext';
import { getStaffThemeById } from '@/utils/staff-colors';
import { useStaffColorVersion } from '@/contexts/StaffColorsProvider';

/**
 * Bridges the server-backed staff_preferences `theme` to the live `data-theme`
 * attribute, and the staff accent color to the `theme-${accent}` class.
 * Mount once inside the authenticated tree (beside ScanHotkeySync).
 */
export function ThemeSync() {
  const { prefs } = useStaffPreferences();
  const { user } = useAuth();
  const colorVersion = useStaffColorVersion();

  useEffect(() => {
    if (!prefs) return; // server prefs not loaded yet — keep the boot value
    applyTheme(prefs.theme ?? 'light');
  }, [prefs]);

  useEffect(() => {
    if (user?.staffId) {
      const theme = getStaffThemeById(user.staffId);
      applyAccentTheme(theme);
    } else {
      applyAccentTheme('blue'); // fallback theme
    }
  }, [user?.staffId, colorVersion]);

  return null;
}
