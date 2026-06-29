import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable } from '@/lib/drizzle/schema';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/orders/import-csv
 *
 * Tenant-generic CSV order import. Where the Google-Sheets import is hardcoded
 * to USAV (transitionalUsavOrgId), this lane lets ANY tenant bring orders in:
 * the client parses the CSV in-browser, picks which detected header maps to each
 * canonical field, and posts the already-parsed rows + the mapping here.
 *
 * Body: { rows: Array<Record<string,string>>, mapping: Record<canonical, csvHeader> }
 * Canonical fields: order_number (required), sku, quantity, customer_name,
 *                   tracking_number?, platform?
 *
 * Org scope is taken STRICTLY from ctx.organizationId — never the body. The
 * insert shape mirrors /api/import-orders (drizzle ignores keys that aren't real
 * `orders` columns); `quantity` and `account_source` are added because they are
 * real columns that hold two of the canonical fields.
 *
 * Idempotency: `orders` has no UNIQUE(organization_id, order_id) constraint, so
 * we dedupe within the batch and skip rows whose order_number already exists for
 * this org, reporting them as `skipped` rather than inserting duplicates.
 */

const CANONICAL_FIELDS = [
  'order_number',
  'sku',
  'quantity',
  'customer_name',
  'tracking_number',
  'platform',
] as const;

const bodySchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).max(10_000),
  mapping: z.record(z.string(), z.string()),
});

type CanonicalRow = {
  order_number: string;
  sku: string;
  quantity: string;
  customer_name: string;
  tracking_number: string;
  platform: string;
};

function pick(row: Record<string, string>, header: string | undefined): string {
  if (!header) return '';
  const v = row[header];
  return typeof v === 'string' ? v.trim() : '';
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { rows, mapping } = parsed.data;

  if (!mapping.order_number) {
    return NextResponse.json(
      { error: 'mapping.order_number is required (an order number column must be mapped)' },
      { status: 400 },
    );
  }

  const errors: Array<{ row: number; reason: string }> = [];
  let skipped = 0;

  // 1. Map every row to canonical fields; collect per-row validation errors.
  const mapped: Array<{ index: number; canonical: CanonicalRow }> = [];
  rows.forEach((row, index) => {
    const canonical: CanonicalRow = {
      order_number: pick(row, mapping.order_number),
      sku: pick(row, mapping.sku),
      quantity: pick(row, mapping.quantity),
      customer_name: pick(row, mapping.customer_name),
      tracking_number: pick(row, mapping.tracking_number),
      platform: pick(row, mapping.platform),
    };
    if (!canonical.order_number) {
      errors.push({ row: index, reason: 'Missing order_number' });
      return;
    }
    mapped.push({ index, canonical });
  });

  // 2. Dedupe within the batch by order_number (first occurrence wins).
  const seen = new Set<string>();
  const deduped: Array<{ index: number; canonical: CanonicalRow }> = [];
  for (const entry of mapped) {
    if (seen.has(entry.canonical.order_number)) {
      skipped += 1;
      continue;
    }
    seen.add(entry.canonical.order_number);
    deduped.push(entry);
  }

  // 3. Skip order_numbers that already exist for THIS org (no unique constraint
  //    to upsert on, so we explicitly check + skip).
  const candidateNumbers = deduped.map((e) => e.canonical.order_number);
  const existing = new Set<string>();
  if (candidateNumbers.length > 0) {
    const found = await db
      .select({ orderId: ordersTable.orderId })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.organizationId, ctx.organizationId),
          inArray(ordersTable.orderId, candidateNumbers),
        ),
      );
    for (const r of found) {
      if (r.orderId) existing.add(r.orderId);
    }
  }

  const toInsert = deduped.filter((e) => {
    if (existing.has(e.canonical.order_number)) {
      skipped += 1;
      return false;
    }
    return true;
  });

  // 4. Insert org-scoped (organizationId from ctx, NEVER the body). Insert shape
  //    mirrors /api/import-orders; quantity + accountSource carry canonical data.
  let inserted = 0;
  if (toInsert.length > 0) {
    try {
      const result = await db
        .insert(ordersTable)
        .values(
          toInsert.map(({ canonical }) => ({
            organizationId: ctx.organizationId,
            orderId: canonical.order_number,
            productTitle: '',
            sku: canonical.sku || '',
            condition: '',
            shippingTrackingNumber: canonical.tracking_number || '',
            notes: canonical.customer_name ? `Customer: ${canonical.customer_name}` : '',
            quantity: canonical.quantity || '1',
            accountSource: canonical.platform || '',
            status: 'unassigned',
            statusHistory: [],
            isShipped: false,
            saleAmount: null,
            currency: 'USD',
          })),
        )
        .returning({ id: ordersTable.id });
      inserted = result.length;
    } catch (error: any) {
      console.error('CSV order import insert error:', error);
      return NextResponse.json(
        { error: 'Failed to insert orders', details: error?.message },
        { status: 500 },
      );
    }
  }

  await recordAudit(pool, ctx, request, {
    source: 'orders-import-csv',
    action: 'orders.import',
    entityType: AUDIT_ENTITY.ORDER,
    entityId: `csv:${inserted}`,
    method: 'system',
    extra: {
      inserted,
      skipped,
      errorCount: errors.length,
      rowCount: rows.length,
    },
  });

  return NextResponse.json({ inserted, skipped, errors });
}, { permission: 'orders.import' });
