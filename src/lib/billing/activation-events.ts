/**
 * Activation instrumentation — records onboarding/activation milestones
 * (first integration connected, first order synced, …) so the SaaS funnel can
 * be measured per-org. Writes to the existing `ops_events` spine via
 * `recordOpsEvent` (src/lib/ops-events.ts) under `entity_type = 'other'`
 * (org-level events have no business-entity anchor; entity_id = 0) with
 * `event_type = 'activation.<event>'`.
 *
 * No-op-safe by contract: instrumentation must NEVER break the product path,
 * so failures are logged and swallowed. Deps-injected for DB-free tests.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import { recordOpsEvent, type RecordOpsEventInput } from '@/lib/ops-events';

/** Known activation milestones. String-typed union so new milestones are
 *  additive (the ops_events side is free-text `event_type`). */
export type ActivationEvent =
  | 'signup_completed'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'first_integration_connected'
  | 'first_order_synced'
  | 'first_unit_received'
  | 'first_label_printed'
  | (string & {});

export interface ActivationEventOpts {
  actorStaffId?: number | null;
  /** Thread for idempotency — a retry with the same id is a no-op. */
  clientEventId?: string | null;
  payload?: Record<string, unknown>;
}

export interface ActivationEventDeps {
  recordOpsEvent: (input: RecordOpsEventInput) => Promise<void>;
}

const defaultDeps: ActivationEventDeps = { recordOpsEvent };

/**
 * Record an activation milestone for an org. Never throws — a failed write is
 * logged (structured) and dropped so instrumentation cannot break the caller.
 */
export async function recordActivationEvent(
  orgId: OrgId,
  event: ActivationEvent,
  opts: ActivationEventOpts = {},
  deps: ActivationEventDeps = defaultDeps,
): Promise<void> {
  try {
    await deps.recordOpsEvent({
      organizationId: orgId,
      entityType: 'other',
      entityId: 0,
      eventType: `activation.${event}`,
      actorStaffId: opts.actorStaffId ?? null,
      clientEventId: opts.clientEventId ?? null,
      payload: opts.payload ?? {},
    });
  } catch (err) {
    console.warn(
      '[activation-events] dropped',
      JSON.stringify({ orgId, event, error: err instanceof Error ? err.message : String(err) }),
    );
  }
}
