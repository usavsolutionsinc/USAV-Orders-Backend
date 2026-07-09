import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';
import { withAuth } from '@/lib/auth/withAuth';
import { getSkuCatalogBySku } from '@/lib/neon/sku-catalog-queries';
import { upsertSerialUnit } from '@/lib/neon/serial-units-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import { attachTechSerial } from '@/lib/inventory/tech-serial';
import { recordLabelPrintJob } from '@/lib/labels/print-jobs';

/**
 * POST /api/post-multi-sn — issue label(s) for a SKU + record the audit trail.
 *
 * Modernized writer for the `MultiSkuSnBarcode` workspace. Replaces the
 * legacy raw INSERT into `serial_units.legacy_*` columns (a holdover from
 * the retired `sku` table backfill — see migration 2026-04-15) with the
 * canonical pipeline:
 *
 *   1. `upsertSerialUnit()` — single writer for serial_units, handles
 *      status transitions, return detection, idempotent upsert.
 *   2. `station_activity_logs` — one row per print batch, records who
 *      issued labels for which SKU + carries the DataMatrix payload.
 *   3. `tech_serial_numbers` — one row per unit, the canonical SKU↔serial
 *      acknowledgment table. Cross-refs the station_activity_logs row.
 *   4. `recordInventoryEvent()` — LABELED event per unit, station=SYSTEM.
 *      This is what powers the future Recently Printed + Unit History
 *      views — both read from `inventory_events` and
 *      `station_activity_logs`.
 *
 * Request body (legacy `productTitle` and `shippingTrackingNumber` fields
 * are now ignored; legacy `sku` field is accepted as an alias for `unitId`
 * so older clients keep working until they switch to the new shape):
 *
 *   {
 *     sku: string;             // product SKU, e.g. "00804"
 *     unitId?: string;         // minted unit id, e.g. "00098-2026-000010"
 *     gtin?: string;           // internal GTIN from /api/units/next-id
 *     qrPayload?: string;      // the DataMatrix payload printed on the label
 *     symbology?: 'gs1datamatrix' | 'datamatrix';
 *     serialNumbers: string[]; // raw serials — for auto-issue this is [unitId]
 *     notes?: string;
 *     location?: string;
 *     condition?: ConditionGrade;
 *     printClass?: 'print' | 'sn-to-sku';
 *   }
 */

const VALID_CONDITIONS = ['BRAND_NEW', 'LIKE_NEW', 'REFURBISHED', 'USED_A', 'USED_B', 'USED_C', 'PARTS'] as const;
type ConditionGrade = (typeof VALID_CONDITIONS)[number];

export const POST = withAuth(
  async (request: NextRequest, ctx) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Accept the legacy contract (sku = unitId) and the new contract
    // (sku = real SKU, unitId = minted id) simultaneously. When only
    // `sku` is sent, treat it as the unit id so existing clients keep
    // working; the catalog lookup falls through to the base form.
    const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
    const unitId =
      typeof body.unitId === 'string' && body.unitId.trim()
        ? body.unitId.trim()
        : sku;
    const productSku =
      typeof body.productSku === 'string' && body.productSku.trim()
        ? body.productSku.trim()
        : sku;

    const serialNumbers = Array.isArray(body.serialNumbers)
      ? (body.serialNumbers as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean)
      : [];

    if (!sku || serialNumbers.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: sku and serialNumbers[]' },
        { status: 400 },
      );
    }

    const notes = typeof body.notes === 'string' ? body.notes : null;
    const location = typeof body.location === 'string' ? body.location.trim() || null : null;
    const conditionRaw = typeof body.condition === 'string' ? body.condition : '';
    const condition: ConditionGrade = (VALID_CONDITIONS as readonly string[]).includes(conditionRaw)
      ? (conditionRaw as ConditionGrade)
      : 'BRAND_NEW';
    const clientEventId =
      typeof body.clientEventId === 'string' ? body.clientEventId.trim() || null : null;
    const gtin = typeof body.gtin === 'string' ? body.gtin.trim() || null : null;
    const qrPayload = typeof body.qrPayload === 'string' ? body.qrPayload.trim() || null : null;
    const symbology =
      body.symbology === 'gs1datamatrix' || body.symbology === 'datamatrix'
        ? (body.symbology as 'gs1datamatrix' | 'datamatrix')
        : null;
    const printClass =
      body.printClass === 'sn-to-sku' || body.printClass === 'print'
        ? (body.printClass as 'print' | 'sn-to-sku')
        : 'print';

    // Resolve catalog from the real SKU first; fall back to the unit-id form
    // for old clients that only sent `sku`. The base form strips any `:`
    // suffix used by composite SKUs.
    const baseProductSku = productSku.includes(':') ? productSku.split(':')[0].trim() : productSku;
    const catalog =
      (await getSkuCatalogBySku(baseProductSku)) ?? (await getSkuCatalogBySku(productSku));
    const catalogId = catalog?.id ?? null;
    const skuForStorage = catalog?.sku || baseProductSku || productSku;

    const actorId = ctx.staffId ?? null;
    const orgId = ctx.organizationId ?? USAV_ORG_ID;

    // 1. One station_activity_logs row covering the whole batch. Carries
    //    the print payload + metadata so the future Recently Printed view
    //    can render rich rows without rejoining inventory_events.
    let stationActivityLogId: number | null = null;
    try {
      const logRes = await tenantQuery<{ id: number }>(
        orgId,
        `INSERT INTO station_activity_logs
           (station, activity_type, staff_id, scan_ref, notes, metadata, organization_id)
         VALUES ('LABELS', 'LABEL_PRINTED', $1, $2, $3, $4::jsonb, $5)
         RETURNING id`,
        [
          actorId,
          qrPayload,
          notes,
          JSON.stringify({
            unit_id: unitId,
            sku: skuForStorage,
            sku_catalog_id: catalogId,
            gtin,
            symbology,
            print_class: printClass,
            serial_count: serialNumbers.length,
            condition,
          }),
          ctx.organizationId,
        ],
      );
      stationActivityLogId = logRes.rows[0]?.id ?? null;
    } catch (err) {
      console.warn('[post-multi-sn] station_activity_logs insert failed (non-fatal)', err);
    }

    const serialUnitIds: number[] = [];
    // Per-serial minted unit identities, index-aligned to the labels the client
    // will print. Each physical unit owns exactly one {SKU}-{YYWW}-{SEQ6}.
    const units: Array<{ serial: string; unitUid: string | null }> = [];
    for (const serial of serialNumbers) {
      // 2. Canonical upsert — handles status transitions, return detection,
      //    metadata patching, AND mints this serial's own unit_uid at birth
      //    (upsertSerialUnit, Phase 2) when the row doesn't already have one and
      //    a catalog row is known. An already-labeled unit keeps its original id
      //    (the reprint guarantee). Uncataloged (e.g. Ecwid-only) SKUs get a
      //    null id and the label falls back to encoding the bare serial. Origin
      //    is 'manual' (operator-triggered print); status lands at LABELED.
      let upserted;
      try {
        upserted = await upsertSerialUnit({
          serial_number: serial,
          sku: skuForStorage,
          sku_catalog_id: catalogId,
          origin_source: 'manual',
          actor_id: actorId,
          condition_grade: condition,
          location,
          target_status: 'LABELED',
        }, undefined, ctx.organizationId);
      } catch (err) {
        console.error('[post-multi-sn] upsertSerialUnit failed', { serial, err });
        continue;
      }
      if (!upserted) continue;

      const serialUnitId = upserted.unit.id;
      serialUnitIds.push(serialUnitId);
      // The authoritative id is whatever landed on the row (minted at birth, or
      // the pre-existing id for a relabel). This is what the label prints and
      // what scan tokens point at.
      const effectiveUid = upserted.unit.unit_uid ?? null;
      units.push({ serial, unitUid: effectiveUid });

      // 3. Canonical SKU↔serial acknowledgment row. ADMIN is the only
      //    station_source the CHECK constraint accepts for non-receiving/
      //    non-tech/non-pack writes (see 2026-03-31_tsn_add_station_source).
      try {
        await attachTechSerial({
          serialNumber: serial,
          serialUnitId,
          stationSource: 'ADMIN',
          testedBy: actorId,
          scanRef: effectiveUid ?? qrPayload,
          sourceSkuId: catalogId,
          contextStationActivityLogId: stationActivityLogId,
        });
      } catch (err) {
        console.warn('[post-multi-sn] tech_serial_numbers insert failed (non-fatal)', err);
      }

      // 4. Lifecycle event — what the Unit History view reads. station=
      //    SYSTEM because the print is operator-triggered but not tied to
      //    a physical station scan. scan_token is this unit's own uid so the
      //    timeline resolves back to the right physical unit.
      try {
        await recordInventoryEvent({
          event_type: 'LABELED',
          actor_staff_id: actorId,
          station: 'SYSTEM',
          serial_unit_id: serialUnitId,
          sku: skuForStorage,
          prev_status: upserted.prior_status,
          next_status: 'LABELED',
          scan_token: effectiveUid ?? qrPayload ?? unitId,
          notes,
          payload: {
            unit_id: effectiveUid ?? unitId,
            gtin,
            symbology,
            print_class: printClass,
            station_activity_log_id: stationActivityLogId,
          },
        }, undefined, ctx.organizationId);
      } catch (err) {
        console.warn('[post-multi-sn] recordInventoryEvent failed (non-fatal)', err);
      }

      // 5. Immutable print-ledger row (audit-grade serial↔label pairing). Records
      //    the exact DataMatrix payload + the unit_uid snapshot for THIS unit.
      //    A relabel of an already-LABELED unit is marked is_reprint. Idempotent
      //    per (org, clientEventId:serial) so a retry is a no-op. Non-fatal —
      //    the label already printed client-side; the ledger records it.
      try {
        await recordLabelPrintJob(
          {
            jobType: 'UNIT',
            serialUnitId,
            unitUid: effectiveUid,
            qrPayload: qrPayload ?? effectiveUid ?? serial,
            symbology: symbology ?? 'datamatrix',
            templateId: 'product',
            isReprint: upserted.prior_status === 'LABELED',
            actorStaffId: actorId,
            clientEventId: clientEventId ? `${clientEventId}:${serial}` : null,
          },
          orgId,
        );
      } catch (err) {
        console.warn('[post-multi-sn] label_print_jobs insert failed (non-fatal)', err);
      }
    }

    return NextResponse.json({
      success: true,
      serialUnitIds,
      units,
      id: serialUnitIds[0] ?? null,
      stationActivityLogId,
    });
  },
  { permission: 'print.label' },
);
