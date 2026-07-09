/**
 * Adapter: Nextiva call-log rows → {@link TimelineItem}s for the shared
 * {@link EventTimeline}. The Calls support mode is a Monitor — a newest-first
 * org call stream — so it renders through the one timeline primitive rather
 * than a forked list. Direction drives the dot tone; the agent is the actor.
 *
 * See docs/nextiva-voice-support-mode-plan.md §8 (Call Log mode).
 */

import { formatPhoneNumber } from '@/utils/phone';
import type { TimelineItem, TimelineTone } from './types';

export type CallDirection = 'inbound' | 'outbound' | 'missed';

/** Minimal call shape the adapter needs (structurally a subset of the API item). */
export interface CallEventTimelineRow {
  id: number | string;
  direction: CallDirection;
  fromNumber: string | null;
  counterparty: string | null;
  matchedCustomerName: string | null;
  agentName: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
}

const DIRECTION_TONE: Record<CallDirection, TimelineTone> = {
  inbound: 'info',
  outbound: 'muted',
  missed: 'danger',
};

const DIRECTION_TITLE: Record<CallDirection, string> = {
  inbound: 'Inbound call',
  outbound: 'Outbound call',
  missed: 'Missed call',
};

function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function callEventsToTimeline(rows: CallEventTimelineRow[]): TimelineItem[] {
  return rows.map((r) => {
    const num = r.fromNumber ?? r.counterparty;
    const who = r.matchedCustomerName ?? (num ? formatPhoneNumber(num) : 'Unknown caller');

    const parts: string[] = [DIRECTION_TITLE[r.direction]];
    const dur = r.direction === 'missed' ? '' : fmtDuration(r.durationSeconds);
    if (dur) parts.push(dur);
    if (r.matchedCustomerName && num) parts.push(formatPhoneNumber(num));

    return {
      id: `call:${r.id}`,
      at: r.startedAt,
      title: who,
      tone: DIRECTION_TONE[r.direction],
      subtitle: parts.join(' · '),
      actor: r.agentName ?? undefined,
    };
  });
}
