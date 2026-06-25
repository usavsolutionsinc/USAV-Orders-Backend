/**
 * Voice (Nextiva) domain types — the lib-side DTOs returned by the query/ingest
 * helpers and serialized verbatim by the API routes. The frontend
 * `voice-presentation.ts` declares structurally-identical view types; keeping
 * the DTOs here (lib) avoids a components→lib import inversion.
 */

export type CallDirection = 'inbound' | 'outbound' | 'missed';
export type VoicemailStatus = 'open' | 'snoozed' | 'done' | 'no_action';

/** Best-effort customer match attached to a call/voicemail. */
export interface MatchedCustomer {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Where the match came from — for provenance / debugging. */
  source: 'square' | 'customers' | 'orders' | 'zendesk' | null;
}

export interface VoicemailListItemDTO {
  id: number;
  fromNumber: string | null;
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

export interface VoicemailDetailDTO extends VoicemailListItemDTO {
  transcript: string | null;
  /** Same-origin proxy URL (never the raw Nextiva URL). null when no recording. */
  recordingUrl: string | null;
  snoozeUntil: string | null;
  note: string | null;
  linkedOrderId: number | null;
}

export interface CallEventDTO {
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

/** Coerce a pg timestamptz (Date | string | null) to an ISO string or null. */
export function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
