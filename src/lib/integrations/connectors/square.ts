/**
 * Square connector sync adapter — connection-driven order ingestion.
 *
 * Square is the Nango pilot: auth (the hosted Connect flow + token rotation)
 * already lands a connection in organization_integrations. This adapter is the
 * "only net-new code per provider" the README describes — it pulls the org's
 * Square orders through the tenant-aware client and upserts them into `orders`
 * with the SAME shape eBay/Amazon use (account_source / sale_amount / currency),
 * so every downstream surface (price chip, tracker, source-platform label)
 * renders it generically.
 *
 * Reuses:
 *   - resolveSquareConfig / squareFetchForOrg (Nango token, env fallback)
 *   - the orders upsert shape from src/lib/ebay/sync.ts (idx_orders_unique_account_order)
 *   - getSyncCursor / updateSyncCursor for the incremental updated_at watermark
 *
 * Lazily imported by the registry so the connection reader never pulls in the
 * Square client.
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { squareFetchForOrg } from '@/lib/square/server';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import type { SyncOutcome } from './types';

const ACCOUNT_SOURCE = 'square';
// First-run lookback when no watermark exists yet (Square POS history is small).
const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 25; // safety bound: 25 * 200 = 5k orders / run

interface SquareMoney { amount?: number; currency?: string }
interface SquareLineItem { name?: string; quantity?: string }
interface SquareOrder {
  id?: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  total_money?: SquareMoney;
  line_items?: SquareLineItem[];
}

/** Resolve the location ids to search. Prefer the configured location; else ask
 *  Square for the org's active locations (Orders Search requires ≥1). */
async function resolveLocationIds(orgId: OrgId): Promise<string[]> {
  const res = await squareFetchForOrg<{ locations?: Array<{ id?: string; status?: string }> }>(
    orgId,
    '/locations',
    { method: 'GET' },
  );
  if (!res.ok) return [];
  return (res.data.locations ?? [])
    .filter((l) => l.id && (l.status ?? 'ACTIVE') === 'ACTIVE')
    .map((l) => l.id as string)
    .slice(0, 10); // Square caps location_ids at 10 per search
}

/** One representative line for the orders row (Square orders are multi-line). */
function summarizeLines(order: SquareOrder): { title: string; quantity: number } {
  const lines = order.line_items ?? [];
  const quantity = lines.reduce((s, li) => s + (Number(li.quantity) || 0), 0) || 1;
  const first = lines.find((li) => (li.name ?? '').trim())?.name?.trim();
  const title = !first
    ? 'Square order'
    : lines.length > 1
      ? `${first} +${lines.length - 1} more`
      : first;
  return { title, quantity };
}

/** Upsert one Square order into `orders`. Returns 'created' | 'updated'. */
async function upsertOrder(orgId: OrgId, order: SquareOrder): Promise<'created' | 'updated'> {
  const { title, quantity } = summarizeLines(order);
  const saleAmount =
    typeof order.total_money?.amount === 'number' ? order.total_money.amount / 100 : null;
  const currency = order.total_money?.currency || 'USD';
  // In-store Square sales are realized/fulfilled at the register; mark shipped
  // so they land in the tracker as completed (mirrors Amazon FBA read-only).
  const status = order.state === 'COMPLETED' ? 'shipped' : 'unassigned';

  const result = await pool.query(
    `INSERT INTO orders (
       organization_id, order_id, product_title, condition, sku, status, status_history, notes,
       quantity, out_of_stock, account_source, order_date, sku_catalog_id,
       sale_amount, currency
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15
     )
     ON CONFLICT ON CONSTRAINT idx_orders_unique_account_order DO UPDATE
       SET product_title = COALESCE(NULLIF(EXCLUDED.product_title, 'Square order'), orders.product_title),
           quantity = COALESCE(NULLIF(orders.quantity, ''), EXCLUDED.quantity),
           order_date = COALESCE(orders.order_date, EXCLUDED.order_date),
           sale_amount = COALESCE(orders.sale_amount, EXCLUDED.sale_amount),
           currency = COALESCE(NULLIF(orders.currency, ''), EXCLUDED.currency),
           status = CASE
             WHEN orders.status IS NULL OR orders.status = '' OR orders.status = 'unassigned' THEN EXCLUDED.status
             ELSE orders.status
           END
       RETURNING (xmax = 0) AS inserted`,
    [
      orgId,
      order.id,
      title,
      '',
      '',
      status,
      JSON.stringify([]),
      '',
      String(quantity),
      '',
      ACCOUNT_SOURCE,
      order.created_at ?? null,
      null,
      saleAmount,
      currency,
    ],
  );
  return result.rows[0]?.inserted ? 'created' : 'updated';
}

export async function squareSync(orgId: OrgId): Promise<SyncOutcome> {
  const cursorKey = `square:orders:${orgId}`;
  let locationIds: string[];
  try {
    locationIds = await resolveLocationIds(orgId);
  } catch (e) {
    return { ok: false, error: `square: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (locationIds.length === 0) {
    return { ok: false, error: 'square: no active locations (is the connection live?)' };
  }

  const since = (await getSyncCursor(cursorKey)) ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
  let imported = 0;
  let updated = 0;
  let maxUpdatedAt = since.getTime();
  let pageCursor: string | undefined;
  const errors: string[] = [];

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await squareFetchForOrg<{ orders?: SquareOrder[]; cursor?: string }>(
        orgId,
        '/orders/search',
        {
          method: 'POST',
          body: {
            location_ids: locationIds,
            limit: PAGE_LIMIT,
            ...(pageCursor ? { cursor: pageCursor } : {}),
            query: {
              filter: {
                date_time_filter: { updated_at: { start_at: since.toISOString() } },
                state_filter: { states: ['OPEN', 'COMPLETED'] },
              },
              sort: { sort_field: 'UPDATED_AT', sort_order: 'ASC' },
            },
          },
        },
      );

      if (!res.ok) {
        const detail = res.errors?.map((e) => e.detail || e.code).filter(Boolean).join('; ');
        return { ok: false, error: `square orders/search ${res.status}: ${detail || 'request failed'}` };
      }

      const orders = res.data.orders ?? [];
      for (const order of orders) {
        if (!order.id) continue;
        try {
          if ((await upsertOrder(orgId, order)) === 'created') imported++;
          else updated++;
        } catch (e) {
          errors.push(`${order.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
        const ts = order.updated_at ? Date.parse(order.updated_at) : NaN;
        if (Number.isFinite(ts) && ts > maxUpdatedAt) maxUpdatedAt = ts;
      }

      pageCursor = res.data.cursor;
      if (!pageCursor) break;
    }

    // Advance the watermark only on a clean run so a mid-page failure re-pulls.
    if (errors.length === 0 && maxUpdatedAt > since.getTime()) {
      await updateSyncCursor(cursorKey, new Date(maxUpdatedAt));
    }
  } catch (e) {
    return { ok: false, error: `square: ${e instanceof Error ? e.message : String(e)}` };
  }

  return {
    ok: errors.length === 0,
    imported,
    updated,
    error: errors.length ? errors.join('; ') : undefined,
    cursor: new Date(maxUpdatedAt).toISOString(),
  };
}
