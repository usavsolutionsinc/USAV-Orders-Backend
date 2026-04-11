import { NextRequest, NextResponse } from 'next/server';
import {
  getBinContentsByBarcode,
  getLocationByBarcode,
  adjustBinQty,
  upsertBinContent,
  markBinCounted,
} from '@/lib/neon/location-queries';

/**
 * GET /api/locations/[barcode]
 * Scan a bin barcode → returns the bin location + all SKUs stored there.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const { barcode } = await params;
  const code = decodeURIComponent(barcode).trim();

  if (!code) {
    return NextResponse.json({ error: 'Barcode is required' }, { status: 400 });
  }

  try {
    const result = await getBinContentsByBarcode(code);

    if (!result) {
      return NextResponse.json(
        { error: 'Bin not found', barcode: code },
        { status: 404 },
      );
    }

    return NextResponse.json({
      location: {
        id: result.location.id,
        name: result.location.name,
        room: result.location.room,
        rowLabel: result.location.row_label,
        colLabel: result.location.col_label,
        barcode: result.location.barcode,
        binType: result.location.bin_type,
        capacity: result.location.capacity,
      },
      contents: result.contents.map((c) => ({
        id: c.id,
        sku: c.sku,
        qty: c.qty,
        minQty: c.min_qty,
        maxQty: c.max_qty,
        lastCounted: c.last_counted,
        productTitle: c.product_title,
      })),
    });
  } catch (err: any) {
    console.error('[GET /api/locations/[barcode]] error:', err);
    return NextResponse.json(
      { error: 'Failed to load bin', details: err?.message },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/locations/[barcode]
 * Actions: take, put, set, count
 *
 * take:  { action: "take",  sku, qty, staffId?, reason? }  — subtract from bin + sku_stock
 * put:   { action: "put",   sku, qty, staffId?, reason? }  — add to bin + sku_stock
 * set:   { action: "set",   sku, qty, minQty?, maxQty? }   — set absolute bin qty
 * count: { action: "count", sku }                           — mark bin as physically counted
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const { barcode } = await params;
  const code = decodeURIComponent(barcode).trim();

  if (!code) {
    return NextResponse.json({ error: 'Barcode is required' }, { status: 400 });
  }

  try {
    const loc = await getLocationByBarcode(code);
    if (!loc) {
      return NextResponse.json({ error: 'Bin not found' }, { status: 404 });
    }

    const body = await request.json();
    const { action, sku, qty, staffId, reason, minQty, maxQty } = body as {
      action: 'take' | 'put' | 'set' | 'count';
      sku?: string;
      qty?: number;
      staffId?: number;
      reason?: string;
      minQty?: number;
      maxQty?: number;
    };

    if (!sku?.trim()) {
      return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
    }

    if (action === 'take' && typeof qty === 'number' && qty > 0) {
      const result = await adjustBinQty({
        locationId: loc.id,
        sku: sku.trim(),
        delta: -qty,
        staffId,
        reason: reason || 'TAKEN',
      });
      return NextResponse.json({
        success: true,
        binQty: result.binContent.qty,
        totalStock: result.newStockQty,
      });
    }

    if (action === 'put' && typeof qty === 'number' && qty > 0) {
      const result = await adjustBinQty({
        locationId: loc.id,
        sku: sku.trim(),
        delta: qty,
        staffId,
        reason: reason || 'RECEIVED',
      });
      return NextResponse.json({
        success: true,
        binQty: result.binContent.qty,
        totalStock: result.newStockQty,
      });
    }

    if (action === 'set' && typeof qty === 'number') {
      const result = await upsertBinContent({
        locationId: loc.id,
        sku: sku.trim(),
        qty,
        minQty: minQty ?? null,
        maxQty: maxQty ?? null,
      });
      return NextResponse.json({ success: true, binContent: result });
    }

    if (action === 'count') {
      await markBinCounted(loc.id, sku.trim());
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('[PATCH /api/locations/[barcode]] error:', err);
    return NextResponse.json(
      { error: 'Failed to update bin', details: err?.message },
      { status: 500 },
    );
  }
}
