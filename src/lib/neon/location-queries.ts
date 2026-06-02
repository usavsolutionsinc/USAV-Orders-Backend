import pool from '../db';
import {
  locationCode,
  locationCodeFlat,
  noPad,
  pad2,
  type LocationSegments,
} from '../barcode-routing';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Location {
  id: number;
  name: string;
  room: string | null;
  description: string | null;
  barcode: string | null;
  is_active: boolean;
  sort_order: number;
  row_label: string | null;
  col_label: string | null;
  bin_type: string | null;
  capacity: number | null;
  parent_id: number | null;
  /** A-Z, set on parent rows only. Drives the printed label and GS1 QR. */
  zone_letter: string | null;
}

export interface BinContent {
  id: number;
  location_id: number;
  sku: string;
  qty: number;
  min_qty: number | null;
  max_qty: number | null;
  last_counted: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  location_name?: string;
  room?: string;
  row_label?: string;
  col_label?: string;
  barcode?: string;
  product_title?: string;
}

export interface LocationTransfer {
  id: number;
  entity_type: string;
  entity_id: number;
  sku: string;
  from_location: string | null;
  to_location: string;
  staff_id: number | null;
  notes: string | null;
  created_at: string;
}

// ─── Locations CRUD ─────────────────────────────────────────────────────────

export async function getActiveLocations(): Promise<Location[]> {
  const result = await pool.query(
    `SELECT id, name, room, description, barcode, is_active, sort_order,
            row_label, col_label, bin_type, capacity, parent_id, zone_letter
     FROM locations
     WHERE is_active = true
     ORDER BY room, sort_order, row_label, col_label, name`,
  );
  return result.rows;
}

/** Get only room-level parents (no row/col) for the room picker. */
export async function getRooms(): Promise<Location[]> {
  const result = await pool.query(
    `SELECT id, name, room, description, barcode, is_active, sort_order,
            row_label, col_label, bin_type, capacity, parent_id, zone_letter
     FROM locations
     WHERE is_active = true AND row_label IS NULL AND col_label IS NULL
     ORDER BY sort_order, name`,
  );
  return result.rows;
}

/** Get bins (with row/col) under a specific room. */
export async function getBinsByRoom(room: string): Promise<Location[]> {
  const result = await pool.query(
    `SELECT id, name, room, description, barcode, is_active, sort_order,
            row_label, col_label, bin_type, capacity, parent_id, zone_letter
     FROM locations
     WHERE is_active = true AND room = $1 AND row_label IS NOT NULL
     ORDER BY row_label, col_label`,
    [room.trim()],
  );
  return result.rows;
}

/**
 * Upsert the zone-letter for a room. The partial unique index enforces no
 * two active rooms share a letter; we map the constraint violation to a
 * structured error so the API can return 409.
 *
 * Legacy data can have multiple parent rows (row_label/col_label NULL) that
 * share the same `room` value — e.g. "Storage A" and "Storage B" both with
 * room='Zone 2 -'. A naive UPDATE would set the letter on every matching
 * row and trip the partial unique index. We resolve that ambiguity by:
 *   1. clearing zone_letter on every parent row for this room, then
 *   2. setting the letter on exactly one canonical parent (lowest
 *      sort_order, then lowest id), all inside a single transaction.
 */
export async function setRoomZoneLetter(
  roomName: string,
  letter: string | null,
): Promise<{ ok: true } | { ok: false; reason: 'duplicate' | 'not_found' }> {
  const name = roomName.trim();
  if (!name) return { ok: false, reason: 'not_found' };
  const normalised = letter ? letter.trim().toUpperCase().charAt(0) : null;
  if (normalised !== null && !/^[A-Z]$/.test(normalised)) {
    return { ok: false, reason: 'duplicate' }; // bad letter; surface as 4xx
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1 — clear letter on every parent row for this room so we never
    // leave two active parents with the same letter (would violate the
    // partial unique index).
    await client.query(
      `UPDATE locations
         SET zone_letter = NULL, updated_at = NOW()
       WHERE row_label IS NULL
         AND col_label IS NULL
         AND is_active = true
         AND (room = $1 OR name = $1)
         AND zone_letter IS NOT NULL`,
      [name],
    );

    // Step 2 — when clearing (normalised == null) we're done; otherwise set
    // the letter on exactly one canonical parent row.
    if (normalised === null) {
      await client.query('COMMIT');
      return { ok: true };
    }

    const result = await client.query(
      `UPDATE locations
          SET zone_letter = $2, updated_at = NOW()
        WHERE id = (
          SELECT id FROM locations
           WHERE row_label IS NULL
             AND col_label IS NULL
             AND is_active = true
             AND (room = $1 OR name = $1)
           ORDER BY sort_order, id
           LIMIT 1
        )
        RETURNING id`,
      [name, normalised],
    );
    if ((result.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') return { ok: false, reason: 'duplicate' };
    throw err;
  } finally {
    client.release();
  }
}

// ─── Bins overview ──────────────────────────────────────────────────────────

export interface BinsOverviewRow {
  id: number;
  barcode: string | null;
  name: string;
  room: string | null;
  row_label: string | null;
  col_label: string | null;
  capacity: number | null;
  bin_type: string | null;
  zone_letter: string | null;
  /** Sum of qty across every SKU in this bin. */
  total_qty: number;
  /** Distinct SKUs in this bin. */
  sku_count: number;
  /** total_qty / capacity (0..1), null when capacity is null. */
  fill_pct: number | null;
  /** Newest last_counted across this bin's rows. */
  last_counted: string | null;
  is_empty: boolean;
  is_stale: boolean;          // last_counted older than 90d (or never counted with stock)
  has_low_stock: boolean;     // any bin_contents row with qty < min_qty
  is_over_capacity: boolean;  // total_qty > capacity
}

export interface BinsOverviewCounts {
  total: number;
  empty: number;
  stale: number;
  low_stock: number;
  over_capacity: number;
}

const STALE_DAYS = 90;

/**
 * One-shot read for the inventory bins tab. Joins locations with aggregated
 * bin_contents so the client doesn't need to fan out N queries to enrich
 * the list. Safe up to ~5k bins; switch to a materialized view if it grows.
 */
export async function getBinsOverview(filter?: {
  room?: string | null;
  q?: string | null;
}): Promise<{ rows: BinsOverviewRow[]; counts: BinsOverviewCounts }> {
  const room = filter?.room?.trim() || null;
  const q = filter?.q?.trim() || null;

  const params: unknown[] = [STALE_DAYS];
  const where: string[] = [
    "l.is_active = true",
    "l.row_label IS NOT NULL",
    "l.col_label IS NOT NULL",
  ];

  if (room) {
    params.push(room);
    where.push(`l.room = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    // Match against the bin's own fields AND any product title / SKU stored
    // in it. "Find me bins holding bose speakers" should just work — even
    // though product_title lives on sku_stock, not on locations.
    where.push(
      `(
        l.barcode ILIKE $${idx}
        OR l.name ILIKE $${idx}
        OR l.room ILIKE $${idx}
        OR l.row_label ILIKE $${idx}
        OR l.col_label ILIKE $${idx}
        OR EXISTS (
          SELECT 1
          FROM bin_contents bc2
          LEFT JOIN sku_stock ss ON ss.sku = bc2.sku
          WHERE bc2.location_id = l.id
            AND (bc2.sku ILIKE $${idx} OR ss.product_title ILIKE $${idx})
        )
      )`,
    );
  }

  const sql = `
    WITH agg AS (
      SELECT
        bc.location_id,
        COALESCE(SUM(bc.qty), 0)::int        AS total_qty,
        COUNT(DISTINCT bc.sku)::int          AS sku_count,
        MAX(bc.last_counted)                 AS last_counted,
        BOOL_OR(bc.qty < COALESCE(bc.min_qty, -1)) AS has_low_stock
      FROM bin_contents bc
      GROUP BY bc.location_id
    )
    SELECT
      l.id, l.barcode, l.name, l.room, l.row_label, l.col_label,
      l.capacity, l.bin_type, l.zone_letter,
      COALESCE(agg.total_qty, 0)::int           AS total_qty,
      COALESCE(agg.sku_count, 0)::int           AS sku_count,
      CASE
        WHEN l.capacity IS NULL OR l.capacity <= 0 THEN NULL::float
        ELSE LEAST(COALESCE(agg.total_qty, 0)::float / l.capacity::float, 9.99)
      END                                       AS fill_pct,
      agg.last_counted                          AS last_counted,
      (COALESCE(agg.total_qty, 0) = 0)          AS is_empty,
      (
        agg.last_counted IS NULL
        OR agg.last_counted < NOW() - ($1 || ' days')::interval
      )                                         AS is_stale,
      COALESCE(agg.has_low_stock, false)        AS has_low_stock,
      (l.capacity IS NOT NULL AND COALESCE(agg.total_qty, 0) > l.capacity) AS is_over_capacity
    FROM locations l
    LEFT JOIN agg ON agg.location_id = l.id
    WHERE ${where.join(' AND ')}
    ORDER BY l.room NULLS LAST, l.row_label, l.col_label, l.id
  `;

  const result = await pool.query(sql, params);
  const rows = result.rows as BinsOverviewRow[];

  const counts: BinsOverviewCounts = {
    total: rows.length,
    empty: rows.filter((r) => r.is_empty).length,
    stale: rows.filter((r) => r.is_stale).length,
    low_stock: rows.filter((r) => r.has_low_stock).length,
    over_capacity: rows.filter((r) => r.is_over_capacity).length,
  };

  return { rows, counts };
}

/** Get distinct rows for a room (for cascading picker). */
export async function getRowsForRoom(room: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT row_label FROM locations
     WHERE is_active = true AND room = $1 AND row_label IS NOT NULL
     ORDER BY row_label`,
    [room.trim()],
  );
  return result.rows.map((r: any) => r.row_label);
}

/** Get distinct cols for a room+row (for cascading picker). */
export async function getColsForRoomRow(room: string, row: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT col_label FROM locations
     WHERE is_active = true AND room = $1 AND row_label = $2 AND col_label IS NOT NULL
     ORDER BY col_label`,
    [room.trim(), row.trim()],
  );
  return result.rows.map((r: any) => r.col_label);
}

export async function getLocationByBarcode(barcode: string): Promise<Location | null> {
  const result = await pool.query(
    `SELECT * FROM locations WHERE barcode = $1 AND is_active = true LIMIT 1`,
    [barcode.trim()],
  );
  return result.rows[0] ?? null;
}

export async function createLocation(data: {
  name: string;
  room?: string | null;
  description?: string | null;
  barcode?: string | null;
  sortOrder?: number;
  rowLabel?: string | null;
  colLabel?: string | null;
  binType?: string | null;
  capacity?: number | null;
  parentId?: number | null;
  /** Only meaningful on parent room rows (no row/col). */
  zoneLetter?: string | null;
}): Promise<Location> {
  // Auto-generate barcode if not provided and we have room+row+col
  let barcode = data.barcode?.trim() || null;
  if (!barcode && data.room && data.rowLabel && data.colLabel) {
    const roomCode = data.room.trim().replace(/\s+/g, '').replace(/zone/i, 'Z');
    barcode = `${roomCode}-${data.rowLabel.trim()}-${data.colLabel.trim().padStart(2, '0')}`;
  }

  const zoneLetter = data.zoneLetter
    ? data.zoneLetter.trim().toUpperCase().charAt(0)
    : null;

  const result = await pool.query(
    `INSERT INTO locations (name, room, description, barcode, sort_order, row_label, col_label, bin_type, capacity, parent_id, zone_letter)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.name.trim(),
      data.room?.trim() || null,
      data.description?.trim() || null,
      barcode,
      data.sortOrder ?? 0,
      data.rowLabel?.trim() || null,
      data.colLabel?.trim() || null,
      data.binType?.trim() || null,
      data.capacity ?? null,
      data.parentId ?? null,
      zoneLetter && /^[A-Z]$/.test(zoneLetter) ? zoneLetter : null,
    ],
  );
  return result.rows[0];
}

export async function updateLocation(
  id: number,
  data: Partial<{ name: string; room: string | null; description: string | null; barcode: string | null; isActive: boolean; sortOrder: number }>,
): Promise<Location | null> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name.trim()); }
  if (data.room !== undefined) { sets.push(`room = $${idx++}`); params.push(data.room?.trim() || null); }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description?.trim() || null); }
  if (data.barcode !== undefined) { sets.push(`barcode = $${idx++}`); params.push(data.barcode?.trim() || null); }
  if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }
  if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(data.sortOrder); }

  params.push(id);
  const result = await pool.query(
    `UPDATE locations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

// ─── Room-level helpers ─────────────────────────────────────────────────────

/**
 * Rename a room across every location that references it. Returns the count
 * of rows touched (room parent + all child bins).
 */
export async function renameRoom(
  oldName: string,
  newName: string,
): Promise<{ updated: number; barcodesRekeyed: number }> {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return { updated: 0, barcodesRekeyed: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find every parent row participating in this room — match on either
    // `room` or legacy `name`. We need to know the count up front because
    // the `locations.name` column has a UNIQUE index, so we can only rewrite
    // `name` on ONE row per rename. Sort_order/id picks the canonical row;
    // siblings keep their distinct names (e.g. "Storage A", "Storage B")
    // and only get their `room` rewritten.
    const parents = await client.query(
      `SELECT id, name FROM locations
        WHERE row_label IS NULL
          AND col_label IS NULL
          AND is_active = true
          AND (room = $1 OR name = $1)
        ORDER BY sort_order, id`,
      [from],
    ) as { rows: { id: number; name: string }[] };

    let parentUpdates = 0;
    if (parents.rows.length > 0) {
      const canonicalId = parents.rows[0].id;
      const siblingIds = parents.rows.slice(1).map((r) => r.id);

      // Siblings: room-only rewrite. Keeps their distinct names so the
      // UNIQUE(name) constraint doesn't fire when multiple parents share a
      // room (legacy data shape).
      if (siblingIds.length > 0) {
        const sib = await client.query(
          `UPDATE locations
              SET room = $1, updated_at = NOW()
            WHERE id = ANY($2::int[])
          RETURNING id`,
          [to, siblingIds],
        );
        parentUpdates += sib.rowCount ?? 0;
      }

      // Canonical parent: rewrite both name + room. Throws 23505 if some
      // OTHER row already owns this name — caller maps that to a 409.
      const can = await client.query(
        `UPDATE locations
            SET name = $1, room = $1, updated_at = NOW()
          WHERE id = $2
        RETURNING id`,
        [to, canonicalId],
      );
      parentUpdates += can.rowCount ?? 0;
    }

    // Bin rows: only `room` gets rewritten. `name` on bins is a free-form
    // label and should not be globally swapped by a room rename.
    const binUpdate = await client.query(
      `UPDATE locations
         SET room = $2, updated_at = NOW()
       WHERE row_label IS NOT NULL
         AND col_label IS NOT NULL
         AND room = $1
       RETURNING id, row_label, col_label, barcode`,
      [from, to],
    ) as { rowCount: number; rows: { id: number; row_label: string; col_label: string; barcode: string | null }[] };

    // Re-key barcodes for renamed bins so the room prefix matches the new name.
    let barcodesRekeyed = 0;
    const fromRoomCode = from.replace(/\s+/g, '').replace(/zone/i, 'Z');
    const toRoomCode = to.replace(/\s+/g, '').replace(/zone/i, 'Z');
    for (const r of binUpdate.rows) {
      if (!r.barcode) continue;
      if (!r.barcode.startsWith(`${fromRoomCode}-`)) continue;
      const rest = r.barcode.slice(fromRoomCode.length + 1);
      const next = `${toRoomCode}-${rest}`;
      await client.query(
        `UPDATE locations SET barcode = $1, updated_at = NOW() WHERE id = $2`,
        [next, r.id],
      );
      barcodesRekeyed += 1;
    }

    const updated = parentUpdates + (binUpdate.rowCount ?? 0);

    // If neither parent nor any bin matched, the room exists only in client
    // state (localStorage zoneMap from the legacy label printer). Materialise
    // the parent row with the new name so subsequent reads see it.
    let parentCreated = 0;
    if (updated === 0) {
      const insert = await client.query(
        `INSERT INTO locations (name, room, is_active, sort_order)
         VALUES ($1, $1, true, COALESCE(
           (SELECT MAX(sort_order) + 1 FROM locations WHERE row_label IS NULL AND col_label IS NULL),
           0
         ))
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [to],
      );
      parentCreated = insert.rowCount ?? 0;
    }

    await client.query('COMMIT');
    return { updated: updated + parentCreated, barcodesRekeyed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reorder rooms — apply `sort_order` to each room name in `order` by index.
 * Updates only the room-level parent row (no row/col) so child bins keep
 * their own ordering. Returns the count of rooms updated.
 */
export async function reorderRooms(order: string[]): Promise<{ updated: number }> {
  const clean = order.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return { updated: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let updated = 0;
    for (let i = 0; i < clean.length; i += 1) {
      const r = await client.query(
        `UPDATE locations
            SET sort_order = $2, updated_at = NOW()
          WHERE row_label IS NULL AND col_label IS NULL
            AND (name = $1 OR room = $1)`,
        [clean[i], i],
      );
      updated += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Soft-delete a single bin/location by id (is_active = false). Bin contents,
 * inventory_events and audit rows reference it by id, so we never hard-delete.
 * Returns true if a row was deactivated (false if not found / already inactive).
 */
export async function softDeleteLocation(id: number): Promise<boolean> {
  const r = await pool.query(
    `UPDATE locations
        SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND is_active = true`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Soft-delete a room and every bin under it (sets is_active = false). */
export async function softDeleteRoom(name: string): Promise<{ deactivated: number }> {
  const room = name.trim();
  if (!room) return { deactivated: 0 };
  const r = await pool.query(
    `UPDATE locations
        SET is_active = false, updated_at = NOW()
      WHERE (room = $1 OR (row_label IS NULL AND col_label IS NULL AND name = $1))
        AND is_active = true`,
    [room],
  );
  return { deactivated: r.rowCount ?? 0 };
}

/**
 * Bulk-create bins for a row across a column range. Idempotent on barcode —
 * existing bins are returned untouched so the caller can simply re-print.
 */
export async function bulkCreateBinRange(data: {
  room: string;
  rowLabel: string;
  colStart: number;
  colEnd: number;
  binType?: string | null;
  capacity?: number | null;
}): Promise<{ created: number; bins: Location[] }> {
  const room = data.room.trim();
  const rowLabel = data.rowLabel.trim();
  const lo = Math.min(data.colStart, data.colEnd);
  const hi = Math.max(data.colStart, data.colEnd);
  const roomCode = room.replace(/\s+/g, '').replace(/zone/i, 'Z');
  const bins: Location[] = [];
  let created = 0;

  for (let n = lo; n <= hi; n += 1) {
    const colLabel = String(n);
    const barcode = `${roomCode}-${rowLabel}-${colLabel.padStart(2, '0')}`;
    const existing = await pool.query(
      `SELECT * FROM locations WHERE barcode = $1 LIMIT 1`,
      [barcode],
    );
    if (existing.rows[0]) {
      // Re-activate if soft-deleted so re-prints work after a delete cycle.
      if (existing.rows[0].is_active === false) {
        const reactivated = await pool.query(
          `UPDATE locations SET is_active = true, updated_at = NOW()
             WHERE id = $1 RETURNING *`,
          [existing.rows[0].id],
        );
        bins.push(reactivated.rows[0]);
      } else {
        bins.push(existing.rows[0]);
      }
      continue;
    }

    const insert = await pool.query(
      `INSERT INTO locations
        (name, room, barcode, row_label, col_label, bin_type, capacity, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        `${roomCode} ${rowLabel}${colLabel}`,
        room,
        barcode,
        rowLabel,
        colLabel,
        data.binType?.trim() || null,
        data.capacity ?? null,
        n,
      ],
    );
    bins.push(insert.rows[0]);
    created += 1;
  }
  return { created, bins };
}

/**
 * Upsert location rows for a batch of printer-format addresses
 * ({zone, aisle, bay, level, position}). Called by the Location Label
 * Printer before window.print() so every printed sticker has a backing row
 * — scans of the QR resolve to a real bin, putaway audits work, and the
 * bin appears in bins-overview.
 *
 * Idempotent on `barcode`: the flat code (e.g. "A0101101") is the natural
 * key. Re-printing the same label is a no-op (existing row returned). Soft-
 * deleted rows are reactivated so the print-then-delete-then-print cycle
 * works.
 *
 * `name` is the dashed human-readable form ("A-01-01-1-01") and is the
 * column the UNIQUE(name) index pins.
 * `row_label` / `col_label` are populated so the bin shows up in
 * bins-overview (the SQL there filters `row_label IS NOT NULL AND
 * col_label IS NOT NULL`). We pack the 5-tier address into the 3-tier
 * schema as `row_label = "{aisle}-{bay}"`, `col_label = "{level}-{position}"`.
 * `parent_id` is set to the active parent room row when one exists.
 */
export async function registerPrintedLocations(input: {
  room: string;
  segments: LocationSegments[];
  binType?: string | null;
  capacity?: number | null;
}): Promise<{ registered: number; bins: Location[] }> {
  const room = input.room.trim();
  if (!room) throw new Error('room is required');
  if (!Array.isArray(input.segments) || input.segments.length === 0) {
    return { registered: 0, bins: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Active parent room row (best-effort; null is acceptable).
    const parent = await client.query(
      `SELECT id FROM locations
        WHERE row_label IS NULL
          AND col_label IS NULL
          AND is_active = true
          AND (room = $1 OR name = $1)
        ORDER BY sort_order, id
        LIMIT 1`,
      [room],
    ) as { rows: { id: number }[] };
    const parentId = parent.rows[0]?.id ?? null;

    const bins: Location[] = [];
    let registered = 0;

    for (const seg of input.segments) {
      const barcode = locationCodeFlat(seg);
      const dashedName = locationCode(seg);
      const rowLabel = `${pad2(seg.aisle)}-${pad2(seg.bay)}`;
      const colLabel = `${noPad(seg.level)}-${pad2(seg.position)}`;

      // 1. Existing row by barcode? Reactivate if soft-deleted, else return.
      const existing = await client.query(
        `SELECT * FROM locations WHERE barcode = $1 LIMIT 1`,
        [barcode],
      ) as { rows: Location[] };
      if (existing.rows[0]) {
        if (existing.rows[0].is_active === false) {
          const r = await client.query(
            `UPDATE locations
                SET is_active = true,
                    room = $2,
                    row_label = $3,
                    col_label = $4,
                    parent_id = COALESCE($5, parent_id),
                    bin_type = COALESCE($6, bin_type),
                    capacity = COALESCE($7, capacity),
                    updated_at = NOW()
              WHERE id = $1
            RETURNING *`,
            [
              existing.rows[0].id,
              room,
              rowLabel,
              colLabel,
              parentId,
              input.binType ?? null,
              input.capacity ?? null,
            ],
          ) as { rows: Location[] };
          bins.push(r.rows[0]);
          registered += 1;
        } else {
          // Already live — keep row drift in sync (room rename safety).
          if (existing.rows[0].room !== room || existing.rows[0].parent_id !== parentId) {
            const r = await client.query(
              `UPDATE locations
                  SET room = $2, parent_id = COALESCE($3, parent_id), updated_at = NOW()
                WHERE id = $1
              RETURNING *`,
              [existing.rows[0].id, room, parentId],
            ) as { rows: Location[] };
            bins.push(r.rows[0]);
          } else {
            bins.push(existing.rows[0]);
          }
        }
        continue;
      }

      // 2. Insert a fresh row. UNIQUE(name) protects against manual dupes.
      const insert = await client.query(
        `INSERT INTO locations
           (name, room, barcode, row_label, col_label, bin_type, capacity, parent_id, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
         ON CONFLICT (barcode) DO UPDATE
            SET room = EXCLUDED.room,
                row_label = EXCLUDED.row_label,
                col_label = EXCLUDED.col_label,
                bin_type = COALESCE(EXCLUDED.bin_type, locations.bin_type),
                capacity = COALESCE(EXCLUDED.capacity, locations.capacity),
                parent_id = COALESCE(EXCLUDED.parent_id, locations.parent_id),
                is_active = true,
                updated_at = NOW()
         RETURNING *`,
        [
          dashedName,
          room,
          barcode,
          rowLabel,
          colLabel,
          input.binType ?? null,
          input.capacity ?? null,
          parentId,
        ],
      ) as { rows: Location[] };
      bins.push(insert.rows[0]);
      registered += 1;
    }

    await client.query('COMMIT');
    return { registered, bins };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Location Transfers ─────────────────────────────────────────────────────

export async function logLocationTransfer(data: {
  entityType: string;
  entityId: number;
  sku: string;
  fromLocation: string | null;
  toLocation: string;
  staffId?: number | null;
  notes?: string | null;
}): Promise<LocationTransfer> {
  const result = await pool.query(
    `INSERT INTO location_transfers (entity_type, entity_id, sku, from_location, to_location, staff_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [data.entityType, data.entityId, data.sku, data.fromLocation, data.toLocation, data.staffId || null, data.notes?.trim() || null],
  );
  return result.rows[0];
}

export async function getTransfersForSku(sku: string, limit = 25): Promise<LocationTransfer[]> {
  const result = await pool.query(
    `SELECT * FROM location_transfers
     WHERE sku = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sku.trim(), limit],
  );
  return result.rows;
}

// ─── Bin Contents ───────────────────────────────────────────────────────────

/** Get all SKUs stored in a specific bin (by location_id). */
export async function getBinContents(locationId: number): Promise<BinContent[]> {
  const result = await pool.query(
    `SELECT bc.*, l.name AS location_name, l.room, l.row_label, l.col_label, l.barcode,
            COALESCE(
              NULLIF(ss.display_name_override, ''),
              NULLIF(ss.product_title, '')
            ) AS product_title,
            ss.display_name_override
     FROM bin_contents bc
     JOIN locations l ON l.id = bc.location_id
     LEFT JOIN sku_stock ss ON ss.sku = bc.sku
     WHERE bc.location_id = $1
     ORDER BY bc.sku`,
    [locationId],
  );
  return result.rows;
}

/** Get all bin locations for a specific SKU (where is this product stored?). */
export async function getBinLocationsBySku(sku: string): Promise<BinContent[]> {
  const result = await pool.query(
    `SELECT bc.*, l.name AS location_name, l.room, l.row_label, l.col_label, l.barcode,
            COALESCE(
              NULLIF(ss.display_name_override, ''),
              NULLIF(ss.product_title, '')
            ) AS product_title,
            ss.display_name_override
     FROM bin_contents bc
     JOIN locations l ON l.id = bc.location_id
     LEFT JOIN sku_stock ss ON ss.sku = bc.sku
     WHERE bc.sku = $1 AND bc.qty > 0
     ORDER BY l.room, l.row_label, l.col_label`,
    [sku.trim()],
  );
  return result.rows;
}

/** Get bin contents by scanning a bin barcode. */
export async function getBinContentsByBarcode(barcode: string): Promise<{
  location: Location;
  contents: BinContent[];
} | null> {
  const loc = await getLocationByBarcode(barcode);
  if (!loc) return null;
  const contents = await getBinContents(loc.id);
  return { location: loc, contents };
}

/** Add or update SKU quantity in a bin. */
export async function upsertBinContent(data: {
  locationId: number;
  sku: string;
  qty: number;
  minQty?: number | null;
  maxQty?: number | null;
}): Promise<BinContent> {
  const result = await pool.query(
    `INSERT INTO bin_contents (location_id, sku, qty, min_qty, max_qty)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id, sku)
     DO UPDATE SET
       qty = EXCLUDED.qty,
       min_qty = COALESCE(EXCLUDED.min_qty, bin_contents.min_qty),
       max_qty = COALESCE(EXCLUDED.max_qty, bin_contents.max_qty),
       updated_at = NOW()
     RETURNING *`,
    [data.locationId, data.sku.trim(), data.qty, data.minQty ?? null, data.maxQty ?? null],
  );
  return result.rows[0];
}

/**
 * Versioned variant of {@link upsertBinContent} — UPDATE only succeeds when
 * the caller-supplied `expectedUpdatedAt` matches the current row.
 *
 * Returns:
 *   • `{ ok: true,  row }`     — write applied
 *   • `{ ok: false, current }` — stale version; caller should re-fetch
 *
 * Insert path (row doesn't exist yet) never collides with version; the
 * caller should treat that as a successful write.
 */
export async function upsertBinContentIfVersion(data: {
  locationId: number;
  sku: string;
  qty: number;
  minQty?: number | null;
  maxQty?: number | null;
  expectedUpdatedAt: string;
}): Promise<
  | { ok: true; row: BinContent }
  | { ok: false; current: BinContent | null }
> {
  // Try the conditional UPDATE first. We compare with millisecond-level
  // truncation on both sides because the API roundtrips timestamps as ISO
  // strings (millisecond precision) while Postgres stores microseconds.
  const updated = await pool.query<BinContent>(
    `UPDATE bin_contents
       SET qty = $3,
           min_qty = COALESCE($4, min_qty),
           max_qty = COALESCE($5, max_qty),
           updated_at = NOW()
     WHERE location_id = $1
       AND sku = $2
       AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $6::timestamptz)
     RETURNING *`,
    [
      data.locationId,
      data.sku.trim(),
      data.qty,
      data.minQty ?? null,
      data.maxQty ?? null,
      data.expectedUpdatedAt,
    ],
  );
  if (updated.rows[0]) return { ok: true, row: updated.rows[0] };

  // No row updated — either the version was stale, or the row never existed.
  const existing = await pool.query<BinContent>(
    `SELECT * FROM bin_contents WHERE location_id = $1 AND sku = $2 LIMIT 1`,
    [data.locationId, data.sku.trim()],
  );
  if (existing.rows[0]) {
    return { ok: false, current: existing.rows[0] };
  }

  // First-time insert — race-free because the UNIQUE (location_id, sku)
  // constraint serializes concurrent inserts.
  const inserted = await pool.query<BinContent>(
    `INSERT INTO bin_contents (location_id, sku, qty, min_qty, max_qty)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id, sku) DO NOTHING
     RETURNING *`,
    [data.locationId, data.sku.trim(), data.qty, data.minQty ?? null, data.maxQty ?? null],
  );
  if (inserted.rows[0]) return { ok: true, row: inserted.rows[0] };

  // Someone else inserted between our checks — fetch and report stale.
  const after = await pool.query<BinContent>(
    `SELECT * FROM bin_contents WHERE location_id = $1 AND sku = $2 LIMIT 1`,
    [data.locationId, data.sku.trim()],
  );
  return { ok: false, current: after.rows[0] ?? null };
}

/**
 * Adjust bin quantity by delta (positive = put, negative = take).
 * Also adjusts sku_stock in the same transaction for consistency.
 */
export async function adjustBinQty(data: {
  locationId: number;
  sku: string;
  delta: number;
  staffId?: number | null;
  reason?: string;
  /** FK into reason_codes — newer callers should send this so reports can group cleanly. */
  reasonCodeId?: number | null;
  /** Free-text note (used by reason codes like DAMAGED / FOUND that require explanation). */
  notes?: string | null;
}): Promise<{ binContent: BinContent; newStockQty: number; ledgerId: number | null }> {
  const rawSku = data.sku.trim();
  const baseSku = rawSku.includes(':') ? rawSku.split(':')[0].trim() : rawSku;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Adjust bin qty (floor at 0)
    const binResult = await client.query(
      `INSERT INTO bin_contents (location_id, sku, qty)
       VALUES ($1, $2, GREATEST(0, $3))
       ON CONFLICT (location_id, sku)
       DO UPDATE SET
         qty = GREATEST(0, bin_contents.qty + $3),
         updated_at = NOW()
       RETURNING *`,
      [data.locationId, baseSku, data.delta],
    );

    // 2. Adjust sku_stock aggregate
    const stockResult = await client.query(
      `INSERT INTO sku_stock (sku, stock)
       VALUES ($1, GREATEST(0, $2))
       ON CONFLICT (sku)
       DO UPDATE SET stock = GREATEST(0, sku_stock.stock + $2)
       RETURNING stock`,
      [baseSku, data.delta],
    );

    // 3. Log to stock ledger — preserves the text `reason` for back-compat
    //    while also stamping `reason_code_id` so reporting can group cleanly.
    let ledgerId: number | null = null;
    try {
      const ledgerRes = await client.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger
           (sku, delta, reason, staff_id, reason_code_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          baseSku,
          data.delta,
          data.reason || 'BIN_ADJUST',
          data.staffId || null,
          data.reasonCodeId ?? null,
          data.notes ?? null,
        ],
      );
      ledgerId = ledgerRes.rows[0]?.id ?? null;
    } catch {
      /* best-effort — adjustment still succeeds even if ledger write fails */
    }

    await client.query('COMMIT');

    return {
      binContent: binResult.rows[0],
      newStockQty: Number(stockResult.rows[0]?.stock) || 0,
      ledgerId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Mark a bin as physically counted (cycle count). */
export async function markBinCounted(locationId: number, sku: string): Promise<void> {
  await pool.query(
    `UPDATE bin_contents SET last_counted = NOW() WHERE location_id = $1 AND sku = $2`,
    [locationId, sku.trim()],
  );
}

/** Get bins that are below their min_qty threshold (low stock alerts). */
export async function getLowStockBins(): Promise<BinContent[]> {
  const result = await pool.query(
    `SELECT bc.*, l.name AS location_name, l.room, l.row_label, l.col_label, l.barcode,
            ss.product_title
     FROM bin_contents bc
     JOIN locations l ON l.id = bc.location_id
     LEFT JOIN sku_stock ss ON ss.sku = bc.sku
     WHERE bc.min_qty IS NOT NULL AND bc.qty <= bc.min_qty
     ORDER BY bc.qty ASC, l.room, l.row_label, l.col_label`,
  );
  return result.rows;
}
