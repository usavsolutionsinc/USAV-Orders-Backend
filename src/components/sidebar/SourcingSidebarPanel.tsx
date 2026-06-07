'use client';

/**
 * Sidebar for /sourcing. Owns the per-mode search/filter inputs; the right
 * pane (SourcingWorkspace) is the visual display.
 *
 * URL-state contract:
 *   ?mode=lookup|alerts|watchlist   (bare = lookup)
 *   lookup:    ?q=<term> ?by=serial|model
 *   alerts:    ?status=''(live)|resolved|dismissed
 *   watchlist: ?status=''(all)|watching|ordered|imported
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { sidebarHeaderPillRowClass } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { resolveSourcingMode, SOURCING_MODE_ITEMS } from '@/components/sourcing/sourcing-shared';

const BY_ITEMS: HorizontalSliderItem[] = [
  { id: 'model', label: 'Model' },
  { id: 'serial', label: 'Serial' },
];
const ALERT_STATUS_ITEMS: HorizontalSliderItem[] = [
  { id: 'live', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
];
const WATCH_STATUS_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All' },
  { id: 'watching', label: 'Watching' },
  { id: 'ordered', label: 'Ordered' },
  { id: 'imported', label: 'Imported' },
];

export function SourcingSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const masterNavEnabled = useMasterNavEnabled();
  const mode = resolveSourcingMode(searchParams.get('mode'));

  const setParam = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      const qs = next.toString();
      router.replace(qs ? `/sourcing?${qs}` : '/sourcing');
    },
    [router, searchParams],
  );

  const goMode = (next: string) =>
    setParam((p) => {
      if (next === 'lookup') p.delete('mode');
      else p.set('mode', next);
      // Cross-mode params don't carry over.
      p.delete('q');
      p.delete('status');
    });

  const q = searchParams.get('q') ?? '';
  const by = searchParams.get('by') === 'serial' ? 'serial' : 'model';
  const status = searchParams.get('status') ?? '';

  const modeRail = !masterNavEnabled ? (
    <div className={sidebarHeaderPillRowClass}>
      <HorizontalButtonSlider
        items={SOURCING_MODE_ITEMS}
        value={mode}
        onChange={goMode}
        variant="nav"
        dense
        className="w-full"
        aria-label="Sourcing mode"
      />
    </div>
  ) : null;

  // ── Lookup: search + serial/model toggle ──────────────────────────────────
  if (mode === 'lookup') {
    return (
      <SidebarShell
        search={{
          value: q,
          onChange: (v: string) => setParam((p) => { if (v.trim()) p.set('q', v.trim()); else p.delete('q'); }),
          onClear: () => setParam((p) => p.delete('q')),
          placeholder: by === 'serial' ? 'Scan or type a serial' : 'Search model number or name',
          variant: 'blue',
        }}
        headerRows={[
          modeRail,
          <div key="by" className={sidebarHeaderPillRowClass}>
            <HorizontalButtonSlider
              items={BY_ITEMS}
              value={by}
              onChange={(next) => setParam((p) => p.set('by', next))}
              variant="nav"
              dense
              className="w-full"
              aria-label="Lookup by"
            />
          </div>,
        ]}
      >
        <p className="px-3 py-4 text-caption text-gray-500">
          {by === 'serial' ? 'Scan a Bose serial to decode the model.' : 'Find a model to see its compatible parts and stock.'}
        </p>
      </SidebarShell>
    );
  }

  // ── Alerts / Watchlist: status filter ─────────────────────────────────────
  const statusItems = mode === 'alerts' ? ALERT_STATUS_ITEMS : WATCH_STATUS_ITEMS;
  const sentinel = mode === 'alerts' ? 'live' : 'all';
  const activeStatus = status === '' ? sentinel : status;

  return (
    <SidebarShell
      headerRows={[
        modeRail,
        <div key="status" className={sidebarHeaderPillRowClass}>
          <HorizontalButtonSlider
            items={statusItems}
            value={activeStatus}
            onChange={(next) => setParam((p) => { if (next === sentinel) p.delete('status'); else p.set('status', next); })}
            variant="nav"
            dense
            className="w-full"
            aria-label={`${mode} status`}
          />
        </div>,
      ]}
    >
      <p className="px-3 py-4 text-caption text-gray-500">
        {mode === 'alerts'
          ? 'EOL / low-stock / no-stock alerts from the nightly scan. Resolve or dismiss with a reason.'
          : 'Saved eBay candidates. Import one into inventory to track its cost & condition.'}
      </p>
    </SidebarShell>
  );
}
