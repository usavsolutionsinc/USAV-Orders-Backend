/**
 * Zendesk-specific status/priority badge maps. The generic
 * design-system StatusBadge only covers a couple of these, so the console
 * uses its own complete map.
 */

interface BadgeStyle {
  label: string;
  className: string;
}

const NEUTRAL = 'bg-gray-100 text-gray-600 ring-1 ring-gray-200';

const STATUS_BADGE: Record<string, BadgeStyle> = {
  new: { label: 'New', className: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  open: { label: 'Open', className: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  pending: { label: 'Pending', className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  hold: { label: 'On-hold', className: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
  solved: { label: 'Solved', className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  closed: { label: 'Closed', className: NEUTRAL },
};

const PRIORITY_BADGE: Record<string, BadgeStyle> = {
  urgent: { label: 'Urgent', className: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  high: { label: 'High', className: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  normal: { label: 'Normal', className: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
  low: { label: 'Low', className: 'bg-slate-50 text-slate-500 ring-1 ring-slate-200' },
};

export function statusBadge(status?: string | null): BadgeStyle {
  const key = String(status ?? '').toLowerCase();
  return STATUS_BADGE[key] ?? { label: status || '—', className: NEUTRAL };
}

/** Returns null for normal/low/unset so the UI can hide low-signal priorities. */
export function priorityBadge(priority?: string | null): BadgeStyle | null {
  const key = String(priority ?? '').toLowerCase();
  return PRIORITY_BADGE[key] ?? null;
}

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'hold', label: 'On-hold' },
  { value: 'solved', label: 'Solved' },
  { value: 'closed', label: 'Closed' },
];

export const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];
