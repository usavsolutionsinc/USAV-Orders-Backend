import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import {
  upsertSerialUnit,
  enrichSerialUnitCatalog,
  stampReceivingTsnSerialUnitId,
} from '@/lib/neon/serial-units-queries';
import { getSkuCatalogBySku } from '@/lib/neon/sku-catalog-queries';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';

interface ReceivingLineTarget {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  zoho_item_id: string | null;
  zoho_purchaseorder_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string | null;
}

async function loadLineById(lineId: number): Promise<ReceivingLineTarget | null> {
  const result = await pool.query<ReceivingLineTarget>(
    `SELECT id, receiving_id, sku, item_name, zoho_item_id, zoho_purchaseorder_id,
            quantity_expected, quantity_received, workflow_status
     FROM receiving_lines
     WHERE id = $1
     LIMIT 1`,
    [lineId],
  );
  return result.rows[0] ?? null;
}

async function loadCandidateLines(receivingId: number): Promise<ReceivingLineTarget[]> {
  const result = await pool.query<ReceivingLineTarget>(
    `SELECT id, receiving_id, sku, item_name, zoho_item_id, zoho_purchaseorder_id,
            quantity_expected, quantity_received, workflow_status
     FROM receiving_lines
     WHERE receiving_id = $1
     ORDER BY id ASC`,
    [receivingId],
  );
  return result.rows;
}

function pickAutoLine(lines: ReceivingLineTarget[]): ReceivingLineTarget | 'ambiguous' | null {
  const open = lines.filter(
    (l) => l.quantity_expected == null || l.quantity_received < (l.quantity_expected ?? 0),
  );
  if (open.length === 0) return null;
  if (open.length === 1) return open[0];
  return 'ambiguous';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const serialNumber = String(body?.serial_number ?? body?.serialNumber ?? '').trim();
    const receivingIdRaw = Number(body?.receiving_id);
    const receivingLineIdRaw = Number(body?.receiving_line_id);
    const staffIdRaw = Number(body?.staff_id ?? body?.staffId);
    const conditionGrade = String(body?.condition_grade ?? body?.conditionGrade ?? '').trim() || null;

    const staffId = Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;
    const receivingId =
      Number.isFinite(receivingIdRaw) && receivingIdRaw > 0 ? Math.floor(receivingIdRaw) : null;
    const receivingLineId =
      Number.isFinite(receivingLineIdRaw) && receivingLineIdRaw > 0
        ? Math.floor(receivingLineIdRaw)
        : null;

    if (!serialNumber) {
      return NextResponse.json(
        { success: false, error: 'serial_number is required' },
        { status: 400 },
      );
    }
    if (!receivingId && !receivingLineId) {
      return NextResponse.json(
        { success: false, error: 'receiving_id or receiving_line_id is required' },
        { status: 400 },
      );
    }

    // ─── Resolve target line ────────────────────────────────────────────────
    let targetLine: ReceivingLineTarget | null = null;

    if (receivingLineId) {
      targetLine = await loadLineById(receivingLineId);
      if (!targetLine) {
        return NextResponse.json(
          { success: false, error: `receiving_line ${receivingLineId} not found` },
          { status: 404 },
        );
      }
    } else if (receivingId) {
      const candidates = await loadCandidateLines(receivingId);
      if (candidates.length === 0) {
        return NextResponse.json(
          { success: false, error: `no lines found for receiving ${receivingId}` },
          { status: 404 },
        );
      }
      const picked = pickAutoLine(candidates);
      if (picked === null) {
        return NextResponse.json(
          { success: false, error: 'all lines already at full quantity' },
          { status: 409 },
        );
      }
      if (picked === 'ambiguous') {
        return NextResponse.json({
          success: false,
          needs_line_selection: true,
          candidate_lines: candidates
            .filter(
              (l) =>
                l.quantity_expected == null ||
                l.quantity_received < (l.quantity_expected ?? 0),
            )
            .map((l) => ({
              id: l.id,
              sku: l.sku,
              quantity_expected: l.quantity_expected,
              quantity_received: l.quantity_received,
            })),
        });
      }
      targetLine = picked;
    }

    if (!targetLine) {
      return NextResponse.json(
        { success: false, error: 'could not resolve target line' },
        { status: 400 },
      );
    }

    // ─── sku_catalog fast path (cache-only, no Zoho call on the hot path) ──
    const catalog = targetLine.sku ? await getSkuCatalogBySku(targetLine.sku) : null;

    // ─── upsert into serial_units master ────────────────────────────────────
    const result = await upsertSerialUnit({
      serial_number: serialNumber,
      sku: targetLine.sku,
      sku_catalog_id: catalog?.id ?? null,
      zoho_item_id: targetLine.zoho_item_id,
      origin_source: 'receiving',
      origin_receiving_line_id: targetLine.id,
      actor_id: staffId,
      condition_grade: conditionGrade,
      target_status: 'RECEIVED',
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'invalid serial number' },
        { status: 400 },
      );
    }

    // ─── Audit row in tech_serial_numbers (lineage + existing GET compat) ──
    // Stamp the FK on the TSN row(s) so downstream queries can JOIN through
    // the master. Uses an idempotent UPDATE so it handles both the freshly
    // inserted row and any prior dupe caught by ON CONFLICT DO NOTHING.
    try {
      await pool.query(
        `INSERT INTO tech_serial_numbers
           (serial_number, serial_type, tested_by, station_source, receiving_line_id, shipment_id, scan_ref, serial_unit_id)
         VALUES ($1, 'SERIAL', $2, 'RECEIVING', $3, NULL, NULL, $4)
         ON CONFLICT DO NOTHING`,
        [serialNumber.toUpperCase(), staffId, targetLine.id, result.unit.id],
      );
      await stampReceivingTsnSerialUnitId({
        serial_unit_id: result.unit.id,
        serial_number: serialNumber,
        receiving_line_id: targetLine.id,
      });
    } catch (err) {
      console.warn('scan-serial: tsn audit insert failed (non-fatal)', err);
    }

    // ─── Bump quantity on the line, flip workflow_status when complete ─────
    const bumped = await pool.query<{
      quantity_received: number;
      quantity_expected: number | null;
      workflow_status: string | null;
    }>(
      `UPDATE receiving_lines
       SET quantity_received = quantity_received + 1,
           workflow_status = CASE
             WHEN quantity_expected IS NOT NULL
                  AND quantity_received + 1 >= quantity_expected
               THEN 'RECEIVED'::inbound_workflow_status_enum
             ELSE workflow_status
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING quantity_received, quantity_expected, workflow_status::text AS workflow_status`,
      [targetLine.id],
    );

    const lineState = bumped.rows[0] ?? {
      quantity_received: targetLine.quantity_received + 1,
      quantity_expected: targetLine.quantity_expected,
      workflow_status: targetLine.workflow_status,
    };

    // Emit a RECEIVED/WAREHOUSE ledger row — only on truly-new serials.
    // Re-scans (is_new=false) have already been counted.
    if (result.is_new && targetLine.sku) {
      try {
        const ledgerInsert = await pool.query<{ id: number }>(
          `INSERT INTO sku_stock_ledger
             (sku, delta, reason, dimension, staff_id,
              ref_serial_unit_id, ref_receiving_line_id, notes)
           VALUES ($1, 1, 'RECEIVED', 'WAREHOUSE', $2, $3, $4, $5)
           RETURNING id`,
          [
            targetLine.sku,
            staffId,
            result.unit.id,
            targetLine.id,
            `Receiving scan: ${serialNumber.toUpperCase()}`,
          ],
        );
        const ledgerId = ledgerInsert.rows[0]?.id ?? null;
        if (ledgerId) {
          await publishStockLedgerEvent({
            ledgerId,
            sku: targetLine.sku,
            delta: 1,
            reason: 'RECEIVED',
            dimension: 'WAREHOUSE',
            staffId,
            source: 'receiving.scan-serial',
          });
        }
      } catch (err) {
        console.warn('scan-serial: ledger RECEIVED insert failed (non-fatal)', err);
      }
    }

    // ─── Background: catalog enrichment (on miss) + cache/realtime ─────────
    const needsEnrichment = !catalog;
    const serialUnitId = result.unit.id;
    const skuForEnrichment = targetLine.sku;
    const zohoItemForEnrichment = targetLine.zoho_item_id;
    const zohoPoForEnrichment = targetLine.zoho_purchaseorder_id;
    const receivingIdForEvent = targetLine.receiving_id ?? receivingId;

    after(async () => {
      if (needsEnrichment && skuForEnrichment) {
        await enrichSerialUnitCatalog({
          serial_unit_id: serialUnitId,
          sku: skuForEnrichment,
          zoho_item_id: zohoItemForEnrichment,
          zoho_purchaseorder_id: zohoPoForEnrichment,
        });
      }

      try {
        await invalidateCacheTags([
          'receiving-lines',
          'receiving-logs',
          'pending-unboxing',
        ]);
        if (receivingIdForEvent != null) {
          await publishReceivingLogChanged({
            action: 'update',
            rowId: String(receivingIdForEvent),
            source: 'receiving.scan-serial',
          });
        }
      } catch (err) {
        console.warn('scan-serial: cache/realtime update failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      serial_unit: result.unit,
      is_new: result.is_new,
      prior_status: result.prior_status,
      is_return: result.is_return,
      warnings: result.warnings,
      line_state: {
        id: targetLine.id,
        sku: targetLine.sku,
        item_name: targetLine.item_name,
        quantity_received: Number(lineState.quantity_received),
        quantity_expected:
          lineState.quantity_expected != null ? Number(lineState.quantity_expected) : null,
        workflow_status: lineState.workflow_status,
        is_complete:
          lineState.quantity_expected != null &&
          Number(lineState.quantity_received) >= Number(lineState.quantity_expected),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan serial';
    console.error('receiving/scan-serial POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
