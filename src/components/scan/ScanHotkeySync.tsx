'use client';

import { useEffect } from 'react';
import { useStaffPreferences } from '@/hooks/useStaffPreferences';
import { hydrateHotkey, setHotkeyPersister } from '@/lib/scan-hotkey/store';

/**
 * Bridges the server-backed staff_preferences hotkey to the in-memory scan
 * store. Mount once inside the authenticated tree.
 *
 *   • Hydrates the store from the server binding when it loads (server is the
 *     durable cross-device SoT; the store stayed instant from localStorage).
 *   • Registers the persister so every reassign PUTs back to the server.
 *
 * Renders nothing.
 */
export function ScanHotkeySync() {
  const { prefs, update } = useStaffPreferences();

  // Persist reassigns to the server. update is stable (useCallback).
  useEffect(() => {
    setHotkeyPersister((key) => update({ focusScanHotkey: key }));
    return () => setHotkeyPersister(null);
  }, [update]);

  // Adopt the server value once it arrives.
  useEffect(() => {
    hydrateHotkey(prefs?.focusScanHotkey ?? null);
  }, [prefs?.focusScanHotkey]);

  return null;
}
