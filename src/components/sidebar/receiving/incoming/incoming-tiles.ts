import type React from 'react';
import { Package, Truck, AlertTriangle, Clock, Mail, Unlink } from '@/components/Icons';
import type { IncomingDeliveryState, IncomingSummary } from './incoming-summary-types';

export interface TileSpec {
  state: IncomingDeliveryState | null; // null = "All"
  label: string;
  key: keyof IncomingSummary;
  tone: 'rose' | 'amber' | 'blue' | 'gray' | 'slate' | 'orange' | 'violet' | 'red';
  icon: React.FC<{ className?: string }>;
  /** Tooltip / `aria-description` — the *why* this bucket exists. */
  title: string;
}

export const TILES: TileSpec[] = [
  { state: null, label: 'All issued', key: 'issued', tone: 'slate', icon: Package, title: 'Every PO Zoho says is issued and not yet received locally.' },
  {
    state: 'DELIVERED_UNOPENED', label: 'Delivered · not scanned', key: 'delivered_unopened', tone: 'rose', icon: AlertTriangle,
    title: 'Carrier marked the box delivered AND no operator has scanned the tracking# at the receiving station yet (no receiving_scans row). Physically here, untouched — top priority.',
  },
  {
    state: 'DELIVERED_EMAIL', label: 'Delivered (email)', key: 'delivered_email', tone: 'rose', icon: Mail,
    title: 'An "ORDER DELIVERED" email (eBay) reported this order delivered AND no operator has scanned it at the receiving station yet. The email-driven counterpart to the carrier signal — catches boxes carrier polling misses.',
  },
  { state: 'ARRIVING_TODAY', label: 'Arriving today', key: 'arriving_today', tone: 'amber', icon: Truck, title: 'Carrier currently reports "out for delivery".' },
  {
    state: 'STALLED', label: 'Stalled', key: 'stalled', tone: 'orange', icon: AlertTriangle,
    title: 'Carrier-reported exception OR no scan in >72h while still mid-route. Catch these before vendors do.',
  },
  { state: 'IN_TRANSIT', label: 'In transit', key: 'in_transit', tone: 'blue', icon: Truck, title: 'Label created, accepted, or in transit (carrier-side).' },
  {
    state: 'PENDING_CARRIER', label: 'Pending carrier', key: 'pending_carrier', tone: 'gray', icon: Clock,
    title: 'Tracking# is registered with a known carrier, but the carrier sync has not returned a status yet (UNKNOWN / NULL). USPS shipments often land here while the sync adapter is rate-limited.',
  },
  {
    state: 'TRACKING_UNAVAILABLE', label: 'Tracking unavailable', key: 'tracking_unavailable', tone: 'violet', icon: AlertTriangle,
    title: 'The carrier is refusing tracking requests for these (e.g. USPS access-control 403 while the IP Agreement is pending). Delivered status is unobtainable until access clears — not "not delivered".',
  },
  {
    state: 'CARRIER_MISMATCH', label: 'Carrier mismatch', key: 'carrier_mismatch', tone: 'red', icon: Unlink,
    title: 'The carrier and tracking# don’t match: the number matched no known carrier, or the carrier API has no record of it (not-found / invalid). These never resolve on their own — fix the tracking# or reassign the carrier.',
  },
  {
    state: 'AWAITING_TRACKING', label: 'Awaiting tracking #', key: 'awaiting_tracking', tone: 'gray', icon: Clock,
    title: 'No tracking# registered at all — vendor has not shipped, or the PO `reference_number` field on Zoho is empty.',
  },
];

/** Per-tone tokens for status rows + matching active-filter pills. */
export const TONE: Record<
  TileSpec['tone'],
  { active: string; inactive: string; ring: string; iconActive: string; iconInactive: string; pill: string }
> = {
  rose: { active: 'bg-rose-600 text-white ring-rose-600', inactive: 'bg-surface-card text-rose-700 ring-rose-200 hover:bg-rose-50', ring: 'focus:ring-rose-500/40', iconActive: 'text-white', iconInactive: 'text-rose-500', pill: 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100' },
  amber: { active: 'bg-amber-600 text-white ring-amber-600', inactive: 'bg-surface-card text-amber-800 ring-amber-200 hover:bg-amber-50', ring: 'focus:ring-amber-500/40', iconActive: 'text-white', iconInactive: 'text-amber-500', pill: 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100' },
  orange: { active: 'bg-orange-600 text-white ring-orange-600', inactive: 'bg-surface-card text-orange-800 ring-orange-200 hover:bg-orange-50', ring: 'focus:ring-orange-500/40', iconActive: 'text-white', iconInactive: 'text-orange-500', pill: 'bg-orange-50 text-orange-800 ring-orange-200 hover:bg-orange-100' },
  blue: { active: 'bg-blue-600 text-white ring-blue-600', inactive: 'bg-surface-card text-blue-700 ring-blue-200 hover:bg-blue-50', ring: 'focus:ring-blue-500/40', iconActive: 'text-white', iconInactive: 'text-blue-500', pill: 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100' },
  // ds-allow-raw-neutral: identity/tone hue — gray tone must stay distinct from slate (= surface-inverse), not chrome
  gray: { active: 'bg-gray-700 text-white ring-gray-700', inactive: 'bg-surface-card text-text-muted ring-border-soft hover:bg-surface-hover', ring: 'focus:ring-gray-500/40', iconActive: 'text-white', iconInactive: 'text-text-soft', pill: 'bg-surface-canvas text-text-muted ring-border-soft hover:bg-surface-sunken' },
  slate: { active: 'bg-surface-inverse text-white ring-surface-inverse', inactive: 'bg-surface-card text-text-muted ring-border-soft hover:bg-surface-hover', ring: 'focus:ring-text-soft/40', iconActive: 'text-white', iconInactive: 'text-text-soft', pill: 'bg-surface-canvas text-text-muted ring-border-soft hover:bg-surface-sunken' },
  violet: { active: 'bg-violet-600 text-white ring-violet-600', inactive: 'bg-surface-card text-violet-700 ring-violet-200 hover:bg-violet-50', ring: 'focus:ring-violet-500/40', iconActive: 'text-white', iconInactive: 'text-violet-500', pill: 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100' },
  red: { active: 'bg-red-600 text-white ring-red-600', inactive: 'bg-surface-card text-red-700 ring-red-200 hover:bg-red-50', ring: 'focus:ring-red-500/40', iconActive: 'text-white', iconInactive: 'text-red-500', pill: 'bg-red-50 text-red-700 ring-red-200 hover:bg-red-100' },
};
