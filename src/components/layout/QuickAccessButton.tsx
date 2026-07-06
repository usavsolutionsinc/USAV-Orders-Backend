'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnchoredLayer } from '@/design-system';
import { IconButton } from '@/design-system/primitives';
import { Search, X } from '@/components/Icons';
import { getStaffColorHex } from '@/utils/staff-colors';
import { useStaffColorVersion } from '@/contexts/StaffColorsProvider';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useQuickAccessHotkey } from '@/lib/quick-access/use-hotkey';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { FeedbackPopover } from '@/components/quick-access/FeedbackWidget';
import { useAuth } from '@/contexts/AuthContext';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';

interface QuickAccessButtonProps {
  className?: string;
  buttonClassName?: string;
  placement?: 'down' | 'up';
  /** 36×36 circular control for 44px app bars (e.g. mobile hub header). */
  compact?: boolean;
}

/**
 * Reusable Quick Access button. Can be mounted in a header or as a FAB.
 * Handles its own popover state and hotkeys.
 */
export function QuickAccessButton({
  className,
  buttonClassName,
  placement = 'down',
  compact = false,
}: QuickAccessButtonProps) {
  const pathname = usePathname();
  const { settings } = useQuickAccess();
  const { user: authUser } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
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
    setFeedbackOpen(false);
  }, [pathname]);

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setHistoryOpen(false);
        setFeedbackOpen(false);
      }
      return next;
    });
  }, []);

  useQuickAccessHotkey(settings.hotkey === 'cmdk' && settings.enabled, toggleMenu);

  const handleOpenHistory = useCallback(() => {
    setMenuOpen(false);
    setFeedbackOpen(false);
    setHistoryOpen(true);
  }, []);

  const handleOpenFeedback = useCallback(() => {
    setMenuOpen(false);
    setHistoryOpen(false);
    setFeedbackOpen(true);
  }, []);

  if (!settings.enabled) return null;
  if (!authUser) return null;

  // Popovers portal via AnchoredLayer (escapes any transformed/blurred header
  // ancestor) and own their own outside-click + Escape dismissal.
  const popoverPlacement = placement === 'up' ? 'top-end' : 'bottom-end';

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <AnchoredLayer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={wrapperRef}
        placement={popoverPlacement}
        gap={2}
      >
        <QuickAccessPopover
          onClose={() => setMenuOpen(false)}
          onOpenHistoryPopover={handleOpenHistory}
          onOpenFeedbackPopover={handleOpenFeedback}
        />
      </AnchoredLayer>

      <AnchoredLayer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        anchorRef={wrapperRef}
        placement={popoverPlacement}
        gap={2}
      >
        <PhoneHistoryPopover onClose={() => setHistoryOpen(false)} />
      </AnchoredLayer>

      <AnchoredLayer
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        anchorRef={wrapperRef}
        placement={popoverPlacement}
        gap={2}
      >
        <FeedbackPopover onClose={() => setFeedbackOpen(false)} />
      </AnchoredLayer>

      <HoverTooltip
        label={menuOpen ? 'Close' : staffChipActive && staffName ? `${staffName} — Quick access (⌘K)` : 'Quick access (⌘K)'}
        asChild
      >
        <IconButton
          onClick={toggleMenu}
          ariaLabel={
            menuOpen
              ? 'Close quick access'
              : staffChipActive && staffName
                ? `Quick access — signed in as ${staffName}`
                : 'Open quick access'
          }
          aria-expanded={menuOpen}
          className={cn(
            'relative flex items-center justify-center transition-all active:scale-95 shadow-sm',
            compact
              ? 'h-9 w-9 min-h-0 min-w-0 shrink-0 rounded-full ring-1 ring-border-soft/90'
              : 'h-10 w-10 rounded-xl',
            menuOpen
              ? 'bg-surface-inverse-raised hover:bg-surface-inverse-soft'
              : staffChipActive && staffColorHex
                ? 'hover:brightness-110'
                : 'bg-surface-inverse hover:bg-surface-inverse-hover',
            buttonClassName,
          )}
          style={
            !menuOpen && staffChipActive && staffColorHex
              ? { backgroundColor: staffColorHex }
              : undefined
          }
          icon={
            menuOpen ? (
              <X className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} text-white`} />
            ) : (
              <Search className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} text-white`} />
            )
          }
        />
      </HoverTooltip>
    </div>
  );
}
