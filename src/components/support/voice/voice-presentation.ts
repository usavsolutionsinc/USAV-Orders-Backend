/**
 * Voice (Nextiva) presentation SoT — shared types, tone/label registries, and
 * pure formatters for the Voicemail (Workbench) and Call Log (Monitor) support
 * modes. Mirrors the house rule "format in lib, render dumb": views pick a
 * status/direction and the registry maps it to a label + tone; no view inlines
 * a colour or a label map.
 *
 * Pure data only — no JSX, no hooks.
 */

import { formatPhoneNumber } from '@/utils/phone';

// ── Wire shapes (the frontend's view of the planned /api/voicemails +
//    /api/call-events payloads — see docs/nextiva-voice-support-mode-plan.md) ─

export type VoicemailStatus = 'open' | 'snoozed' | 'done' | 'no_action';
export type CallDirection = 'inbound' | 'outbound' | 'missed';

export interface VoicemailListItem {
  id: number;
  fromNumber: string | null;
  /** Already-normalized E.164 counterparty (matching key). */
  counterparty: string | null;
  matchedCustomerName: string | null;
  mailbox: string | null;
  leftAt: string | null;
  durationSeconds: number | null;
  isRead: boolean;
  transcriptPreview: string | null;
  followupStatus: VoicemailStatus;
  assignedStaffName: string | null;
  linkedTicketId: number | null;
}

export interface VoicemailDetailData extends VoicemailListItem {
  transcript: string | null;
  /** Same-origin proxy URL (never the raw Nextiva URL). */
  recordingUrl: string | null;
  snoozeUntil: string | null;
  note: string | null;
  linkedOrderId: number | null;
}

export interface CallEventItem {
  id: number;
  direction: CallDirection;
  fromNumber: string | null;
  toNumber: string | null;
  counterparty: string | null;
  matchedCustomerName: string | null;
  agentName: string | null;
  status: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
}

// ── Tone registry ────────────────────────────────────────────────────────────

export interface ToneClasses {
  /** Solid dot fill. */
  dot: string;
  /** Chip: bg + text + ring (the house 3-layer chip). */
  chip: string;
  /** Foreground accent for an icon. */
  fg: string;
}

export const VOICEMAIL_STATUS_TONE: Record<VoicemailStatus, ToneClasses> = {
  open: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200', fg: 'text-amber-600' },
  snoozed: { dot: 'bg-blue-400', chip: 'bg-blue-50 text-blue-700 ring-blue-200', fg: 'text-blue-600' },
  done: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', fg: 'text-emerald-600' },
  no_action: { dot: 'bg-gray-300', chip: 'bg-gray-100 text-gray-600 ring-gray-200', fg: 'text-gray-400' },
};

export const VOICEMAIL_STATUS_LABEL: Record<VoicemailStatus, string> = {
  open: 'Open',
  snoozed: 'Snoozed',
  done: 'Done',
  no_action: 'No action',
};

export const CALL_DIRECTION_TONE: Record<CallDirection, ToneClasses> = {
  inbound: { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 ring-blue-200', fg: 'text-blue-600' },
  outbound: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-200', fg: 'text-slate-500' },
  missed: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200', fg: 'text-rose-600' },
};

export const CALL_DIRECTION_LABEL: Record<CallDirection, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  missed: 'Missed',
};

// ── Pure formatters ───────────────────────────────────────────────────────────

/** Display name for a row: matched customer, else formatted number, else "Unknown". */
export function displayCounterparty(
  row: { matchedCustomerName: string | null; fromNumber: string | null; counterparty: string | null },
): string {
  if (row.matchedCustomerName) return row.matchedCustomerName;
  const num = row.fromNumber ?? row.counterparty;
  if (num) return formatPhoneNumber(num);
  return 'Unknown caller';
}

/** The raw number, formatted, when we also have a matched name (shown as meta). */
export function displayNumber(row: { fromNumber: string | null; counterparty: string | null }): string {
  const num = row.fromNumber ?? row.counterparty;
  return num ? formatPhoneNumber(num) : '';
}

/** Compact mm:ss for a call/voicemail length. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Coarse relative time ("just now", "12m", "3h", "2d", else a short date). */
export function timeAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, nowMs - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
