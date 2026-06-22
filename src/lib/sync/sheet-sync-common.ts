import type { OrgId } from '@/lib/tenancy/constants';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

export function getTrackingLast8(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(-8);
}

export function parseSheetDateTime(rawValue: string): Date | null {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  // Supports common sheet format: M/D/YYYY HH:mm:ss
  if (value.includes('/')) {
    const [datePart, timePartRaw] = value.split(' ');
    const [m, d, y] = String(datePart || '').split('/');
    const timePart = timePartRaw || '00:00:00';
    const asIsoLike = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${timePart}`;
    const parsed = new Date(asIsoLike);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function ensureOrdersExceptionsTable(client: any, orgId?: OrgId): Promise<void> {
  if (orgId) {
    // Executor pattern: set the org GUC on the caller-provided client so any
    // RLS-subject default/policy on orders_exceptions resolves to this tenant.
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS orders_exceptions (
      id SERIAL PRIMARY KEY,
      shipping_tracking_number TEXT NOT NULL,
      source_station VARCHAR(20) NOT NULL,
      staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
      staff_name TEXT,
      exception_reason VARCHAR(50) NOT NULL DEFAULT 'not_found',
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function hasOrderByTracking(
  client: any,
  shippingTracking: string,
  orgId?: OrgId,
): Promise<boolean> {
  const tracking = String(shippingTracking || '').trim();
  if (!tracking) return false;

  const trackingLast8 = getTrackingLast8(tracking);

  if (orgId) {
    // Executor pattern: set the org GUC on the caller-provided client + scope
    // the read to this tenant. `orders` carries organization_id; the
    // orders↔shipping_tracking_numbers join is on the integer surrogate PK
    // (stn.id = o.shipment_id), so it's safe bare (shipping_tracking_numbers
    // has no org_id column — NEEDS-COL — and is scoped via its parent order).
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

    if (trackingLast8.length === 8) {
      const result = await client.query(
        `SELECT o.id
         FROM orders o
         JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
         WHERE RIGHT(regexp_replace(stn.tracking_number_normalized, '\\D', '', 'g'), 8) = $1
           AND o.organization_id = $2
         LIMIT 1`,
        [trackingLast8, orgId]
      );
      return result.rows.length > 0;
    }

    const fallback = await client.query(
      `SELECT o.id
       FROM orders o
       JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       WHERE UPPER(TRIM(stn.tracking_number_raw)) = UPPER(TRIM($1))
         AND o.organization_id = $2
       LIMIT 1`,
      [tracking, orgId]
    );
    return fallback.rows.length > 0;
  }

  if (trackingLast8.length === 8) {
    const result = await client.query(
      `SELECT o.id
       FROM orders o
       JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       WHERE RIGHT(regexp_replace(stn.tracking_number_normalized, '\\D', '', 'g'), 8) = $1
       LIMIT 1`,
      [trackingLast8]
    );
    return result.rows.length > 0;
  }

  const fallback = await client.query(
    `SELECT o.id
     FROM orders o
     JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     WHERE UPPER(TRIM(stn.tracking_number_raw)) = UPPER(TRIM($1))
     LIMIT 1`,
    [tracking]
  );
  return fallback.rows.length > 0;
}

export async function hasFbaFnsku(client: any, tracking: string, orgId?: OrgId): Promise<boolean> {
  const normalized = String(tracking || '').trim().toUpperCase();
  if (!normalized) return false;

  if (orgId) {
    // Executor pattern: set the org GUC on the caller-provided client + scope
    // the read to this tenant. `fba_fnskus` carries organization_id.
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

    try {
      const primary = await client.query(
        `SELECT 1
         FROM fba_fnskus
         WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
           AND organization_id = $2
         LIMIT 1`,
        [normalized, orgId]
      );
      if (primary.rows.length > 0) return true;
    } catch (err: any) {
      if (err?.code !== '42P01') throw err;
    }

    try {
      // Legacy singular `fba_fnsku` fallback: not present in the tenancy
      // coverage catalog (unknown / no org_id column) — left unscoped; the
      // table only survives as a 42P01-guarded compatibility shim. See notes.
      const fallback = await client.query(
        `SELECT 1
         FROM fba_fnsku
         WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
         LIMIT 1`,
        [normalized]
      );
      return fallback.rows.length > 0;
    } catch (err: any) {
      if (err?.code === '42P01') return false;
      throw err;
    }
  }

  try {
    const primary = await client.query(
      `SELECT 1
       FROM fba_fnskus
       WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
       LIMIT 1`,
      [normalized]
    );
    if (primary.rows.length > 0) return true;
  } catch (err: any) {
    if (err?.code !== '42P01') throw err;
  }

  try {
    const fallback = await client.query(
      `SELECT 1
       FROM fba_fnsku
       WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
       LIMIT 1`,
      [normalized]
    );
    return fallback.rows.length > 0;
  } catch (err: any) {
    if (err?.code === '42P01') return false;
    throw err;
  }
}

export async function upsertOpenOrdersException(params: {
  client: any;
  shippingTrackingNumber: string;
  sourceStation: 'tech' | 'packer';
  staffId?: number | null;
  orgId?: OrgId;
}): Promise<void> {
  const tracking = String(params.shippingTrackingNumber || '').trim();
  if (!tracking || tracking.includes(':')) return;

  const trackingLast8 = getTrackingLast8(tracking);
  const orgId = params.orgId;

  if (orgId) {
    // Executor pattern: set the org GUC on the caller-provided client + scope
    // every read/write to this tenant. `orders_exceptions` carries
    // organization_id (stamp on INSERT, predicate on SELECT/UPDATE).
    await params.client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

    let existing;
    if (trackingLast8.length === 8) {
      existing = await params.client.query(
        `SELECT id
         FROM orders_exceptions
         WHERE status = 'open'
           AND organization_id = $2
           AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
         ORDER BY id DESC
         LIMIT 1`,
        [trackingLast8, orgId]
      );
    } else {
      existing = await params.client.query(
        `SELECT id
         FROM orders_exceptions
         WHERE status = 'open'
           AND organization_id = $2
           AND UPPER(TRIM(COALESCE(shipping_tracking_number, ''))) = UPPER(TRIM($1))
         ORDER BY id DESC
         LIMIT 1`,
        [tracking, orgId]
      );
    }

    if (existing.rows.length > 0) {
      await params.client.query(
        `UPDATE orders_exceptions
         SET shipping_tracking_number = $1,
             source_station = $2,
             staff_id = COALESCE($3, staff_id),
             exception_reason = 'not_found',
             updated_at = NOW()
         WHERE id = $4
           AND organization_id = $5`,
        [tracking, params.sourceStation, params.staffId, existing.rows[0].id, orgId]
      );
      return;
    }

    await params.client.query(
      `INSERT INTO orders_exceptions (
        shipping_tracking_number,
        source_station,
        staff_id,
        exception_reason,
        status,
        organization_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, 'not_found', 'open', $4, NOW(), NOW())`,
      [tracking, params.sourceStation, params.staffId, orgId]
    );
    return;
  }

  let existing;
  if (trackingLast8.length === 8) {
    existing = await params.client.query(
      `SELECT id
       FROM orders_exceptions
       WHERE status = 'open'
         AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [trackingLast8]
    );
  } else {
    existing = await params.client.query(
      `SELECT id
       FROM orders_exceptions
       WHERE status = 'open'
         AND UPPER(TRIM(COALESCE(shipping_tracking_number, ''))) = UPPER(TRIM($1))
       ORDER BY id DESC
       LIMIT 1`,
      [tracking]
    );
  }

  if (existing.rows.length > 0) {
    await params.client.query(
      `UPDATE orders_exceptions
       SET shipping_tracking_number = $1,
           source_station = $2,
           staff_id = COALESCE($3, staff_id),
           exception_reason = 'not_found',
           updated_at = NOW()
       WHERE id = $4`,
      [tracking, params.sourceStation, params.staffId, existing.rows[0].id]
    );
    return;
  }

  // Legacy (no-org) branch: runs on a raw client with no GUC set, so the
  // orders_exceptions usav-fallback default would silently misroute. Stamp the
  // transitional USAV org explicitly to match the org-scoped branch above.
  await params.client.query(
    `INSERT INTO orders_exceptions (
      shipping_tracking_number,
      source_station,
      staff_id,
      exception_reason,
      status,
      organization_id,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, 'not_found', 'open', $4::uuid, NOW(), NOW())`,
    [tracking, params.sourceStation, params.staffId, transitionalUsavOrgId()]
  );
}
