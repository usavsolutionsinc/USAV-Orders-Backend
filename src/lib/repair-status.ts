// Single source of truth for repair-service (RS) status tones.
//
// Reconciles two previously-divergent inline maps: the mobile repair station
// (app/m/rs/[id]) rendered bordered `-100` pills, while the ops KpiDetailsModal
// rendered flat `-50` chips — and the two assigned CONFLICTING hues to the same
// status (e.g. "Awaiting Pickup" was amber on mobile, emerald in ops). Per the
// design color story (DESIGN_SYSTEM.md → Functional Color Mapping), each status
// now has ONE canonical hue, rendered in two shape variants:
//   badge — bordered pill (mobile station + status toggle buttons)
//   chip  — flat chip (desktop ops modal)
//
// src/lib is in Tailwind's content globs, so these classes are generated.

export type RepairStatusHue = 'warning' | 'info' | 'success' | 'danger' | 'neutral';

const HUE_BADGE: Record<RepairStatusHue, string> = {
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  info: 'bg-blue-100 text-blue-700 border-blue-200',
  success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  danger: 'bg-rose-100 text-rose-700 border-rose-200',
  neutral: 'bg-surface-sunken text-text-muted border-border-soft',
};

const HUE_CHIP: Record<RepairStatusHue, string> = {
  warning: 'bg-amber-50 text-amber-700',
  info: 'bg-blue-50 text-blue-600',
  success: 'bg-emerald-50 text-emerald-600',
  danger: 'bg-rose-50 text-rose-600',
  neutral: 'bg-surface-canvas text-text-muted',
};

// Canonical hue per repair status (union of both surfaces' status sets).
const REPAIR_STATUS_HUE: Record<string, RepairStatusHue> = {
  'Incoming Shipment': 'info',
  'Awaiting Parts': 'warning',
  'Awaiting Additional Parts Payment': 'warning',
  'Pending Repair': 'info',
  'Awaiting Pickup': 'success',
  'Repaired, Contact Customer': 'info',
  'Awaiting Payment': 'danger',
  Done: 'success',
};

function hueFor(status: string): RepairStatusHue {
  return REPAIR_STATUS_HUE[status] ?? 'neutral';
}

/** Bordered pill classes (mobile station + toggle buttons). */
export function repairStatusBadgeClass(status: string): string {
  return HUE_BADGE[hueFor(status)];
}

/** Flat chip classes (desktop ops modal). */
export function repairStatusChipClass(status: string): string {
  return HUE_CHIP[hueFor(status)];
}
