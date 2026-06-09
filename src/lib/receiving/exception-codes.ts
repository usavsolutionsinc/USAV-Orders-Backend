/**
 * OS&D (Over / Short / Damaged) exception taxonomy for inbound receiving
 * (receiving-triage streamline Phase 5). Single source of truth for the
 * `receiving.exception_code` values, their display labels, and tones — so the
 * write sites (lookup-po, mark-received) and the Unfound triage chip/filter
 * agree by construction. Mirrors the migration 2026-06-08_receiving_exception_code.
 */

export const RECEIVING_EXCEPTION_CODES = [
  'NO_PO',
  'CARRIER_MISMATCH',
  'SHORT',
  'OVER',
  'DAMAGED',
  'WRONG_ITEM',
] as const;

export type ReceivingExceptionCode = (typeof RECEIVING_EXCEPTION_CODES)[number];

export function isReceivingExceptionCode(v: string | null | undefined): v is ReceivingExceptionCode {
  return v != null && (RECEIVING_EXCEPTION_CODES as readonly string[]).includes(v);
}

interface ExceptionMeta {
  label: string;
  /** Tailwind chip classes (bg/text/ring). */
  tone: string;
  description: string;
}

export const RECEIVING_EXCEPTION_META: Record<ReceivingExceptionCode, ExceptionMeta> = {
  NO_PO: {
    label: 'No PO',
    tone: 'bg-slate-100 text-slate-600 ring-slate-200',
    description: 'Scanned carton with no matching Zoho purchase order.',
  },
  CARRIER_MISMATCH: {
    label: 'Carrier?',
    tone: 'bg-rose-100 text-rose-700 ring-rose-200',
    description: 'Tracking number has no known carrier or the carrier has no record of it.',
  },
  SHORT: {
    label: 'Short',
    tone: 'bg-amber-100 text-amber-700 ring-amber-200',
    description: 'Fewer units received than the PO expected.',
  },
  OVER: {
    label: 'Over',
    tone: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
    description: 'More units received than the PO expected.',
  },
  DAMAGED: {
    label: 'Damaged',
    tone: 'bg-red-100 text-red-700 ring-red-200',
    description: 'Unit(s) arrived damaged.',
  },
  WRONG_ITEM: {
    label: 'Wrong item',
    tone: 'bg-orange-100 text-orange-700 ring-orange-200',
    description: "Received SKU doesn't match the PO line.",
  },
};

/** Display label for an exception code (empty string when none/unknown). */
export function receivingExceptionLabel(code: string | null | undefined): string {
  return isReceivingExceptionCode(code) ? RECEIVING_EXCEPTION_META[code].label : '';
}
