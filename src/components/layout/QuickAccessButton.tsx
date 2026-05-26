'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Search, X } from '@/components/Icons';
import { getStaffColorHex } from '@/utils/staff-colors';
import { useStaffColorVersion } from '@/contexts/StaffColorsProvider';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useQuickAccessHotkey } from '@/lib/quick-access/use-hotkey';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { ActivityInboxPopover } from '@/components/quick-access/ActivityInboxPopover';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/_cn';

interface QuickAccessButtonProps {
  className?: string;
  buttonClassName?: string;
  placement?: 'down' | 'up';
}

/**
 * Reusable Quick Access button. Can be mounted in a header or as a FAB.
 * Handles its own popover state and hotkeys.
 */
export function QuickAccessButton({ className, buttonClassName, placement = 'down' }: QuickAccessButtonProps) {
  const pathname = usePathname();
  const { settings, recordVisit } = useQuickAccess();
  const { user: authUser } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
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
  useStaffColorVersion();
  const staffColorHex = authStaffId ? getStaffColorHex({ id: authStaffId }) : null;

  useEffect(() => {
    setMenuOpen(false);
    setHistoryOpen(false);
    setInboxOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen && !historyOpen && !inboxOpen) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setHistoryOpen(false);
        setInboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen, historyOpen, inboxOpen]);

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setHistoryOpen(false);
        setInboxOpen(false);
      }
      return next;
    });
  }, []);

  useQuickAccessHotkey(settings.hotkey === 'cmdk' && settings.enabled, toggleMenu);

  const handleOpenHistory = useCallback(() => {
    setMenuOpen(false);
    setInboxOpen(false);
    setHistoryOpen(true);
  }, []);

  const handleOpenInbox = useCallback(() => {
    setMenuOpen(false);
    setHistoryOpen(false);
    setInboxOpen(true);
  }, []);

  if (!settings.enabled) return null;
  if (!authUser) return null;

  const popoverPosition = placement === 'up'
    ? 'absolute right-0 bottom-full mb-0.5 z-50'
    : 'absolute right-0 top-full mt-0.5 z-50';

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      {menuOpen && (
        <div className={popoverPosition}>
          <QuickAccessPopover
            onClose={() => setMenuOpen(false)}
            onOpenHistoryPopover={handleOpenHistory}
            onOpenInboxPopover={handleOpenInbox}
          />
        </div>
      )}

      {historyOpen && (
        <div className={popoverPosition}>
          <PhoneHistoryPopover onClose={() => setHistoryOpen(false)} />
        </div>
      )}

      {inboxOpen && (
        <div className={popoverPosition}>
          <ActivityInboxPopover onClose={() => setInboxOpen(false)} />
        </div>
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
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-95 text-white shadow-sm",
          menuOpen
            ? 'bg-gray-700 hover:bg-gray-600'
            : staffChipActive && staffColorHex
              ? 'hover:brightness-110'
              : 'bg-gray-900 hover:bg-gray-800',
          buttonClassName,
        )}
        style={
          !menuOpen && staffChipActive && staffColorHex
            ? { backgroundColor: staffColorHex }
            : undefined
        }
      >
        {menuOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
      </button>
    </div>
  );
}
