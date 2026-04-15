import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getApiIdempotencyResponse, readIdempotencyKey, saveApiIdempotencyResponse } from '@/lib/api-idempotency';
import { getValidStationScanSession, trackingMatchesSession } from '@/lib/station-scan-session';
import { normalizeSku } from '@/utils/sku';
import { TECH_EMPLOYEE_IDS } from '@/utils/staff';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';
import { parseSerialCsvField } from '@/lib/tech/serialFields';
import {
  getTechSerialsBySalId,
  insertTechSerialForSalContext,
  resolveTechSerialSalContext,
} from '@/lib/tech/insertTechSerialForSalContext';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';

const ROUTE = 'tech.scan-sku';

export async function POST(req: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await req.json();
    const { skuCode, tracking: rawTracking, techId, salId } = body;
    // tracking is optional — server resolves from SAL when absent
    const tracking = rawTracking ? String(rawTracking).trim() : null;
    const scanSessionId = body?.scanSessionId != null ? String(body.scanSessionId).trim() : '';
    const idemKey = readIdempotencyKey(req, body?.idempotencyKey);

    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE);
      if (hit && hit.status_code === 200) {
        return NextResponse.json(hit.response_body, { status: 200 });
      }
    }

    if (!skuCode || !techId) {
      return NextResponse.json({
        success: false,
        error: 'skuCode and techId are required',
      });
    }

    const fullSkuCode = String(skuCode).trim();
    const parts = fullSkuCode.split(':');
    if (parts.length < 2) {
      return NextResponse.json({
        success: false,
        error: 'Invalid SKU format. Use SKU:identifier or SKUxN:identifier',
      });
    }

    let skuToMatch = parts[0].trim();
    let qtyToDecrement = 1;

    const xMatch = skuToMatch.match(/^(.+?)x(\d+)$/i);
    if (xMatch) {
      skuToMatch = xMatch[1];
      qtyToDecrement = parseInt(xMatch[2], 10) || 1;
    }
    const normalizedSkuToMatch = normalizeSku(skuToMatch);

    const techIdNum = parseInt(String(techId), 10);
    let staffResult = { rows: [] as Array<{ id: number }> };
    if (!Number.isNaN(techIdNum) && techIdNum > 0) {
      const byId = await client.query('SELECT id FROM staff WHERE id = $1 LIMIT 1', [techIdNum]);
      if (byId.rows.length > 0) {
        staffResult = byId;
      }
    }

    if (staffResult.rows.length === 0) {
      const employeeId = TECH_EMPLOYEE_IDS[String(techId)] || String(techId);
      const byEmployeeId = await client.query('SELECT id FROM staff WHERE employee_id = $1 LIMIT 1', [
        employeeId,
      ]);
      staffResult = byEmployeeId;
    }

    if (staffResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Staff not found',
      }, { status: 404 });
    }

    const staffId = staffResult.rows[0].id;

    if (scanSessionId) {
      const sess = await getValidStationScanSession(client, scanSessionId, staffId);
      if (!sess || sess.session_kind === 'REPAIR') {
        return NextResponse.json(
          { success: false, error: 'Invalid scan session for SKU scan.' },
          { status: 400 },
        );
      }
      // Only validate tracking against session when tracking is present.
      // When absent the SAL-based serial resolution handles context.
      if (tracking) {
        const trk = String(tracking).trim();
        const k18 = normalizeTrackingKey18(trk);
        if (!trackingMatchesSession(sess, trk, k18)) {
          return NextResponse.json(
            { success: false, error: 'Tracking does not match the active scan session.' },
            { status: 400 },
          );
        }
      }
    }

    // Lookup order:
    //  1. Exact match on full colon code (GAS-compatible: static_sku may store "PROD:tag")
    //  2. Exact match on base SKU only (web-native: static_sku stores "PROD")
    //  3. Normalized fuzzy match on base SKU
    let skuRecord: { id: number; serial_number: string | null; notes: string | null; static_sku: string | null } | null = null;

    // Reads go through v_sku (compat view over serial_units) now that the sku
    // table is retired. v_sku preserves legacy ids for rows migrated from sku
    // and synthesizes ids (+1_000_000_000) for post-retirement serials.
    const tryExact = async (value: string) => {
      const r = await client.query(
        `SELECT id, serial_number, notes, static_sku FROM v_sku WHERE BTRIM(static_sku) = BTRIM($1) LIMIT 1`,
        [value],
      );
      return r.rows[0] ?? null;
    };

    skuRecord = await tryExact(fullSkuCode);            // "PROD:tag" full match
    if (!skuRecord) skuRecord = await tryExact(skuToMatch);  // "PROD" base match

    if (!skuRecord) {
      const fuzzy = await client.query(
        `SELECT id, serial_number, notes, static_sku FROM v_sku WHERE static_sku IS NOT NULL AND BTRIM(static_sku) <> ''`,
      );
      skuRecord =
        fuzzy.rows.find((r: any) => normalizeSku(String(r.static_sku || '')) === normalizedSkuToMatch) ?? null;
    }

    if (!skuRecord) {
      return NextResponse.json({
        success: false,
        error: `SKU "${skuToMatch}" not found`,
      });
    }

    const serialsFromSku = parseSerialCsvField(skuRecord.serial_number);

    const salIdNum = Number(salId);
    if (!Number.isFinite(salIdNum) || salIdNum <= 0) {
      return NextResponse.json({
        success: false,
        error: 'salId is required for SKU scan context',
      }, { status: 400 });
    }
    const salCtxResult = await resolveTechSerialSalContext(client, salIdNum);
    if (!salCtxResult.ok) {
      return NextResponse.json({ success: false, error: salCtxResult.error }, { status: salCtxResult.status });
    }
    const salCtx = salCtxResult.ctx;
    const resolvedShipmentId = salCtx.shipmentId;

    const insertedSerials: string[] = [];
    let productTitle = '';
    let ledgerIdForPublish: number | null = null;
    let canonicalSkuForPublish: string | null = null;

    await client.query('BEGIN');

    try {
      if (serialsFromSku.length > 0) {
        for (const rawSerial of serialsFromSku) {
          const ins = await insertTechSerialForSalContext(client, {
            salContext: salCtx,
            staffId,
            serial: rawSerial,
            source: 'tech.scan-sku',
            sourceMethod: 'SKU_PULL',
            sourceSkuId: skuRecord.id,
            sourceSkuCode: skuRecord.static_sku ?? fullSkuCode,
          });
          if (!ins.ok) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, error: ins.error }, { status: ins.status });
          }
          insertedSerials.push(ins.serial);
        }
      }

      // Resolve canonical sku + product title — exact match first, then fuzzy.
      let canonicalSku: string = skuToMatch;
      const exact = await client.query(
        `SELECT sku, product_title FROM sku_stock WHERE sku = $1 LIMIT 1`,
        [skuToMatch],
      );
      if (exact.rows[0]) {
        canonicalSku = String(exact.rows[0].sku);
        productTitle = String(exact.rows[0].product_title || '').trim();
      } else {
        const all = await client.query(`SELECT sku, product_title FROM sku_stock`);
        const match = all.rows.find(
          (r: any) => normalizeSku(String(r.sku || '')) === normalizedSkuToMatch,
        );
        if (match) {
          canonicalSku = String(match.sku);
          productTitle = String(match.product_title || '').trim();
        }
      }

      // Emit one ledger delta. Trigger fn_recompute_sku_stock keeps sku_stock
      // in sync automatically — no direct UPDATE on sku_stock from this route.
      const ledgerInsert = await client.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger
           (sku, delta, reason, dimension, staff_id, ref_sal_id, notes)
         VALUES ($1, $2, 'PICKED', 'WAREHOUSE', $3, $4, $5)
         RETURNING id`,
        [canonicalSku, -qtyToDecrement, staffId, salIdNum, `tech.scan-sku ${fullSkuCode}`],
      );
      ledgerIdForPublish = ledgerInsert.rows[0]?.id ?? null;
      canonicalSkuForPublish = canonicalSku;

      // Tracking + shipment_id were already written to serial_units upstream
      // by insertTechSerialForSalContext → syncTsnToSerialUnit. The old
      // UPDATE on sku is no longer needed — sku is retired and the pairing
      // state now lives on serial_units.

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    const canonicalSerialList = await getTechSerialsBySalId(client, salIdNum);

    await invalidateCacheTags(['tech-logs', 'orders-next']);
    await publishTechLogChanged({
      techId: staffId,
      action: 'update',
      source: 'tech.scan-sku',
    });

    if (ledgerIdForPublish && canonicalSkuForPublish) {
      try {
        await publishStockLedgerEvent({
          ledgerId: ledgerIdForPublish,
          sku: canonicalSkuForPublish,
          delta: -qtyToDecrement,
          reason: 'PICKED',
          dimension: 'WAREHOUSE',
          staffId,
          source: 'tech.scan-sku',
        });
      } catch (err) {
        console.warn('[tech.scan-sku] realtime publish failed', err);
      }
    }

    const responsePayload: Record<string, unknown> = {
      success: true,
      matchedSku: skuRecord.static_sku ?? skuToMatch,
      serialNumbers: insertedSerials,
      productTitle,
      notes: skuRecord.notes,
      quantityDecremented: qtyToDecrement,
      shipmentId: resolvedShipmentId,
      scanSessionId: scanSessionId || null,
      ...(serialsFromSku.length > 0 ? { updatedSerials: canonicalSerialList } : {}),
    };

    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE,
        staffId,
        statusCode: 200,
        responseBody: responsePayload,
      });
    }

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    console.error('SKU scan error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process SKU scan',
      details: error.message,
    }, { status: 500 });
  } finally {
    client.release();
  }
}
