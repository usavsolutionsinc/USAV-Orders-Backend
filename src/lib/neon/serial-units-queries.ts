import pool from '../db';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SerialStatus =
  | 'UNKNOWN'
  | 'RECEIVED'
  | 'TESTED'
  | 'STOCKED'
  | 'PICKED'
  | 'SHIPPED'
  | 'RETURNED'
  | 'RMA'
  | 'SCRAPPED';

export type SerialOriginSource =
  | 'receiving'
  | 'tsn'
  | 'sku'
  | 'manual'
  | 'legacy';

export interface SerialUnitRow {
  id: number;
  serial_number: string;
  normalized_serial: string;
  sku: string | null;
  sku_catalog_id: number | null;
  zoho_item_id: string | null;
  current_status: SerialStatus;
  current_location: string | null;
  condition_grade: string | null;
  origin_source: string | null;
  origin_receiving_line_id: number | null;
  origin_tsn_id: number | null;
  origin_sku_id: number | null;
  received_at: string | null;
  received_by: number | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsertSerialUnitInput {
  serial_number: string;
  sku?: string | null;
  sku_catalog_id?: number | null;
  zoho_item_id?: string | null;
  origin_source: SerialOriginSource;
  origin_receiving_line_id?: number | null;
  origin_tsn_id?: number | null;
  origin_sku_id?: number | null;
  actor_id?: number | null;
  condition_grade?: string | null;
  location?: string | null;
  target_status?: SerialStatus;
}

export interface UpsertSerialUnitResult {
  unit: SerialUnitRow;
  is_new: boolean;
  prior_status: SerialStatus | null;
  is_return: boolean;
  warnings: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function normalizeSerial(raw: string | null | undefined): string {
  return String(raw || '').trim().toUpperCase();
}

function defaultStatusForSource(source: SerialOriginSource): SerialStatus {
  switch (source) {
    case 'receiving':
      return 'RECEIVED';
    case 'tsn':
      return 'TESTED';
    case 'sku':
      return 'STOCKED';
    case 'manual':
    case 'legacy':
    default:
      return 'UNKNOWN';
  }
}

function resolveTransition(
  prior: SerialStatus,
  target: SerialStatus,
): { next: SerialStatus; is_return: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Relaxed mode: SCRAPPED out is allowed but flagged
  if (prior === 'SCRAPPED' && target !== 'SCRAPPED') {
    warnings.push('scrapped_unit_reused');
  }

  // SHIPPED -> RECEIVED = return detected (flip status to RETURNED)
  if (prior === 'SHIPPED' && target === 'RECEIVED') {
    return { next: 'RETURNED', is_return: true, warnings };
  }

  // UNKNOWN upgrades to anything without ceremony
  if (prior === 'UNKNOWN') {
    return { next: target, is_return: false, warnings };
  }

  return { next: target, is_return: false, warnings };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function findByNormalizedSerial(
  serial: string,
): Promise<SerialUnitRow | null> {
  const normalized = normalizeSerial(serial);
  if (!normalized) return null;

  const result = await pool.query<SerialUnitRow>(
    `SELECT * FROM serial_units WHERE normalized_serial = $1 LIMIT 1`,
    [normalized],
  );
  return result.rows[0] ?? null;
}

export async function listByReceivingLine(
  receivingLineId: number,
): Promise<SerialUnitRow[]> {
  const result = await pool.query<SerialUnitRow>(
    `SELECT * FROM serial_units
     WHERE origin_receiving_line_id = $1
     ORDER BY created_at ASC, id ASC`,
    [receivingLineId],
  );
  return result.rows;
}

export async function countByReceivingLine(
  receivingLineId: number,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM serial_units
     WHERE origin_receiving_line_id = $1`,
    [receivingLineId],
  );
  return result.rows[0]?.count ?? 0;
}

// ─── Upsert (the single writer) ─────────────────────────────────────────────

/**
 * Find-or-create a serial_units row. This is the ONLY place code should
 * write to serial_units. Every caller (receiving, tsn, sku, backfill,
 * manual) funnels through here so lifecycle transitions and return
 * detection stay centralized.
 *
 * Relaxed: never throws on valid input. Missing origin context is fine.
 * Returns null only if the serial number is empty.
 */
export async function upsertSerialUnit(
  input: UpsertSerialUnitInput,
): Promise<UpsertSerialUnitResult | null> {
  const normalized = normalizeSerial(input.serial_number);
  if (!normalized) return null;

  const targetStatus =
    input.target_status ?? defaultStatusForSource(input.origin_source);

  const trimmedSerial = input.serial_number.trim();
  const trimmedSku = input.sku?.trim() || null;
  const trimmedZohoItem = input.zoho_item_id?.trim() || null;
  const trimmedLocation = input.location?.trim() || null;
  const trimmedGrade = input.condition_grade?.trim() || null;
  const nowIso = new Date().toISOString();
  const isReceivingTouch = input.origin_source === 'receiving';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<SerialUnitRow>(
      `SELECT * FROM serial_units
       WHERE normalized_serial = $1
       FOR UPDATE`,
      [normalized],
    );

    if (existing.rows.length === 0) {
      const insertMetadata = {
        created_via: input.origin_source,
        created_at_iso: nowIso,
      };

      const inserted = await client.query<SerialUnitRow>(
        `INSERT INTO serial_units (
           serial_number, normalized_serial, sku, sku_catalog_id, zoho_item_id,
           current_status, current_location, condition_grade,
           origin_source, origin_receiving_line_id, origin_tsn_id, origin_sku_id,
           received_at, received_by, metadata
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8::condition_grade_enum,
           $9, $10, $11, $12,
           $13, $14, $15::jsonb
         )
         RETURNING *`,
        [
          trimmedSerial,
          normalized,
          trimmedSku,
          input.sku_catalog_id ?? null,
          trimmedZohoItem,
          targetStatus,
          trimmedLocation,
          trimmedGrade,
          input.origin_source,
          input.origin_receiving_line_id ?? null,
          input.origin_tsn_id ?? null,
          input.origin_sku_id ?? null,
          isReceivingTouch ? nowIso : null,
          isReceivingTouch ? input.actor_id ?? null : null,
          JSON.stringify(insertMetadata),
        ],
      );

      await client.query('COMMIT');
      return {
        unit: inserted.rows[0],
        is_new: true,
        prior_status: null,
        is_return: false,
        warnings: [],
      };
    }

    const prior = existing.rows[0];
    const { next, is_return, warnings } = resolveTransition(
      prior.current_status,
      targetStatus,
    );

    const metadataPatch: Record<string, unknown> = {
      last_touch: {
        source: input.origin_source,
        actor: input.actor_id ?? null,
        at: nowIso,
        from: prior.current_status,
        to: next,
      },
    };
    if (warnings.length > 0) metadataPatch.warnings = warnings;
    if (is_return) metadataPatch.return_detected_at = nowIso;

    const updated = await client.query<SerialUnitRow>(
      `UPDATE serial_units SET
         sku = COALESCE(sku, $2),
         sku_catalog_id = COALESCE(sku_catalog_id, $3),
         zoho_item_id = COALESCE(zoho_item_id, $4),
         current_status = $5,
         current_location = COALESCE($6, current_location),
         condition_grade = COALESCE($7::condition_grade_enum, condition_grade),
         origin_source = COALESCE(origin_source, $8),
         origin_receiving_line_id = COALESCE(origin_receiving_line_id, $9),
         origin_tsn_id = COALESCE(origin_tsn_id, $10),
         origin_sku_id = COALESCE(origin_sku_id, $11),
         received_at = COALESCE(received_at, $12),
         received_by = COALESCE(received_by, $13),
         metadata = metadata || $14::jsonb,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        prior.id,
        trimmedSku,
        input.sku_catalog_id ?? null,
        trimmedZohoItem,
        next,
        trimmedLocation,
        trimmedGrade,
        input.origin_source,
        input.origin_receiving_line_id ?? null,
        input.origin_tsn_id ?? null,
        input.origin_sku_id ?? null,
        isReceivingTouch && !prior.received_at ? nowIso : null,
        isReceivingTouch && !prior.received_by ? input.actor_id ?? null : null,
        JSON.stringify(metadataPatch),
      ],
    );

    await client.query('COMMIT');
    return {
      unit: updated.rows[0],
      is_new: false,
      prior_status: prior.current_status,
      is_return,
      warnings,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Downstream-table sync (TSN + sku → serial_units master) ───────────────

export interface TsnRowForSync {
  id: number;
  serial_number: string;
  station_source?: string | null;
  tested_by?: number | null;
  receiving_line_id?: number | null;
  shipment_id?: number | null;
  fba_shipment_id?: number | null;
  orders_exception_id?: number | null;
  source_sku_id?: number | null;
}

/**
 * After a tech_serial_numbers row is inserted anywhere in the app, call this
 * to register / update the master serial_units row and stamp the FK back
 * onto the TSN row. Never throws — the master registry is relaxed, so a
 * sync failure never prevents the original TSN row from existing.
 *
 * Infers origin/status from TSN fields:
 *   station_source='RECEIVING' → origin=receiving, status=RECEIVED
 *   shipment_id or fba_shipment_id set → origin=tsn, status=SHIPPED
 *   otherwise → origin=tsn, status=TESTED
 *
 * Callers can override via options.
 */
export async function syncTsnToSerialUnit(
  tsnRow: TsnRowForSync,
  options?: {
    sku?: string | null;
    sku_catalog_id?: number | null;
    zoho_item_id?: string | null;
    override_status?: SerialStatus;
  },
): Promise<number | null> {
  try {
    const isReceiving = tsnRow.station_source === 'RECEIVING';
    const isShipped = tsnRow.shipment_id != null || tsnRow.fba_shipment_id != null;

    const origin_source: SerialOriginSource = isReceiving ? 'receiving' : 'tsn';
    const target_status: SerialStatus =
      options?.override_status ??
      (isReceiving ? 'RECEIVED' : isShipped ? 'SHIPPED' : 'TESTED');

    const result = await upsertSerialUnit({
      serial_number: tsnRow.serial_number,
      sku: options?.sku ?? null,
      sku_catalog_id: options?.sku_catalog_id ?? null,
      zoho_item_id: options?.zoho_item_id ?? null,
      origin_source,
      origin_receiving_line_id: tsnRow.receiving_line_id ?? null,
      origin_tsn_id: tsnRow.id,
      actor_id: tsnRow.tested_by ?? null,
      target_status,
    });

    if (!result) return null;

    await pool.query(
      `UPDATE tech_serial_numbers
       SET serial_unit_id = $1
       WHERE id = $2 AND serial_unit_id IS NULL`,
      [result.unit.id, tsnRow.id],
    );

    return result.unit.id;
  } catch (err) {
    console.warn('syncTsnToSerialUnit failed:', err);
    return null;
  }
}

/**
 * Idempotent stamp of serial_unit_id on every matching TSN row for a
 * receiving-side scan. Useful when the caller already has the serial_unit_id
 * from a prior upsertSerialUnit call and just needs to backfill the FK (e.g.
 * when the INSERT used ON CONFLICT DO NOTHING and we don't have the id back).
 */
export async function stampReceivingTsnSerialUnitId(params: {
  serial_unit_id: number;
  serial_number: string;
  receiving_line_id: number;
}): Promise<number> {
  const result = await pool.query(
    `UPDATE tech_serial_numbers
     SET serial_unit_id = $1
     WHERE UPPER(TRIM(serial_number)) = UPPER(TRIM($2))
       AND receiving_line_id = $3
       AND station_source = 'RECEIVING'
       AND serial_unit_id IS NULL`,
    [params.serial_unit_id, params.serial_number, params.receiving_line_id],
  );
  return result.rowCount ?? 0;
}

export interface SkuRowForSync {
  id: number;
  serial_number: string | null;
  static_sku: string | null;
  location?: string | null;
}

/**
 * After a sku row is inserted, register / update the master serial_units row
 * and stamp the FK back. Silent on no-serial rows (location-only updates).
 */
export async function syncSkuToSerialUnit(
  skuRow: SkuRowForSync,
): Promise<number | null> {
  const serial = skuRow.serial_number?.trim();
  if (!serial) return null;

  try {
    const { getSkuCatalogBySku } = await import('./sku-catalog-queries');
    const catalog = skuRow.static_sku
      ? await getSkuCatalogBySku(skuRow.static_sku)
      : null;

    const result = await upsertSerialUnit({
      serial_number: serial,
      sku: skuRow.static_sku,
      sku_catalog_id: catalog?.id ?? null,
      origin_source: 'sku',
      origin_sku_id: skuRow.id,
      location: skuRow.location ?? null,
      target_status: skuRow.location ? 'STOCKED' : 'UNKNOWN',
    });

    if (!result) return null;

    await pool.query(
      `UPDATE sku
       SET serial_unit_id = $1
       WHERE id = $2 AND serial_unit_id IS NULL`,
      [result.unit.id, skuRow.id],
    );

    return result.unit.id;
  } catch (err) {
    console.warn('syncSkuToSerialUnit failed:', err);
    return null;
  }
}

// ─── Background enrichment (called via waitUntil) ───────────────────────────

/**
 * Async catalog backfill. Called from waitUntil() in the scan-serial route
 * when sku_catalog was a cache miss. Never throws — silently no-ops on any
 * failure so the scanner's response is already safely sent.
 */
export async function enrichSerialUnitCatalog(params: {
  serial_unit_id: number;
  sku?: string | null;
  zoho_item_id?: string | null;
  zoho_purchaseorder_id?: string | null;
}): Promise<void> {
  try {
    const current = await pool.query<{ sku_catalog_id: number | null }>(
      `SELECT sku_catalog_id FROM serial_units WHERE id = $1 LIMIT 1`,
      [params.serial_unit_id],
    );
    if (current.rows.length === 0) return;
    if (current.rows[0].sku_catalog_id != null) return;

    // Dynamic import avoids a circular dep between sku-catalog and serial-units queries
    const { ensureSkuCatalogEntry } = await import('./sku-catalog-queries');
    const catalog = await ensureSkuCatalogEntry(params.sku ?? '', {
      zoho_item_id: params.zoho_item_id ?? undefined,
      zoho_purchaseorder_id: params.zoho_purchaseorder_id ?? undefined,
    });
    if (!catalog) return;

    await pool.query(
      `UPDATE serial_units
       SET sku_catalog_id = $1, updated_at = NOW()
       WHERE id = $2 AND sku_catalog_id IS NULL`,
      [catalog.id, params.serial_unit_id],
    );
  } catch (err) {
    console.warn('enrichSerialUnitCatalog failed:', err);
  }
}
