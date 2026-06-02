import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { enrichSerialUnitCatalog } from '@/lib/neon/serial-units-queries';
import { attachSerialToLine, detachSerialFromLine } from '@/lib/receiving/serial-attach';
import { syncSerialToZohoPo } from '@/lib/receiving/zoho-serial-sync';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';

const IDEMPOTENCY_ROUTE = 'receiving.scan-serial';

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

// Serials are sidecar metadata, not stock — "open vs full" no longer applies to
// where a scan lands. A single-line carton resolves automatically; anything
// ambiguous asks the operator which line. The caller always wins when it passes
// an explicit receiving_line_id.
function pickAutoLine(
  lines: ReceivingLineCandidate[],
): ReceivingLineCandidate | 'ambiguous' | null {
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0];
  return 'ambiguous';
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();

    const serialNumber = String(body?.serial_number ?? body?.serialNumber ?? '').trim();
    const receivingIdRaw = Number(body?.receiving_id);
    const receivingLineIdRaw = Number(body?.receiving_line_id);
    const conditionGrade =
      String(body?.condition_grade ?? body?.conditionGrade ?? '').trim() || null;
    const clientEventId = String(body?.client_event_id ?? '').trim() || null;
    const scanToken = String(body?.scan_token ?? '').trim() || null;
    const stationRaw = String(body?.station ?? '').trim().toUpperCase();
    const station =
      stationRaw === 'MOBILE' || stationRaw === 'TECH' ? stationRaw : 'RECEIVING';

    // Server-trusted actor from the verified session cookie.
    const staffId = ctx.staffId;
    const receivingId =
      Number.isFinite(receivingIdRaw) && receivingIdRaw > 0
        ? Math.floor(receivingIdRaw)
        : null;
    let receivingLineId =
      Number.isFinite(receivingLineIdRaw) && receivingLineIdRaw > 0
        ? Math.floor(receivingLineIdRaw)
        : null;

    // Idempotency: replay a prior cached response when the same Idempotency-Key
    // (or body client_event_id) is seen again. Retries land on the same answer
    // (already_received / already_complete / success) without re-running the scan.
    const idempotencyKey = readIdempotencyKey(request, clientEventId);
    if (idempotencyKey) {
      const cached = await getApiIdempotencyResponse(
        pool,
        idempotencyKey,
        IDEMPOTENCY_ROUTE,
      );
      if (cached) {
        return NextResponse.json(cached.response_body, {
          status: cached.status_code,
        });
      }
    }

    // Wrap NextResponse.json so every meaningful return point also persists
    // the response under the idempotency key (skips 5xx — those are transient
    // and a retry should be allowed to succeed).
    const respond = async (
      body: Record<string, unknown>,
      init?: { status?: number },
    ) => {
      const status = init?.status ?? 200;
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey,
          route: IDEMPOTENCY_ROUTE,
          staffId,
          statusCode: status,
          responseBody: body,
        });
      }
      return NextResponse.json(body, init);
    };

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
      if (picked === 'ambiguous') {
        // Multiple lines on the carton and no explicit target — ask the
        // operator which product this serial belongs to.
        return NextResponse.json({
          success: false,
          needs_line_selection: true,
          candidate_lines: candidates.map((l) => ({
            id: l.id,
            sku: l.sku,
            quantity_expected: l.quantity_expected,
            quantity_received: l.quantity_received,
          })),
        });
      } else if (picked) {
        receivingLineId = picked.id;
        targetReceivingId = picked.receiving_id;
      }
    }

    if (!receivingLineId) {
      return NextResponse.json(
        { success: false, error: 'could not resolve target line' },
        { status: 400 },
      );
    }

    // ─── Attach serial (sidecar metadata — no qty/ledger change) ────────────
    const result = await attachSerialToLine({
      receiving_line_id: receivingLineId,
      serial_number: serialNumber,
      condition_grade: conditionGrade,
      staff_id: staffId,
      station,
      client_event_id: clientEventId,
      scan_token: scanToken,
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'invalid serial number' },
        { status: 400 },
      );
    }

    // Idempotent re-scan: the same serial is already on this line. Return
    // success so the UI shows a friendly toast instead of an error. No
    // background enrichment needed — the prior scan handled it.
    if (result.already_attached) {
      return respond({
        success: true,
        already_attached: true,
        serial_unit: result.serial_unit,
        line_state: result.line_state,
      });
    }

    const serialResult = result;

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

      // Push the serial up to Zoho — append to the matching PO line item's
      // description AND the PO header notes. Fire-and-forget; the helper is
      // idempotent so re-scans / supplemental scans won't double-append. No
      // toast on failure: per-scan Zoho sync is best-effort; the canonical
      // truth lives in serial_units + tech_serial_numbers locally.
      void syncSerialToZohoPo({
        receivingLineId,
        serial: serialResult.serial_unit.serial_number,
        staffId,
      }).catch((err) => {
        console.warn('scan-serial: syncSerialToZohoPo threw', err);
      });

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

    return respond({
      success: true,
      serial_unit: serialResult.serial_unit,
      is_new: serialResult.is_new,
      prior_status: serialResult.prior_status,
      is_return: serialResult.is_return,
      warnings: serialResult.warnings,
      line_state: result.line_state,
      inventory_event_id: result.inventory_event_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan serial';
    console.error('receiving/scan-serial POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, {
  permission: 'receiving.mark_received',
  audit: {
    source: 'receiving.scan-serial',
    action: AUDIT_ACTION.SERIAL_SCAN,
    entityType: AUDIT_ENTITY.SERIAL_UNIT,
    entityId: ({ response }) => {
      const r = response as { serial_unit?: { id?: number | string } } | null;
      return r?.serial_unit?.id ?? null;
    },
    extra: ({ response }) => {
      const r = response as { line_state?: { id?: number }; is_new?: boolean; is_return?: boolean } | null;
      return {
        receiving_line_id: r?.line_state?.id ?? null,
        is_new: r?.is_new ?? null,
        is_return: r?.is_return ?? null,
      };
    },
  },
});

/**
 * DELETE /api/receiving/scan-serial
 * Body: { serial_unit_id: number, receiving_line_id: number }
 *   — OR — { serial_number: string, receiving_line_id: number }
 *
 * Removes a previously-scanned serial from a receiving line:
 *   - Deletes the matching `serial_units` row (only if it still points at the
 *     given receiving_line_id, so we never clobber a unit that's already moved
 *     beyond receiving).
 *
 * Serials are sidecar metadata: removing one does NOT change
 * `receiving_lines.quantity_received` and writes NO reversing stock-ledger row.
 * Stock/quantity are owned by the PO line item via the Receive action.
 */
export const DELETE = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json().catch(() => ({}));
    const serialUnitIdRaw = Number(body?.serial_unit_id ?? body?.serialUnitId);
    const serialNumberRaw = String(body?.serial_number ?? body?.serialNumber ?? '').trim();
    const receivingLineIdRaw = Number(body?.receiving_line_id ?? body?.receivingLineId);

    const serialUnitId =
      Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0
        ? Math.floor(serialUnitIdRaw)
        : null;
    const receivingLineId =
      Number.isFinite(receivingLineIdRaw) && receivingLineIdRaw > 0
        ? Math.floor(receivingLineIdRaw)
        : null;

    if (!receivingLineId) {
      return NextResponse.json(
        { success: false, error: 'receiving_line_id is required' },
        { status: 400 },
      );
    }
    if (!serialUnitId && !serialNumberRaw) {
      return NextResponse.json(
        { success: false, error: 'serial_unit_id or serial_number is required' },
        { status: 400 },
      );
    }

    const result = await detachSerialFromLine({
      receiving_line_id: receivingLineId,
      serial_unit_id: serialUnitId,
      serial_number: serialNumberRaw || null,
      staff_id: ctx.staffId ?? null,
      station: 'RECEIVING',
    });

    if (!result.removed) {
      return NextResponse.json(
        { success: false, error: 'serial not found on this line' },
        { status: 404 },
      );
    }

    // Background: same cache + realtime fanout the POST path uses so the
    // sidebar/accordion refetch and the UI reflects the change.
    after(async () => {
      try {
        await invalidateCacheTags([
          'receiving-lines',
          'receiving-logs',
          'pending-unboxing',
        ]);
        await publishReceivingLogChanged({
          action: 'update',
          rowId: String(receivingLineId),
          source: 'receiving.scan-serial.delete',
        });
      } catch (err) {
        console.warn('scan-serial DELETE: cache/realtime update failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      removed_serial_unit_id: result.removed_serial_unit_id,
      removed_serial_number: result.removed_serial_number,
      line_state: result.line_state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove serial';
    console.error('receiving/scan-serial DELETE failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, {
  permission: 'receiving.mark_received',
  audit: {
    source: 'receiving.scan-serial.delete',
    action: AUDIT_ACTION.SERIAL_DELETE,
    entityType: AUDIT_ENTITY.SERIAL_UNIT,
    entityId: ({ response }) => {
      const r = response as { removed_serial_unit_id?: number } | null;
      return r?.removed_serial_unit_id ?? null;
    },
    extra: ({ response }) => {
      const r = response as {
        removed_serial_number?: string;
        line_state?: { id?: number; quantity_received?: number };
      } | null;
      return {
        serial_number: r?.removed_serial_number ?? null,
        receiving_line_id: r?.line_state?.id ?? null,
        quantity_received: r?.line_state?.quantity_received ?? null,
      };
    },
  },
});
