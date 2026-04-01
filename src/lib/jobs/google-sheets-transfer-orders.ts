import { sheets as googleSheets } from '@googleapis/sheets';
import { db } from '@/lib/drizzle/db';
import pool from '@/lib/db';
import { customers as customersTable, orders as ordersTable } from '@/lib/drizzle/schema';
import { getGoogleAuth } from '@/lib/google-auth';
import { normalizeTrackingNumber } from '@/lib/shipping/normalize';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';
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
  skippedRows?: number;
  durationMs: number;
}

function fail(status: number, error: string): never {
  throw new GoogleSheetsTransferOrdersJobError(status, { success: false, error });
}

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

export async function runGoogleSheetsTransferOrders(
  manualSheetName?: string
): Promise<GoogleSheetsTransferOrdersJobResult> {
  const startedAt = Date.now();

  try {
    const auth = getGoogleAuth();
    const sheets = googleSheets({ version: 'v4', auth });

    const sourceSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SPREADSHEET_ID });

    let targetTabName: string;

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
    const colIndices = {
      shipByDate: findHeaderIndex(headerRow, ['Ship by date']),
      orderNumber: findHeaderIndex(headerRow, ['Order Number', 'Order - Number']),
      itemNumber: findHeaderIndex(headerRow, ['Item Number']),
      itemTitle: findHeaderIndex(headerRow, ['Item title', 'Item Title']),
      quantity: findHeaderIndex(headerRow, ['Quantity']),
      usavSku: findHeaderIndex(headerRow, ['USAV SKU']),
      condition: findHeaderIndex(headerRow, ['Condition']),
      tracking: findHeaderIndex(headerRow, ['Tracking', 'Shipment - Tracking Number']),
      note: findHeaderIndex(headerRow, ['Note', 'Notes']),
      platform: findHeaderIndex(headerRow, ['Platform', 'Account Source', 'Channel']),
    };

    const missingCols = Object.entries(colIndices)
      .filter(([_, index]) => index === -1)
      .map(([name]) => name);

    if (missingCols.length > 0) {
      fail(400, `Missing columns in source: ${missingCols.join(', ')}`);
    }

    const eligibleSourceRows = sourceRows.slice(1).filter((row) => {
      const orderId = String(row[colIndices.orderNumber] || '').trim();
      const platform = colIndices.platform >= 0
        ? String(row[colIndices.platform] || '').trim()
        : '';
      if (!orderId) return false;
      if (colIndices.platform >= 0 && !platform) return false;
      // Accept all marketplace platforms present in the transfer sheet
      // (Amazon, eBay, Ecwid, etc.) so legacy sheet-driven uploads continue to work.
      return true;
    });

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
        skippedRows: sourceRows.length - 1,
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

    for (const tracking of sourceTrackings) {
      await ensureShipmentId(tracking);
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
          },
        });
      }
    }

    if (ordersToDelete.length > 0) {
      for (const id of ordersToDelete) {
        await db.delete(ordersTable).where(eq(ordersTable.id, id));
      }
    }

    if (ordersToBackfill.length > 0) {
      for (const entry of ordersToBackfill) {
        const compactedUpdateValues = compactUpdateValues(entry.values);
        if (Object.keys(compactedUpdateValues).length === 0) continue;
        await db
          .update(ordersTable)
          .set(compactedUpdateValues)
          .where(eq(ordersTable.id, entry.id));
      }
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
      for (const [orderRowId, linkEntry] of Array.from(shipmentLinksToUpsert.entries())) {
        await upsertOrderShipmentLinks(
          orderRowId,
          linkEntry.shipmentIds,
          linkEntry.primaryShipmentId,
          'google-sheets-transfer-orders',
        );
      }
    }

    if (orderDeadlinesToUpsert.length > 0) {
      for (const entry of orderDeadlinesToUpsert) {
        await upsertOrderDeadline(entry.id, entry.shipByDate);
      }
    }

    // Bust the /api/orders Upstash cache and notify all connected clients
    // so the pending-orders dashboard picks up changes immediately.
    const affectedOrderIds = [
      ...insertedOrderIds,
      ...ordersToBackfill.map((e) => e.id),
      ...ordersToDelete,
    ];
    if (affectedOrderIds.length > 0) {
      await invalidateCacheTags(['orders']);
      await publishOrderChanged({
        orderIds: affectedOrderIds,
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
