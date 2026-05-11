'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Barcode, Link2 } from '@/components/Icons';
import { MobileReceivingScanSheet } from './MobileReceivingScanSheet';
import { useMobilePair } from '@/contexts/MobilePairContext';

// Routes that own a specific scan flow (tech / packer / sku-stock).
// On these routes the FAB dispatches `mobile-scan-fab-open` and the page
// opens its own sheet. Elsewhere we open the generic pair / PO sheet.
const ROUTE_SPECIFIC_PREFIXES = ['/tech', '/packer', '/sku-stock'];

// /m/* are the phone-native flows served outside the mobile shell (pair, scan
// landing). Don't double-mount the FAB there.
const HIDDEN_PREFIXES = ['/m/'];

/** Packer page provides its own layout; suppress the global scan FAB there. */
const SUPPRESS_GLOBAL_SCAN_FAB_PREFIXES = ['/packer'];

function matchesPrefix(pathname: string | null, prefixes: string[]): boolean {
  if (!pathname) return false;
  return prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

/** Custom event name the route-specific pages listen for. */
export const MOBILE_SCAN_FAB_EVENT = 'mobile-scan-fab-open';

export function MobileScanFab() {
  const pathname = usePathname();
  const { session, unreadEchoCount, markEchoesRead } = useMobilePair();

  const [sheetOpen, setSheetOpen] = useState(false);

  const hidden = matchesPrefix(pathname, HIDDEN_PREFIXES);
  const suppressGlobalFab = matchesPrefix(pathname, SUPPRESS_GLOBAL_SCAN_FAB_PREFIXES);
  const routeHasOwnFlow = matchesPrefix(pathname, ROUTE_SPECIFIC_PREFIXES);
  const paired = Boolean(session);
  const hasNotification = paired && unreadEchoCount > 0;

  const handleTap = useCallback(() => {
    // Opening clears the badge — matches desktop FAB behavior.
    if (hasNotification) markEchoesRead();
    if (routeHasOwnFlow) {
      window.dispatchEvent(new CustomEvent(MOBILE_SCAN_FAB_EVENT));
      return;
    }
    setSheetOpen(true);
  }, [routeHasOwnFlow, hasNotification, markEchoesRead]);

  // Auto-close the generic sheet when the user navigates away.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  if (hidden || suppressGlobalFab) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleTap}
        aria-label={paired ? 'Phone paired — open scanner' : 'Open scanner'}
        title={paired ? 'Paired — tap to scan' : 'Scan'}
        className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-[95] flex h-16 w-16 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(17,24,39,0.35)] transition-transform active:scale-95 ${
          paired
            ? 'bg-white text-emerald-600 ring-2 ring-emerald-400 active:ring-emerald-500'
            : 'bg-blue-600 text-white active:bg-blue-700'
        }`}
      >
        {paired ? <Link2 className="h-6 w-6" /> : <Barcode className="h-6 w-6" />}
        {hasNotification && (
          <span
            aria-label={`${unreadEchoCount} new scan result${unreadEchoCount === 1 ? '' : 's'}`}
            className="absolute -top-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white"
          >
            <span className="h-3.5 w-3.5 animate-ping rounded-full bg-red-400 opacity-75" />
          </span>
        )}
      </button>

      {!routeHasOwnFlow && (
        <MobileReceivingScanSheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}
