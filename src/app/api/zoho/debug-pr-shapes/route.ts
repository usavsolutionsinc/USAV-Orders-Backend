import { NextRequest, NextResponse } from 'next/server';
import { zohoPost } from '@/lib/zoho/httpClient';

export const dynamic = 'force-dynamic';

/**
 * Debug-only: POST several payload variants to /api/v1/purchasereceives and
 * report which one Zoho accepts. Body:
 * {
 *   purchaseorder_id: string,
 *   line_item_id: string,
 *   item_id: string,
 *   bill_id: string,
 *   receive_number?: string,
 *   serial_number?: string
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const purchaseorder_id = String(body?.purchaseorder_id || '').trim();
  const line_item_id = String(body?.line_item_id || '').trim();
  const item_id = String(body?.item_id || '').trim();
  const bill_id = String(body?.bill_id || '').trim();
  const receive_number_base = String(body?.receive_number || '').trim() || `PR-PROBE-${Date.now()}`;
  const date = String(body?.date || '').trim() || new Date().toISOString().slice(0, 10);
  const serial = String(body?.serial_number || '').trim();

  const query = { purchaseorder_id };

  const variants: Array<{ label: string; body: Record<string, unknown> }> = [
    {
      label: 'A_billed_quantity_received',
      body: {
        purchaseorder_id,
        receive_number: `${receive_number_base}-A`,
        date,
        purchaseorder_bills: [
          {
            bill_id,
            line_items: [{ line_item_id, item_id, quantity_received: 1 }],
          },
        ],
      },
    },
    {
      label: 'B_billed_quantity_with_serial',
      body: {
        purchaseorder_id,
        receive_number: `${receive_number_base}-B`,
        date,
        purchaseorder_bills: [
          {
            bill_id,
            line_items: [
              {
                line_item_id,
                item_id,
                quantity: 1,
                ...(serial ? { serial_numbers: [serial] } : {}),
              },
            ],
          },
        ],
      },
    },
    {
      label: 'C_root_line_items_bill_id_per_line',
      body: {
        receive_number: `${receive_number_base}-C`,
        date,
        line_items: [
          {
            line_item_id,
            item_id,
            quantity: 1,
            bill_id,
            ...(serial ? { serial_numbers: [serial] } : {}),
          },
        ],
      },
    },
    {
      label: 'D_root_line_items_with_serial_no_bill',
      body: {
        receive_number: `${receive_number_base}-D`,
        date,
        line_items: [
          {
            line_item_id,
            item_id,
            quantity: 1,
            ...(serial ? { serial_numbers: [serial] } : {}),
          },
        ],
      },
    },
  ];

  const results = [];
  for (const v of variants) {
    try {
      const resp = await zohoPost<Record<string, unknown>>('/api/v1/purchasereceives', v.body, query);
      results.push({
        label: v.label,
        ok: true,
        receive_id:
          (resp?.purchasereceive as { receive_id?: string; purchase_receive_id?: string } | undefined)
            ?.receive_id ??
          (resp?.purchasereceive as { receive_id?: string; purchase_receive_id?: string } | undefined)
            ?.purchase_receive_id ??
          null,
        sent: v.body,
      });
      break;
    } catch (err) {
      results.push({
        label: v.label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        sent: v.body,
      });
    }
  }

  return NextResponse.json({ ok: results.some((r) => r.ok), results });
}
