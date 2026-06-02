/**
 * POST /api/receiving/add-unmatched-line
 *
 * Manually add a receiving line to an unmatched receiving (source='unmatched').
 * Triggered by UnfoundLineEditPanel after the operator picks a product via
 * EcwidProductSearchPopover.
 *
 * Floor-as-SOT contract:
 *   • No Zoho IDs required — the line gets zoho_item_id/zoho_purchaseorder_id NULL.
 *   • workflow_status starts at MATCHED (line is already "linked" to its package
 *     — there's no pre-staging EXPECTED row to reconcile against).
 *   • The operator can then scan serials via /api/receiving/scan-serial, which
 *     already works on lines without Zoho linkage.
 *
 * Guardrails:
 *   • Rejects if the receiving row is source='zoho_po' — Zoho-sourced receivings
 *     are reconciled against Zoho line items; manual additions would create
 *     local lines that never match anything on the Zoho side.
 *   • Idempotent via api_idempotency_responses on Idempotency-Key header or
 *     body.client_event_id. A duplicate POST returns the prior result, no
 *     duplicate row created.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { withAuth } from '@/lib/auth/withAuth';
import { after } from 'next/server';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';

const IDEMPOTENCY_ROUTE = 'receiving.add-unmatched-line';

const CONDITION_GRADES = ['BRAND_NEW', 'LIKE_NEW', 'REFURBISHED', 'USED_A', 'USED_B', 'USED_C', 'PARTS'] as const;
type ConditionGrade = (typeof CONDITION_GRADES)[number];

const PLATFORM_PILLS = ['ebay', 'goodwill', 'amazon', 'aliexp', 'walmart', 'other'] as const;
type PlatformPill = (typeof PLATFORM_PILLS)[number];

const INTAKE_TYPES = ['po', 'return', 'trade_in'] as const;
type IntakeType = (typeof INTAKE_TYPES)[number];

interface ReceivingRow {
  id: number;
  source: string | null;
  organization_id: string | null;
  zoho_purchaseorder_id: string | null;
}

interface InsertedLineRow {
  id: number;
  receiving_id: number;
  sku: string | null;
  item_name: string | null;
  sku_catalog_id: number | null;
  sku_platform_id_row: number | null;
  source_platform_pill: string | null;
  intake_type: string | null;
  condition_grade: ConditionGrade;
  listing_url: string | null;
  listing_reference: string | null;
  location_code: string | null;
  quantity_expected: number | null;
  quantity_received: number | null;
  workflow_status: string;
  manual_entry_at: string;
}

function normalizeEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T | null = null,
): T | null {
  if (raw == null) return fallback;
  const v = String(raw).trim().toLowerCase();
  const match = allowed.find((a) => a.toLowerCase() === v);
  return match ?? fallback;
}

function normalizeConditionGrade(raw: unknown): ConditionGrade {
  if (raw == null) return 'BRAND_NEW';
  const upper = String(raw).trim().toUpperCase().replace(/[\s-]/g, '_');
  const match = CONDITION_GRADES.find((g) => g === upper);
  return match ?? 'BRAND_NEW';
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const receivingId = Number(body.receiving_id);
  if (!Number.isFinite(receivingId) || receivingId <= 0) {
    return NextResponse.json(
      { success: false, error: 'receiving_id is required' },
      { status: 400 },
    );
  }

  const skuCatalogIdRaw = body.sku_catalog_id;
  const skuCatalogId =
    skuCatalogIdRaw == null ? null : Number(skuCatalogIdRaw);
  if (skuCatalogId != null && (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0)) {
    return NextResponse.json(
      { success: false, error: 'sku_catalog_id must be a positive integer' },
      { status: 400 },
    );
  }

  const skuPlatformIdRowRaw = body.sku_platform_id_row;
  const skuPlatformIdRow =
    skuPlatformIdRowRaw == null ? null : Number(skuPlatformIdRowRaw);
  if (
    skuPlatformIdRow != null &&
    (!Number.isFinite(skuPlatformIdRow) || skuPlatformIdRow <= 0)
  ) {
    return NextResponse.json(
      { success: false, error: 'sku_platform_id_row must be a positive integer' },
      { status: 400 },
    );
  }

  const sku = body.sku == null ? null : String(body.sku).trim() || null;
  const itemName =
    body.item_name == null ? null : String(body.item_name).trim() || null;

  // At least one of (sku_catalog_id, sku, item_name) must be present so the
  // operator has identified *something*. Bare lines are useless downstream.
  if (skuCatalogId == null && !sku && !itemName) {
    return NextResponse.json(
      {
        success: false,
        error: 'must provide at least one of: sku_catalog_id, sku, item_name',
      },
      { status: 400 },
    );
  }

  const sourcePlatformPill: PlatformPill | null = normalizeEnum(
    body.source_platform_pill,
    PLATFORM_PILLS,
    null,
  );
  const intakeType: IntakeType | null = normalizeEnum(
    body.intake_type,
    INTAKE_TYPES,
    null,
  );
  const conditionGrade = normalizeConditionGrade(body.condition_grade);

  const listingUrl =
    body.listing_url == null ? null : String(body.listing_url).trim() || null;
  const listingReference =
    body.listing_reference == null
      ? null
      : String(body.listing_reference).trim() || null;
  const locationCode =
    body.location_code == null ? null : String(body.location_code).trim() || null;

  const quantityExpectedRaw = body.quantity_expected;
  const quantityExpected =
    quantityExpectedRaw == null ? 1 : Number(quantityExpectedRaw);
  if (!Number.isFinite(quantityExpected) || quantityExpected < 1) {
    return NextResponse.json(
      { success: false, error: 'quantity_expected must be >= 1' },
      { status: 400 },
    );
  }

  const clientEventId =
    body.client_event_id == null
      ? null
      : String(body.client_event_id).trim() || null;

  // ─── Idempotency ──────────────────────────────────────────────────────────
  const idempotencyKey = readIdempotencyKey(request, clientEventId);
  if (idempotencyKey) {
    const cached = await getApiIdempotencyResponse(
      pool,
      idempotencyKey,
      IDEMPOTENCY_ROUTE,
    );
    if (cached) {
      return NextResponse.json(cached.response_body, { status: cached.status_code });
    }
  }

  const respond = async (
    payload: Record<string, unknown>,
    init?: { status?: number },
  ) => {
    const status = init?.status ?? 200;
    if (idempotencyKey && status < 500) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey,
        route: IDEMPOTENCY_ROUTE,
        staffId: ctx.staffId,
        statusCode: status,
        responseBody: payload,
      });
    }
    return NextResponse.json(payload, { status });
  };

  // ─── Verify receiving row exists and is unmatched ─────────────────────────
  const receivingResult = await pool.query<ReceivingRow>(
    `SELECT id, source, organization_id, zoho_purchaseorder_id
       FROM receiving
      WHERE id = $1
      LIMIT 1`,
    [receivingId],
  );
  const receiving = receivingResult.rows[0];

  if (!receiving) {
    return respond(
      { success: false, error: `receiving ${receivingId} not found` },
      { status: 404 },
    );
  }

  if (receiving.source !== 'unmatched') {
    return respond(
      {
        success: false,
        error: 'add-unmatched-line is only valid on receiving rows with source=unmatched',
        actual_source: receiving.source,
      },
      { status: 409 },
    );
  }

  // ─── Resolve sku_catalog_id from sku_platform_id_row when omitted ─────────
  // The popover passes sku_platform_id_row (the specific Ecwid listing) but
  // can't cheaply resolve the paired sku_catalog_id from the platform-search
  // response. Look it up here so manually-added lines carry the catalog FK
  // whenever the platform row is paired. Unpaired listings leave it NULL.
  let resolvedSkuCatalogId = skuCatalogId;
  let resolvedSku = sku;
  let resolvedItemName = itemName;
  if (resolvedSkuCatalogId == null && skuPlatformIdRow != null) {
    const platformLookup = await pool.query<{
      sku_catalog_id: number | null;
      platform_sku: string | null;
      display_name: string | null;
    }>(
      `SELECT sku_catalog_id, platform_sku, display_name
         FROM sku_platform_ids
        WHERE id = $1
        LIMIT 1`,
      [skuPlatformIdRow],
    );
    const platformRow = platformLookup.rows[0];
    if (platformRow) {
      resolvedSkuCatalogId = platformRow.sku_catalog_id;
      if (!resolvedSku) resolvedSku = platformRow.platform_sku;
      if (!resolvedItemName) resolvedItemName = platformRow.display_name;
    }
  }

  // ─── Insert the line ──────────────────────────────────────────────────────
  // zoho_item_id is NULL (we relaxed the NOT NULL constraint in migration
  // 2026-05-22_receiving_lines_unfound_columns.sql for exactly this case).
  // workflow_status='MATCHED' because the line is already linked to its
  // package — no pre-staging EXPECTED row to reconcile.
  const insertResult = await pool.query<InsertedLineRow>(
    `INSERT INTO receiving_lines (
       receiving_id,
       sku,
       item_name,
       sku_catalog_id,
       sku_platform_id_row,
       source_platform_pill,
       intake_type,
       condition_grade,
       listing_url,
       listing_reference,
       location_code,
       quantity_expected,
       quantity_received,
       workflow_status,
       manual_entry_at,
       created_at,
       updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::condition_grade_enum,
       $9, $10, $11, $12, 0,
       'MATCHED'::inbound_workflow_status_enum,
       NOW(), NOW(), NOW()
     )
     RETURNING
       id, receiving_id, sku, item_name,
       sku_catalog_id, sku_platform_id_row,
       source_platform_pill, intake_type, condition_grade,
       listing_url, listing_reference, location_code,
       quantity_expected, quantity_received, workflow_status,
       manual_entry_at`,
    [
      receivingId,
      resolvedSku,
      resolvedItemName,
      resolvedSkuCatalogId,
      skuPlatformIdRow,
      sourcePlatformPill,
      intakeType,
      conditionGrade,
      listingUrl,
      listingReference,
      locationCode,
      quantityExpected,
    ],
  );

  const line = insertResult.rows[0];
  if (!line) {
    return respond(
      { success: false, error: 'insert returned no row' },
      { status: 500 },
    );
  }

  // ─── Background: cache invalidation + realtime publish ────────────────────
  after(async () => {
    try {
      await invalidateCacheTags([
        'receiving-lines',
        'receiving-logs',
        'pending-unboxing',
        'unfound-queue',
      ]);
      await publishReceivingLogChanged({
        action: 'update',
        rowId: String(receivingId),
        source: 'receiving.add-unmatched-line',
      });
    } catch (err) {
      console.warn('add-unmatched-line: cache/realtime update failed', err);
    }
  });

  return respond({ success: true, line });
});
