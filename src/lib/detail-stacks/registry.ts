'use client';

/**
 * Detail-stack registry — the single source of truth mapping each right-side
 * "detail stack" slide-over (ShippedDetailsPanel, ReceivingDetailsStack,
 * SkuDetailView, FbaBoardDetailPanel, RepairDetailsPanel, …) to the URL param
 * that opens it, a display noun, and an icon.
 *
 * These panels are deep-linkable via an `open<Kind>Id` search param on their
 * home surfaces. The URL tracker records opens into the assistant recents list;
 * re-open from recents uses `openDetailStack` (global host, no navigation).
 */

import type { ComponentType } from 'react';
import { Box, Camera, FileText, Layers, Package, Truck, Wrench } from '@/components/Icons';

export type DetailStackKind = 'shipment' | 'receiving' | 'order' | 'claim' | 'photo' | 'plan' | 'po';

interface DetailStackDef {
  kind: DetailStackKind;
  /** URL search param that opens this stack's slide-over panel. */
  param: string;
  /** Human noun for labels, e.g. "Shipment", "Receiving carton". */
  noun: string;
  Icon: ComponentType<{ className?: string }>;
}

export const DETAIL_STACK_DEFS: Record<DetailStackKind, DetailStackDef> = {
  shipment: { kind: 'shipment', param: 'openShipmentId', noun: 'Shipment', Icon: Truck },
  receiving: { kind: 'receiving', param: 'openReceivingId', noun: 'Receiving', Icon: Package },
  order: { kind: 'order', param: 'openOrderId', noun: 'Order', Icon: Box },
  claim: { kind: 'claim', param: 'openClaimId', noun: 'Claim', Icon: Wrench },
  photo: { kind: 'photo', param: 'openPhotoId', noun: 'Photo', Icon: Camera },
  plan: { kind: 'plan', param: 'openPlanId', noun: 'Plan', Icon: Layers },
  po: { kind: 'po', param: 'openPoId', noun: 'PO', Icon: FileText },
};

/** Flat list for URL-watching (the tracker iterates these every navigation). */
export const DETAIL_STACK_PARAMS: ReadonlyArray<{ kind: DetailStackKind; param: string }> =
  Object.values(DETAIL_STACK_DEFS).map((d) => ({ kind: d.kind, param: d.param }));

/** Pages that always own a given kind's open param (even if opened elsewhere). */
const DETAIL_STACK_CANONICAL_PATH: Partial<Record<DetailStackKind, string>> = {
  order: '/dashboard',
  shipment: '/fba',
};

/** Build the href that re-opens a recorded stack on the page it was opened from. */
export function detailStackHref(entry: {
  kind: DetailStackKind;
  id: string;
  path: string;
  /** Query string captured when the stack was opened (preserves view/mode params). */
  search?: string;
}): string {
  const def = DETAIL_STACK_DEFS[entry.kind];
  const basePath = DETAIL_STACK_CANONICAL_PATH[entry.kind] ?? entry.path;
  const params = new URLSearchParams(entry.search ?? '');
  for (const { param } of DETAIL_STACK_PARAMS) {
    params.delete(param);
  }
  params.set(def.param, entry.id);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : `${basePath}?${def.param}=${encodeURIComponent(entry.id)}`;
}
