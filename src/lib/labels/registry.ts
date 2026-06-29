/**
 * Label layer — the seeded default registry + tone→class map.
 *
 * `LABEL_DEFAULTS` is the single system seed for every lifecycle label that was
 * previously a hand‑written `*_STATE_META` map + inline lane order/icon. Phase 2
 * copies these rows into `reason_codes` as the system defaults; the per‑org
 * overrides layer over them through `resolveLabel`.
 *
 * `TONE_CLASSES` reproduces the EXACT Tailwind strings the old `*_STATE_META`
 * used (verified byte‑identical by `labels/resolve.test.ts`), so moving the data
 * here is zero visual change. Every class below already appears in the codebase,
 * so Tailwind's content scan still generates them.
 */
import type { LabelKind, LabelPresentation, LabelTone } from './types';

/** Runtime guard: is `v` a known tone token? (validates API input). */
export function isLabelTone(v: unknown): v is LabelTone {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TONE_CLASSES, v);
}

/** Tone token → { pill, dot } classes. The customizable palette (safelisted). */
export const TONE_CLASSES: Record<LabelTone, { pill: string; dot: string }> = {
  slate: { pill: 'bg-slate-50 text-slate-600 ring-slate-200', dot: 'bg-slate-400' },
  yellow: { pill: 'bg-yellow-50 text-yellow-700 ring-yellow-200', dot: 'bg-yellow-500' },
  teal: { pill: 'bg-teal-50 text-teal-700 ring-teal-200', dot: 'bg-teal-500' },
  amber: { pill: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-400' },
  red: { pill: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' },
  blue: { pill: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  indigo: { pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200', dot: 'bg-indigo-500' },
  emerald: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  rose: { pill: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  orange: { pill: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  pink: { pill: 'bg-pink-50 text-pink-700 ring-pink-200', dot: 'bg-pink-500' },
};

/**
 * System‑default presentation per (kind, code). PACKED_STAGED appears in BOTH
 * kinds with different labels ('Packed · Staged' inbound seam vs 'In Staging'
 * outbound) — exactly why labels key on (kind, code), not code alone. The
 * no‑two‑dots‑share‑a‑hue invariant is preserved by the distinct tones.
 */
export const LABEL_DEFAULTS: Record<LabelKind, Record<string, LabelPresentation>> = {
  unshipped: {
    AWAITING_LABEL: { label: 'Awaiting Label', description: 'Sold — no tracking or label attached yet.', tone: 'slate' },
    PENDING: { label: 'Pending', description: 'Labeled and queued — waiting for test/pack.', tone: 'yellow' },
    TESTED: { label: 'Tested', description: 'Passed the tech scan — ready to pack.', tone: 'teal' },
    PACKED_STAGED: { label: 'Packed · Staged', description: 'Packed and staged at the dock — awaiting scan‑out.', tone: 'amber' },
    BLOCKED: { label: 'Blocked', description: 'Out of stock / can’t fulfill — needs attention.', tone: 'red' },
  },
  outbound: {
    PACKED_STAGED: { label: 'In Staging', description: 'Packed and waiting at the dock — not scanned out yet.', tone: 'amber' },
    SCANNED_OUT: { label: 'Scanned Out', description: 'Scanned out at the dock — left the building; carrier hasn’t confirmed custody.', tone: 'blue' },
    IN_CUSTODY: { label: 'In Custody', description: 'Carrier has it — accepted, in transit, or out for delivery.', tone: 'indigo' },
    DELIVERED: { label: 'Delivered', description: 'Carrier confirmed delivery (terminal).', tone: 'emerald' },
    EXCEPTION: { label: 'Exception', description: 'Carrier exception or stalled — no movement.', tone: 'rose' },
    PROCESS_GAP: { label: 'Process Gap', description: 'Scanned out but no pack record — needs backfill / coaching.', tone: 'orange' },
    ORPHAN: { label: 'Orphan', description: 'Carrier took custody, but it was never scanned out internally.', tone: 'pink' },
  },
};
