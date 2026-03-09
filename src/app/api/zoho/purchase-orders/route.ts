import { NextRequest, NextResponse } from 'next/server';
import { listPurchaseOrders, getPurchaseOrderById } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

type AnyRecord = Record<string, unknown>;

function readObject(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' ? (value as AnyRecord) : null;
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function normalizeLineItem(raw: unknown) {
  const row = readObject(raw);
  if (!row) return null;

  const item = readObject(row.item);

  const line_item_id = readString(row.line_item_id, row.lineitem_id, row.id);
  const item_id = readString(row.item_id, row.itemId, item?.item_id, item?.id);

  const normalized = {
    line_item_id: line_item_id || item_id || '',
    item_id: item_id || '',
    name: readString(row.name, row.item_name, item?.name),
    description: readString(row.description, row.item_description, item?.description),
    sku: readString(row.sku, row.item_sku, item?.sku),
    quantity: readNumber(row.quantity, row.quantity_ordered, row.qty),
    quantity_received: readNumber(row.quantity_received, row.received_quantity, row.received_qty),
    rate: readNumber(row.rate, row.purchase_rate),
    total: readNumber(row.total, row.item_total, row.line_total),
    unit: readString(row.unit, row.unit_name),
  };

  if (!normalized.line_item_id && !normalized.item_id && !normalized.name) return null;
  return normalized;
}

function normalizePurchaseOrder(raw: unknown) {
  const row = readObject(raw);
  if (!row) return null;

  const vendor = readObject(row.vendor);
  const currency = readObject(row.currency);

  const lineItemsRaw = Array.isArray(row.line_items)
    ? row.line_items
    : Array.isArray(row.items)
      ? row.items
      : [];

  const normalized = {
    purchaseorder_id: readString(row.purchaseorder_id, row.purchase_order_id, row.purchaseOrderId, row.id) || '',
    purchaseorder_number: readString(
      row.purchaseorder_number,
      row.purchase_order_number,
      row.po_number,
      row.reference_number
    ),
    vendor_id: readString(row.vendor_id, row.vendorId, vendor?.vendor_id, vendor?.id),
    vendor_name: readString(row.vendor_name, vendor?.vendor_name, vendor?.name),
    status: readString(row.status)?.toLowerCase(),
    date: readString(row.date, row.purchase_date, row.created_time),
    delivery_date: readString(row.delivery_date, row.expected_delivery_date),
    expected_delivery_date: readString(row.expected_delivery_date, row.delivery_date),
    total: readNumber(row.total, row.grand_total),
    sub_total: readNumber(row.sub_total, row.subtotal),
    currency_code: readString(row.currency_code, currency?.currency_code, currency?.code),
    warehouse_id: readString(row.warehouse_id, row.warehouseId),
    warehouse_name: readString(row.warehouse_name, row.warehouseName),
    notes: readString(row.notes),
    reference_number: readString(row.reference_number),
    line_items: lineItemsRaw.map(normalizeLineItem).filter(Boolean),
  };

  if (!normalized.purchaseorder_id) return null;
  return normalized;
}

/**
 * GET /api/zoho/purchase-orders
 *
 * Supports:
 *  ?purchaseorder_id=  → single PO detail (includes line_items)
 *  ?status=open        → filter by status (draft|open|billed|cancelled)
 *  ?search_text=       → search by PO number, vendor name, reference
 *  ?page=&per_page=    → pagination (max 200)
 *  ?last_modified_time= → ISO date filter for incremental sync
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const purchaseOrderId = (searchParams.get('purchaseorder_id') ?? '').trim();

    if (purchaseOrderId) {
      const data = await getPurchaseOrderById(purchaseOrderId);
      const normalizedPurchaseOrder = normalizePurchaseOrder(
        (data as Record<string, unknown>).purchaseorder
      );
      return NextResponse.json({
        success: true,
        mode: 'detail',
        ...data,
        purchaseorder: normalizedPurchaseOrder,
      });
    }

    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const perPage = Math.min(200, Math.max(1, Number(searchParams.get('per_page') || 50)));
    const status = (searchParams.get('status') ?? '').trim() || undefined;
    const searchText =
      (searchParams.get('search_text') ?? searchParams.get('search') ?? '').trim() || undefined;
    const vendorId = (searchParams.get('vendor_id') ?? '').trim() || undefined;
    const lastModifiedTime = (searchParams.get('last_modified_time') ?? '').trim() || undefined;

    const data = await listPurchaseOrders({
      page,
      per_page: perPage,
      status,
      search_text: searchText,
      vendor_id: vendorId,
      last_modified_time: lastModifiedTime,
    });

    const rawPurchaseOrders =
      ((data as Record<string, unknown>).purchaseorders as unknown[]) ||
      ((data as Record<string, unknown>).purchase_orders as unknown[]) ||
      ((data as Record<string, unknown>).purchaseOrders as unknown[]) ||
      [];
    const purchaseorders = Array.isArray(rawPurchaseOrders)
      ? rawPurchaseOrders
          .map(normalizePurchaseOrder)
          .filter((row): row is NonNullable<ReturnType<typeof normalizePurchaseOrder>> => Boolean(row))
      : [];

    return NextResponse.json({ success: true, mode: 'list', ...data, purchaseorders });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch purchase orders';
    console.error('Zoho purchase orders API failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
