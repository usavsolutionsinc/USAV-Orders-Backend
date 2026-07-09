/**
 * Shared types + constants for the /support master-page sidebar.
 *
 * Support is one contextual sidebar + a mostly-visual right pane (the house
 * sidebar-mode contract). Three top-level modes; `?mode=` in the URL is the
 * single source of truth — never a local `useState`. The default mode
 * (`tickets`) stays on the bare `/support` path for deep-link back-compat.
 *
 * Mirrors `operations-sidebar-shared.ts`. Pure data only — no JSX.
 */

import {
  Bell,
  CheckCircle,
  Clock,
  Inbox,
  Layers,
  Lock,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Voicemail,
} from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

// ── Sidebar mode switcher ───────────────────────────────────────────────────

export type SupportMode = 'tickets' | 'voicemail' | 'calls';

/**
 * - tickets   → Zendesk ticket queue → conversation (Workbench, the existing
 *   console; the default — stays on bare `/support`, no `?mode=`).
 * - voicemail → voicemail / missed-call follow-up to-do list (Workbench):
 *   pick a voicemail → detail + linked case → act (call back, done, assign…).
 * - calls     → org call log (Monitor): observe inbound/outbound/missed,
 *   newest-first, filter-only, no durable selection.
 */
export const SUPPORT_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'tickets', label: 'Tickets', icon: Inbox },
  { id: 'voicemail', label: 'Voicemail', icon: Voicemail },
  { id: 'calls', label: 'Calls', icon: Phone },
];

export const DEFAULT_SUPPORT_MODE: SupportMode = 'tickets';

export function parseSupportMode(raw: string | null | undefined): SupportMode {
  return raw === 'voicemail' || raw === 'calls' ? raw : 'tickets';
}

/**
 * URL params owned by a specific mode. Cleared on a mode switch so the next
 * mode lands on a clean default state (sidebar-mode law #4).
 */
export const SUPPORT_MODE_SCOPED_PARAMS = [
  'ticket', // tickets: selected Zendesk ticket
  'vm', // voicemail: selected voicemail (durable, deep-linkable)
  'q', // search query (voicemail / calls)
  'status', // voicemail follow-up status filter
  'assignee', // voicemail assignee filter
  'direction', // calls: inbound | outbound | missed
  'range', // calls: time window
] as const;

// ── Tickets mode — Zendesk status filter ────────────────────────────────────

export const TICKET_STATUS_ITEMS: HorizontalSliderItem[] = [
  { id: 'open', label: 'Open', icon: Inbox },
  { id: 'pending', label: 'Pending', icon: Clock },
  { id: 'hold', label: 'Hold', icon: Lock },
  { id: 'solved', label: 'Solved', icon: CheckCircle },
  { id: 'all', label: 'All', icon: Layers },
];

// ── Voicemail mode — follow-up status filter ────────────────────────────────

export type VoicemailStatusFilter = 'open' | 'snoozed' | 'done' | 'all';

export const VOICEMAIL_STATUS_ITEMS: HorizontalSliderItem[] = [
  { id: 'open', label: 'Open', icon: Bell },
  { id: 'snoozed', label: 'Snoozed', icon: Clock },
  { id: 'done', label: 'Done', icon: CheckCircle },
  { id: 'all', label: 'All', icon: Layers },
];

export function parseVoicemailStatus(raw: string | null | undefined): VoicemailStatusFilter {
  return raw === 'snoozed' || raw === 'done' || raw === 'all' ? raw : 'open';
}

// ── Calls mode — direction filter ───────────────────────────────────────────

export type CallDirectionFilter = 'all' | 'inbound' | 'outbound' | 'missed';

export const CALL_DIRECTION_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All', icon: Phone },
  { id: 'inbound', label: 'In', icon: PhoneIncoming },
  { id: 'outbound', label: 'Out', icon: PhoneOutgoing },
  { id: 'missed', label: 'Missed', icon: PhoneMissed },
];

export function parseCallDirection(raw: string | null | undefined): CallDirectionFilter {
  return raw === 'inbound' || raw === 'outbound' || raw === 'missed' ? raw : 'all';
}
