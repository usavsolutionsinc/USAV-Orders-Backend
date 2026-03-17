import pool from '../db';
import { normalizePSTTimestamp } from '@/utils/date';

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
  source_system?: string | null;
  source_order_id?: string | null;
  source_tracking_number?: string | null;
  source_sku?: string | null;
  intake_channel?: string | null;
  incoming_status?: string | null;
  delivered_at?: string | null;
  received_at?: string | null;
  intake_confirmed_at?: string | null;
  received_by_staff_id?: number | null;
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

export type RepairStatus = typeof REPAIR_STATUS_OPTIONS[number];

export type RepairTab = 'incoming' | 'active' | 'done';

function mapRepairRow(row: any): RSRecord {
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
    source_system: row.source_system ?? null,
    source_order_id: row.source_order_id ?? null,
    source_tracking_number: row.source_tracking_number ?? null,
    source_sku: row.source_sku ?? null,
    intake_channel: row.intake_channel ?? null,
    incoming_status: row.incoming_status ?? null,
    delivered_at: normalizePSTTimestamp(row.delivered_at) || null,
    received_at: normalizePSTTimestamp(row.received_at) || null,
    intake_confirmed_at: normalizePSTTimestamp(row.intake_confirmed_at) || null,
    received_by_staff_id: row.received_by_staff_id == null ? null : Number(row.received_by_staff_id),
  };
}

function buildRepairTabWhere(tab: RepairTab) {
  if (tab === 'incoming') {
    return `WHERE COALESCE(incoming_status, '') = 'incoming'`;
  }
  if (tab === 'done') {
    return `WHERE status IN ('Done', 'Picked Up', 'Shipped')`;
  }
  return `WHERE COALESCE(incoming_status, '') != 'incoming'
          AND status NOT IN ('Done', 'Picked Up', 'Shipped')`;
}

function buildRepairSearchWhere(idx: number, tab?: RepairTab) {
  const base = `(
      ticket_number ILIKE $${idx}
      OR contact_info ILIKE $${idx}
      OR product_title ILIKE $${idx}
      OR serial_number ILIKE $${idx}
      OR COALESCE(source_order_id, '') ILIKE $${idx}
      OR COALESCE(source_tracking_number, '') ILIKE $${idx}
      OR COALESCE(source_sku, '') ILIKE $${idx}
    )`;

  if (!tab) return `WHERE ${base}`;
  if (tab === 'incoming') return `WHERE COALESCE(incoming_status, '') = 'incoming' AND ${base}`;
  if (tab === 'done') return `WHERE status IN ('Done', 'Picked Up', 'Shipped') AND ${base}`;
  return `WHERE COALESCE(incoming_status, '') != 'incoming'
          AND status NOT IN ('Done', 'Picked Up', 'Shipped')
          AND ${base}`;
}

export async function getAllRepairs(limit = 100, offset = 0, options?: { tab?: RepairTab }): Promise<RSRecord[]> {
  try {
    const where = buildRepairTabWhere(options?.tab || 'active');
    const result = await pool.query(
      `SELECT
         id,
         created_at,
         updated_at,
         ticket_number,
         contact_info,
         product_title,
         price,
         issue,
         serial_number,
         status,
         notes,
         source_system,
         source_order_id,
         source_tracking_number,
         source_sku,
         intake_channel,
         incoming_status,
         delivered_at,
         received_at,
         intake_confirmed_at,
         received_by_staff_id
       FROM repair_service
       ${where}
       ORDER BY created_at DESC NULLS LAST, id DESC
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
      `SELECT
         id,
         created_at,
         updated_at,
         ticket_number,
         contact_info,
         product_title,
         price,
         issue,
         serial_number,
         status,
         notes,
         source_system,
         source_order_id,
         source_tracking_number,
         source_sku,
         intake_channel,
         incoming_status,
         delivered_at,
         received_at,
         intake_confirmed_at,
         received_by_staff_id
       FROM repair_service
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) return null;
    return mapRepairRow(result.rows[0]);
  } catch (error) {
    console.error('Error fetching repair by ID:', error);
    throw new Error('Failed to fetch repair');
  }
}

export async function updateRepairStatus(id: number, newStatus: string): Promise<void> {
  try {
    const result = await pool.query(
      'UPDATE repair_service SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, id],
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
      'incoming_status',
      'delivered_at',
      'received_at',
      'intake_confirmed_at',
      'received_by_staff_id',
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
  incomingStatus?: string | null;
  deliveredAt?: string | null;
  receivedAt?: string | null;
  intakeConfirmedAt?: string | null;
  receivedByStaffId?: number | null;
}

export async function createRepair(params: CreateRepairParams): Promise<RSRecord> {
  const createdAt = normalizePSTTimestamp(params.createdAt, { fallbackToNow: true })!;
  const intakeChannel = params.intakeChannel ?? 'pickup';
  const incomingStatus = params.incomingStatus ?? 'pending_repair';
  const receivedAt = params.receivedAt ?? (intakeChannel === 'pickup' ? createdAt : null);
  const intakeConfirmedAt = params.intakeConfirmedAt ?? (intakeChannel === 'pickup' ? createdAt : null);

  const result = await pool.query(
    `INSERT INTO repair_service
       (
         created_at, updated_at, ticket_number, contact_info, product_title, price, issue, serial_number, notes, status,
         source_system, source_order_id, source_tracking_number, source_sku, intake_channel, incoming_status,
         delivered_at, received_at, intake_confirmed_at, received_by_staff_id
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
      incomingStatus,
      params.deliveredAt ?? null,
      receivedAt,
      intakeConfirmedAt,
      params.receivedByStaffId ?? null,
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
      `SELECT
         id,
         created_at,
         updated_at,
         ticket_number,
         contact_info,
         product_title,
         price,
         issue,
         serial_number,
         status,
         notes,
         source_system,
         source_order_id,
         source_tracking_number,
         source_sku,
         intake_channel,
         incoming_status,
         delivered_at,
         received_at,
         intake_confirmed_at,
         received_by_staff_id
       FROM repair_service
       ${where}
       ORDER BY created_at DESC NULLS LAST, id DESC
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
           (source_order_id IS NOT NULL AND source_order_id = $1)
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
             incoming_status = CASE
               WHEN COALESCE(incoming_status, '') IN ('', 'pending_repair') THEN 'incoming'
               ELSE incoming_status
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
      status: 'Incoming Shipment',
      sourceSystem: 'ecwid',
      sourceOrderId: params.orderId ?? null,
      sourceTrackingNumber: params.trackingNumber ?? null,
      sourceSku: params.sku ?? null,
      intakeChannel: 'shipment',
      incomingStatus: 'incoming',
      deliveredAt: params.orderDate ?? null,
      receivedAt: null,
      intakeConfirmedAt: null,
    });
  } catch (error) {
    console.error('Error upserting Ecwid incoming repair:', error);
    throw new Error('Failed to upsert incoming repair');
  }
}
