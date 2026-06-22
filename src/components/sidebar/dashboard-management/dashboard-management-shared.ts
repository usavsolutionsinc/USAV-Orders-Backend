import type { Transition } from 'framer-motion';
import type { SyncPhase, TransferOrderDetails } from '@/lib/orders-sync/types';

export interface SearchHistory {
  query: string;
  timestamp: Date;
  resultCount?: number;
}

/** Success/error banner state for a completed orders import. */
export interface ImportStatus {
  type: 'success' | 'error';
  message: string;
  details?: {
    tabName?: string;
    inserted?: number;
    updated?: number;
    trackingAttached?: number;
    unresolvedTracking?: number;
    processedRows?: number;
    exceptionsResolved?: number;
    ecwidInserted?: number;
    durationMs?: number;
  };
}

// Module-scope motion transitions / variants — defined here (not inside a
// component) so React doesn't re-allocate them on every render. Local to this
// panel's kinetic rhythm; not shared across the design system.
const PANEL_ITEM_SPRING: Transition = { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 };
export const PANEL_STATUS_BANNER_SPRING: Transition = { type: 'spring', damping: 26, stiffness: 340, mass: 0.5 };
export const PANEL_STATUS_ICON_SPRING: Transition = { type: 'spring', damping: 14, stiffness: 280, delay: 0.1 };

export const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

export const itemVariants = {
  hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
  visible: { opacity: 1, x: 0, filter: 'blur(0px)', transition: PANEL_ITEM_SPRING },
};

export function emptyTransferDetails(): TransferOrderDetails {
  return { inserted: [], updated: [], deleted: [], unknownTitle: [], unresolvedTracking: [] };
}

export function cloneDetails(d: TransferOrderDetails): TransferOrderDetails {
  return {
    inserted: [...d.inserted],
    updated: [...d.updated],
    deleted: [...d.deleted],
    unknownTitle: [...d.unknownTitle],
    unresolvedTracking: [...(d.unresolvedTracking ?? [])],
  };
}

export function phaseSummary(phase: SyncPhase, count?: number): string {
  switch (phase) {
    case 'starting': return 'Starting…';
    case 'fetching_sheet': return 'Fetching sheet…';
    case 'fetching_ecwid': return 'Fetching Ecwid orders…';
    case 'resolving_tracking': return count ? `Resolving ${count} tracking number${count === 1 ? '' : 's'}…` : 'Resolving tracking…';
    case 'matching_orders': return 'Matching orders…';
    case 'inserting': return count ? `Inserting ${count} order${count === 1 ? '' : 's'}…` : 'Inserting…';
    case 'updating': return count ? `Updating ${count} order${count === 1 ? '' : 's'}…` : 'Updating…';
    case 'publishing': return 'Publishing changes…';
    case 'scanning_exceptions': return count ? `Scanning ${count} open exception${count === 1 ? '' : 's'}…` : 'Scanning exceptions…';
    case 'done': return 'Done';
    default: return 'Working…';
  }
}
