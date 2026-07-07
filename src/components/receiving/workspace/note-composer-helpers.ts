/** Shared textarea insert helpers for receiving note composers (label notes, claim body, …). */

import { formatPSTTimestamp } from '@/utils/date';

export const CLAIM_BODY_INSERT_HINT_KEY = 'receiving.claim.body-insert-hint-dismissed';

export function focusTextEnd(el: HTMLTextAreaElement | HTMLInputElement | null) {
  if (!el) return;
  const len = el.value.length;
  el.focus();
  el.setSelectionRange(len, len);
  if ('scrollTop' in el) el.scrollTop = el.scrollHeight;
}

export function appendNoteLine(current: string, addition: string): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return current;
  const trimmedCurrent = current.trimEnd();
  return trimmedCurrent ? `${trimmedCurrent}\n${trimmedAddition}` : trimmedAddition;
}

/** Staff attribution line — matches receive-note stamping (`Name MM/DD/YYYY …`). */
export function buildStaffStampText(opts: {
  name?: string | null;
  staffId?: number | null;
}): string | null {
  const name = opts.name?.trim();
  const staffId = opts.staffId;
  const label =
    name || (staffId != null && Number.isFinite(staffId) && staffId > 0 ? `Staff #${staffId}` : null);
  if (!label) return null;
  return `${label} ${formatPSTTimestamp()}`;
}

/** Zoho PO unit cost — same `$88.77` shape as {@link UnitPriceChip}. */
export function formatUnitPriceForNotes(unitPrice: string | number | null | undefined): string | null {
  if (unitPrice == null || unitPrice === '') return null;
  const n = Number(unitPrice);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

/** Numeric Zendesk id from "#9395", a bare id, or a ticket URL. */
export function parseZendeskTicketId(raw: string | number | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? String(raw) : null;
  const fromUrl = raw.match(/tickets\/(\d+)/);
  const digits = (fromUrl ? fromUrl[1] : raw.replace(/^#/, '')).match(/\d+/);
  if (!digits) return null;
  const n = Number(digits[0]);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
}

/** Fixed square hit target — top-right inserts and bottom-right actions share one size. */
export const NOTE_OVERLAY_ICON_BTN =
  'ds-raw-button inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded';

export const NOTE_OVERLAY_ICON = 'h-3.5 w-3.5';

export const NOTE_RAIL_SPACER_CLASS = 'inline-flex h-[22px] w-[22px] shrink-0';

export const NOTE_TAG_BTN = `${NOTE_OVERLAY_ICON_BTN} text-orange-500 transition hover:bg-orange-100/60 hover:text-orange-600 hover:shadow-sm hover:ring-1 hover:ring-orange-200/80`;

export const NOTE_DOWNLOAD_INSERT_BTN = `${NOTE_OVERLAY_ICON_BTN} text-blue-600 transition hover:bg-blue-100/60 hover:text-blue-700 hover:shadow-sm hover:ring-1 hover:ring-blue-200/80`;

export const NOTE_DOWNLOAD_SYNC_BTN = `${NOTE_OVERLAY_ICON_BTN} text-text-faint transition hover:bg-blue-100/60 hover:text-blue-600 hover:shadow-sm hover:ring-1 hover:ring-blue-200/80`;

export const NOTE_SAVE_BTN = `${NOTE_OVERLAY_ICON_BTN} text-text-faint transition hover:bg-emerald-100/60 hover:text-emerald-600 hover:shadow-sm hover:ring-1 hover:ring-emerald-200/80`;

export const NOTE_STAFF_STAMP_BTN = `${NOTE_OVERLAY_ICON_BTN} text-violet-600 transition hover:bg-violet-100/60 hover:text-violet-700 hover:shadow-sm hover:ring-1 hover:ring-violet-200/80`;

export const NOTE_SERIAL_INSERT_BTN = `${NOTE_OVERLAY_ICON_BTN} text-emerald-600 transition hover:bg-emerald-100/60 hover:text-emerald-700 hover:shadow-sm hover:ring-1 hover:ring-emerald-200/80`;

/** Money / unit cost — distinct from emerald serial identifiers. */
export const NOTE_UNIT_PRICE_BTN = `${NOTE_OVERLAY_ICON_BTN} text-amber-600 transition hover:bg-amber-100/60 hover:text-amber-700 hover:shadow-sm hover:ring-1 hover:ring-amber-200/80`;

export const NOTE_CLEAR_BTN =
  'ds-raw-button rounded px-1.5 py-0.5 text-micro font-semibold text-text-faint transition hover:bg-surface-sunken/80 hover:text-text-muted';
