/**
 * ai-meter-reporter — pushes billed AI usage to a Stripe Billing Meter
 * (margin billing for platform-carried AI; docs/ai-search-modernization-plan.md).
 *
 * Env-gated: a NO-OP until STRIPE_AI_METER_EVENT_NAME is set (the Meter's
 * event_name from the Stripe dashboard). Runs from the daily cleanup cron.
 *
 * Semantics:
 *   - Only PLATFORM-carried usage bills through us (provider='platform');
 *     BYOK rows are billed by the tenant's own provider — they're marked
 *     reported (so the unreported set stays lean) but contribute $0.
 *   - Billed cents = estimated provider cost × (1 + per-org margin). The
 *     margin resolves per org from the DB (organizations.settings) at report
 *     time — see getAiUsageMarginPercent.
 *   - Tenants come from DB rows only: orgs are whatever the usage table +
 *     organizations table say; an org without a stripe_customer_id is
 *     skipped (rows left unreported) until billing is set up for it.
 *   - Idempotent at two levels: rows are marked stripe_reported_at in the
 *     same flow, and the meter event identifier is derived from the row-id
 *     range so a crash-retry can't double-bill.
 */

import pool from '@/lib/db';
import { reportAiUsageMeterEvent } from '@/lib/billing/stripe';
import { getAiUsageMarginPercent } from '@/lib/ai/usage';
import { applyMarginMicrocents } from '@/lib/ai/model-pricing';
import type { OrgId } from '@/lib/tenancy/constants';

const MICROCENTS_PER_CENT = 1_000_000;

export interface AiMeterReportResult {
  configured: boolean;
  rowsProcessed: number;
  orgsReported: number;
  orgsSkippedNoCustomer: number;
  centsReported: number;
}

export async function reportAiUsageToStripe(
  opts: { limit?: number } = {},
): Promise<AiMeterReportResult> {
  const eventName = String(process.env.STRIPE_AI_METER_EVENT_NAME || '').trim();
  const result: AiMeterReportResult = {
    configured: Boolean(eventName),
    rowsProcessed: 0,
    orgsReported: 0,
    orgsSkippedNoCustomer: 0,
    centsReported: 0,
  };
  if (!eventName) return result;

  const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 10_000);
  // Tenants from the DB: usage rows joined to their org's Stripe customer.
  const res = await pool.query(
    `SELECT u.id, u.organization_id, u.provider, u.cost_microcents,
            o.stripe_customer_id
     FROM ai_usage_events u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.stripe_reported_at IS NULL
     ORDER BY u.id
     LIMIT $1`,
    [limit],
  );
  if (res.rows.length === 0) return result;

  const byOrg = new Map<
    OrgId,
    { ids: number[]; platformMicrocents: number; customerId: string | null }
  >();
  for (const row of res.rows) {
    const orgId = String(row.organization_id) as OrgId;
    const entry = byOrg.get(orgId) ?? { ids: [], platformMicrocents: 0, customerId: null };
    entry.ids.push(Number(row.id));
    entry.customerId = row.stripe_customer_id ? String(row.stripe_customer_id) : null;
    if (row.provider === 'platform' && row.cost_microcents != null) {
      entry.platformMicrocents += Number(row.cost_microcents);
    }
    byOrg.set(orgId, entry);
  }

  for (const [orgId, entry] of byOrg) {
    if (!entry.customerId) {
      // No Stripe customer yet — leave the rows unreported; they bill once
      // the org completes billing setup.
      result.orgsSkippedNoCustomer += 1;
      continue;
    }
    const marginPercent = await getAiUsageMarginPercent(orgId);
    const billedCents = Math.round(
      applyMarginMicrocents(entry.platformMicrocents, marginPercent) / MICROCENTS_PER_CENT,
    );
    if (billedCents > 0) {
      await reportAiUsageMeterEvent({
        eventName,
        stripeCustomerId: entry.customerId,
        valueCents: billedCents,
        // Row-id-range identifier — a crash between report and mark makes the
        // retry a Stripe-side duplicate no-op instead of a double bill.
        idempotencyKey: `ai-usage:${orgId}:${entry.ids[0]}-${entry.ids[entry.ids.length - 1]}`,
      });
      result.orgsReported += 1;
      result.centsReported += billedCents;
    }
    await pool.query(
      `UPDATE ai_usage_events SET stripe_reported_at = now() WHERE id = ANY($1::bigint[])`,
      [entry.ids],
    );
    result.rowsProcessed += entry.ids.length;
  }

  return result;
}
