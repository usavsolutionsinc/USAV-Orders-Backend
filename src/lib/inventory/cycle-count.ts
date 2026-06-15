/**
 * cycle-count.ts
 * ────────────────────────────────────────────────────────────────────
 * Operations on the Phase 0 cycle_count_campaigns / cycle_count_lines
 * tables (migration 2026-05-14_cycle_counts.sql).
 *
 * Lifecycle of a campaign:
 *   1. createCampaign(name, varianceTol)
 *        - INSERTs the campaign (status='open').
 *        - Snapshots every (location_id, sku) in bin_contents into
 *          cycle_count_lines (status='pending', expected_qty = qty).
 *   2. submitCount(lineId, countedQty)
 *        - UPDATE counted_qty + counted_by + counted_at.
 *        - Auto-routes status:
 *            within campaign.variance_tol  →  'counted' (will auto-
 *                                              approve on closeCampaign)
 *            outside tolerance            →  'pending_review' (admin
 *                                              must approve or reject)
 *   3. approveLine(lineId)
 *        - UPDATE bin_contents.qty = counted_qty + last_counted = NOW().
 *        - INSERT sku_stock_ledger row with the variance delta
 *          (reason='CYCLE_COUNT_ADJ').
 *        - UPDATE line status='approved' + approved_by + approved_at.
 *   4. rejectLine(lineId)
 *        - UPDATE line status='rejected'. No stock changes.
 *   5. closeCampaign(campaignId)
 *        - Auto-approves remaining 'counted' lines (those that came in
 *          within tolerance) in one pass.
 *        - UPDATE campaign status='closed' + closed_at.
 *
 * All five operations are single-transaction. No feature-flag gate
 * here — cycle count is an always-available admin tool.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// ─── Campaign creation ──────────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string;
  /** Auto-approve threshold. 0.05 = 5%. Range 0..1 (validated). */
  varianceTol: number;
  createdByStaffId: number | null;
  /** Owning org — scopes the bin_contents snapshot and stamps every row. */
  organizationId: OrgId;
}

export interface CreateCampaignResult {
  campaignId: number;
  lineCount: number;
}

export async function createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
  const name = input.name?.trim();
  if (!name) throw new Error('campaign name required');
  const tol = Number(input.varianceTol);
  if (!Number.isFinite(tol) || tol < 0 || tol > 1) {
    throw new Error(`varianceTol must be in [0,1], got ${input.varianceTol}`);
  }
  const orgId = input.organizationId;

  return withTenantTransaction<CreateCampaignResult>(orgId, async (client) => {
    const campaignQ = await client.query<{ id: number }>(
      `INSERT INTO cycle_count_campaigns (name, variance_tol, status, created_by, organization_id)
       VALUES ($1, $2, 'open', $3, $4)
       RETURNING id`,
      [name, tol.toFixed(4), input.createdByStaffId, orgId],
    );
    const campaignId = campaignQ.rows[0]?.id;
    if (!campaignId) throw new Error('campaign insert returned no id');

    // Snapshot only THIS org's bins; stamp each line with the org so the
    // campaign + its lines are isolated end-to-end.
    const linesQ = await client.query<{ n: number }>(
      `WITH ins AS (
         INSERT INTO cycle_count_lines (campaign_id, bin_id, sku, expected_qty, status, organization_id)
         SELECT $1, bc.location_id, bc.sku, bc.qty, 'pending', $2
           FROM bin_contents bc
          WHERE bc.organization_id = $2
            AND (bc.qty > 0 OR bc.last_counted IS NULL)
         ON CONFLICT (campaign_id, bin_id, sku) DO NOTHING
         RETURNING 1
       )
       SELECT COUNT(*)::int AS n FROM ins`,
      [campaignId, orgId],
    );

    return { campaignId, lineCount: linesQ.rows[0]?.n ?? 0 };
  });
}

// ─── Submit a count ─────────────────────────────────────────────────────────

export interface SubmitCountInput {
  lineId: number;
  countedQty: number;
  countedByStaffId: number | null;
  organizationId: OrgId;
}

export interface SubmitCountResult {
  lineId: number;
  expectedQty: number;
  countedQty: number;
  variance: number;
  varianceFraction: number;
  status: 'counted' | 'pending_review';
}

export async function submitCount(input: SubmitCountInput): Promise<SubmitCountResult> {
  if (!Number.isInteger(input.countedQty) || input.countedQty < 0) {
    throw new Error(`countedQty must be a non-negative integer, got ${input.countedQty}`);
  }

  const orgId = input.organizationId;
  return withTenantTransaction<SubmitCountResult>(orgId, async (client) => {
    const lineQ = await client.query<{
      id: number;
      campaign_id: number;
      expected_qty: number;
      variance_tol: string;
    }>(
      `SELECT l.id, l.campaign_id, l.expected_qty,
              c.variance_tol::text AS variance_tol
         FROM cycle_count_lines l
         JOIN cycle_count_campaigns c ON c.id = l.campaign_id AND c.organization_id = l.organization_id
        WHERE l.id = $1 AND l.organization_id = $2
        FOR UPDATE OF l`,
      [input.lineId, orgId],
    );
    const line = lineQ.rows[0];
    if (!line) throw new Error(`cycle_count_lines id ${input.lineId} not found`);

    const expected = Number(line.expected_qty);
    const variance = input.countedQty - expected;
    const varianceFraction = expected > 0 ? Math.abs(variance) / expected : (variance === 0 ? 0 : Infinity);
    const tolerance = Number(line.variance_tol);
    const status: 'counted' | 'pending_review' =
      varianceFraction <= tolerance ? 'counted' : 'pending_review';

    await client.query(
      `UPDATE cycle_count_lines
          SET counted_qty = $1,
              counted_by = $2,
              counted_at = NOW(),
              status = $3,
              updated_at = NOW()
        WHERE id = $4 AND organization_id = $5`,
      [input.countedQty, input.countedByStaffId, status, input.lineId, orgId],
    );

    return {
      lineId: input.lineId,
      expectedQty: expected,
      countedQty: input.countedQty,
      variance,
      varianceFraction,
      status,
    };
  });
}

// ─── Approve a line (writes ledger + bin_contents) ──────────────────────────

export interface ApproveLineInput {
  lineId: number;
  approvedByStaffId: number | null;
  organizationId: OrgId;
}

export interface ApproveLineResult {
  lineId: number;
  variance: number;
  ledgerId: number | null;
}

export async function approveLine(input: ApproveLineInput): Promise<ApproveLineResult> {
  const orgId = input.organizationId;
  return withTenantTransaction<ApproveLineResult>(orgId, async (client) => {
    const lineQ = await client.query<{
      id: number;
      bin_id: number;
      sku: string;
      expected_qty: number;
      counted_qty: number | null;
      status: string;
    }>(
      `SELECT id, bin_id, sku, expected_qty, counted_qty, status::text AS status
         FROM cycle_count_lines
        WHERE id = $1 AND organization_id = $2
        FOR UPDATE`,
      [input.lineId, orgId],
    );
    const line = lineQ.rows[0];
    if (!line) throw new Error(`cycle_count_lines id ${input.lineId} not found`);
    if (line.counted_qty == null) throw new Error('cannot approve a line with no counted_qty');
    if (line.status === 'approved' || line.status === 'rejected') {
      throw new Error(`line already ${line.status}`);
    }

    const variance = line.counted_qty - line.expected_qty;
    let ledgerId: number | null = null;
    if (variance !== 0) {
      const ledgerQ = await client.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger (
           sku, delta, reason, dimension, staff_id, notes, organization_id
         )
         VALUES ($1, $2, 'CYCLE_COUNT_ADJ', 'WAREHOUSE', $3, $4, $5)
         RETURNING id`,
        [
          line.sku,
          variance,
          input.approvedByStaffId,
          `cycle_count line=${line.id} bin=${line.bin_id} expected=${line.expected_qty} counted=${line.counted_qty}`,
          orgId,
        ],
      );
      ledgerId = ledgerQ.rows[0]?.id ?? null;
    }

    // Reflect the count on bin_contents so the bin-level view matches.
    // bin_contents UNIQUE(location_id, sku) — direct UPDATE is safe.
    await client.query(
      `UPDATE bin_contents
          SET qty = $1,
              last_counted = NOW(),
              updated_at = NOW()
        WHERE location_id = $2 AND sku = $3 AND organization_id = $4`,
      [line.counted_qty, line.bin_id, line.sku, orgId],
    );

    await client.query(
      `UPDATE cycle_count_lines
          SET status = 'approved',
              approved_by = $1,
              approved_at = NOW(),
              updated_at = NOW()
        WHERE id = $2 AND organization_id = $3`,
      [input.approvedByStaffId, input.lineId, orgId],
    );

    return { lineId: input.lineId, variance, ledgerId };
  });
}

// ─── Reject a line (no stock changes) ───────────────────────────────────────

export async function rejectLine(input: { lineId: number; approvedByStaffId: number | null; organizationId: OrgId }): Promise<void> {
  const orgId = input.organizationId;
  await withTenantTransaction(orgId, async (client) => {
    const r = await client.query(
      `UPDATE cycle_count_lines
          SET status = 'rejected',
              approved_by = $1,
              approved_at = NOW(),
              updated_at = NOW()
        WHERE id = $2
          AND organization_id = $3
          AND status IN ('counted', 'pending_review', 'pending')`,
      [input.approvedByStaffId, input.lineId, orgId],
    );
    if (r.rowCount === 0) {
      throw new Error('line not found or already finalized');
    }
  });
}

// ─── Close campaign (auto-approves remaining 'counted' lines) ───────────────

export interface CloseCampaignInput {
  campaignId: number;
  approvedByStaffId: number | null;
  organizationId: OrgId;
}

export interface CloseCampaignResult {
  campaignId: number;
  autoApproved: number;
  pendingReviewSkipped: number;
}

export async function closeCampaign(input: CloseCampaignInput): Promise<CloseCampaignResult> {
  const orgId = input.organizationId;
  return withTenantTransaction<CloseCampaignResult>(orgId, async (client) => {
    // Find every 'counted' line — those are within tolerance and ready for
    // auto-approval. Process one at a time so each gets its own ledger
    // row + bin_contents update.
    const countedQ = await client.query<{ id: number }>(
      `SELECT id FROM cycle_count_lines
        WHERE campaign_id = $1 AND organization_id = $2 AND status = 'counted'
        ORDER BY id ASC`,
      [input.campaignId, orgId],
    );

    let autoApproved = 0;
    for (const row of countedQ.rows) {
      // Inline the approve logic to keep one transaction. Calling
      // approveLine() here would nest a transaction; pg doesn't allow
      // that and even if it did the lock semantics get muddled.
      const lineQ = await client.query<{
        id: number;
        bin_id: number;
        sku: string;
        expected_qty: number;
        counted_qty: number | null;
      }>(
        `SELECT id, bin_id, sku, expected_qty, counted_qty
           FROM cycle_count_lines WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [row.id, orgId],
      );
      const l = lineQ.rows[0];
      if (!l || l.counted_qty == null) continue;
      const variance = l.counted_qty - l.expected_qty;
      if (variance !== 0) {
        await client.query(
          `INSERT INTO sku_stock_ledger (
             sku, delta, reason, dimension, staff_id, notes, organization_id
           )
           VALUES ($1, $2, 'CYCLE_COUNT_ADJ', 'WAREHOUSE', $3, $4, $5)`,
          [
            l.sku, variance, input.approvedByStaffId,
            `cycle_count close campaign=${input.campaignId} line=${l.id} expected=${l.expected_qty} counted=${l.counted_qty}`,
            orgId,
          ],
        );
      }
      await client.query(
        `UPDATE bin_contents
            SET qty = $1, last_counted = NOW(), updated_at = NOW()
          WHERE location_id = $2 AND sku = $3 AND organization_id = $4`,
        [l.counted_qty, l.bin_id, l.sku, orgId],
      );
      await client.query(
        `UPDATE cycle_count_lines
            SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND organization_id = $3`,
        [input.approvedByStaffId, l.id, orgId],
      );
      autoApproved += 1;
    }

    // Count anything still pending review — those are NOT auto-approved
    // and stay in the campaign for an admin to manually resolve later.
    const pendingQ = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM cycle_count_lines
        WHERE campaign_id = $1 AND organization_id = $2 AND status = 'pending_review'`,
      [input.campaignId, orgId],
    );

    await client.query(
      `UPDATE cycle_count_campaigns
          SET status = 'closed', closed_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [input.campaignId, orgId],
    );

    return {
      campaignId: input.campaignId,
      autoApproved,
      pendingReviewSkipped: pendingQ.rows[0]?.n ?? 0,
    };
  });
}
