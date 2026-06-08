/**
 * Post-warranty paid-repair quoting (Phase 6).
 *
 * For a DENIED / EXPIRED claim, staff can quote a paid repair. The quote moves
 * DRAFT → SENT → ACCEPTED | DECLINED; on ACCEPTED it hands the job off to a
 * repair_service ticket (paid intake) and links it to the claim — closing the
 * loop into the existing repair module rather than a parallel workflow.
 *
 * `computeQuoteTotals` is pure + unit-tested.
 */

import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import type { WarrantyQuoteRow, WarrantyQuoteLineItem, WarrantyQuoteStatus } from './types';

export function computeQuoteTotals(
  lineItems: WarrantyQuoteLineItem[],
  tax = 0,
): { subtotal: number; total: number } {
  const subtotal = (lineItems || []).reduce((sum, li) => {
    const qty = Number(li.qty) || 0;
    const unit = Number(li.unitPrice) || 0;
    return sum + qty * unit;
  }, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const sub = round2(subtotal);
  return { subtotal: sub, total: round2(sub + (Number(tax) || 0)) };
}

async function nextQuoteNumber(client: PoolClient): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await client.query<{ next_seq: number }>(
    `SELECT COALESCE(MAX((regexp_replace(quote_number, '^WQ-\\d{4}-', ''))::int), 0) + 1 AS next_seq
       FROM warranty_quotes WHERE quote_number LIKE $1`,
    [`WQ-${year}-%`],
  );
  return `WQ-${year}-${String(rows[0]?.next_seq ?? 1).padStart(5, '0')}`;
}

function mapQuote(r: {
  id: string | number;
  quote_number: string;
  line_items: unknown;
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  status: WarrantyQuoteStatus;
  sent_at: string | null;
  responded_at: string | null;
  valid_until: string | null;
  created_at: string;
}): WarrantyQuoteRow {
  return {
    id: Number(r.id),
    quoteNumber: r.quote_number,
    lineItems: Array.isArray(r.line_items) ? (r.line_items as WarrantyQuoteLineItem[]) : [],
    subtotal: r.subtotal,
    tax: r.tax,
    total: r.total,
    status: r.status,
    sentAt: r.sent_at,
    respondedAt: r.responded_at,
    validUntil: r.valid_until,
    createdAt: r.created_at,
  };
}

const QUOTE_SELECT = `
  id, quote_number, line_items, subtotal::text AS subtotal, tax::text AS tax, total::text AS total,
  status, sent_at::text AS sent_at, responded_at::text AS responded_at,
  valid_until::text AS valid_until, created_at::text AS created_at
`;

export async function listQuotes(claimId: number): Promise<WarrantyQuoteRow[]> {
  const { rows } = await pool.query(
    `SELECT ${QUOTE_SELECT} FROM warranty_quotes WHERE claim_id = $1 ORDER BY created_at DESC, id DESC`,
    [claimId],
  );
  return rows.map(mapQuote);
}

export type CreateQuoteResult =
  | { ok: true; quote: WarrantyQuoteRow }
  | { ok: false; status: 404 | 400 | 500; error: string };

export async function createQuote(
  claimId: number,
  args: {
    lineItems: WarrantyQuoteLineItem[];
    tax?: number | null;
    validUntil?: string | null;
    createdByStaffId: number;
  },
): Promise<CreateQuoteResult> {
  if (!args.lineItems || args.lineItems.length === 0) {
    return { ok: false, status: 400, error: 'at least one line item is required' };
  }
  const tax = Number(args.tax) || 0;
  const { subtotal, total } = computeQuoteTotals(args.lineItems, tax);

  const client = await pool.connect();
  try {
    const exists = await client.query(`SELECT 1 FROM warranty_claims WHERE id = $1`, [claimId]);
    if (exists.rowCount === 0) return { ok: false, status: 404, error: 'claim not found' };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const quoteNumber = await nextQuoteNumber(client);
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO warranty_quotes
             (claim_id, quote_number, line_items, subtotal, tax, total, valid_until, created_by_staff_id)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
           RETURNING ${QUOTE_SELECT}`,
          [
            claimId,
            quoteNumber,
            JSON.stringify(args.lineItems),
            subtotal,
            tax,
            total,
            args.validUntil ?? null,
            args.createdByStaffId,
          ],
        );
        await client.query(
          `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id)
           VALUES ($1, 'QUOTE_CREATED', $2::jsonb, $3)`,
          [claimId, JSON.stringify({ quoteNumber, total }), args.createdByStaffId],
        );
        await client.query('COMMIT');
        return { ok: true, quote: mapQuote(rows[0]) };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        const message = err instanceof Error ? err.message : '';
        if (/duplicate key value/i.test(message) && attempt < 2) continue;
        return { ok: false, status: 500, error: message || 'create quote failed' };
      }
    }
    return { ok: false, status: 500, error: 'failed to generate a unique quote number' };
  } finally {
    client.release();
  }
}

const QUOTE_TRANSITIONS: Record<string, { from: WarrantyQuoteStatus[]; setTimestamp?: 'sent_at' | 'responded_at' }> = {
  SENT: { from: ['DRAFT'], setTimestamp: 'sent_at' },
  ACCEPTED: { from: ['SENT'], setTimestamp: 'responded_at' },
  DECLINED: { from: ['SENT'], setTimestamp: 'responded_at' },
  EXPIRED: { from: ['DRAFT', 'SENT'] },
};

export type QuoteStatusResult =
  | { ok: true; quote: WarrantyQuoteRow; repairServiceId?: number }
  | { ok: false; status: 404 | 409 | 400 | 500; error: string };

export async function setQuoteStatus(
  quoteId: number,
  nextStatus: WarrantyQuoteStatus,
  actorStaffId: number | null,
): Promise<QuoteStatusResult> {
  const rule = QUOTE_TRANSITIONS[nextStatus];
  if (!rule) return { ok: false, status: 400, error: `unsupported quote status ${nextStatus}` };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ status: WarrantyQuoteStatus; claim_id: string | number }>(
      `SELECT status, claim_id FROM warranty_quotes WHERE id = $1 FOR UPDATE`,
      [quoteId],
    );
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'quote not found' };
    }
    const from = cur.rows[0].status;
    const claimId = Number(cur.rows[0].claim_id);
    if (!rule.from.includes(from)) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `quote is ${from}; cannot move to ${nextStatus}` };
    }

    const tsCol = rule.setTimestamp ? `, ${rule.setTimestamp} = NOW()` : '';
    const { rows } = await client.query(
      `UPDATE warranty_quotes SET status = $2, updated_at = NOW()${tsCol} WHERE id = $1 RETURNING ${QUOTE_SELECT}`,
      [quoteId, nextStatus],
    );

    let repairServiceId: number | undefined;
    if (nextStatus === 'ACCEPTED') {
      // Hand the paid repair off to a repair_service ticket and link it (if the
      // claim doesn't already have one). Paid repair is outside the warranty
      // status machine, so the claim status is left untouched.
      const claim = await client.query<{
        repair_service_id: number | null;
        product_title: string | null;
        serial_number: string | null;
        sku: string | null;
        customer_id: number | null;
        source_system: string | null;
        source_order_id: string | null;
        source_tracking_number: string | null;
      }>(
        `SELECT repair_service_id, product_title, serial_number, sku, customer_id,
                source_system, source_order_id, source_tracking_number
           FROM warranty_claims WHERE id = $1 FOR UPDATE`,
        [claimId],
      );
      if ((claim.rowCount ?? 0) > 0 && claim.rows[0].repair_service_id == null) {
        const c = claim.rows[0];
        const ins = await client.query<{ id: number }>(
          `INSERT INTO repair_service (
             product_title, serial_number, issue, notes, source_system,
             source_order_id, source_tracking_number, source_sku, intake_channel, customer_id, price
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'warranty_paid_repair', $9, $10)
           RETURNING id`,
          [
            c.product_title,
            c.serial_number,
            'Paid repair (accepted quote)',
            `From warranty claim ${claimId}`,
            c.source_system,
            c.source_order_id,
            c.source_tracking_number,
            c.sku,
            c.customer_id,
            rows[0].total,
          ],
        );
        repairServiceId = Number(ins.rows[0].id);
        await client.query(`UPDATE warranty_claims SET repair_service_id = $2, updated_at = NOW() WHERE id = $1`, [
          claimId,
          repairServiceId,
        ]);
      }
    }

    await client.query(
      `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        claimId,
        `QUOTE_${nextStatus}`,
        JSON.stringify({ quoteId, repairServiceId: repairServiceId ?? null }),
        actorStaffId,
      ],
    );
    await client.query('COMMIT');
    return { ok: true, quote: mapQuote(rows[0]), repairServiceId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = err instanceof Error ? err.message : 'set quote status failed';
    return { ok: false, status: 500, error: message };
  } finally {
    client.release();
  }
}
