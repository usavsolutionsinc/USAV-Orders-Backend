'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addPin,
  addRecent,
  clearRecents,
  getRecents,
  getSettings,
  isPinned,
  removePin,
  renamePin,
  reorderPins,
  setSettings,
} from './storage';
import type {
  PinnedPage,
  QuickAccessSettings,
  RecentVisit,
} from './types';

const STORAGE_EVENT_KEY = 'usav.quickAccess.changed';

function emitChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY));
}

/**
 * React hook for Quick Access state. Reads from localStorage, subscribes to
 * cross-component change events, and returns mutation helpers. All mutations
 * persist immediately and broadcast so every mounted instance re-renders.
 */
export function useQuickAccess() {
  const [settings, setSettingsState] = useState<QuickAccessSettings>(() => getSettings());
  const [recents, setRecentsState] = useState<RecentVisit[]>(() => getRecents());

  useEffect(() => {
    const sync = () => {
      setSettingsState(getSettings());
      setRecentsState(getRecents());
    };
    window.addEventListener(STORAGE_EVENT_KEY, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(STORAGE_EVENT_KEY, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<QuickAccessSettings>) => {
    setSettingsState(setSettings(patch));
    emitChanged();
  }, []);

  const pin = useCallback((input: { label: string; href: string; iconKey?: string }) => {
    const { settings: next, result } = addPin(input);
    setSettingsState(next);
    emitChanged();
    return result;
  }, []);

  const unpin = useCallback((id: string) => {
    setSettingsState(removePin(id));
    emitChanged();
  }, []);

  const rename = useCallback((id: string, label: string) => {
    setSettingsState(renamePin(id, label));
    emitChanged();
  }, []);

  const reorder = useCallback((orderedIds: string[]) => {
    setSettingsState(reorderPins(orderedIds));
    emitChanged();
  }, []);

  const recordVisit = useCallback((visit: RecentVisit) => {
    setRecentsState(addRecent(visit));
  }, []);

  const wipeRecents = useCallback(() => {
    clearRecents();
    setRecentsState([]);
  }, []);

  return {
    settings,
    recents,
    pinnedByHref: (href: string): PinnedPage | null =>
      settings.pinned.find((p) => p.href === href) ?? null,
    isHrefPinned: (href: string) => settings.pinned.some((p) => p.href === href),
    isPinnedSync: isPinned,
    updateSettings,
    pin,
    unpin,
    rename,
    reorder,
    recordVisit,
    wipeRecents,
  };
}
