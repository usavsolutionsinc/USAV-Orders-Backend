/**
 * Nextiva connector sync — the CATCH-UP / reconciliation path. Webhooks are the
 * realtime path; this poll backfills anything missed while the webhook endpoint
 * was unreachable. Both converge on the same idempotent upsert (recordCallEvent
 * / recordVoicemail keyed on UNIQUE(org, provider, external_*_id)), so a webhook
 * + a later sync of the same event is a no-op.
 *
 * The REST list endpoints + cursor are confirmed in the Phase 0 spike
 * (docs/nextiva-voice-support-mode-plan.md §9.3). Until then this returns a
 * clean no-op outcome when connected, and an error outcome when not — never
 * throws, so the sync orchestrator/cron stays green.
 */

import { getIntegrationCredentials, type NextivaCredentials } from '@/lib/integrations/credentials';
import type { OrgId } from '@/lib/tenancy/constants';
import type { SyncOutcome } from './types';

export async function nextivaSync(
  orgId: OrgId,
  _opts?: { full?: boolean; cursor?: unknown },
): Promise<SyncOutcome> {
  const creds = await getIntegrationCredentials<NextivaCredentials>(orgId, 'nextiva');
  if (!creds || !creds.apiKey) {
    return { ok: false, error: 'nextiva not connected' };
  }

  // TODO(spike §9.3): page the call-log + voicemail list endpoints since
  // `_opts.cursor`, mapping each row through recordCallEvent / recordVoicemail,
  // and return the new high-watermark as `cursor`. Implemented as a no-op until
  // the endpoints/pagination are pinned.
  return { ok: true, imported: 0, updated: 0, cursor: _opts?.cursor ?? null };
}
