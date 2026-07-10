import { sheets as googleSheets } from '@googleapis/sheets';
import { db } from '@/lib/drizzle/db';
import pool from '@/lib/db';
import { customers as customersTable, orders as ordersTable } from '@/lib/drizzle/schema';
import { transitionalUsavOrgId, tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { withTenantDrizzle } from '@/lib/drizzle/tenant-db';
import { getIntegrationCredentials, type EcwidCredentials, type GoogleSheetsCredentials } from '@/lib/integrations/credentials';
import { getGoogleAuth } from '@/lib/google-auth';
import { invalidateAllOrdersApiCaches } from '@/lib/orders/invalidation';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { normalizeTrackingNumber } from '@/lib/shipping/normalize';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { linkShipment } from '@/lib/shipping/shipment-links';
import { fetchEcwidTransferRows } from '@/lib/ecwid/fetch-transfer-rows';
import { isPlanFeatureExemptOrg } from '@/lib/billing/plan-feature-gate';
import {
  batchPlatformItemIdsByCatalogIds,
  batchResolveSkuCatalogByTitles,
  type SkuCatalogTitleMatch,
} from '@/lib/neon/sku-catalog-queries';
import { and, desc, eq, inArray } from 'drizzle-orm';

/**
 * USAV's hardcoded source sheet — the transitional default used when no per-org
 * spreadsheet id is supplied. USAV connects Google via env service-account creds
 * (GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY) and has no organization_integrations
 * `google_sheets` row to read an id from, so this stays its source. Exported so
 * the cron fan-out can use it as USAV's includeUsavTransitional source while
 * every OTHER org supplies its OWN id from its google_sheets integration config.
 * A non-USAV caller MUST pass an explicit id — never default another tenant onto
 * USAV's sheet.
 */
export const USAV_SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';

/**
 * The transfer source sheet for `orgId`, or null to skip the org.
 *
 * USAV keeps its hardcoded sheet: it connects Google via env service-account
 * creds and has no organization_integrations.google_sheets row, so there is no
 * per-org id to read — preserving the exact prior behavior. Every OTHER org must
 * supply its OWN id via its google_sheets integration config
 * (GoogleSheetsCredentials.defaultSpreadsheetId); an org with the provider
 * connected but NO configured sheet id returns null and is skipped — we never
 * default a tenant onto USAV's sheet. Lives here (beside the constant + the env
 * fallback's defaultSpreadsheetId) so the sheet-source rule has one home.
 */
export async function resolveTransferSourceSpreadsheetId(orgId: OrgId): Promise<string | null> {
  if (orgId === transitionalUsavOrgId()) return USAV_SOURCE_SPREADSHEET_ID;
  const creds = await getIntegrationCredentials<GoogleSheetsCredentials>(orgId, 'google_sheets');
  const id = creds?.defaultSpreadsheetId?.trim();
  return id || null;
}

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
  accountSource: string | null;
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

import type { SyncProgress, TransferOrderDetail, TransferOrderDetails } from '@/lib/orders-sync/types';

export type { TransferOrderDetail, TransferOrderDetails } from '@/lib/orders-sync/types';

/** No-op progress callback used when streaming isn't needed. */
const noopProgress: SyncProgress = () => {};

export interface GoogleSheetsTransferOrdersJobResult {
  success: true;
  rowCount: number;
  processedRows: number;
  insertedOrders: number;
  updatedOrdersTracking: number;
  updatedOrdersFields: number;
  /** Rows whose sheet tracking value failed carrier detection (not linked). */
  unresolvedTrackingCount: number;
  deletedDuplicateOrders: number;
  matchedCustomers: number;
  unmatchedCustomers: number;
  tabName: string;
  ecwidApiRows?: number;
  skippedRows?: number;
  durationMs: number;
  details: TransferOrderDetails;
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
  salePrice: -1,
  currency: -1,
};

/** Sheet row 1 headers that MUST be present (minimal small-business import). */
const REQUIRED_SHEET_HEADER_BINDINGS: { field: keyof typeof FIXED_COL_INDICES_DEFAULT; candidates: string[] }[] = [
  { field: 'orderNumber', candidates: ['Order Number', 'Order - Number', 'Order #', 'Order ID'] },
  { field: 'itemTitle', candidates: ['Item title', 'Item Title', 'Product Title', 'Product', 'Title', 'Description'] },
];

/** Optional columns — missing headers leave index at -1 (absent), not a sync failure. */
const OPTIONAL_SHEET_COLUMN_BINDINGS: { field: keyof typeof FIXED_COL_INDICES_DEFAULT; candidates: string[] }[] = [
  { field: 'shipByDate', candidates: ['Ship by date', 'Ship Date', 'Due Date'] },
  { field: 'itemNumber', candidates: ['Item Number', 'Item ID', 'Listing ID'] },
  { field: 'quantity', candidates: ['Quantity', 'Qty'] },
  { field: 'usavSku', candidates: ['USAV SKU', 'SKU', 'Internal SKU'] },
  { field: 'condition', candidates: ['Condition'] },
  { field: 'tracking', candidates: ['Tracking', 'Shipment - Tracking Number'] },
  { field: 'note', candidates: ['Note', 'Notes'] },
  { field: 'platform', candidates: ['Platform', 'Account Source', 'Channel'] },
];

/** Sale price + currency — optional, never required for sync. */
const OPTIONAL_SALE_HEADER_BINDINGS: { field: keyof typeof FIXED_COL_INDICES_DEFAULT; candidates: string[] }[] = [
  { field: 'salePrice', candidates: ['Sale Price', 'Price', 'Amount', 'Order Total', 'Item Total', 'Sale Amount'] },
  { field: 'currency', candidates: ['Currency', 'Currency Code'] },
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

async function upsertOrderDeadline(orderId: number, deadlineAt: Date | null, orgId?: OrgId) {
  // Tenant path: GUC-wrap + scope reads/writes to the supplied org so the
  // upsert can't touch a different tenant's work_assignments row.
  if (orgId) {
    await withTenantTransaction(orgId, async (client) => {
      const existing = await client.query(
        `SELECT id
         FROM work_assignments
         WHERE entity_type = 'ORDER'
           AND entity_id   = $1
           AND work_type   = 'TEST'
           AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
           AND organization_id = $2
         ORDER BY
           CASE status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 END,
           id DESC
         LIMIT 1`,
        [orderId, orgId]
      );

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE work_assignments
           SET deadline_at = $1, updated_at = NOW()
           WHERE id = $2
             AND organization_id = $3`,
          [deadlineAt, existing.rows[0].id, orgId]
        );
        return;
      }

      await client.query(
        `INSERT INTO work_assignments
           (organization_id, entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at)
         VALUES ($1, 'ORDER', $2, 'TEST', NULL, 'OPEN', 100, $3)
         ON CONFLICT DO NOTHING`,
        [orgId, orderId, deadlineAt]
      );
    });
    return;
  }

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
       (organization_id, entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at)
     VALUES ($1, 'ORDER', $2, 'TEST', NULL, 'OPEN', 100, $3)
     ON CONFLICT DO NOTHING`,
    [transitionalUsavOrgId(), orderId, deadlineAt]
  );
}

async function upsertOrderShipmentLinks(
  orderRowId: number,
  shipmentIds: number[],
  primaryShipmentId: number | null,
  source: string,
  orgId?: OrgId,
) {
  const uniqueIds = Array.from(
    new Set(
      shipmentIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  if (uniqueIds.length === 0) return;

  // Link every shipment to the order row via the unified shipment_links table
  // (the sole linkage SoT). The is_primary one matches primaryShipmentId; the
  // helper demotes the order's other primaries so exactly one stays primary.
  const effectiveOrg = orgId ?? transitionalUsavOrgId();
  await withTenantTransaction(effectiveOrg, async (client) => {
    for (const sid of uniqueIds) {
      const isPrimary = primaryShipmentId != null && sid === primaryShipmentId;
      await linkShipment(
        effectiveOrg,
        {
          ownerType: 'ORDER', ownerId: orderRowId, shipmentId: sid,
          direction: 'OUTBOUND', isPrimary,
          role: isPrimary ? 'ORDER_PRIMARY' : 'ORDER_SPLIT', source,
        },
        client,
      );
    }
  });
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
  progress: SyncProgress = noopProgress,
  orgId?: OrgId,
  // Which Google Sheet to read. Defaults to USAV's hardcoded sheet so existing
  // (USAV-context) callers are byte-identical. The per-org cron fan-out passes
  // each org's OWN sheet id (from its google_sheets integration config) so a
  // tenant is never read from another tenant's sheet.
  sourceSpreadsheetId: string = USAV_SOURCE_SPREADSHEET_ID,
): Promise<GoogleSheetsTransferOrdersJobResult> {
  const startedAt = Date.now();

  // When orgId is omitted we keep EXACTLY today's behavior (raw pool + neon-http
  // Drizzle `db` + transitionalUsavOrgId() stamping). When orgId is supplied we
  // route every tenant-table read/write through the GUC-carrying helpers
  // (tenantQuery / withTenantDrizzle) and scope/stamp by org. The `effectiveOrgId`
  // is what gets stamped on writes either way.
  const effectiveOrgId: OrgId = orgId ?? transitionalUsavOrgId();

  progress({ type: 'phase', phase: 'starting' });

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
      progress({ type: 'phase', phase: 'fetching_sheet' });
      const auth = getGoogleAuth();
      const sheets = googleSheets({ version: 'v4', auth });
      const sourceSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sourceSpreadsheetId });

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
        spreadsheetId: sourceSpreadsheetId,
        range: `${targetTabName}!A1:Z`,
      });

      const sourceRows = sourceDataResponse.data.values || [];
      if (sourceRows.length < 2) {
        fail(404, 'No data found in source tab');
      }

      const headerRow = sourceRows[0];
      colIndices = { ...FIXED_COL_INDICES_DEFAULT };
      for (const { field, candidates } of [
        ...REQUIRED_SHEET_HEADER_BINDINGS,
        ...OPTIONAL_SHEET_COLUMN_BINDINGS,
        ...OPTIONAL_SALE_HEADER_BINDINGS,
      ]) {
        colIndices[field] = findHeaderIndex(headerRow, candidates);
      }

      const missingBindings = REQUIRED_SHEET_HEADER_BINDINGS.filter((b) => colIndices[b.field] === -1);
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
        if (!orderId) return false;
        // Ecwid orders are now fetched directly from the Ecwid API — skip them in the sheet.
        const platform = colIndices.platform >= 0
          ? String(row[colIndices.platform] || '').trim()
          : '';
        if (platform.toLowerCase() === 'ecwid') return false;
        return true;
      });
    }

    // ─── Ecwid API fetch (source: 'ecwid' | 'all') ───────────────────
    if (source !== 'sheets') {
      progress({ type: 'phase', phase: 'fetching_ecwid' });
      try {
        // Vault-first credential read (connector layer): the org's Ecwid vault
        // row wins. The legacy ECWID_* env fallback is DOGFOOD-ONLY (the env
        // creds are the dogfood store's) — any other org without a vault row
        // fails closed here and the catch below degrades the Ecwid phase.
        const ecwidVault = await getIntegrationCredentials<EcwidCredentials>(effectiveOrgId, 'ecwid');
        const ecwidRows = await fetchEcwidTransferRows(
          colIndices,
          ecwidVault?.storeId && ecwidVault?.apiToken
            ? { storeId: ecwidVault.storeId, token: ecwidVault.apiToken }
            : undefined,
          { allowEnvFallback: isPlanFeatureExemptOrg(effectiveOrgId) },
        );
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
      progress({ type: 'phase', phase: 'done' });
      return {
        success: true,
        rowCount: 0,
        processedRows: 0,
        insertedOrders: 0,
        updatedOrdersTracking: 0,
        updatedOrdersFields: 0,
        unresolvedTrackingCount: 0,
        deletedDuplicateOrders: 0,
        matchedCustomers: 0,
        unmatchedCustomers: 0,
        tabName: targetTabName,
        ecwidApiRows,
        skippedRows: sheetTotalRows,
        durationMs: Date.now() - startedAt,
        details: { inserted: [], updated: [], deleted: [], unknownTitle: [], unresolvedTracking: [] },
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

    // shipping_tracking_numbers has NO organization_id column (NEEDS-COL) and
    // these standalone lookups have no org-bearing parent to JOIN, so when an
    // orgId is supplied we GUC-wrap only (tenantQuery) and leave the predicate
    // unchanged; until the column lands this is the strongest scoping available.
    const existingShipmentsResult = sourceTrackingNormalized.length > 0
      ? (orgId
          ? await tenantQuery(
              orgId,
              `SELECT id, tracking_number_raw, tracking_number_normalized
               FROM shipping_tracking_numbers
               WHERE tracking_number_normalized = ANY($1::text[])`,
              [sourceTrackingNormalized]
            )
          : await pool.query(
              `SELECT id, tracking_number_raw, tracking_number_normalized
               FROM shipping_tracking_numbers
               WHERE tracking_number_normalized = ANY($1::text[])`,
              [sourceTrackingNormalized]
            ))
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
    progress({ type: 'phase', phase: 'resolving_tracking', count: sourceTrackings.length });
    for (let i = 0; i < sourceTrackings.length; i += 10) {
      await Promise.all(sourceTrackings.slice(i, i + 10).map(ensureShipmentId));
    }
    progress({ type: 'phase', phase: 'matching_orders' });

    const resolvedShipmentIds = Array.from(
      new Set(
        Array.from(shipmentIdCache.values()).filter(
          (id): id is number => typeof id === 'number' && Number.isFinite(id)
        )
      )
    );

    const missingShipmentIds = resolvedShipmentIds.filter((id) => !shipmentTrackingById.has(id));
    if (missingShipmentIds.length > 0) {
      // shipping_tracking_numbers: NEEDS-COL, no org-bearing parent here → GUC-wrap only.
      const resolvedShipmentsResult = orgId
        ? await tenantQuery(
            orgId,
            `SELECT id, tracking_number_raw, tracking_number_normalized
             FROM shipping_tracking_numbers
             WHERE id = ANY($1::bigint[])`,
            [missingShipmentIds]
          )
        : await pool.query(
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

    const orderProjectionCols = {
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
      accountSource: ordersTable.accountSource,
      createdAt: ordersTable.createdAt,
    } as const;

    const sourceOrdersByOrderId = sourceOrderIds.length === 0
      ? []
      : orgId
        ? await withTenantDrizzle(orgId, (tx) =>
            tx
              .select(orderProjectionCols)
              .from(ordersTable)
              .where(and(
                inArray(ordersTable.orderId, sourceOrderIds),
                eq(ordersTable.organizationId, orgId),
              ))
              .orderBy(desc(ordersTable.createdAt))
          )
        : await db
            .select(orderProjectionCols)
            .from(ordersTable)
            .where(inArray(ordersTable.orderId, sourceOrderIds))
            .orderBy(desc(ordersTable.createdAt));

    const sourceOrdersByShipmentId = sourceShipmentIds.length === 0
      ? []
      : orgId
        ? await withTenantDrizzle(orgId, (tx) =>
            tx
              .select(orderProjectionCols)
              .from(ordersTable)
              .where(and(
                inArray(ordersTable.shipmentId, sourceShipmentIds),
                eq(ordersTable.organizationId, orgId),
              ))
              .orderBy(desc(ordersTable.createdAt))
          )
        : await db
            .select(orderProjectionCols)
            .from(ordersTable)
            .where(inArray(ordersTable.shipmentId, sourceShipmentIds))
            .orderBy(desc(ordersTable.createdAt));

    const sourceLegacyOrdersByTracking: OrderProjection[] = [];

    const customerProjectionCols = {
      id: customersTable.id,
      orderId: customersTable.orderId,
      createdAt: customersTable.createdAt,
    } as const;

    const sourceCustomers = sourceOrderIds.length === 0
      ? []
      : orgId
        ? await withTenantDrizzle(orgId, (tx) =>
            tx
              .select(customerProjectionCols)
              .from(customersTable)
              .where(and(
                inArray(customersTable.orderId, sourceOrderIds),
                eq(customersTable.organizationId, orgId),
              ))
              .orderBy(desc(customersTable.createdAt))
          )
        : await db
            .select(customerProjectionCols)
            .from(customersTable)
            .where(inArray(customersTable.orderId, sourceOrderIds))
            .orderBy(desc(customersTable.createdAt));

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
        accountSource: (order as any).accountSource ?? null,
        createdAt: (order as any).createdAt ?? null,
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
        accountSource: (order as any).accountSource ?? null,
        createdAt: (order as any).createdAt ?? null,
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

    // Hydrate product identity from sku_catalog:
    //   • blank titles → fill from SKU / platform item# crosswalk (USAV full sheet)
    //   • title-only rows → match catalog by product_title (small-business minimal sheet)
    const titleBySku = new Map<string, string>();
    const catalogByLookupKey = new Map<string, SkuCatalogTitleMatch>();
    const catalogByTitle = new Map<string, SkuCatalogTitleMatch>();
    {
      const lookupSkus = new Set<string>();
      const lookupItemNumbers = new Set<string>();
      const titlesNeedingCatalog = new Set<string>();
      eligibleSourceRows.forEach((row) => {
        const itemTitle = String(row[colIndices.itemTitle] || '').trim();
        const sku = colIndices.usavSku >= 0 ? String(row[colIndices.usavSku] || '').trim() : '';
        const itemNumber = colIndices.itemNumber >= 0 ? String(row[colIndices.itemNumber] || '').trim() : '';
        if (sku) lookupSkus.add(sku);
        if (itemNumber) lookupItemNumbers.add(itemNumber);
        if (itemTitle && !sku && !itemNumber) titlesNeedingCatalog.add(itemTitle);
      });

      if (lookupSkus.size > 0) {
        const result = orgId
          ? await tenantQuery(
              orgId,
              `SELECT id, sku, product_title
                 FROM sku_catalog
                WHERE sku = ANY($1::text[]) AND product_title IS NOT NULL AND product_title <> ''
                  AND organization_id = $2`,
              [Array.from(lookupSkus), orgId],
            )
          : await pool.query(
              `SELECT id, sku, product_title
                 FROM sku_catalog
                WHERE sku = ANY($1::text[]) AND product_title IS NOT NULL AND product_title <> ''`,
              [Array.from(lookupSkus)],
            );
        for (const row of result.rows) {
          const sku = String(row.sku || '').trim();
          const title = String(row.product_title || '').trim();
          const id = Number(row.id);
          if (!sku || !title || !Number.isFinite(id)) continue;
          titleBySku.set(sku, title);
          catalogByLookupKey.set(sku, { id, sku, productTitle: title });
        }
      }

      if (lookupItemNumbers.size > 0) {
        const result = orgId
          ? await tenantQuery(
              orgId,
              `SELECT spi.platform_sku, spi.platform_item_id, sc.id, sc.product_title, sc.sku
                 FROM sku_platform_ids spi
                 JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
                  AND sc.organization_id = spi.organization_id
                WHERE (spi.platform_sku = ANY($1::text[]) OR spi.platform_item_id = ANY($1::text[]))
                  AND sc.product_title IS NOT NULL AND sc.product_title <> ''
                  AND spi.organization_id = $2`,
              [Array.from(lookupItemNumbers), orgId],
            )
          : await pool.query(
              `SELECT spi.platform_sku, spi.platform_item_id, sc.id, sc.product_title, sc.sku
                 FROM sku_platform_ids spi
                 JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
                WHERE (spi.platform_sku = ANY($1::text[]) OR spi.platform_item_id = ANY($1::text[]))
                  AND sc.product_title IS NOT NULL AND sc.product_title <> ''`,
              [Array.from(lookupItemNumbers)],
            );
        for (const row of result.rows) {
          const title = String(row.product_title || '').trim();
          const id = Number(row.id);
          const sku = String(row.sku || '').trim();
          if (!title || !Number.isFinite(id) || !sku) continue;
          const platformSku = String(row.platform_sku || '').trim();
          const platformItemId = String(row.platform_item_id || '').trim();
          const match: SkuCatalogTitleMatch = { id, sku, productTitle: title };
          if (platformSku) {
            if (!titleBySku.has(platformSku)) titleBySku.set(platformSku, title);
            if (!catalogByLookupKey.has(platformSku)) catalogByLookupKey.set(platformSku, match);
          }
          if (platformItemId) {
            if (!titleBySku.has(platformItemId)) titleBySku.set(platformItemId, title);
            if (!catalogByLookupKey.has(platformItemId)) catalogByLookupKey.set(platformItemId, match);
          }
        }
      }

      if (titlesNeedingCatalog.size > 0) {
        const byTitle = await batchResolveSkuCatalogByTitles(Array.from(titlesNeedingCatalog), orgId);
        byTitle.forEach((match, title) => catalogByTitle.set(title, match));
      }
    }

    const platformItemIdByCatalogId = await batchPlatformItemIdsByCatalogIds(
      Array.from(new Set([
        ...Array.from(catalogByLookupKey.values()).map((m) => m.id),
        ...Array.from(catalogByTitle.values()).map((m) => m.id),
      ])),
      orgId,
    );

    const resolveProductTitle = (
      sheetTitle: string,
      sku: string,
      itemNumber: string,
    ): { title: string; source: TransferOrderDetail['titleSource'] } => {
      const cleaned = sheetTitle.trim();
      if (cleaned) return { title: cleaned, source: 'sheet' };
      const bySku = sku && titleBySku.get(sku);
      if (bySku) return { title: bySku, source: 'sku_catalog' };
      const byItem = itemNumber && titleBySku.get(itemNumber);
      if (byItem) return { title: byItem, source: 'platform_lookup' };
      return { title: '', source: 'none' };
    };

    const resolveCatalogLink = (
      sheetTitle: string,
      sku: string,
      itemNumber: string,
    ): {
      sku: string;
      itemNumber: string;
      skuCatalogId: number | null;
      titleSource: TransferOrderDetail['titleSource'];
      productTitle: string;
    } => {
      let resolvedSku = sku.trim();
      let resolvedItemNumber = itemNumber.trim();
      let skuCatalogId: number | null = null;
      let titleSource: TransferOrderDetail['titleSource'] = 'sheet';
      let productTitle = sheetTitle.trim();

      const fromKey = (key: string) => catalogByLookupKey.get(key) ?? null;
      const bySku = resolvedSku ? fromKey(resolvedSku) : null;
      const byItem = !bySku && resolvedItemNumber ? fromKey(resolvedItemNumber) : null;
      const byTitle = !bySku && !byItem && productTitle ? catalogByTitle.get(productTitle) ?? null : null;
      const match = bySku ?? byItem ?? byTitle;

      if (match) {
        resolvedSku = resolvedSku || match.sku;
        skuCatalogId = match.id;
        if (!productTitle) {
          productTitle = match.productTitle;
          titleSource = byTitle ? 'title_catalog_match' : (byItem ? 'platform_lookup' : 'sku_catalog');
        } else if (byTitle) {
          titleSource = 'title_catalog_match';
        }
      } else {
        const titleResolved = resolveProductTitle(sheetTitle, resolvedSku, resolvedItemNumber);
        productTitle = titleResolved.title;
        titleSource = titleResolved.source;
      }

      if (!resolvedItemNumber && skuCatalogId) {
        resolvedItemNumber = platformItemIdByCatalogId.get(skuCatalogId) ?? '';
      }

      return {
        sku: resolvedSku,
        itemNumber: resolvedItemNumber,
        skuCatalogId,
        titleSource,
        productTitle,
      };
    };

    const ordersToInsert: Array<{
      orderId: string;
      values: Record<string, unknown>;
      shipByDate: Date | null;
      shipmentIds: number[];
      detail: TransferOrderDetail;
    }> = [];
    const ordersToBackfill: Array<{
      id: number;
      values: Record<string, unknown>;
      detail: TransferOrderDetail;
    }> = [];
    const ordersToDelete: Array<{ id: number; detail: TransferOrderDetail }> = [];
    const shipmentLinksToUpsert = new Map<number, { primaryShipmentId: number | null; shipmentIds: number[] }>();
    const orderDeadlinesToUpsert: Array<{ id: number; shipByDate: Date | null }> = [];
    let updatedOrdersTracking = 0;
    let matchedCustomers = 0;
    let unmatchedCustomers = 0;
    const detailsUnknownTitle: TransferOrderDetail[] = [];
    const detailsUnresolvedTracking: TransferOrderDetail[] = [];

    for (const [orderId, group] of Array.from(groupedSourceByOrderId.entries())) {
      const row = group.row;
      const existingOrder = latestOrderByOrderId.get(orderId);
      const rawShipByDate = colIndices.shipByDate >= 0 ? (row[colIndices.shipByDate] || '') : '';
      const parsedShipByDate = rawShipByDate ? new Date(rawShipByDate) : null;
      const sheetShipByDate = parsedShipByDate && !Number.isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;
      const effectiveShipByDate = sheetShipByDate ?? getTodayDate();
      const rawSheetTitle = String(row[colIndices.itemTitle] || '').trim();
      const rawSheetSku = colIndices.usavSku >= 0 ? String(row[colIndices.usavSku] || '').trim() : '';
      const rawSheetItemNumber = colIndices.itemNumber >= 0 ? String(row[colIndices.itemNumber] || '').trim() : '';
      const catalogLink = resolveCatalogLink(rawSheetTitle, rawSheetSku, rawSheetItemNumber);
      const sheetProductTitle = catalogLink.productTitle;
      const sheetSku = catalogLink.sku;
      const sheetItemNumber = catalogLink.itemNumber;
      const sheetSkuCatalogId = catalogLink.skuCatalogId;
      const titleSource = catalogLink.titleSource;
      const sheetQuantity = colIndices.quantity >= 0
        ? (String(row[colIndices.quantity] || '').trim() || '1')
        : '1';
      const sheetCondition = colIndices.condition >= 0 ? String(row[colIndices.condition] || '').trim() : '';
      const sheetNotes = colIndices.note >= 0 ? String(row[colIndices.note] || '').trim() : '';
      const sheetPlatform = colIndices.platform >= 0 ? String(row[colIndices.platform] || '').trim() : '';
      // Optional sale price + currency (columns may be absent → index -1).
      const rawSalePrice =
        colIndices.salePrice >= 0 ? String(row[colIndices.salePrice] || '').trim() : '';
      // Strip currency symbols / thousands separators before parsing.
      const parsedSalePrice = rawSalePrice
        ? Number(rawSalePrice.replace(/[^0-9.-]/g, ''))
        : NaN;
      const sheetSaleAmount =
        Number.isFinite(parsedSalePrice) ? String(parsedSalePrice) : null;
      const sheetCurrency =
        (colIndices.currency >= 0 ? String(row[colIndices.currency] || '').trim() : '') || 'USD';
      const primaryTracking = Array.from(group.trackings.values())[0] || '';
      const existing = latestOrderByOrderId.get(orderId);
      const detailRow: TransferOrderDetail = {
        orderId,
        productTitle: sheetProductTitle,
        sku: sheetSku,
        itemNumber: sheetItemNumber,
        tracking: primaryTracking,
        titleSource,
        existingAccountSource: existing?.accountSource ?? null,
        existingCreatedAt: existing?.createdAt instanceof Date
          ? existing.createdAt.toISOString()
          : (typeof existing?.createdAt === 'string' ? existing.createdAt : null),
      };
      if (titleSource === 'none') detailsUnknownTitle.push(detailRow);
      const matchedCustomer = orderId ? latestCustomerByOrderId.get(orderId) : undefined;
      const matchedCustomerId = matchedCustomer ? Number(matchedCustomer.id) : Number.NaN;
      const customerId = Number.isFinite(matchedCustomerId) ? matchedCustomerId : null;

      if (customerId) {
        matchedCustomers++;
      } else {
        unmatchedCustomers++;
      }

      const shipmentIds = new Set<number>();
      const unresolvedTrackings: string[] = [];
      for (const rawTracking of Array.from(group.trackings.values())) {
        const cleanRaw = normalizeTracking(rawTracking);
        if (!cleanRaw) continue;
        const normalized = normalizeTrackingNumber(rawTracking);
        const resolvedShipmentId = normalized
          ? shipmentIdCache.get(normalized) ?? shipmentByNormalized.get(normalized)?.id ?? null
          : null;
        const shipmentId = resolvedShipmentId ?? await ensureShipmentId(rawTracking);
        if (shipmentId && Number.isFinite(shipmentId)) shipmentIds.add(Number(shipmentId));
        else unresolvedTrackings.push(cleanRaw);
      }
      // A non-blank tracking that resolved to no shipment failed carrier
      // detection (e.g. a double-scanned / malformed value). Surface it as a
      // warning so it doesn't vanish silently behind an "Up to date" summary.
      if (unresolvedTrackings.length > 0) {
        const unresolvedDetail: TransferOrderDetail = {
          ...detailRow,
          tracking: unresolvedTrackings.join(', '),
        };
        detailsUnresolvedTracking.push(unresolvedDetail);
        progress({ type: 'detail', kind: 'unresolvedTracking', row: unresolvedDetail });
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
            accountSource: existingOrder.accountSource ?? null,
            createdAt: existingOrder.createdAt ?? null,
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
            ordersToDelete.push({ id: order.id, detail: detailRow });
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
        if (
          sheetSkuCatalogId != null
          && (isBlank(orderToKeep.sku) || isBlank(orderToKeep.itemNumber))
        ) {
          updateValues.skuCatalogId = sheetSkuCatalogId;
        }
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
        // sale_amount/currency aren't in the OrderProjection select, so backfill
        // only when the sheet actually carries a price (additive, never clobbers).
        if (sheetSaleAmount != null) updateValues.saleAmount = sheetSaleAmount;
        if (colIndices.currency >= 0 && sheetCurrency) updateValues.currency = sheetCurrency;

        const compactedUpdateValues = compactUpdateValues(updateValues);
        if (Object.keys(compactedUpdateValues).length > 0) {
          ordersToBackfill.push({ id: orderToKeep.id, values: compactedUpdateValues, detail: detailRow });
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
          detail: detailRow,
          values: {
            // Tenant scope: stamp the effective org. When called WITHOUT an
            // orgId (un-migrated cron callers) effectiveOrgId falls back to
            // transitionalUsavOrgId() — byte-identical to the prior behavior.
            // When an orgId IS supplied it stamps that tenant. The explicit
            // stamp is required because Drizzle's neon-http client can't carry
            // the GUC, so orders.organization_id (NOT NULL) must be set here.
            organizationId: effectiveOrgId,
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
            saleAmount: sheetSaleAmount,
            currency: sheetCurrency,
            skuCatalogId: sheetSkuCatalogId,
          },
        });
      }
    }

    if (ordersToDelete.length > 0) {
      progress({ type: 'phase', phase: 'updating', count: ordersToDelete.length });
      const deleteIds = ordersToDelete.map((e) => e.id);
      if (orgId) {
        // Org-ownership scoped delete: a row id that belongs to another tenant
        // simply won't match (no cross-tenant deletes).
        await withTenantDrizzle(orgId, (tx) =>
          tx.delete(ordersTable).where(and(
            inArray(ordersTable.id, deleteIds),
            eq(ordersTable.organizationId, orgId),
          ))
        );
      } else {
        await db.delete(ordersTable).where(inArray(ordersTable.id, deleteIds));
      }
      for (const entry of ordersToDelete) progress({ type: 'detail', kind: 'deleted', row: entry.detail });
    }

    if (ordersToBackfill.length > 0) {
      progress({ type: 'phase', phase: 'updating', count: ordersToBackfill.length });
      if (orgId) {
        // Run all backfills inside one GUC-carrying transaction; each UPDATE is
        // scoped by AND organization_id = orgId so it can never touch another
        // tenant's row even if an id collision were possible.
        await withTenantDrizzle(orgId, (tx) =>
          Promise.all(
            ordersToBackfill.map((entry) => {
              const compacted = compactUpdateValues(entry.values);
              if (Object.keys(compacted).length === 0) return Promise.resolve();
              return tx.update(ordersTable).set(compacted).where(and(
                eq(ordersTable.id, entry.id),
                eq(ordersTable.organizationId, orgId),
              ));
            })
          )
        );
      } else {
        await Promise.all(
          ordersToBackfill.map((entry) => {
            const compacted = compactUpdateValues(entry.values);
            if (Object.keys(compacted).length === 0) return Promise.resolve();
            return db.update(ordersTable).set(compacted).where(eq(ordersTable.id, entry.id));
          })
        );
      }
      for (const entry of ordersToBackfill) progress({ type: 'detail', kind: 'updated', row: entry.detail });
    }

    let insertedOrderIds: number[] = [];
    if (ordersToInsert.length > 0) {
      progress({ type: 'phase', phase: 'inserting', count: ordersToInsert.length });
      // Values already carry organizationId = effectiveOrgId. When orgId is
      // supplied we also run the INSERT through the GUC-carrying connection so
      // app.current_org is live (defense in depth + future per-table FORCE).
      const insertValues = ordersToInsert.map((entry) => entry.values);
      const insertedOrders = orgId
        ? await withTenantDrizzle(orgId, (tx) =>
            tx.insert(ordersTable).values(insertValues).returning({ id: ordersTable.id })
          )
        : await db
            .insert(ordersTable)
            .values(insertValues)
            .returning({ id: ordersTable.id });
      for (const entry of ordersToInsert) progress({ type: 'detail', kind: 'inserted', row: entry.detail });

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
            orgId,
          )
        )
      );
    }

    if (orderDeadlinesToUpsert.length > 0) {
      await Promise.all(
        orderDeadlinesToUpsert.map((entry) => upsertOrderDeadline(entry.id, entry.shipByDate, orgId))
      );
    }

    // Always bust the cached order views and notify clients via Ably so the
    // dashboard refreshes on every successful cron delivery — even when no
    // new orders were inserted or fields updated.
    const affectedOrderIds = [
      ...insertedOrderIds,
      ...ordersToBackfill.map((e) => e.id),
      ...ordersToDelete.map((e) => e.id),
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

    // Bust the server-side cache *before* signalling the client to refetch,
    // otherwise the client's GET /api/orders can race ahead and get a stale
    // cache hit. Sequence matters: invalidate → publishing event → publish.
    await invalidateAllOrdersApiCaches();
    progress({ type: 'phase', phase: 'publishing' });
    if (uniqueProcessedIds.length > 0) {
      await publishOrderChanged({
        // effectiveOrgId === transitionalUsavOrgId() when no orgId was supplied
        // (byte-identical to prior behavior); targets the supplied tenant when present.
        organizationId: effectiveOrgId,
        orderIds: uniqueProcessedIds,
        source: 'google-sheets-transfer-orders',
      });
    }
    for (const detail of detailsUnknownTitle) progress({ type: 'detail', kind: 'unknownTitle', row: detail });
    progress({ type: 'phase', phase: 'done' });

    return {
      success: true,
      rowCount: ordersToInsert.length,
      processedRows: groupedSourceByOrderId.size,
      insertedOrders: ordersToInsert.length,
      updatedOrdersTracking,
      updatedOrdersFields: ordersToBackfill.length,
      unresolvedTrackingCount: detailsUnresolvedTracking.length,
      deletedDuplicateOrders: ordersToDelete.length,
      matchedCustomers,
      unmatchedCustomers,
      tabName: targetTabName,
      ecwidApiRows,
      durationMs: Date.now() - startedAt,
      details: {
        inserted: ordersToInsert.map((e) => e.detail),
        updated: ordersToBackfill.map((e) => e.detail),
        deleted: ordersToDelete.map((e) => e.detail),
        unknownTitle: detailsUnknownTitle,
        unresolvedTracking: detailsUnresolvedTracking,
      },
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
