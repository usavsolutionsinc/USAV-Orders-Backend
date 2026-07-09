'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Settings, X } from '@/components/Icons';
import { AnchoredLayer } from '@/design-system/primitives/AnchoredLayer';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { FOCUS_SCAN_HOTKEY_RE } from '@/lib/schemas/staff-preferences';
import { useScanHotkey } from '@/lib/scan-hotkey/useScanHotkey';
import { cn } from '@/utils/_cn';

interface ScanHotkeyControlProps {
  /** The bar's contextual left icon (scan glyph / mode indicator) shown at rest. */
  children: ReactNode;
}

/**
 * The shared focus-scan hotkey affordance that lives in EVERY StationScanBar's
 * left icon slot.
 *
 * At rest the bar's contextual icon shows. On bar hover the icon cross-fades to
 * a gear + hotkey chip. Horizontal position comes from
 * Horizontal position comes from `STATION_SCAN_BAR_ICON_SLOT_CLASS` in
 * `@/components/station/scan-bar/tokens` — do not add per-caller `-ml-1`.
 */
export function ScanHotkeyControl({ children }: ScanHotkeyControlProps) {
  const { hotkey, setHotkey, setCapturing } = useScanHotkey();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gearRef = useRef<HTMLButtonElement>(null);

  // Close + blur the gear. Capturing a key flips the button into :focus-visible
  // (it's keyboard focus now), which would otherwise pin the chip visible via
  // focus-visible:opacity-100 even after the mouse leaves. Blurring clears that.
  const close = useCallback(() => {
    setOpen(false);
    gearRef.current?.blur();
  }, []);

  // While the popover is open we're in capture mode: stand the global listener
  // down and grab the next keystroke (capture phase, so we beat every handler).
  useEffect(() => {
    if (!open) return;
    setCapturing(true);
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (FOCUS_SCAN_HOTKEY_RE.test(e.key)) {
        setHotkey(e.key);
        close();
      } else {
        setError('Pick a function key (F1–F12)');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setCapturing(false);
    };
  }, [open, setHotkey, setCapturing, close]);

  return (
    <span className="relative inline-flex items-center justify-center leading-none">
      {/* Contextual icon — fades out on hover / while configuring. In-flow so
          the slot keeps the same height as a direct icon child; inline-flex
          avoids inline-SVG baseline drift. */}
      <span
        className={cn(
          'inline-flex items-center justify-center leading-none transition-opacity duration-150',
          open ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
        )}
        aria-hidden={open}
      >
        {children}
      </span>

      {/* Gear + current key — revealed on hover / while configuring. Gear matches
          the 17px resting icon slot; kbd row height tracks the same baseline. */}
      <HoverTooltip label={`Focus scan — press ${hotkey}. Click to change.`} asChild>
        <button
          ref={gearRef}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-label={`Focus-scan hotkey is ${hotkey}. Click to reassign.`}
          className={cn(
            'ds-raw-button',
            // Slide-in from the left (translate-x) + fade, so the gear + key chip
            // "arrives" into the slot while the input placeholder shifts right to
            // make room (see group-hover:pl-16 in StationScanBar).
            'absolute inset-y-0 left-0 inline-flex items-center gap-1 rounded-md pr-0.5 text-text-soft transition-all duration-150 hover:text-blue-600 focus-visible:opacity-100 focus-visible:outline-none',
            open
              ? 'pointer-events-auto translate-x-0 opacity-100 text-blue-600'
              : 'pointer-events-none -translate-x-2 opacity-0 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100',
          )}
        >
          <span className="inline-flex size-[17px] shrink-0 items-center justify-center">
            <Settings className="block size-[17px]" />
          </span>
          <kbd className="inline-flex h-[17px] items-center rounded border border-border-soft bg-surface-card px-1 font-mono text-micro font-bold leading-none text-text-muted">
            {hotkey}
          </kbd>
        </button>
      </HoverTooltip>

      <AnchoredLayer
        open={open}
        onClose={close}
        anchorRef={gearRef}
        placement="bottom-start"
        gap={10}
      >
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className="w-60 overflow-hidden rounded-2xl border border-white/40 bg-surface-card/95 p-3 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.08] backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-eyebrow font-black uppercase tracking-wider text-text-soft">
              Focus-scan hotkey
            </span>
            <IconButton
              icon={<X className="h-3 w-3" />}
              onClick={close}
              ariaLabel="Cancel reassign"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-surface-sunken"
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <kbd className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 font-mono text-xs font-black text-blue-700">
              {hotkey}
            </kbd>
            <span className="text-xs font-semibold text-text-muted">
              Press a function key…
            </span>
          </div>

          <p
            className={cn(
              'mt-1.5 text-caption font-medium',
              error ? 'text-rose-600' : 'text-text-faint',
            )}
          >
            {error ?? 'F1–F12 only · Esc to cancel'}
          </p>
        </motion.div>
      </AnchoredLayer>
    </span>
  );
}
