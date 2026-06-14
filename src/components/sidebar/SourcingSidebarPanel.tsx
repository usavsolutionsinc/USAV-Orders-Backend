'use client';

/**
 * Sidebar for /sourcing. Owns the per-mode search/filter inputs; the right
 * pane (SourcingWorkspace) is the visual display.
 *
 * URL-state contract:
 *   ?mode=scout|watchlist           (bare = queue, the default demand surface)
 *   scout:     ?q=<term> ?by=serial|model
 *   queue:     ?status=''(live)|resolved|dismissed
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
const SUPPLIER_TYPE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All' },
  { id: 'ebay_seller', label: 'eBay' },
  { id: 'distributor', label: 'Distributor' },
  { id: 'salvage', label: 'Salvage' },
  { id: 'oem', label: 'OEM' },
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
      if (next === 'queue') p.delete('mode');
      else p.set('mode', next);
      // Cross-mode params don't carry over.
      p.delete('q');
      p.delete('status');
      p.delete('type');
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

  // ── Scout: search + serial/model toggle ───────────────────────────────────
  if (mode === 'scout') {
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
          {by === 'serial' ? 'Scan a serial to decode the model.' : 'Find a product or model to see compatible parts and stock.'}
        </p>
      </SidebarShell>
    );
  }

  // ── Searches: no filter, just the mode rail + a hint ──────────────────────
  if (mode === 'searches') {
    return (
      <SidebarShell headerRows={[modeRail]}>
        <p className="px-3 py-4 text-caption text-gray-500">
          Standing searches the scour watcher re-runs on a cadence to auto-fill the watchlist. Add one, then run, pause, or remove it.
        </p>
      </SidebarShell>
    );
  }

  // ── Suppliers: name search + type filter ──────────────────────────────────
  if (mode === 'suppliers') {
    const type = searchParams.get('type') || 'all';
    return (
      <SidebarShell
        search={{
          value: q,
          onChange: (v: string) => setParam((p) => { if (v.trim()) p.set('q', v.trim()); else p.delete('q'); }),
          onClear: () => setParam((p) => p.delete('q')),
          placeholder: 'Search suppliers',
          variant: 'blue',
        }}
        headerRows={[
          modeRail,
          <div key="type" className={sidebarHeaderPillRowClass}>
            <HorizontalButtonSlider
              items={SUPPLIER_TYPE_ITEMS}
              value={type}
              onChange={(next) => setParam((p) => { if (next === 'all') p.delete('type'); else p.set('type', next); })}
              variant="nav"
              dense
              className="w-full"
              aria-label="Supplier type"
            />
          </div>,
        ]}
      >
        <p className="px-3 py-4 text-caption text-gray-500">
          Sourcing suppliers ranked by spend. Read-only — add or edit suppliers in Admin › Suppliers.
        </p>
      </SidebarShell>
    );
  }

  // ── Queue / Watchlist: status filter ──────────────────────────────────────
  const statusItems = mode === 'queue' ? ALERT_STATUS_ITEMS : WATCH_STATUS_ITEMS;
  const sentinel = mode === 'queue' ? 'live' : 'all';
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
        {mode === 'queue'
          ? 'Everything that needs sourcing — EOL, low/no stock, and replenish-on-sold. Resolve or dismiss with a reason.'
          : 'Saved candidates across channels. Import one into inventory to track its cost & condition.'}
      </p>
    </SidebarShell>
  );
}
