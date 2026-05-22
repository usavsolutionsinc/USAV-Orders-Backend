'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { AlertTriangle, Check, LayoutDashboard, Mail, RefreshCw } from '@/components/Icons';
import { useStaffRole } from '@/hooks/useStaffRole';
import { PoTriagePanel } from '@/components/po-triage/PoTriagePanel';
import { InventoryControlsPanel } from '@/components/inventory-v2/InventoryControlsPanel';

/**
 * Sidebar panel for the inventory area — matches ReceivingSidebarPanel's
 * shape (just the section-nav pills inside the standard header band; the
 * "Inventory" section title comes from DashboardSidebar's chrome).
 *
 * Pills switch between the main /inventory shell and /inventory/po-mailbox.
 * PO Mailbox pill is admin-only — non-admins see no pill row at all (a
 * single pill would be visually pointless).
 */

interface NavItem extends HorizontalSliderItem {
  href: string;
  requiresAdmin?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'inventory',  label: 'Inventory',  icon: LayoutDashboard, href: '/inventory' },
  { id: 'po-mailbox', label: 'PO Mailbox', icon: Mail,            href: '/inventory/po-mailbox', requiresAdmin: true },
];

function activeId(pathname: string | null | undefined): string {
  if (pathname?.startsWith('/inventory/po-mailbox')) return 'po-mailbox';
  return 'inventory';
}

export function InventorySidebarPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin } = useStaffRole();

  const items = NAV_ITEMS.filter((i) => !i.requiresAdmin || isAdmin);
  const value = activeId(pathname);

  // Even without the PO Mailbox pill (non-admins), we still want the
  // inventory search/filters in the sidebar.
  const showPills = items.length >= 2;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {showPills ? (
        <div className={`${sidebarHeaderBandClass} px-3`}>
          <HorizontalButtonSlider
            items={items}
            value={value}
            onChange={(id) => {
              const target = NAV_ITEMS.find((i) => i.id === id);
              if (target && target.href !== pathname) router.push(target.href);
            }}
            variant="nav"
            aria-label="Inventory section"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {value === 'po-mailbox' ? (
          <div className="space-y-3">
            <MirrorHealthBadge />
            <PoTriagePanel />
          </div>
        ) : (
          <InventoryControlsPanel />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Mirror health badge ──────────────────────── */

interface MirrorHealth {
  mirror: { totalPurchaseOrders: number; lastSyncedAt: string | null; ageMs: number | null };
  cron: { lastCursorAdvance: string | null };
  worklist: { pending: number; ignored: number; resolved: number };
}

const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2h

function MirrorHealthBadge() {
  const [data, setData] = useState<MirrorHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/po-mirror/health', { cache: 'no-store' });
      if (res.ok) setData((await res.json()) as MirrorHealth);
    } catch {
      // best-effort; the badge is read-only diagnostics
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // refresh once per minute
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-2 text-[11px] text-gray-400">
        Loading mirror status…
      </div>
    );
  }
  if (!data) return null;

  const stale = data.mirror.ageMs != null && data.mirror.ageMs > STALE_AFTER_MS;
  const ageLabel = data.mirror.ageMs == null ? 'never synced' : formatAge(data.mirror.ageMs);

  return (
    <div
      className={`rounded-md border px-2.5 py-2 text-[11px] ${
        stale ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-1.5 font-semibold text-gray-700">
        {stale ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        ) : (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        )}
        Zoho mirror
        <button
          type="button"
          onClick={load}
          className="ml-auto rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          aria-label="Refresh mirror status"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-gray-600">
        <span>POs mirrored:</span>
        <span className="tabular-nums text-gray-900">{data.mirror.totalPurchaseOrders.toLocaleString()}</span>
        <span>Last sync:</span>
        <span className={stale ? 'text-amber-700' : 'text-gray-900'}>{ageLabel}</span>
      </div>
      {data.worklist.pending > 0 && (
        <div className="mt-1.5 border-t border-gray-100 pt-1.5">
          <span className="font-semibold text-amber-700">{data.worklist.pending}</span>
          <span className="text-gray-600"> pending in worklist</span>
        </div>
      )}
      {stale && (
        <p className="mt-1.5 text-[10.5px] italic text-amber-700">
          Webhook + cron quiet for &gt;2h. Check QStash schedule and webhook signature.
        </p>
      )}
    </div>
  );
}

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
