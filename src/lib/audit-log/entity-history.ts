/**
 * Per-entity audit timeline. Modeled on `receiving-aggregator.ts` but scoped
 * to a single bin or a single SKU. Returns a unified, newest-first event
 * stream stitched from:
 *   • audit_logs        — field-level before/after diffs
 *   • inventory_events  — lifecycle (RECEIVED, MOVED, PUTAWAY, ADJUSTED, …)
 *   • sku_stock_ledger  — qty deltas (for SKU view only)
 *
 * Used by /api/audit/bin/[id] and /api/audit/sku/[sku].
 */

import 'server-only';
import pool from '@/lib/db';

export interface EntityAuditEvent {
  /** Synthetic id stable across runs so React keys hold. */
  id: string;
  occurred_at: string;
  source: 'audit_log' | 'inventory_event' | 'sku_stock_ledger';
  /** Human-readable verb. */
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  sku: string | null;
  bin_id: number | null;
  bin_name: string | null;
  bin_code: string | null;
  location_code: string | null;
  scan_ref: string | null;
  reason_code: string | null;
  note: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

async function fetchStaffNames(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  const r = await pool.query(
    `SELECT id, name FROM staff WHERE id = ANY($1::int[])`,
    [ids],
  );
  const rows = r.rows as { id: number; name: string }[];
  for (const row of rows) map.set(row.id, row.name);
  return map;
}

async function fetchBinName(id: number): Promise<{ name: string | null; barcode: string | null }> {
  try {
    const r = await pool.query(
      `SELECT name, barcode FROM locations WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = (r.rows as { name: string | null; barcode: string | null }[])[0];
    return { name: row?.name ?? null, barcode: row?.barcode ?? null };
  } catch {
    return { name: null, barcode: null };
  }
}

interface AuditLogRow {
  id: number;
  created_at: string;
  actor_staff_id: number | null;
  actor_role: string | null;
  source: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string | null;
  user_agent: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

interface InventoryEventRow {
  id: number;
  occurred_at: string;
  event_type: string;
  actor_staff_id: number | null;
  station: string | null;
  sku: string | null;
  bin_id: number | null;
  prev_bin_id: number | null;
  prev_status: string | null;
  next_status: string | null;
  notes: string | null;
  scan_token: string | null;
  payload: Record<string, unknown>;
}

interface LedgerRow {
  id: number;
  created_at: string;
  sku: string;
  delta: number;
  reason: string | null;
  staff_id: number | null;
}

function metaString(meta: Record<string, unknown> | null, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ── Bin timeline ───────────────────────────────────────────────────────────

export async function getBinAuditHistory(
  binId: number,
  opts: { limit?: number } = {},
): Promise<EntityAuditEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  const [auditsRes, invEventsRes, binMeta] = await Promise.all([
    pool.query(
      `SELECT * FROM audit_logs
        WHERE entity_type = 'bin' AND entity_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [String(binId), limit],
    ),
    pool.query(
      `SELECT id, occurred_at, event_type, actor_staff_id, station, sku,
              bin_id, prev_bin_id, prev_status, next_status, notes, scan_token, payload
         FROM inventory_events
        WHERE bin_id = $1 OR prev_bin_id = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2`,
      [binId, limit],
    ),
    fetchBinName(binId),
  ]);

  const audits = { rows: auditsRes.rows as AuditLogRow[] };
  const invEvents = { rows: invEventsRes.rows as InventoryEventRow[] };

  const staffIds = new Set<number>();
  for (const r of audits.rows) if (r.actor_staff_id != null) staffIds.add(r.actor_staff_id);
  for (const r of invEvents.rows) if (r.actor_staff_id != null) staffIds.add(r.actor_staff_id);
  const staffMap = await fetchStaffNames(Array.from(staffIds));

  const events: EntityAuditEvent[] = [];

  for (const a of audits.rows) {
    events.push({
      id: `audit:${a.id}`,
      occurred_at: a.created_at,
      source: 'audit_log',
      kind: a.action,
      actor_staff_id: a.actor_staff_id,
      actor_name: a.actor_staff_id != null ? staffMap.get(a.actor_staff_id) ?? null : null,
      station: a.source,
      sku: (a.metadata?.sku as string | undefined) ?? null,
      bin_id: binId,
      bin_name: binMeta.name,
      bin_code: metaString(a.metadata, 'bin_code') ?? binMeta.barcode,
      location_code: metaString(a.metadata, 'location_code') ?? binMeta.name,
      scan_ref: metaString(a.metadata, 'scan_ref'),
      reason_code: metaString(a.metadata, 'reason_code'),
      note: metaString(a.metadata, 'note'),
      before: a.before_data,
      after: a.after_data,
      detail: {
        actor_role: a.actor_role,
        ip_address: a.ip_address,
        user_agent: a.user_agent,
        ...(a.metadata ?? {}),
      },
    });
  }

  for (const e of invEvents.rows) {
    events.push({
      id: `inv:${e.id}`,
      occurred_at: e.occurred_at,
      source: 'inventory_event',
      kind: e.event_type,
      actor_staff_id: e.actor_staff_id,
      actor_name: e.actor_staff_id != null ? staffMap.get(e.actor_staff_id) ?? null : null,
      station: e.station,
      sku: e.sku,
      bin_id: e.bin_id,
      bin_name: binMeta.name,
      bin_code: binMeta.barcode,
      location_code: binMeta.name,
      scan_ref: e.scan_token,
      reason_code: null,
      note: e.notes,
      before: e.prev_status ? { status: e.prev_status } : null,
      after: e.next_status ? { status: e.next_status } : null,
      detail: { prev_bin_id: e.prev_bin_id, ...(e.payload ?? {}) },
    });
  }

  events.sort((a, b) => {
    if (a.occurred_at === b.occurred_at) return a.id < b.id ? 1 : -1;
    return a.occurred_at < b.occurred_at ? 1 : -1;
  });

  return events.slice(0, limit);
}

// ── SKU timeline ───────────────────────────────────────────────────────────

export async function getSkuAuditHistory(
  sku: string,
  opts: { limit?: number } = {},
): Promise<EntityAuditEvent[]> {
  const skuValue = sku.trim();
  if (!skuValue) return [];
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  const [auditsRes, invEventsRes, ledgerRes] = await Promise.all([
    pool.query(
      `SELECT * FROM audit_logs
        WHERE (entity_type IN ('sku', 'sku_stock') AND entity_id = $1)
           OR (entity_type = 'bin' AND (metadata->>'sku') = $1)
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [skuValue, limit],
    ),
    pool.query(
      `SELECT id, occurred_at, event_type, actor_staff_id, station, sku,
              bin_id, prev_bin_id, prev_status, next_status, notes, scan_token, payload
         FROM inventory_events
        WHERE sku = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2`,
      [skuValue, limit],
    ),
    pool
      .query(
        `SELECT id, created_at, sku, delta, reason, staff_id
           FROM sku_stock_ledger
          WHERE sku = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2`,
        [skuValue, limit],
      )
      .catch(() => ({ rows: [] as LedgerRow[] })),
  ]);

  const audits = { rows: auditsRes.rows as AuditLogRow[] };
  const invEvents = { rows: invEventsRes.rows as InventoryEventRow[] };
  const ledger = { rows: ledgerRes.rows as LedgerRow[] };

  const staffIds = new Set<number>();
  const binIds = new Set<number>();
  for (const r of audits.rows) if (r.actor_staff_id != null) staffIds.add(r.actor_staff_id);
  for (const r of invEvents.rows) {
    if (r.actor_staff_id != null) staffIds.add(r.actor_staff_id);
    if (r.bin_id != null) binIds.add(r.bin_id);
  }
  for (const r of ledger.rows) if (r.staff_id != null) staffIds.add(r.staff_id);

  const [staffMap, binMap] = await Promise.all([
    fetchStaffNames(Array.from(staffIds)),
    (async () => {
      const map = new Map<number, { name: string | null; barcode: string | null }>();
      if (binIds.size === 0) return map;
      try {
        const r = await pool.query(
          `SELECT id, name, barcode FROM locations WHERE id = ANY($1::int[])`,
          [Array.from(binIds)],
        );
        const rows = r.rows as { id: number; name: string | null; barcode: string | null }[];
        for (const row of rows) map.set(row.id, { name: row.name, barcode: row.barcode });
      } catch {
        /* locations may not exist */
      }
      return map;
    })(),
  ]);

  const events: EntityAuditEvent[] = [];

  for (const a of audits.rows) {
    events.push({
      id: `audit:${a.id}`,
      occurred_at: a.created_at,
      source: 'audit_log',
      kind: a.action,
      actor_staff_id: a.actor_staff_id,
      actor_name: a.actor_staff_id != null ? staffMap.get(a.actor_staff_id) ?? null : null,
      station: a.source,
      sku: skuValue,
      bin_id: null,
      bin_name: null,
      bin_code: metaString(a.metadata, 'bin_code'),
      location_code: metaString(a.metadata, 'location_code'),
      scan_ref: metaString(a.metadata, 'scan_ref'),
      reason_code: metaString(a.metadata, 'reason_code'),
      note: metaString(a.metadata, 'note'),
      before: a.before_data,
      after: a.after_data,
      detail: {
        actor_role: a.actor_role,
        ip_address: a.ip_address,
        user_agent: a.user_agent,
        entity_type: a.entity_type,
        ...(a.metadata ?? {}),
      },
    });
  }

  for (const e of invEvents.rows) {
    const bin = e.bin_id != null ? binMap.get(e.bin_id) ?? null : null;
    events.push({
      id: `inv:${e.id}`,
      occurred_at: e.occurred_at,
      source: 'inventory_event',
      kind: e.event_type,
      actor_staff_id: e.actor_staff_id,
      actor_name: e.actor_staff_id != null ? staffMap.get(e.actor_staff_id) ?? null : null,
      station: e.station,
      sku: e.sku,
      bin_id: e.bin_id,
      bin_name: bin?.name ?? null,
      bin_code: bin?.barcode ?? null,
      location_code: bin?.name ?? null,
      scan_ref: e.scan_token,
      reason_code: null,
      note: e.notes,
      before: e.prev_status ? { status: e.prev_status } : null,
      after: e.next_status ? { status: e.next_status } : null,
      detail: { prev_bin_id: e.prev_bin_id, ...(e.payload ?? {}) },
    });
  }

  for (const l of ledger.rows) {
    events.push({
      id: `ledger:${l.id}`,
      occurred_at: l.created_at,
      source: 'sku_stock_ledger',
      kind: l.reason ?? 'ADJUSTED',
      actor_staff_id: l.staff_id,
      actor_name: l.staff_id != null ? staffMap.get(l.staff_id) ?? null : null,
      station: null,
      sku: l.sku,
      bin_id: null,
      bin_name: null,
      bin_code: null,
      location_code: null,
      scan_ref: null,
      reason_code: l.reason,
      note: null,
      before: null,
      after: { delta: l.delta },
      detail: { delta: l.delta },
    });
  }

  events.sort((a, b) => {
    if (a.occurred_at === b.occurred_at) return a.id < b.id ? 1 : -1;
    return a.occurred_at < b.occurred_at ? 1 : -1;
  });

  return events.slice(0, limit);
}
