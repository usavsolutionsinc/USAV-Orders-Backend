import type { ZohoPurchaseOrder, ZohoPurchaseReceive } from './index';

const MOCK_PO_ID = 'MOCK-PO-8001';

const MOCK_TRACKINGS = new Set([
  'MOCK-TRK-PO',
  '870568737370',
]);

function buildMockPO(): ZohoPurchaseOrder {
  return {
    purchaseorder_id: MOCK_PO_ID,
    purchaseorder_number: 'PO-MOCK-001',
    vendor_id: 'MOCK-VENDOR',
    vendor_name: 'Mock Supplier Inc.',
    status: 'partially_received',
    date: '2026-04-12',
    reference_number: '870568737370',
    line_items: [
      {
        line_item_id: 'MOCK-LINE-1',
        item_id: 'MOCK-ITEM-1',
        name: 'Bose SoundLink Mini II Bluetooth Speaker',
        sku: 'BOSE-SLM2-BK',
        quantity: 2,
        quantity_received: 0,
        rate: 199,
      },
      {
        line_item_id: 'MOCK-LINE-2',
        item_id: 'MOCK-ITEM-2',
        name: 'Apple AirPods Pro (2nd Generation)',
        sku: 'APPL-APP2-WH',
        quantity: 3,
        quantity_received: 0,
        rate: 249,
      },
    ],
  };
}

export async function getMockPurchaseOrdersByTracking(
  tracking: string,
): Promise<ZohoPurchaseOrder[]> {
  if (!MOCK_TRACKINGS.has(tracking)) return [];
  return [buildMockPO()];
}

export async function getMockReceivesByTracking(
  _tracking: string,
): Promise<ZohoPurchaseReceive[]> {
  return [];
}
