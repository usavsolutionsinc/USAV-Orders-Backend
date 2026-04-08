/**
 * Adapter: fetches recent Ecwid orders from the API and returns them as
 * SourceRow[] arrays matching the Google Sheet column layout so they can be
 * injected directly into the existing transfer-orders pipeline.
 */

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const PAGE_LIMIT = 100;
const LOOKBACK_DAYS = 7;

function requiredEnv(primary: string, aliases: string[] = []): string {
  for (const key of [primary, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primary}`);
}

function isRepairServiceSku(value: unknown): boolean {
  return String(value || '').trim().toUpperCase().endsWith('-RS');
}

type ColIndices = {
  shipByDate: number;
  orderNumber: number;
  itemNumber: number;
  itemTitle: number;
  quantity: number;
  usavSku: number;
  condition: number;
  tracking: number;
  note: number;
  platform: number;
};

async function fetchRecentEcwidOrders(
  storeId: string,
  token: string,
): Promise<any[]> {
  const createdFrom = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const orders: any[] = [];
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/orders`);
    url.searchParams.set('createdFrom', createdFrom);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(PAGE_LIMIT));

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ecwid orders API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { items?: any[] };
    const items = Array.isArray(data.items) ? data.items : [];
    orders.push(...items);

    if (items.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return orders;
}

/**
 * Fetch recent Ecwid orders and return them as row arrays whose values are
 * placed at the column indices the transfer-orders job expects (matching the
 * Google Sheet layout). Each line item in an Ecwid order becomes its own row.
 */
export async function fetchEcwidTransferRows(
  colIndices: ColIndices,
): Promise<any[][]> {
  const storeId = requiredEnv('ECWID_STORE_ID', [
    'ECWID_STOREID',
    'ECWID_STORE',
    'NEXT_PUBLIC_ECWID_STORE_ID',
  ]);
  const token = requiredEnv('ECWID_API_TOKEN', [
    'ECWID_TOKEN',
    'ECWID_ACCESS_TOKEN',
    'NEXT_PUBLIC_ECWID_API_TOKEN',
  ]);

  const ecwidOrders = await fetchRecentEcwidOrders(storeId, token);
  const rows: any[][] = [];

  for (const order of ecwidOrders) {
    const orderId = String(order?.orderNumber ?? order?.id ?? '').trim();
    if (!orderId) continue;

    const tracking = String(
      order?.trackingNumber ??
      order?.shippingTrackingNumber ??
      order?.shippingInfo?.trackingNumber ??
      '',
    ).trim();

    const orderDate = order?.createDate ?? order?.created ?? order?.date ?? '';
    const notes = String(order?.customerComments || order?.orderComments || '').trim();

    const items = Array.isArray(order?.items) && order.items.length > 0
      ? order.items
      : [{}];

    for (const item of items) {
      const sku = String(item?.sku || '').trim();
      if (isRepairServiceSku(sku)) continue;

      const productTitle = String(item?.name || '').trim();
      const quantity = item?.quantity ? String(item.quantity).trim() : '1';

      // Build a row array with values at the correct column positions
      const maxCol = Math.max(...Object.values(colIndices)) + 1;
      const row: any[] = new Array(maxCol).fill('');

      row[colIndices.orderNumber] = orderId;
      row[colIndices.itemNumber] = sku;
      row[colIndices.itemTitle] = productTitle;
      row[colIndices.quantity] = quantity;
      row[colIndices.usavSku] = sku;
      row[colIndices.condition] = '';
      row[colIndices.tracking] = tracking;
      row[colIndices.shipByDate] = orderDate;
      row[colIndices.note] = notes;
      row[colIndices.platform] = 'ecwid';

      rows.push(row);
    }
  }

  return rows;
}
