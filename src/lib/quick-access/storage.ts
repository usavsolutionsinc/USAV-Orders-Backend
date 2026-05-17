/**
 * localStorage adapters for the Quick Access feature. Two keys:
 *   - `usav.quickAccess`        — settings + pinned pages (written rarely)
 *   - `usav.quickAccessRecent`  — recent visits (written on every navigation)
 *
 * Recents live in their own key so a page navigation doesn't have to
 * serialize the full settings + pinned list on each write.
 */

import {
  MAX_PINS,
  MAX_RECENTS,
  type PinnedPage,
  type QuickAccessSettings,
  type RecentVisit,
} from './types';

const SETTINGS_KEY = 'usav.quickAccess';
const RECENTS_KEY = 'usav.quickAccessRecent';

export const DEFAULT_SETTINGS: QuickAccessSettings = {
  version: 1,
  enabled: true,
  hotkey: 'cmdk',
  showRecent: true,
  actions: {
    phoneHistory: true,
    installDesktopApp: true,
  },
  pinned: [],
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private-mode — ignore */
  }
}

export function getSettings(): QuickAccessSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  const parsed = safeParse<Partial<QuickAccessSettings>>(raw, {});
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    version: 1,
    actions: { ...DEFAULT_SETTINGS.actions, ...(parsed.actions ?? {}) },
    pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
  };
}

export function setSettings(patch: Partial<QuickAccessSettings>): QuickAccessSettings {
  const next: QuickAccessSettings = {
    ...getSettings(),
    ...patch,
    version: 1,
    actions: { ...getSettings().actions, ...(patch.actions ?? {}) },
  };
  safeWrite(SETTINGS_KEY, next);
  return next;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `pin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isPinned(href: string): boolean {
  return getSettings().pinned.some((p) => p.href === href);
}

export function findPinByHref(href: string): PinnedPage | null {
  return getSettings().pinned.find((p) => p.href === href) ?? null;
}

export function addPin(input: { label: string; href: string; iconKey?: string }): { settings: QuickAccessSettings; result: 'added' | 'duplicate' | 'full' } {
  const current = getSettings();
  if (current.pinned.some((p) => p.href === input.href)) {
    return { settings: current, result: 'duplicate' };
  }
  if (current.pinned.length >= MAX_PINS) {
    return { settings: current, result: 'full' };
  }
  const pin: PinnedPage = {
    id: makeId(),
    label: input.label.trim() || input.href,
    href: input.href,
    iconKey: input.iconKey,
    addedAt: Date.now(),
  };
  return {
    settings: setSettings({ pinned: [pin, ...current.pinned] }),
    result: 'added',
  };
}

export function removePin(id: string): QuickAccessSettings {
  const current = getSettings();
  return setSettings({ pinned: current.pinned.filter((p) => p.id !== id) });
}

export function renamePin(id: string, label: string): QuickAccessSettings {
  const current = getSettings();
  return setSettings({
    pinned: current.pinned.map((p) => (p.id === id ? { ...p, label: label.trim() || p.label } : p)),
  });
}

export function reorderPins(orderedIds: string[]): QuickAccessSettings {
  const current = getSettings();
  const map = new Map(current.pinned.map((p) => [p.id, p]));
  const reordered: PinnedPage[] = [];
  for (const id of orderedIds) {
    const pin = map.get(id);
    if (pin) {
      reordered.push(pin);
      map.delete(id);
    }
  }
  // Append any pins that weren't in the orderedIds list (defensive)
  for (const remaining of map.values()) reordered.push(remaining);
  return setSettings({ pinned: reordered });
}

// ─── Recents ────────────────────────────────────────────────────────────────

export function getRecents(): RecentVisit[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(RECENTS_KEY);
  const parsed = safeParse<RecentVisit[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function addRecent(visit: RecentVisit): RecentVisit[] {
  if (typeof window === 'undefined') return [];
  const existing = getRecents().filter((v) => v.href !== visit.href);
  const next = [visit, ...existing].slice(0, MAX_RECENTS);
  safeWrite(RECENTS_KEY, next);
  return next;
}

export function clearRecents(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENTS_KEY);
  } catch {
    /* ignore */
  }
}
