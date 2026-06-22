'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fbaPaths } from '@/lib/fba/api-paths';
import { emitAppEvent, useEventBridge } from '@/hooks';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getDbTableChannelName, safeChannelName } from '@/lib/realtime/channels';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { useStationTheme } from '@/hooks/useStationTheme';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import type { FbaCombineRailView, FbaPlanRailView } from '@/components/fba/sidebar/FbaSidebarRails';
import {
  FBA_COMBINE_STARTED,
  FBA_PAIRED_REVIEW_TOGGLE,
  FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW,
  FBA_SHIPMENT_EDITOR_ACTIVE,
} from '@/lib/fba/events';
import { resolveFbaMode, type FbaMode } from '@/lib/fba/fba-modes';
import type { PendingPlan } from '@/components/fba/sidebar/fba-sidebar-shared';

/** Patch shape for the /fba workspace URL search params. */
export interface FbaParamPatch {
  q?: string;
  r?: string;
  mode?: FbaMode;
  draft?: string | null;
  plan?: number | null;
  main?: 'print' | 'plan' | null;
  details?: 'catalog' | null;
}

/**
 * URL-driven workspace state: the active mode, the refresh token, and the
 * shipped-search box (hydrated from `?q`, debounced back to the URL). Returns
 * the typed `updateFbaParams` mutator the whole sidebar writes through.
 */
export function useFbaWorkspaceUrlState() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeMode: FbaMode = resolveFbaMode(searchParams.get('mode'));
  const refreshToken = Number(searchParams.get('r') || 0);

  const [localSearch, setLocalSearch] = useState('');
  const urlHydratedRef = useRef(false);

  const updateFbaParams = useCallback(
    (patch: FbaParamPatch) => {
      const params = new URLSearchParams(searchParams.toString());
      if (patch.q !== undefined) {
        if (patch.q.trim()) params.set('q', patch.q.trim());
        else params.delete('q');
      }
      if (patch.mode !== undefined) {
        if (patch.mode === 'combine') params.delete('mode');
        else params.set('mode', patch.mode);
      }
      if (patch.r !== undefined) params.set('r', patch.r);
      if (patch.draft !== undefined) {
        if (patch.draft) params.set('draft', patch.draft);
        else params.delete('draft');
      }
      if (patch.plan !== undefined) {
        if (patch.plan) {
          params.set('plan', String(patch.plan));
          params.delete('draft');
        } else {
          params.delete('plan');
        }
      }
      if (patch.main !== undefined) {
        if (patch.main === 'print') params.set('main', 'print');
        else if (patch.main === 'plan') params.set('main', 'plan');
        else params.delete('main');
      }
      if (patch.details !== undefined) {
        if (patch.details === 'catalog') params.set('details', 'catalog');
        else params.delete('details');
      }
      const q = params.toString();
      router.replace(q ? `/fba?${q}` : '/fba');
    },
    [router, searchParams],
  );

  useLayoutEffect(() => {
    setLocalSearch(searchParams.get('q') || '');
    urlHydratedRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!urlHydratedRef.current) return;
    if (activeMode !== 'shipped') return;
    const t = setTimeout(() => {
      const next = localSearch.trim();
      const cur = (searchParams.get('q') || '').trim();
      if (next === cur) return;
      updateFbaParams({ q: localSearch });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch, activeMode]);

  return { activeMode, refreshToken, localSearch, setLocalSearch, updateFbaParams };
}

/** Signed-in staff identity + station theme + org id for realtime channels. */
export function useFbaStationIdentity() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffId = user?.staffId ?? 0;
  const staffDirectory = useActiveStaffDirectory();
  const selectedStaffMember = staffDirectory.find((m) => m.id === staffId);
  const staffName = selectedStaffMember?.name || (staffDirectory.length === 0 ? '…' : `Staff ${staffId}`);
  const { theme: stationTheme } = useStationTheme({ staffId });
  return { orgId, staffId, staffName, stationTheme };
}

export interface UseFbaPlanDataOptions {
  activeMode: FbaMode;
  refreshToken: number;
  orgId?: string;
}

/**
 * Loads the pending-plan cards and per-stage mode counts for the workspace,
 * refreshing on the refresh token, the `fba_*` realtime channels, a 60s poll,
 * and the dashboard refresh events.
 */
export function useFbaPlanData({ activeMode, refreshToken, orgId }: UseFbaPlanDataOptions) {
  const [pendingPlans, setPendingPlans] = useState<PendingPlan[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  // Live per-stage item counts → mode pill badges (Plan = PLANNED, Combine = PACKED).
  const [modeCounts, setModeCounts] = useState<Record<string, number>>({});

  const fbaShipmentsDbChannel = safeChannelName(() => getDbTableChannelName(orgId!, 'public', 'fba_shipments'));
  const fbaShipmentItemsDbChannel = safeChannelName(() => getDbTableChannelName(orgId!, 'public', 'fba_shipment_items'));
  const fbaShipmentTrackingDbChannel = safeChannelName(() => getDbTableChannelName(orgId!, 'public', 'fba_shipment_tracking'));

  const loadPendingPlans = useCallback(async () => {
    if (activeMode === 'shipped') return;
    setPlansError(null);
    try {
      const res = await fetch(fbaPaths.activeWithDetails(), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load plans');
      // The consolidated endpoint returns { active, shipped } — extract PLANNED from active
      const allActive: any[] = Array.isArray(data?.active) ? data.active : [];
      const planned = allActive.filter((s: any) => s.status === 'PLANNED');
      const sorted = [...planned].sort((a: any, b: any) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });
      setPendingPlans(
        sorted.map((s: any) => ({
          id: s.id,
          shipment_ref: s.shipment_ref,
          due_date: s.due_date,
          total_items: Number(s.total_items) || 0,
          total_expected_qty: Number(s.total_expected_qty) || 0,
          ready_item_count: Number(s.ready_item_count ?? s.ready_items) || 0,
          shipped_item_count: Number(s.shipped_item_count ?? s.shipped_items) || 0,
          created_by_name: s.created_by_name || null,
          created_at: s.created_at,
          amazon_shipment_id: s.amazon_shipment_id ?? null,
          tracking_numbers: Array.isArray(s.tracking) ? s.tracking.map((t: any) => ({
            link_id: t.link_id,
            tracking_id: t.tracking_id,
            tracking_number: t.tracking_number_raw,
            carrier: t.carrier,
            label: t.label,
          })) : [],
        })),
      );
    } catch (err: any) {
      setPlansError(err?.message || 'Could not load plans');
    }
  }, [activeMode]);

  const loadStageCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/fba/stage-counts', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data?.counts) setModeCounts(data.counts as Record<string, number>);
    } catch {
      /* non-fatal: pills just omit the badge */
    }
  }, []);

  useEffect(() => {
    void loadPendingPlans();
    void loadStageCounts();
  }, [refreshToken, loadPendingPlans, loadStageCounts]);

  useAblyChannel(fbaShipmentItemsDbChannel, 'db.row.changed', () => {
    void loadPendingPlans();
    void loadStageCounts();
  }, !!fbaShipmentItemsDbChannel);

  useAblyChannel(fbaShipmentsDbChannel, 'db.row.changed', () => {
    void loadPendingPlans();
  }, !!fbaShipmentsDbChannel);

  useAblyChannel(fbaShipmentTrackingDbChannel, 'db.row.changed', () => {
    void loadPendingPlans();
  }, !!fbaShipmentTrackingDbChannel);

  useEffect(() => {
    if (activeMode === 'shipped') return;
    const interval = setInterval(() => loadPendingPlans(), 60_000);
    return () => clearInterval(interval);
  }, [activeMode, loadPendingPlans]);

  useEventBridge({
    'usav-refresh-data': () => loadPendingPlans(),
    'dashboard-refresh': () => loadPendingPlans(),
    'fba-plan-created': () => loadPendingPlans(),
    'fba-print-shipped': () => loadPendingPlans(),
  });

  return { pendingPlans, plansError, modeCounts };
}

/** Plan / Combine rail view toggles, with combine auto-switching to Packed when a combine starts. */
export function useFbaRailViews() {
  const [planRailView, setPlanRailView] = useState<FbaPlanRailView>('planned');
  const [combineRailView, setCombineRailView] = useState<FbaCombineRailView>('recent');

  useEventBridge({
    [FBA_COMBINE_STARTED]: () => setCombineRailView('packed'),
  });

  return { planRailView, setPlanRailView, combineRailView, setCombineRailView };
}

/** The toggle payload re-broadcast to the paired-review workspace. */
interface PairedReviewToggleDetail {
  sendToPaired?: {
    items: FbaBoardItem[];
    amazonShipmentId: string;
    upsTracking: string;
    activeShipmentSplit?: { sourcePlanId: number; prefilledAmazonShipmentId: string };
  };
}

/**
 * Workspace event bridges that don't fit the data/rail hooks:
 * - tracks whether the shipment editor is open (hides scan bar + welcome),
 * - clears board selection when switching to the shipped tab,
 * - relays the paired-review toggle to the center-right workspace.
 */
export function useFbaWorkspaceBridges(activeMode: FbaMode) {
  const [editorActive, setEditorActive] = useState(false);
  // Tracked only to drive the toggle parity below; never rendered here.
  const [, setPairedReviewExpanded] = useState(true);

  // Clear selection when switching to shipped — also reset board checkboxes.
  useEffect(() => {
    if (activeMode === 'shipped') {
      emitAppEvent('fba-board-toggle-all', 'none');
    }
  }, [activeMode]);

  useEventBridge({
    [FBA_SHIPMENT_EDITOR_ACTIVE]: (e) => {
      setEditorActive(!!(e as CustomEvent<boolean>).detail);
    },
    [FBA_PAIRED_REVIEW_TOGGLE]: (e) => {
      const d = (e as CustomEvent<PairedReviewToggleDetail>).detail;
      setPairedReviewExpanded((was) => {
        const next = !was;
        if (!was && next && d?.sendToPaired) {
          queueMicrotask(() => {
            emitAppEvent(FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW, d.sendToPaired);
          });
        }
        return next;
      });
    },
  });

  return { editorActive };
}
