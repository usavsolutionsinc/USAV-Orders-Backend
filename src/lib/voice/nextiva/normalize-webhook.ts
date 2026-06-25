/**
 * Normalize a Nextiva webhook payload into our ingest shapes.
 *
 * The EXACT Nextiva event schema is confirmed in the Phase 0 spike
 * (docs/nextiva-voice-support-mode-plan.md §9). This parser is intentionally
 * defensive: it reads a generic `{ event, data }` envelope, maps the fields we
 * know we need, and returns empty arrays for anything it doesn't recognize — so
 * an unknown/extra event type is a no-op, never a 500. Adjust the field paths
 * once the spike pins the real schema; callers (the webhook route) don't change.
 */

import type { CallDirection } from '@/lib/voice/types';
import type { IncomingCallEvent, IncomingVoicemail } from '@/lib/voice/ingest';

export interface NormalizedWebhook {
  calls: IncomingCallEvent[];
  voicemails: IncomingVoicemail[];
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDirection(v: unknown): CallDirection {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('out')) return 'outbound';
  if (s.includes('miss') || s.includes('no_answer') || s.includes('noanswer')) return 'missed';
  return 'inbound';
}

/** Pull the event name + data object out of a few plausible envelope shapes. */
function envelope(payload: unknown): { event: string; data: Record<string, unknown> } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const event = String(p.event ?? p.type ?? p.eventType ?? '').toLowerCase();
  const data = (p.data ?? p.payload ?? p) as Record<string, unknown>;
  return { event, data: data && typeof data === 'object' ? data : {} };
}

export function normalizeNextivaWebhook(payload: unknown): NormalizedWebhook {
  const { event, data } = envelope(payload);
  const out: NormalizedWebhook = { calls: [], voicemails: [] };

  const externalCallId = str(data.callId ?? data.call_id ?? data.id ?? data.sessionId);

  // Voicemail created.
  if (event.includes('voicemail')) {
    const externalVmId = str(data.voicemailId ?? data.voicemail_id ?? data.id);
    if (externalVmId) {
      out.voicemails.push({
        externalVmId,
        externalCallId,
        fromNumber: str(data.from ?? data.fromNumber ?? data.caller ?? data.callerNumber),
        mailbox: str(data.mailbox ?? data.extension ?? data.to),
        leftAt: str(data.createdAt ?? data.timestamp ?? data.leftAt),
        durationSeconds: num(data.duration ?? data.durationSeconds),
        recordingUrl: str(data.recordingUrl ?? data.recording_url ?? data.mediaUrl),
        transcript: str(data.transcript ?? data.transcription),
        raw: payload,
      });
    }
    return out;
  }

  // Call lifecycle (started / ended / missed).
  if (event.includes('call') && externalCallId) {
    out.calls.push({
      externalCallId,
      direction: toDirection(data.direction ?? data.callDirection ?? event),
      fromNumber: str(data.from ?? data.fromNumber ?? data.caller),
      toNumber: str(data.to ?? data.toNumber ?? data.callee ?? data.dialed),
      status: str(data.status ?? data.state ?? event),
      startedAt: str(data.startedAt ?? data.startTime ?? data.timestamp),
      endedAt: str(data.endedAt ?? data.endTime),
      durationSeconds: num(data.duration ?? data.durationSeconds),
      raw: payload,
    });
  }

  return out;
}
