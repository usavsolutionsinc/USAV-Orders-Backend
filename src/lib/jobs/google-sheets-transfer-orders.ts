import { sheets as googleSheets } from '@googleapis/sheets';
import { db } from '@/lib/drizzle/db';
import pool from '@/lib/db';
import { customers as customersTable, orders as ordersTable } from '@/lib/drizzle/schema';
import { getGoogleAuth } from '@/lib/google-auth';
import { invalidateAllOrdersApiCaches, invalidateOrderViews } from '@/lib/orders/invalidation';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { normalizeTrackingNumber } from '@/lib/shipping/normalize';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { fetchEcwidTransferRows } from '@/lib/ecwid/fetch-transfer-rows';
import { desc, eq, inArray } from 'drizzle-orm';

const SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';

type SourceRow = any[];

type OrderProjection = {
  id: number;
  orderId: string | null;
  itemNumber: string | null;
  productTitle: string | null;
  quantity: string | null;
  sku: string | null;
  condition: string | null;
  notes: string | null;
  customerId: number | null;
  shipmentId: number | null;
  createdAt?: Date | null;
};

export class GoogleSheetsTransferOrdersJobError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error || body.message || 'Google Sheets transfer failed'));
    this.status = status;
    this.body = body;
  }
}

export interface GoogleSheetsTransferOrdersJobResult {
  success: true;
  rowCount: number;
  processedRows: number;
  insertedOrders: number;
  updatedOrdersTracking: number;
  updatedOrdersFields: number;
  deletedDuplicateOrders: number;
  matchedCustomers: number;
  unmatchedCustomers: number;
  tabName: string;
  ecwidApiRows?: number;
  skippedRows?: number;
  durationMs: number;
}

function fail(status: number, error: string): never {
  throw new GoogleSheetsTransferOrdersJobError(status, { success: false, error });
}

function failJson(status: number, body: Record<string, unknown>): never {
  throw new GoogleSheetsTransferOrdersJobError(status, body);
}

const FIXED_COL_INDICES_DEFAULT = {
  shipByDate: 0,
  orderNumber: 1,
  itemNumber: 2,
  itemTitle: 3,
  quantity: 4,
  usavSku: 5,
  condition: 6,
  tracking: 7,
  note: 8,
  platform: 9,
};

/** Sheet row 1 headers mapped to ingestion fields (same candidates as findHeaderIndex uses). */
const SHEET_HEADER_BINDINGS: { field: keyof typeof FIXED_COL_INDICES_DEFAULT; candidates: string[] }[] = [
  { field: 'shipByDate', candidates: ['Ship by date'] },
  { field: 'orderNumber', candidates: ['Order Number', 'Order - Number'] },
  { field: 'itemNumber', candidates: ['Item Number'] },
  { field: 'itemTitle', candidates: ['Item title', 'Item Title'] },
  { field: 'quantity', candidates: ['Quantity'] },
  { field: 'usavSku', candidates: ['USAV SKU'] },
  { field: 'condition', candidates: ['Condition'] },
  { field: 'tracking', candidates: ['Tracking', 'Shipment - Tracking Number'] },
  { field: 'note', candidates: ['Note', 'Notes'] },
  { field: 'platform', candidates: ['Platform', 'Account Source', 'Channel'] },
];

function findHeaderIndex(headers: any[], candidates: string[]) {
  return headers.findIndex((header) => {
    const normalized = String(header || '').trim().toLowerCase();
    return candidates.some((candidate) => normalized === candidate.trim().toLowerCase());
  });
}

function normalizeTracking(str: any) {
  if (!str) return '';
  return String(str).trim();
}

function isBlank(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '';
}

function compactUpdateValues(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([_, value]) => {
      if (value === undefined) return false;
      if (typeof value === 'number' && !Number.isFinite(value)) return false;
      return true;
    })
  );
}

function getTodayDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

async function upsertOrderDeadline(orderId: number, deadlineAt: Date | null) {
  const existing = await pool.query(
    `SELECT id
     FROM work_assignments
     WHERE entity_type = 'ORDER'
       AND entity_id   = $1
       AND work_type   = 'TEST'
       AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
     ORDER BY
       CASE status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 END,
       id DESC
     LIMIT 1`,
    [orderId]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE work_assignments
       SET deadline_at = $1, updated_at = NOW()
       WHERE id = $2`,
      [deadlineAt, existing.rows[0].id]
    );
    return;
  }

  await pool.query(
    `INSERT INTO work_assignments
       (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at)
     VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2)
     ON CONFLICT DO NOTHING`,
    [orderId, deadlineAt]
  );
}

async function upsertOrderShipmentLinks(
  orderRowId: number,
  shipmentIds: number[],
  primaryShipmentId: number | null,
  source: string,
) {
  const uniqueIds = Array.from(
    new Set(
      shipmentIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  if (uniqueIds.length === 0) return;

  await pool.query(
    `UPDATE order_shipment_links
     SET is_primary = false
     WHERE order_row_id = $1`,
    [orderRowId],
  );

  await pool.query(
    `INSERT INTO order_shipment_links (order_row_id, shipment_id, is_primary, source)
     SELECT $1::int, s.shipment_id, (s.shipment_id = $2::bigint), $3::text
     FROM UNNEST($4::bigint[]) AS s(shipment_id)
     ON CONFLICT (order_row_id, shipment_id) DO UPDATE
       SET is_primary = EXCLUDED.is_primary,
           source = EXCLUDED.source,
           updated_at = NOW()`,
    [orderRowId, primaryShipmentId, source, uniqueIds],
  );
}

function pickLatestByKey<T extends { createdAt: Date | null }>(
  rows: T[],
  getKey: (row: T) => string
) {
  const result = new Map<string, T>();
  rows.forEach((row) => {
    const key = getKey(row);
    if (!key || result.has(key)) return;
    result.set(key, row);
  });
  return result;
}

export type TransferOrdersSource = 'sheets' | 'ecwid' | 'all';

export async function runGoogleSheetsTransferOrders(
  manualSheetName?: string,
  source: TransferOrdersSource = 'all',
): Promise<GoogleSheetsTransferOrdersJobResult> {
  const startedAt = Date.now();

  try {
    // ─── Source-aware data fetching ────────────────────────────────────
    // Fixed column indices used when there is no sheet header row (ecwid-only mode)
    let colIndices = { ...FIXED_COL_INDICES_DEFAULT };
    let targetTabName = source === 'ecwid' ? '(ecwid-api)' : '';
    let eligibleSourceRows: any[][] = [];
    let ecwidApiRows = 0;
    let sheetTotalRows = 0;

    // ─── Google Sheets fetch (source: 'sheets' | 'all') ──────────────
    if (source !== 'ecwid') {
      const auth = getGoogleAuth();
      const sheets = googleSheets({ version: 'v4', auth });
      const sourceSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SPREADSHEET_ID });

      if (manualSheetName && manualSheetName.trim() !== '') {
        const sourceTabs = sourceSpreadsheet.data.sheets || [];
        const manualTab = sourceTabs.find((sheet) => sheet.properties?.title === manualSheetName.trim());
        if (!manualTab) {
          fail(404, `Sheet tab "${manualSheetName}" not found in source spreadsheet`);
        }
        targetTabName = manualSheetName.trim();
      } else {
        const sourceTabs = sourceSpreadsheet.data.sheets || [];
        const dateTabs = sourceTabs
          .map((sheet) => sheet.properties?.title || '')
          .filter((title) => title.startsWith('Sheet_'))
          .map((title) => {
            const parts = title.split('_');
            if (parts.length < 4) return { title, date: new Date(0) };
            const mm = parseInt(parts[1], 10);
            const dd = parseInt(parts[2], 10);
            const yyyy = parseInt(parts[3], 10);
            return { title, date: new Date(yyyy, mm - 1, dd) };
          })
          .sort((a, b) => b.date.getTime() - a.date.getTime());

        if (dateTabs.length === 0) {
          fail(404, 'No valid sheet tabs found in source');
        }
        targetTabName = dateTabs[0].title;
      }

      const sourceDataResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SOURCE_SPREADSHEET_ID,
        range: `${targetTabName}!A1:Z`,
      });

      const sourceRows = sourceDataResponse.data.values || [];
      if (sourceRows.length < 2) {
        fail(404, 'No data found in source tab');
      }

      const headerRow = sourceRows[0];
      colIndices = { ...FIXED_COL_INDICES_DEFAULT };
      for (const { field, candidates } of SHEET_HEADER_BINDINGS) {
        colIndices[field] = findHeaderIndex(headerRow, candidates);
      }

      const missingBindings = SHEET_HEADER_BINDINGS.filter((b) => colIndices[b.field] === -1);
      if (missingBindings.length > 0) {
        const headersReceived = headerRow.map((cell) => String(cell ?? '').trim());
        const missingExplain = missingBindings
          .map(
            (b) =>
              `"${b.field}" needs a column titled one of: ${b.candidates.map((c) => `"${c}"`).join(', ')}`,
          )
          .join('; ');
        const receivedExplain = headersReceived
          .map((text, i) => {
            const label = text === '' ? '(blank)' : `"${text}"`;
            return `${i + 1}:${label}`;
          })
          .join(', ');
        failJson(400, {
          success: false,
          error: `Missing required sheet header(s): ${missingExplain}. Headers found in row 1 (${headersReceived.length} cells): ${receivedExplain}`,
          missingColumns: missingBindings.map((b) => ({
            field: b.field,
            expectedLabels: b.candidates,
          })),
          headersReceived,
        });
      }

      sheetTotalRows = sourceRows.length - 1;
      eligibleSourceRows = sourceRows.slice(1).filter((row) => {
        const orderId = String(row[colIndices.orderNumber] || '').trim();
        const platform = colIndices.platform >= 0
          ? String(row[colIndices.platform] || '').trim()
          : '';
        if (!orderId) return false;
        if (colIndices.platform >= 0 && !platform) return false;
        // Ecwid orders are now fetched directly from the Ecwid API — skip them in the sheet.
        if (platform.toLowerCase() === 'ecwid') return false;
        return true;
      });
    }

    // ─── Ecwid API fetch (source: 'ecwid' | 'all') ───────────────────
    if (source !== 'sheets') {
      try {
        const ecwidRows = await fetchEcwidTransferRows(colIndices);
        ecwidApiRows = ecwidRows.length;
        if (ecwidRows.length > 0) {
          eligibleSourceRows = [...eligibleSourceRows, ...ecwidRows];
        }
        console.log(`[transfer-orders] Fetched ${ecwidApiRows} Ecwid API rows (source=${source})`);
      } catch (err: any) {
        console.error('[transfer-orders] Ecwid API fetch failed (non-fatal):', err?.message);
      }
    }

    if (eligibleSourceRows.length === 0) {
      return {
        success: true,
        rowCount: 0,
        processedRows: 0,
        insertedOrders: 0,
        updatedOrdersTracking: 0,
        updatedOrdersFields: 0,
        deletedDuplicateOrders: 0,
        matchedCustomers: 0,
        unmatchedCustomers: 0,
        tabName: targetTabName,
        ecwidApiRows,
        skippedRows: sheetTotalRows,
        durationMs: Date.now() - startedAt,
      };
    }

    const sourceOrderIds = Array.from(
      new Set(
        eligibleSourceRows
          .map((row) => String(row[colIndices.orderNumber] || '').trim())
          .filter(Boolean)
      )
    );

    const sourceTrackings = Array.from(
      new Set(
        eligibleSourceRows
          .map((row) => normalizeTracking(row[colIndices.tracking]))
          .filter(Boolean)
      )
    );

    const sourceTrackingNormalized = Array.from(
      new Set(sourceTrackings.map((tracking) => normalizeTrackingNumber(tracking)).filter(Boolean))
    );

    const existingShipmentsResult = sourceTrackingNormalized.length > 0
      ? await pool.query(
          `SELECT id, tracking_number_raw, tracking_number_normalized
           FROM shipping_tracking_numbers
           WHERE tracking_number_normalized = ANY($1::text[])`,
          [sourceTrackingNormalized]
        )
      : { rows: [] as Array<{ id: number; tracking_number_raw: string | null; tracking_number_normalized: string }> };

    const shipmentByNormalized = new Map<string, { id: number; tracking: string }>();
    const shipmentTrackingById = new Map<number, string>();
    existingShipmentsResult.rows.forEach((row: any) => {
      const normalized = String(row.tracking_number_normalized || '').trim();
      const id = Number(row.id);
      if (!normalized || Number.isNaN(id) || shipmentByNormalized.has(normalized)) return;
      shipmentByNormalized.set(normalized, {
        id,
        tracking: String(row.tracking_number_raw || '').trim(),
      });
      shipmentTrackingById.set(id, String(row.tracking_number_raw || '').trim());
    });

    const shipmentIdCache = new Map<string, number | null>();
    shipmentByNormalized.forEach((shipment, normalized) => {
      shipmentIdCache.set(normalized, shipment.id);
    });

    const ensureShipmentId = async (tracking: string) => {
      const normalized = normalizeTrackingNumber(tracking);
      if (!normalized) return null;
      if (shipmentIdCache.has(normalized)) return shipmentIdCache.get(normalized) ?? null;
      const resolved = await resolveShipmentId(tracking);
      shipmentIdCache.set(normalized, resolved.shipmentId ?? null);
      return resolved.shipmentId ?? null;
    };

    // Resolve all tracking numbers in parallel (batches of 10 to avoid overwhelming the DB)
    for (let i = 0; i < sourceTrackings.length; i += 10) {
      await Promise.all(sourceTrackings.slice(i, i + 10).map(ensureShipmentId));
    }

    const resolvedShipmentIds = Array.from(
      new Set(
        Array.from(shipmentIdCache.values()).filter(
          (id): id is number => typeof id === 'number' && Number.isFinite(id)
        )
      )
    );

    const missingShipmentIds = resolvedShipmentIds.filter((id) => !shipmentTrackingById.has(id));
    if (missingShipmentIds.length > 0) {
      const resolvedShipmentsResult = await pool.query(
        `SELECT id, tracking_number_raw, tracking_number_normalized
         FROM shipping_tracking_numbers
         WHERE id = ANY($1::bigint[])`,
        [missingShipmentIds]
      );
      resolvedShipmentsResult.rows.forEach((row: any) => {
        const normalized = String(row.tracking_number_normalized || '').trim();
        const id = Number(row.id);
        if (!normalized || Number.isNaN(id)) return;
        shipmentByNormalized.set(normalized, {
          id,
          tracking: String(row.tracking_number_raw || '').trim(),
        });
        shipmentTrackingById.set(id, String(row.tracking_number_raw || '').trim());
      });
    }

    const sourceShipmentIds = resolvedShipmentIds;

    const sourceOrdersByOrderId = sourceOrderIds.length > 0
      ? await db
          .select({
            orderId: ordersTable.orderId,
            id: ordersTable.id,
            itemNumber: ordersTable.itemNumber,
            productTitle: ordersTable.productTitle,
            quantity: ordersTable.quantity,
            sku: ordersTable.sku,
            condition: ordersTable.condition,
            notes: ordersTable.notes,
            customerId: ordersTable.customerId,
            shipmentId: ordersTable.shipmentId,
            createdAt: ordersTable.createdAt,
          })
          .from(ordersTable)
          .where(inArray(ordersTable.orderId, sourceOrderIds))
          .orderBy(desc(ordersTable.createdAt))
      : [];

    const sourceOrdersByShipmentId = sourceShipmentIds.length > 0
      ? await db
          .select({
            orderId: ordersTable.orderId,
            id: ordersTable.id,
            itemNumber: ordersTable.itemNumber,
            productTitle: ordersTable.productTitle,
            quantity: ordersTable.quantity,
            sku: ordersTable.sku,
            condition: ordersTable.condition,
            notes: ordersTable.notes,
            customerId: ordersTable.customerId,
            shipmentId: ordersTable.shipmentId,
            createdAt: ordersTable.createdAt,
          })
          .from(ordersTable)
          .where(inArray(ordersTable.shipmentId, sourceShipmentIds))
          .orderBy(desc(ordersTable.createdAt))
      : [];

    const sourceLegacyOrdersByTracking: OrderProjection[] = [];

    const sourceCustomers = sourceOrderIds.length > 0
      ? await db
          .select({
            id: customersTable.id,
            orderId: customersTable.orderId,
            createdAt: customersTable.createdAt,
          })
          .from(customersTable)
          .where(inArray(customersTable.orderId, sourceOrderIds))
          .orderBy(desc(customersTable.createdAt))
      : [];

    const latestOrderByOrderId = new Map<string, OrderProjection>();
    sourceOrdersByOrderId.forEach((order) => {
      const key = String(order.orderId || '').trim();
      const id = Number(order.id);
      if (!key || Number.isNaN(id) || latestOrderByOrderId.has(key)) return;
      latestOrderByOrderId.set(key, {
        id,
        orderId: order.orderId,
        itemNumber: order.itemNumber,
        productTitle: order.productTitle,
        quantity: order.quantity,
        sku: order.sku,
        condition: order.condition,
        notes: order.notes,
        customerId: order.customerId,
        shipmentId: order.shipmentId ?? null,
      });
    });

    const allOrdersByOrderId = new Map<string, OrderProjection[]>();
    sourceOrdersByOrderId.forEach((order) => {
      const key = String(order.orderId || '').trim();
      if (!key) return;
      const record: OrderProjection = {
        id: order.id,
        orderId: order.orderId,
        itemNumber: order.itemNumber,
        productTitle: order.productTitle,
        quantity: order.quantity,
        sku: order.sku,
        condition: order.condition,
        notes: order.notes,
        customerId: order.customerId,
        shipmentId: order.shipmentId ?? null,
      };
      const rows = allOrdersByOrderId.get(key) ?? [];
      rows.push(record);
      allOrdersByOrderId.set(key, rows);
    });

    const latestCustomerByOrderId = pickLatestByKey(sourceCustomers, (customer) =>
      String(customer.orderId || '').trim()
    );

    const groupedSourceByOrderId = new Map<string, { row: SourceRow; trackings: Set<string> }>();
    eligibleSourceRows.forEach((row) => {
      const orderId = String(row[colIndices.orderNumber] || '').trim();
      const tracking = normalizeTracking(row[colIndices.tracking]);
      if (!orderId) return;
      const current = groupedSourceByOrderId.get(orderId) ?? { row, trackings: new Set<string>() };
      current.row = row;
      if (tracking) current.trackings.add(tracking);
      groupedSourceByOrderId.set(orderId, current);
    });

    const ordersToInsert: Array<{
      orderId: string;
      values: Record<string, unknown>;
      shipByDate: Date | null;
      shipmentIds: number[];
    }> = [];
    const ordersToBackfill: Array<{ id: number; values: Record<string, unknown> }> = [];
    const ordersToDelete: number[] = [];
    const shipmentLinksToUpsert = new Map<number, { primaryShipmentId: number | null; shipmentIds: number[] }>();
    const orderDeadlinesToUpsert: Array<{ id: number; shipByDate: Date | null }> = [];
    let updatedOrdersTracking = 0;
    let matchedCustomers = 0;
    let unmatchedCustomers = 0;

    for (const [orderId, group] of Array.from(groupedSourceByOrderId.entries())) {
      const row = group.row;
      const existingOrder = latestOrderByOrderId.get(orderId);
      const rawShipByDate = row[colIndices.shipByDate] || '';
      const parsedShipByDate = rawShipByDate ? new Date(rawShipByDate) : null;
      const sheetShipByDate = parsedShipByDate && !Number.isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;
      const effectiveShipByDate = sheetShipByDate ?? getTodayDate();
      const sheetItemNumber = String(row[colIndices.itemNumber] || '').trim();
      const sheetProductTitle = String(row[colIndices.itemTitle] || '').trim();
      const sheetQuantity = String(row[colIndices.quantity] || '').trim() || '1';
      const sheetSku = String(row[colIndices.usavSku] || '').trim();
      const sheetCondition = String(row[colIndices.condition] || '').trim();
      const sheetNotes = String(row[colIndices.note] || '').trim();
      const sheetPlatform = String(row[colIndices.platform] || '').trim();
      const matchedCustomer = orderId ? latestCustomerByOrderId.get(orderId) : undefined;
      const matchedCustomerId = matchedCustomer ? Number(matchedCustomer.id) : Number.NaN;
      const customerId = Number.isFinite(matchedCustomerId) ? matchedCustomerId : null;

      if (customerId) {
        matchedCustomers++;
      } else {
        unmatchedCustomers++;
      }

      const shipmentIds = new Set<number>();
      for (const rawTracking of Array.from(group.trackings.values())) {
        const normalized = normalizeTrackingNumber(rawTracking);
        const resolvedShipmentId = normalized
          ? shipmentIdCache.get(normalized) ?? shipmentByNormalized.get(normalized)?.id ?? null
          : null;
        const shipmentId = resolvedShipmentId ?? await ensureShipmentId(rawTracking);
        if (shipmentId && Number.isFinite(shipmentId)) shipmentIds.add(Number(shipmentId));
      }

      if (existingOrder) {
        const candidates = new Map<number, OrderProjection>();
        const byOrderId = allOrdersByOrderId.get(orderId) ?? [];
        byOrderId.forEach((order) => candidates.set(order.id, order));

        const candidateList = Array.from(candidates.values());
        if (candidateList.length === 0) {
          candidateList.push({
            id: existingOrder.id,
            orderId: existingOrder.orderId,
            itemNumber: existingOrder.itemNumber,
            productTitle: existingOrder.productTitle,
            quantity: existingOrder.quantity,
            sku: existingOrder.sku,
            condition: existingOrder.condition,
            notes: existingOrder.notes,
            customerId: existingOrder.customerId,
            shipmentId: existingOrder.shipmentId ?? null,
          });
        }

        let orderToKeep: OrderProjection;

        if (candidateList.length > 1) {
          const score = (order: OrderProjection) =>
            [order.productTitle, order.condition, order.itemNumber, order.sku, order.quantity, order.notes]
              .filter((value) => !isBlank(value)).length;
          const sorted = [...candidateList].sort((a, b) => score(b) - score(a));
          orderToKeep = sorted[0];
          sorted.slice(1).forEach((order) => {
            if (order.shipmentId != null) shipmentIds.add(Number(order.shipmentId));
            ordersToDelete.push(order.id);
          });
        } else {
          orderToKeep = candidateList[0];
        }

        const updateValues: Record<string, unknown> = {};
        if (isBlank(orderToKeep.orderId) && orderId) updateValues.orderId = orderId;
        if (isBlank(orderToKeep.itemNumber) && sheetItemNumber) updateValues.itemNumber = sheetItemNumber;
        if (isBlank(orderToKeep.productTitle) && sheetProductTitle) updateValues.productTitle = sheetProductTitle;
        if (isBlank(orderToKeep.quantity) && sheetQuantity) updateValues.quantity = sheetQuantity;
        if (isBlank(orderToKeep.sku) && sheetSku) updateValues.sku = sheetSku;
        if (isBlank(orderToKeep.condition) && sheetCondition) updateValues.condition = sheetCondition;
        if (isBlank(orderToKeep.notes) && sheetNotes) updateValues.notes = sheetNotes;
        const shipmentIdList = Array.from(shipmentIds.values());
        const primaryShipmentId =
          (orderToKeep.shipmentId != null ? Number(orderToKeep.shipmentId) : null)
          ?? shipmentIdList[0]
          ?? null;
        if (orderToKeep.shipmentId == null && primaryShipmentId != null) {
          updateValues.shipmentId = primaryShipmentId;
          updatedOrdersTracking++;
        }
        if (orderToKeep.customerId == null && customerId) updateValues.customerId = customerId;
        if (isBlank((orderToKeep as any).accountSource) && sheetPlatform) updateValues.accountSource = sheetPlatform;

        const compactedUpdateValues = compactUpdateValues(updateValues);
        if (Object.keys(compactedUpdateValues).length > 0) {
          ordersToBackfill.push({ id: orderToKeep.id, values: compactedUpdateValues });
        }
        if (shipmentIdList.length > 0) {
          shipmentLinksToUpsert.set(orderToKeep.id, {
            primaryShipmentId,
            shipmentIds: shipmentIdList,
          });
        }
        orderDeadlinesToUpsert.push({ id: orderToKeep.id, shipByDate: effectiveShipByDate });
      } else {
        const shipmentIdList = Array.from(shipmentIds.values());
        const primaryShipmentId = shipmentIdList[0] ?? null;
        ordersToInsert.push({
          orderId,
          shipByDate: effectiveShipByDate,
          shipmentIds: shipmentIdList,
          values: {
            orderId,
            itemNumber: sheetItemNumber || '',
            productTitle: sheetProductTitle || '',
            quantity: sheetQuantity || '1',
            sku: sheetSku || '',
            condition: sheetCondition || '',
            shipmentId: primaryShipmentId,
            outOfStock: '',
            notes: sheetNotes || '',
            status: 'unassigned',
            statusHistory: [],
            customerId,
            accountSource: sheetPlatform || '',
          },
        });
      }
    }

    if (ordersToDelete.length > 0) {
      await db.delete(ordersTable).where(inArray(ordersTable.id, ordersToDelete));
    }

    if (ordersToBackfill.length > 0) {
      await Promise.all(
        ordersToBackfill.map((entry) => {
          const compacted = compactUpdateValues(entry.values);
          if (Object.keys(compacted).length === 0) return Promise.resolve();
          return db.update(ordersTable).set(compacted).where(eq(ordersTable.id, entry.id));
        })
      );
    }

    let insertedOrderIds: number[] = [];
    if (ordersToInsert.length > 0) {
      const insertedOrders = await db
        .insert(ordersTable)
        .values(ordersToInsert.map((entry) => entry.values))
        .returning({ id: ordersTable.id });

      insertedOrderIds = insertedOrders.map((o) => o.id);
      insertedOrders.forEach((order, index) => {
        const shipByDate = ordersToInsert[index]?.shipByDate ?? null;
        if (shipByDate) {
          orderDeadlinesToUpsert.push({ id: order.id, shipByDate });
        }
        const shipmentIds = ordersToInsert[index]?.shipmentIds ?? [];
        const primaryShipmentId = Number((ordersToInsert[index]?.values as any)?.shipmentId ?? 0) || null;
        if (shipmentIds.length > 0) {
          shipmentLinksToUpsert.set(order.id, { primaryShipmentId, shipmentIds });
        }
      });
    }

    if (shipmentLinksToUpsert.size > 0) {
      await Promise.all(
        Array.from(shipmentLinksToUpsert.entries()).map(([orderRowId, linkEntry]) =>
          upsertOrderShipmentLinks(
            orderRowId,
            linkEntry.shipmentIds,
            linkEntry.primaryShipmentId,
            'google-sheets-transfer-orders',
          )
        )
      );
    }

    if (orderDeadlinesToUpsert.length > 0) {
      await Promise.all(
        orderDeadlinesToUpsert.map((entry) => upsertOrderDeadline(entry.id, entry.shipByDate))
      );
    }

    // Always bust the cached order views and notify clients via Ably so the
    // dashboard refreshes on every successful cron delivery — even when no
    // new orders were inserted or fields updated.
    const affectedOrderIds = [
      ...insertedOrderIds,
      ...ordersToBackfill.map((e) => e.id),
      ...ordersToDelete,
    ];

    // Collect all processed order DB IDs (including unchanged ones) so we can
    // always broadcast a meaningful notification to clients.
    const allProcessedOrderIds = [
      ...affectedOrderIds,
      ...Array.from(latestOrderByOrderId.values()).map((o) => o.id),
    ];
    const uniqueProcessedIds = Array.from(
      new Set(allProcessedOrderIds.filter((id) => Number.isFinite(id) && id > 0))
    );

    await invalidateAllOrdersApiCaches();
    if (uniqueProcessedIds.length > 0) {
      await publishOrderChanged({
        orderIds: uniqueProcessedIds,
        source: 'google-sheets-transfer-orders',
      });
    }

    return {
      success: true,
      rowCount: ordersToInsert.length,
      processedRows: groupedSourceByOrderId.size,
      insertedOrders: ordersToInsert.length,
      updatedOrdersTracking,
      updatedOrdersFields: ordersToBackfill.length,
      deletedDuplicateOrders: ordersToDelete.length,
      matchedCustomers,
      unmatchedCustomers,
      tabName: targetTabName,
      ecwidApiRows,
      durationMs: Date.now() - startedAt,
    };
  } catch (error: any) {
    if (error instanceof GoogleSheetsTransferOrdersJobError) {
      throw error;
    }

    console.error('[google-sheets-transfer-orders]', error);
    throw new GoogleSheetsTransferOrdersJobError(500, {
      success: false,
      error: error?.message || 'Internal Server Error',
    });
  }
}
