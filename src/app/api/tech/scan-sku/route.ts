import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeSku } from '@/utils/sku';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { parseSerialCsvField } from '@/lib/tech/serialFields';
import { insertTechSerialForTracking } from '@/lib/tech/insertTechSerialForTracking';

export async function POST(req: NextRequest) {
  const client = await pool.connect();
  try {
    const { skuCode, tracking, techId } = await req.json();

    if (!skuCode || !tracking || !techId) {
      return NextResponse.json({
        success: false,
        error: 'skuCode, tracking, and techId are required',
      });
    }

    const parts = String(skuCode).split(':');
    if (parts.length !== 2) {
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
      const techEmployeeIds: { [key: string]: string } = {
        '1': 'TECH001',
        '2': 'TECH002',
        '3': 'TECH003',
        '4': 'TECH004',
      };
      const employeeId = techEmployeeIds[String(techId)] || String(techId);
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

    const exactSku = await client.query(
      `SELECT id, serial_number, notes, static_sku
       FROM sku
       WHERE BTRIM(static_sku) = BTRIM($1)
       LIMIT 1`,
      [skuToMatch],
    );

    let skuRecord: { id: number; serial_number: string | null; notes: string | null; static_sku: string | null } | null =
      exactSku.rows[0] ?? null;

    if (!skuRecord) {
      const fuzzy = await client.query(
        `SELECT id, serial_number, notes, static_sku
         FROM sku
         WHERE static_sku IS NOT NULL AND BTRIM(static_sku) <> ''`,
      );
      skuRecord =
        fuzzy.rows.find((r: any) => normalizeSku(String(r.static_sku || '')) === normalizedSkuToMatch) ?? null;
    }

    if (!skuRecord) {
      return NextResponse.json({
        success: false,
        error: `SKU ${skuToMatch} not found in sku table`,
      });
    }

    const serialsFromSku = parseSerialCsvField(skuRecord.serial_number);
    const normalizedTracking = String(tracking || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isFnskuTracking = /^(X00|X0|B0)/i.test(normalizedTracking);
    const pairingTracking = isFnskuTracking ? normalizedTracking : String(tracking || '').trim();
    const resolvedOnce = await resolveShipmentId(pairingTracking);

    let fnskuContextExists = false;
    if (isFnskuTracking) {
      const fnskuLookup = await client.query(
        `SELECT 1
         FROM fba_fnskus
         WHERE fnsku = $1
         LIMIT 1`,
        [normalizedTracking],
      );
      fnskuContextExists = fnskuLookup.rows.length > 0;
    }

    if (!resolvedOnce.shipmentId && !fnskuContextExists) {
      return NextResponse.json({
        success: false,
        error: 'Tracking/FNSKU context not found',
      }, { status: 404 });
    }

    const insertedSerials: string[] = [];
    let canonicalSerialList: string[] = [];
    let productTitle = '';

    await client.query('BEGIN');

    try {
      if (serialsFromSku.length > 0) {
        for (const rawSerial of serialsFromSku) {
          const ins = await insertTechSerialForTracking(
            client,
            { tracking: pairingTracking, serial: rawSerial, techId, resolvedScan: resolvedOnce },
            { skipInvalidateAndPublish: true },
          );
          if (!ins.ok) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, error: ins.error }, { status: ins.status });
          }
          insertedSerials.push(rawSerial.toUpperCase());
          canonicalSerialList = ins.serialNumbers;
        }
      }

      const stockRows = await client.query(`SELECT id, stock, sku, product_title FROM sku_stock`);
      const stockTarget = stockRows.rows.find(
        (r: any) => normalizeSku(String(r.sku || '')) === normalizedSkuToMatch,
      );
      productTitle = String(stockTarget?.product_title || '').trim();
      if (stockTarget) {
        const currentQty = parseInt(String(stockTarget.stock || '0'), 10) || 0;
        const nextQty = Math.max(0, currentQty - qtyToDecrement);
        await client.query(`UPDATE sku_stock SET stock = $1 WHERE id = $2`, [String(nextQty), stockTarget.id]);
      }

      await client.query(`UPDATE sku SET shipping_tracking_number = $1 WHERE id = $2`, [pairingTracking, skuRecord.id]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    await invalidateCacheTags(['tech-logs', 'orders-next']);
    await publishTechLogChanged({
      techId: staffId,
      action: 'update',
      source: 'tech.scan-sku',
    });

    return NextResponse.json({
      success: true,
      serialNumbers: insertedSerials,
      productTitle,
      notes: skuRecord.notes,
      quantityDecremented: qtyToDecrement,
      ...(serialsFromSku.length > 0 ? { updatedSerials: canonicalSerialList } : {}),
    });
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
