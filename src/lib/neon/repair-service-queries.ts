import pool from '../db';
import { formatPSTTimestamp, normalizePSTTimestamp } from '@/utils/date';

export interface RepairStatusHistoryEntry {
  status: string;
  timestamp: string;
  previous_status?: string | null;
  source?: string | null;
  user_id?: number | null;
  user_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RSRecord {
  id: number;
  version?: number;
  created_at: string;
  updated_at: string;
  ticket_number: string;
  contact_info: string;
  product_title: string;
  price: string;
  issue: string;
  serial_number: string;
  status: string;
  notes?: string | null;
  status_history?: RepairStatusHistoryEntry[];
  source_system?: string | null;
  source_order_id?: string | null;
  source_tracking_number?: string | null;
  source_sku?: string | null;
  intake_channel?: string | null;
  delivered_at?: string | null;
  received_at?: string | null;
  intake_confirmed_at?: string | null;
  received_by_staff_id?: number | null;
  customer_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
}

export const REPAIR_STATUS_OPTIONS = [
  'Incoming Shipment',
  'Awaiting Parts',
  'Pending Repair',
  'Awaiting Pickup',
  'Repaired, Contact Customer',
  'Awaiting Payment',
  'Awaiting Additional Parts Payment',
  'Shipped',
  'Picked Up',
] as const;

export type RepairTab = 'incoming' | 'active' | 'done';

/** Statuses shown on the Done tab — also used by station “next repair” exclusions. */
export const REPAIR_DONE_TAB_STATUSES = ['Done', 'Picked Up', 'Shipped'] as const;

/** Walk-in repairs list — “Incoming” tab (inbound shipments not yet in active workflow). */
export const REPAIR_INCOMING_TAB_STATUS = 'Incoming Shipment' as const;

/**
 * Soft-delete status. Cancelled repairs are hidden from every list tab (see
 * buildRepairTabWhere) but the row + status_history survive for the audit
 * trail. Stored in the free-text `status` column — no schema change needed.
 */
export const REPAIR_CANCELLED_STATUS = 'Cancelled' as const;

function sqlStatusInTerminal(): string {
  return `(${REPAIR_DONE_TAB_STATUSES.map((s) => `'${s}'`).join(', ')})`;
}

function sqlIncomingTabStatus(): string {
  return `'${REPAIR_INCOMING_TAB_STATUS.replace(/'/g, "''")}'`;
}

function sqlCancelledStatus(): string {
  return `'${REPAIR_CANCELLED_STATUS.replace(/'/g, "''")}'`;
}

function mapRepairRow(row: any): RSRecord {
  const statusHistory = Array.isArray(row.status_history)
    ? row.status_history
    : (() => {
        if (!row.status_history) return [];
        try {
          const parsed = JSON.parse(row.status_history);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

  return {
    id: Number(row.id),
    version: row.version == null ? undefined : Number(row.version),
    created_at: normalizePSTTimestamp(row.created_at) || '',
    updated_at: normalizePSTTimestamp(row.updated_at) || '',
    ticket_number: row.ticket_number || '',
    contact_info: row.contact_info || '',
    product_title: row.product_title || '',
    price: row.price || '',
    issue: row.issue || '',
    serial_number: row.serial_number || '',
    status: row.status || 'Pending Repair',
    notes: row.notes ?? null,
    status_history: statusHistory,
    source_system: row.source_system ?? null,
    source_order_id: row.source_order_id ?? null,
    source_tracking_number: row.source_tracking_number ?? null,
    source_sku: row.source_sku ?? null,
    intake_channel: row.intake_channel ?? null,
    delivered_at: normalizePSTTimestamp(row.delivered_at) || null,
    received_at: normalizePSTTimestamp(row.received_at) || null,
    intake_confirmed_at: normalizePSTTimestamp(row.intake_confirmed_at) || null,
    received_by_staff_id: row.received_by_staff_id == null ? null : Number(row.received_by_staff_id),
    customer_id: row.customer_id == null ? null : Number(row.customer_id),
    customer_name: row.customer_name ?? null,
    customer_phone: row.customer_phone ?? null,
    customer_email: row.customer_email ?? null,
  };
}

const REPAIR_SELECT_COLUMNS = `
  rs.id,
  rs.created_at,
  rs.updated_at,
  rs.ticket_number,
  rs.contact_info,
  rs.product_title,
  rs.price,
  rs.issue,
  rs.serial_number,
  rs.status,
  rs.notes,
  rs.status_history,
  rs.source_system,
  rs.source_order_id,
  rs.source_tracking_number,
  rs.source_sku,
  rs.intake_channel,
  rs.delivered_at,
  rs.received_at,
  rs.intake_confirmed_at,
  rs.received_by_staff_id,
  rs.customer_id,
  COALESCE(c.display_name, c.customer_name, CONCAT_WS(' ', c.first_name, c.last_name)) AS customer_name,
  COALESCE(c.phone, c.mobile) AS customer_phone,
  c.email AS customer_email
`;

const REPAIR_FROM = `
  FROM repair_service rs
  LEFT JOIN customers c ON c.id = rs.customer_id
`;

function buildRepairTabWhere(tab: RepairTab) {
  const terminalList = sqlStatusInTerminal();
  const incomingSt = sqlIncomingTabStatus();
  if (tab === 'incoming') {
    return `WHERE rs.status = ${incomingSt}`;
  }
  if (tab === 'done') {
    return `WHERE rs.status IN ${terminalList}`;
  }
  return `WHERE rs.status != ${incomingSt}
          AND rs.status != ${sqlCancelledStatus()}
          AND rs.status NOT IN ${terminalList}`;
}

function buildRepairSearchWhere(idx: number, tab?: RepairTab) {
  const base = `(
      rs.ticket_number ILIKE $${idx}
      OR rs.contact_info ILIKE $${idx}
      OR rs.product_title ILIKE $${idx}
      OR rs.serial_number ILIKE $${idx}
      OR COALESCE(rs.source_order_id, '') ILIKE $${idx}
      OR COALESCE(rs.source_tracking_number, '') ILIKE $${idx}
      OR COALESCE(rs.source_sku, '') ILIKE $${idx}
      OR COALESCE(c.display_name, c.customer_name, '') ILIKE $${idx}
      OR COALESCE(c.phone, c.mobile, '') ILIKE $${idx}
      OR COALESCE(c.email, '') ILIKE $${idx}
    )`;

  const terminalList = sqlStatusInTerminal();
  const incomingSt = sqlIncomingTabStatus();
  if (!tab) return `WHERE ${base}`;
  if (tab === 'incoming') return `WHERE rs.status = ${incomingSt} AND ${base}`;
  if (tab === 'done') return `WHERE rs.status IN ${terminalList} AND ${base}`;
  return `WHERE rs.status != ${incomingSt}
          AND rs.status != ${sqlCancelledStatus()}
          AND rs.status NOT IN ${terminalList}
          AND ${base}`;
}

export async function getAllRepairs(limit = 100, offset = 0, options?: { tab?: RepairTab }): Promise<RSRecord[]> {
  try {
    const where = buildRepairTabWhere(options?.tab || 'active');
    const result = await pool.query(
      `SELECT ${REPAIR_SELECT_COLUMNS}
       ${REPAIR_FROM}
       ${where}
       ORDER BY rs.created_at DESC NULLS LAST, rs.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return result.rows.map(mapRepairRow);
  } catch (error) {
    console.error('Error fetching repairs:', error);
    throw new Error('Failed to fetch repairs');
  }
}

export async function getRepairById(id: number): Promise<RSRecord | null> {
  try {
    const result = await pool.query(
      `SELECT ${REPAIR_SELECT_COLUMNS}
       ${REPAIR_FROM}
       WHERE rs.id = $1`,
      [id],
    );

    if (result.rows.length === 0) return null;
    return mapRepairRow(result.rows[0]);
  } catch (error) {
    console.error('Error fetching repair by ID:', error);
    throw new Error('Failed to fetch repair');
  }
}

export type CancelRepairResult =
  | { ok: true; repair: RSRecord; alreadyCancelled: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Soft-cancel a repair (status → 'Cancelled'). Hidden from all list tabs but
 * the row survives. Refuses repairs already in a terminal/done state (those
 * are finished, not cancellable). Idempotent: cancelling a cancelled repair
 * is a no-op success.
 */
export async function cancelRepair(id: number, reason?: string | null): Promise<CancelRepairResult> {
  const existing = await getRepairById(id);
  if (!existing) return { ok: false, status: 404, error: 'Repair not found' };
  if (existing.status === REPAIR_CANCELLED_STATUS) {
    return { ok: true, repair: existing, alreadyCancelled: true };
  }
  if ((REPAIR_DONE_TAB_STATUSES as readonly string[]).includes(existing.status)) {
    return { ok: false, status: 409, error: `Repair is ${existing.status} and cannot be cancelled` };
  }

  await updateRepairStatus(id, REPAIR_CANCELLED_STATUS);
  if (reason && reason.trim()) {
    await appendRepairStatusHistory(id, {
      status: REPAIR_CANCELLED_STATUS,
      previous_status: existing.status,
      source: 'repair-service.cancel',
      metadata: { reason: reason.trim() },
    });
  }
  const repair = await getRepairById(id);
  return { ok: true, repair: repair!, alreadyCancelled: false };
}

export type UnopenRepairResult =
  | { ok: true; repair: RSRecord; alreadyOpen: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Reverse of {@link cancelRepair}: reopen a Cancelled repair, restoring the
 * EXACT status it held before cancellation. The prior status is recovered from
 * status_history (the cancel recorded it as `previous_status` on the most
 * recent `Cancelled` entry) — so reopen is a true inverse, not a reset to a
 * fixed status. Refuses when the repair isn't Cancelled, or when no prior
 * status can be recovered from history.
 */
export async function unopenRepair(id: number, reason?: string | null): Promise<UnopenRepairResult> {
  const existing = await getRepairById(id);
  if (!existing) return { ok: false, status: 404, error: 'Repair not found' };
  if (existing.status !== REPAIR_CANCELLED_STATUS) {
    return { ok: false, status: 409, error: `Repair is ${existing.status}, not Cancelled — nothing to reopen` };
  }

  const histRes = await pool.query<{ status_history: RepairStatusHistoryEntry[] | null }>(
    `SELECT status_history FROM repair_service WHERE id = $1`,
    [id],
  );
  const history = (histRes.rows[0]?.status_history ?? []) as RepairStatusHistoryEntry[];
  let priorStatus: string | null = null;
  // 1. Cleanest source: the most recent Cancelled entry records the pre-cancel
  //    status as previous_status.
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e && e.status === REPAIR_CANCELLED_STATUS && e.previous_status) {
      priorStatus = String(e.previous_status);
      break;
    }
  }
  // 2. Fallback: the most recent NON-Cancelled status in history — covers a
  //    cancel from an empty/NULL status, where previous_status was stripped, so
  //    a reason-less cancel of a status-less row can still be reopened.
  if (!priorStatus) {
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i];
      if (e && e.status && e.status !== REPAIR_CANCELLED_STATUS) {
        priorStatus = String(e.status);
        break;
      }
    }
  }
  if (!priorStatus) {
    return { ok: false, status: 409, error: 'Cannot determine the prior status to reopen to' };
  }

  await updateRepairStatus(id, priorStatus);
  await appendRepairStatusHistory(id, {
    status: priorStatus,
    previous_status: REPAIR_CANCELLED_STATUS,
    source: 'repair-service.reopen',
    ...(reason && reason.trim() ? { metadata: { reason: reason.trim() } } : {}),
  });
  const repair = await getRepairById(id);
  return { ok: true, repair: repair!, alreadyOpen: false };
}

export async function updateRepairStatus(id: number, newStatus: string): Promise<void> {
  try {
    const timestamp = formatPSTTimestamp();
    const result = await pool.query(
      `UPDATE repair_service
          SET status = $1,
              status_history = CASE
                WHEN COALESCE(status, '') IS DISTINCT FROM $1 THEN
                  COALESCE(status_history, '[]'::jsonb) || jsonb_build_array(
                    jsonb_strip_nulls(
                      jsonb_build_object(
                        'status', $1,
                        'timestamp', $2::text,
                        'previous_status', NULLIF(status, ''),
                        'source', 'repair-service.update-status'
                      )
                    )
                  )
                ELSE COALESCE(status_history, '[]'::jsonb)
              END,
              updated_at = NOW()
        WHERE id = $3`,
      [newStatus, timestamp, id],
    );
    if ((result.rowCount ?? 0) === 0) throw new Error('Repair not found');
  } catch (error) {
    console.error('Error updating repair status:', error);
    throw new Error('Failed to update repair status');
  }
}

export async function updateRepairNotes(id: number, notes: string): Promise<void> {
  try {
    await pool.query(
      'UPDATE repair_service SET notes = $1, updated_at = NOW() WHERE id = $2',
      [notes, id],
    );
  } catch (error) {
    console.error('Error updating repair notes:', error);
    throw new Error('Failed to update repair notes');
  }
}

export async function appendRepairStatusHistory(
  id: number,
  entry: Omit<RepairStatusHistoryEntry, 'timestamp'> & { timestamp?: string }
): Promise<void> {
  try {
    const payload = {
      ...entry,
      timestamp: entry.timestamp ?? formatPSTTimestamp(),
    };

    const result = await pool.query(
      `UPDATE repair_service
          SET status_history = COALESCE(status_history, '[]'::jsonb) || $1::jsonb,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify([payload]), id],
    );

    if ((result.rowCount ?? 0) === 0) throw new Error('Repair not found');
  } catch (error) {
    console.error('Error appending repair status history:', error);
    throw new Error('Failed to append repair status history');
  }
}

export async function updateRepairField(id: number, field: string, value: any): Promise<void> {
  try {
    const validFields = [
      'ticket_number',
      'contact_info',
      'product_title',
      'price',
      'issue',
      'serial_number',
      'status',
      'notes',
      'source_system',
      'source_order_id',
      'source_tracking_number',
      'source_sku',
      'intake_channel',
      'delivered_at',
      'received_at',
      'intake_confirmed_at',
      'received_by_staff_id',
      'customer_id',
    ];

    if (!validFields.includes(field)) throw new Error(`Invalid field: ${field}`);

    await pool.query(
      `UPDATE repair_service SET ${field} = $1, updated_at = NOW() WHERE id = $2`,
      [value, id],
    );
  } catch (error) {
    console.error('Error updating repair field:', error);
    throw new Error('Failed to update repair field');
  }
}

export interface CreateRepairParams {
  createdAt?: string;
  ticketNumber?: string | null;
  contactInfo: string;
  productTitle: string;
  price: string;
  issue: string;
  serialNumber: string;
  notes?: string | null;
  status?: string;
  sourceSystem?: string | null;
  sourceOrderId?: string | null;
  sourceTrackingNumber?: string | null;
  sourceSku?: string | null;
  intakeChannel?: string | null;
  deliveredAt?: string | null;
  receivedAt?: string | null;
  intakeConfirmedAt?: string | null;
  receivedByStaffId?: number | null;
  customerId?: number | null;
}

export async function createRepair(params: CreateRepairParams): Promise<RSRecord> {
  const createdAt = normalizePSTTimestamp(params.createdAt, { fallbackToNow: true })!;
  const intakeChannel = params.intakeChannel ?? 'pickup';
  const receivedAt = params.receivedAt ?? (intakeChannel === 'pickup' ? createdAt : null);
  const intakeConfirmedAt = params.intakeConfirmedAt ?? (intakeChannel === 'pickup' ? createdAt : null);

  const result = await pool.query(
    `INSERT INTO repair_service
       (
         created_at, updated_at, ticket_number, contact_info, product_title, price, issue, serial_number, notes, status,
         source_system, source_order_id, source_tracking_number, source_sku, intake_channel,
         delivered_at, received_at, intake_confirmed_at, received_by_staff_id, customer_id
       )
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING id, ticket_number`,
    [
      createdAt,
      params.ticketNumber ?? null,
      params.contactInfo,
      params.productTitle,
      params.price,
      params.issue,
      params.serialNumber,
      params.notes ?? null,
      params.status ?? 'Pending Repair',
      params.sourceSystem ?? null,
      params.sourceOrderId ?? null,
      params.sourceTrackingNumber ?? null,
      params.sourceSku ?? null,
      intakeChannel,
      params.deliveredAt ?? null,
      receivedAt,
      intakeConfirmedAt,
      params.receivedByStaffId ?? null,
      params.customerId ?? null,
    ],
  );

  const { id } = result.rows[0];
  let ticketNumber = result.rows[0].ticket_number;

  if (!ticketNumber) {
    const fallback = `RS-${String(id).padStart(4, '0')}`;
    await pool.query(
      'UPDATE repair_service SET ticket_number = $1, updated_at = NOW() WHERE id = $2',
      [fallback, id],
    );
    ticketNumber = fallback;
  }

  const record = await getRepairById(id);
  return record!;
}

export async function searchRepairs(query: string, options?: { tab?: RepairTab }): Promise<RSRecord[]> {
  try {
    const searchTerm = `%${query}%`;
    const where = buildRepairSearchWhere(1, options?.tab);
    const result = await pool.query(
      `SELECT ${REPAIR_SELECT_COLUMNS}
       ${REPAIR_FROM}
       ${where}
       ORDER BY rs.created_at DESC NULLS LAST, rs.id DESC
       LIMIT 20`,
      [searchTerm],
    );

    return result.rows.map(mapRepairRow);
  } catch (error) {
    console.error('Error searching repairs:', error);
    throw new Error('Failed to search repairs');
  }
}

function buildEcwidRepairNotes(params: {
  existingNotes?: string | null;
  trackingNumber?: string | null;
  orderId?: string | null;
  sku?: string | null;
}) {
  const parts = [
    params.orderId ? `Ecwid Order: ${params.orderId}` : null,
    params.trackingNumber ? `Tracking: ${params.trackingNumber}` : null,
    params.sku ? `Source SKU: ${params.sku}` : null,
  ].filter(Boolean);

  const prefix = parts.join('\n');
  const existing = String(params.existingNotes || '').trim();
  if (!prefix) return existing || null;
  if (!existing) return prefix;
  return `${prefix}\n\n${existing}`;
}

export async function upsertEcwidIncomingRepair(params: {
  orderId: string | null;
  trackingNumber: string | null;
  sku: string | null;
  productTitle: string | null;
  contactInfo: string | null;
  orderDate?: string | null;
  notes?: string | null;
}): Promise<RSRecord> {
  try {
    const existing = await pool.query(
      `SELECT id
       FROM repair_service
       WHERE source_system = 'ecwid'
         AND (
           (
             source_order_id IS NOT NULL
             AND source_order_id = $1
             AND (
               COALESCE(NULLIF($3, ''), '') = ''
               OR COALESCE(source_sku, '') = COALESCE($3, '')
             )
           )
           OR (
             source_tracking_number IS NOT NULL
             AND source_tracking_number = $2
             AND COALESCE(source_sku, '') = COALESCE($3, '')
           )
         )
       ORDER BY id DESC
       LIMIT 1`,
      [params.orderId, params.trackingNumber, params.sku]
    );

    const notes = buildEcwidRepairNotes({
      existingNotes: params.notes,
      trackingNumber: params.trackingNumber,
      orderId: params.orderId,
      sku: params.sku,
    });

    if (existing.rows.length > 0) {
      const repairId = Number(existing.rows[0].id);
      await pool.query(
        `UPDATE repair_service
         SET contact_info = COALESCE(NULLIF(contact_info, ''), $1),
             product_title = COALESCE(NULLIF(product_title, ''), $2),
             notes = COALESCE(NULLIF(notes, ''), $3),
             source_order_id = COALESCE(NULLIF(source_order_id, ''), $4),
             source_tracking_number = COALESCE(NULLIF(source_tracking_number, ''), $5),
             source_sku = COALESCE(NULLIF(source_sku, ''), $6),
             intake_channel = COALESCE(NULLIF(intake_channel, ''), 'shipment'),
             status = CASE
               WHEN received_at IS NULL
                    AND COALESCE(status, '') NOT IN ('Done', 'Picked Up', 'Shipped')
                    AND COALESCE(status, '') IN ('Pending Repair', ${sqlIncomingTabStatus()})
                 THEN ${sqlIncomingTabStatus()}
               ELSE status
             END,
             delivered_at = COALESCE(delivered_at, $7),
             updated_at = NOW()
         WHERE id = $8`,
        [
          params.contactInfo ?? null,
          params.productTitle ?? null,
          notes,
          params.orderId ?? null,
          params.trackingNumber ?? null,
          params.sku ?? null,
          params.orderDate ?? null,
          repairId,
        ]
      );
      const record = await getRepairById(repairId);
      return record!;
    }

    return createRepair({
      createdAt: params.orderDate ?? undefined,
      ticketNumber: null,
      contactInfo: params.contactInfo || '',
      productTitle: params.productTitle || 'Ecwid Incoming Repair',
      price: '',
      issue: 'Ecwid inbound repair shipment',
      serialNumber: '',
      notes,
      status: REPAIR_INCOMING_TAB_STATUS,
      sourceSystem: 'ecwid',
      sourceOrderId: params.orderId ?? null,
      sourceTrackingNumber: params.trackingNumber ?? null,
      sourceSku: params.sku ?? null,
      intakeChannel: 'shipment',
      deliveredAt: params.orderDate ?? null,
      receivedAt: null,
      intakeConfirmedAt: null,
    });
  } catch (error) {
    console.error('Error upserting Ecwid incoming repair:', error);
    throw new Error('Failed to upsert incoming repair');
  }
}
