/**
 * Voice ingestion — the single idempotent upsert path shared by the realtime
 * webhook and the catch-up poll (nextivaSync). Correctness comes from the
 * UNIQUE(org, provider, external_*_id) keys: a re-delivered webhook or an
 * overlapping sync collapses to a no-op `ON CONFLICT … DO UPDATE`.
 *
 * Deps-injected (real impls by default; fakes in tests) so the matching side
 * effect can be stubbed — mirrors `src/lib/studio/definitions.ts`.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { CallDirection, MatchedCustomer } from './types';
import { toE164 } from './normalize-phone';
import { matchCustomer as defaultMatchCustomer } from './match-customer';

const PROVIDER = 'nextiva';

export interface IngestDeps {
  matchCustomer: (args: { orgId: OrgId; e164: string | null; rawNumber?: string | null }) => Promise<MatchedCustomer | null>;
}

const defaultDeps: IngestDeps = {
  matchCustomer: (args) => defaultMatchCustomer(args),
};

export interface IncomingCallEvent {
  externalCallId: string;
  direction: CallDirection;
  fromNumber?: string | null;
  toNumber?: string | null;
  status?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  raw?: unknown;
  clientEventId?: string | null;
}

export interface IncomingVoicemail {
  externalVmId: string;
  externalCallId?: string | null;
  fromNumber?: string | null;
  mailbox?: string | null;
  leftAt?: string | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  transcript?: string | null;
  raw?: unknown;
  clientEventId?: string | null;
}

export interface IngestResult {
  id: number;
  /** true when this upsert inserted a new row (vs. updated an existing one). */
  created: boolean;
}

/** The customer-facing number for a call, by direction. */
function counterpartyOf(ev: IncomingCallEvent): string | null {
  return ev.direction === 'outbound' ? ev.toNumber ?? null : ev.fromNumber ?? null;
}

export async function recordCallEvent(
  orgId: OrgId,
  ev: IncomingCallEvent,
  deps: IngestDeps = defaultDeps,
): Promise<IngestResult> {
  const rawNumber = counterpartyOf(ev);
  const e164 = toE164(rawNumber);
  const matched = await deps.matchCustomer({ orgId, e164, rawNumber });

  return withTenantTransaction(orgId, async (client) => {
    const r = await client.query<{ id: number; inserted: boolean }>(
      `INSERT INTO call_events
         (provider, external_call_id, direction, from_number, to_number, counterparty_e164,
          status, started_at, ended_at, duration_seconds, matched_customer, raw, client_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
       ON CONFLICT (organization_id, provider, external_call_id)
       DO UPDATE SET
         direction        = EXCLUDED.direction,
         from_number      = EXCLUDED.from_number,
         to_number        = EXCLUDED.to_number,
         counterparty_e164= EXCLUDED.counterparty_e164,
         status           = EXCLUDED.status,
         started_at       = COALESCE(EXCLUDED.started_at, call_events.started_at),
         ended_at         = COALESCE(EXCLUDED.ended_at, call_events.ended_at),
         duration_seconds = COALESCE(EXCLUDED.duration_seconds, call_events.duration_seconds),
         matched_customer = COALESCE(EXCLUDED.matched_customer, call_events.matched_customer),
         raw              = EXCLUDED.raw,
         updated_at       = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        PROVIDER,
        ev.externalCallId,
        ev.direction,
        ev.fromNumber ?? null,
        ev.toNumber ?? null,
        e164,
        ev.status ?? null,
        ev.startedAt ?? null,
        ev.endedAt ?? null,
        ev.durationSeconds ?? null,
        matched ? JSON.stringify(matched) : null,
        ev.raw != null ? JSON.stringify(ev.raw) : null,
        ev.clientEventId ?? null,
      ],
    );
    const row = r.rows[0];
    return { id: Number(row.id), created: Boolean(row.inserted) };
  });
}

export async function recordVoicemail(
  orgId: OrgId,
  vm: IncomingVoicemail,
  deps: IngestDeps = defaultDeps,
): Promise<IngestResult> {
  const e164 = toE164(vm.fromNumber);
  const matched = await deps.matchCustomer({ orgId, e164, rawNumber: vm.fromNumber });

  return withTenantTransaction(orgId, async (client) => {
    // Resolve the parent call_event by its external id, if supplied.
    let callEventId: number | null = null;
    if (vm.externalCallId) {
      const c = await client.query<{ id: number }>(
        `SELECT id FROM call_events
          WHERE organization_id = $1 AND provider = $2 AND external_call_id = $3
          LIMIT 1`,
        [orgId, PROVIDER, vm.externalCallId],
      );
      callEventId = c.rows[0] ? Number(c.rows[0].id) : null;
    }

    const r = await client.query<{ id: number; inserted: boolean }>(
      `INSERT INTO voicemails
         (provider, external_vm_id, call_event_id, from_number, counterparty_e164, mailbox,
          left_at, duration_seconds, recording_url, transcript, matched_customer, raw, client_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
       ON CONFLICT (organization_id, provider, external_vm_id)
       DO UPDATE SET
         call_event_id    = COALESCE(EXCLUDED.call_event_id, voicemails.call_event_id),
         from_number      = EXCLUDED.from_number,
         counterparty_e164= EXCLUDED.counterparty_e164,
         mailbox          = EXCLUDED.mailbox,
         left_at          = COALESCE(EXCLUDED.left_at, voicemails.left_at),
         duration_seconds = COALESCE(EXCLUDED.duration_seconds, voicemails.duration_seconds),
         recording_url    = COALESCE(EXCLUDED.recording_url, voicemails.recording_url),
         transcript       = COALESCE(EXCLUDED.transcript, voicemails.transcript),
         matched_customer = COALESCE(EXCLUDED.matched_customer, voicemails.matched_customer),
         raw              = EXCLUDED.raw,
         updated_at       = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        PROVIDER,
        vm.externalVmId,
        callEventId,
        vm.fromNumber ?? null,
        e164,
        vm.mailbox ?? null,
        vm.leftAt ?? null,
        vm.durationSeconds ?? null,
        vm.recordingUrl ?? null,
        vm.transcript ?? null,
        matched ? JSON.stringify(matched) : null,
        vm.raw != null ? JSON.stringify(vm.raw) : null,
        vm.clientEventId ?? null,
      ],
    );
    const row = r.rows[0];
    const voicemailId = Number(row.id);

    // Auto-create the open follow-up (idempotent — one per voicemail).
    await client.query(
      `INSERT INTO voicemail_followups (voicemail_id, status)
       VALUES ($1, 'open')
       ON CONFLICT (organization_id, voicemail_id) DO NOTHING`,
      [voicemailId],
    );

    return { id: voicemailId, created: Boolean(row.inserted) };
  });
}
