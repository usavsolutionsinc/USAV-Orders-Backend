'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Search, X } from '@/components/Icons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useQuickAccessHotkey } from '@/lib/quick-access/use-hotkey';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Bottom-right Quick Access FAB. Surfaces user-pinned pages, built-in
 * actions (phone history, SKU scan, shipped search), and ⌘K/Ctrl+K
 * keyboard access. Settings toggle on /settings can hide the FAB entirely.
 *
 * The secondary popover slot now hosts the Phone History view, which lists
 * the signed-in staff's most recent packs (from /api/packing-logs/history)
 * and lets them tap to resume in the packer.
 */
export function QuickAccessFab() {
  const pathname = usePathname();
  const { settings, recordVisit } = useQuickAccess();
  const { user: authUser } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const authStaffId = authUser?.staffId ?? null;
  const showStaffChip = settings.showStaffChipOnFab !== false; // default true
  const [staffName, setStaffName] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    if (!authStaffId) { setStaffName(''); return; }
    fetch(`/api/staff?id=${authStaffId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { staff?: { name?: string } } | null) => {
        if (!cancelled && data?.staff?.name) setStaffName(data.staff.name);
      })
      .catch(() => { /* fall back to Search-icon display */ });
    return () => { cancelled = true; };
  }, [authStaffId]);
  const staffChipActive = Boolean(authStaffId && showStaffChip);
  const staffTheme = useMemo(() => (authStaffId ? getStaffThemeById(authStaffId) : null), [authStaffId]);

  // Close everything on route change
  useEffect(() => {
    setMenuOpen(false);
    setHistoryOpen(false);
  }, [pathname]);

  // Capture recent page visits (deduped, last 12) for the recents section.
  useEffect(() => {
    if (!pathname) return;
    const label = typeof document !== 'undefined' ? document.title?.trim() || pathname : pathname;
    recordVisit({ href: pathname, label, visitedAt: Date.now() });
  }, [pathname, recordVisit]);

  // Click-outside dismisses both popovers
  useEffect(() => {
    if (!menuOpen && !historyOpen) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen, historyOpen]);

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => {
      const next = !prev;
      if (next) setHistoryOpen(false);
      return next;
    });
  }, []);

  // ⌘K / Ctrl+K — gated by settings.hotkey
  useQuickAccessHotkey(settings.hotkey === 'cmdk' && settings.enabled, toggleMenu);

  const handleOpenHistory = useCallback(() => {
    setMenuOpen(false);
    setHistoryOpen(true);
  }, []);

  // Hidden only when user explicitly disabled it in settings.
  if (!settings.enabled) return null;

  return (
    <div ref={wrapperRef} className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {menuOpen && (
        <QuickAccessPopover
          onClose={() => setMenuOpen(false)}
          onOpenHistoryPopover={handleOpenHistory}
        />
      )}

      {historyOpen && (
        <PhoneHistoryPopover onClose={() => setHistoryOpen(false)} />
      )}

      <button
        type="button"
        onClick={toggleMenu}
        aria-label={
          menuOpen
            ? 'Close quick access'
            : staffChipActive && staffName
              ? `Quick access — signed in as ${staffName}`
              : 'Open quick access'
        }
        aria-expanded={menuOpen}
        title={menuOpen ? 'Close' : staffChipActive && staffName ? `${staffName} — Quick access (⌘K)` : 'Quick access (⌘K)'}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition-all active:scale-95 ring-2 ring-white ${
          menuOpen
            ? 'bg-gray-700 text-white hover:bg-gray-600'
            : staffChipActive && staffTheme
              ? `${stationThemeColors[staffTheme].bg} text-white ${stationThemeColors[staffTheme].hover}`
              : 'bg-gray-900 text-white hover:bg-gray-800'
        }`}
      >
        {menuOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
      </button>
    </div>
  );
}

export default QuickAccessFab;
