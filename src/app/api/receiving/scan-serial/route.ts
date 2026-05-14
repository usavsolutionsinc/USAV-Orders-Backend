import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { enrichSerialUnitCatalog } from '@/lib/neon/serial-units-queries';
import { receiveLineUnits } from '@/lib/receiving/receive-line';

interface ReceivingLineCandidate {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  zoho_item_id: string | null;
  zoho_purchaseorder_id: string | null;
}

async function loadCandidateLines(receivingId: number): Promise<ReceivingLineCandidate[]> {
  const r = await pool.query<ReceivingLineCandidate>(
    `SELECT id, receiving_id, sku, quantity_expected, quantity_received,
            zoho_item_id, zoho_purchaseorder_id
     FROM receiving_lines
     WHERE receiving_id = $1
     ORDER BY id ASC`,
    [receivingId],
  );
  return r.rows;
}

function pickAutoLine(
  lines: ReceivingLineCandidate[],
): ReceivingLineCandidate | 'ambiguous' | null {
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
    const conditionGrade =
      String(body?.condition_grade ?? body?.conditionGrade ?? '').trim() || null;
    const clientEventId = String(body?.client_event_id ?? '').trim() || null;
    const scanToken = String(body?.scan_token ?? '').trim() || null;
    const stationRaw = String(body?.station ?? '').trim().toUpperCase();
    const station =
      stationRaw === 'MOBILE' || stationRaw === 'TECH' ? stationRaw : 'RECEIVING';

    const staffId =
      Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;
    const receivingId =
      Number.isFinite(receivingIdRaw) && receivingIdRaw > 0
        ? Math.floor(receivingIdRaw)
        : null;
    let receivingLineId =
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
    let targetReceivingId = receivingId;

    if (!receivingLineId && receivingId) {
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
      receivingLineId = picked.id;
      targetReceivingId = picked.receiving_id;
    }

    if (!receivingLineId) {
      return NextResponse.json(
        { success: false, error: 'could not resolve target line' },
        { status: 400 },
      );
    }

    // ─── Single writer ──────────────────────────────────────────────────────
    const result = await receiveLineUnits({
      receiving_line_id: receivingLineId,
      units: 1,
      serials: [serialNumber],
      condition_grade: conditionGrade,
      staff_id: staffId,
      station,
      client_event_id: clientEventId,
      scan_token: scanToken,
    });

    const serialResult = result.serials_recorded[0];
    if (!serialResult) {
      return NextResponse.json(
        { success: false, error: 'invalid serial number' },
        { status: 400 },
      );
    }

    // ─── Background: catalog enrichment + cache/realtime ────────────────────
    const serialUnitId = serialResult.serial_unit.id;
    const skuForEnrichment = result.line_state.sku;
    const receivingIdForEvent = targetReceivingId;

    after(async () => {
      if (skuForEnrichment && !serialResult.serial_unit.sku_catalog_id) {
        await enrichSerialUnitCatalog({
          serial_unit_id: serialUnitId,
          sku: skuForEnrichment,
          zoho_item_id: serialResult.serial_unit.zoho_item_id,
          zoho_purchaseorder_id: null,
        }).catch((err) => {
          console.warn('scan-serial: enrichSerialUnitCatalog failed', err);
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
      serial_unit: serialResult.serial_unit,
      is_new: serialResult.is_new,
      prior_status: serialResult.prior_status,
      is_return: serialResult.is_return,
      warnings: serialResult.warnings,
      line_state: result.line_state,
      inventory_event_ids: result.inventory_event_ids,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan serial';
    console.error('receiving/scan-serial POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
