import { NextRequest, NextResponse } from 'next/server';
import { getSquareTransactionById } from '@/lib/neon/square-transaction-queries';
import pool from '@/lib/db';

function fmt(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Try to find a pickup signature from the documents table. */
async function findPickupSignature(squareOrderId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT data FROM documents
       WHERE entity_type = 'WALK_IN_ORDER'
         AND data->>'type' = 'pickup_signature'
         AND data->>'square_order_id' = $1
       ORDER BY created_at DESC LIMIT 1`,
      [squareOrderId],
    );
    const row = result.rows[0];
    return row?.data?.signature_data_url || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/walk-in/receipt/[id] — Printable sales receipt (Repair Service HTML style).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sale = await getSquareTransactionById(id);
    if (!sale) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const lineItems = Array.isArray(sale.line_items) ? sale.line_items : [];
    const hasDiscount = (sale.discount ?? 0) > 0;
    const hasAnySku = lineItems.some((li) => li.sku);
    const signatureDataUrl = await findPickupSignature(sale.square_order_id);

    const dateStr = sale.created_at
      ? new Date(sale.created_at).toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
        })
      : '____/____/____';

    // Column count for empty rows
    const colCount = 3 + (hasAnySku ? 1 : 0) + (hasDiscount ? 1 : 0);

    const itemRows = lineItems
      .map((item) => {
        const qty = item.quantity || '1';
        const price = item.price || 0;
        const lineTotal = (Number(qty) || 1) * price;
        return `
        <tr>
          <td class="cell">${qty}</td>
          <td class="cell">${esc(item.name || 'Item')}</td>
          ${hasAnySku ? `<td class="cell mono">${esc(item.sku || '')}</td>` : ''}
          <td class="cell r">${fmt(price)}</td>
          ${hasDiscount ? '<td class="cell r">\u2014</td>' : ''}
          <td class="cell r b">${fmt(lineTotal)}</td>
        </tr>`;
      })
      .join('');

    const emptyRows = Array.from({ length: Math.max(0, 3 - lineItems.length) })
      .map(() => `<tr>${'<td class="cell">&nbsp;</td>'.repeat(colCount)}</tr>`)
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sales Receipt \u2014 ${esc(sale.square_order_id)}</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    @page { size: 8.5in 11in; margin: 0.75in; }
    @media print { body { margin: 0; } .no-print { display: none !important; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      width: 8.5in; min-height: 11in;
      margin: 0 auto; padding: 0.6in 0.75in;
      color: #000; font-size: 14px; line-height: 1.4;
    }

    h1 { font-size: 22px; font-weight: 600; margin-bottom: 16px; }

    /* Underlined field row */
    .field-row { margin-bottom: 12px; font-size: 14px; }
    .field-label { font-weight: 600; }
    .field-value {
      display: inline-block; min-width: 250px;
      border-bottom: 1px solid #000;
      margin-left: 8px; padding: 0 4px 2px;
    }

    /* Spacer */
    .sp { height: 12px; }

    /* Items table */
    .items { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .items th {
      background: #000; color: #fff;
      font-size: 11px; font-weight: 400;
      padding: 5px 6px; text-align: left;
    }
    .items th.r { text-align: right; }
    .cell { padding: 5px 6px; border-bottom: 1px solid #ddd; font-size: 14px; vertical-align: top; }
    .cell.r { text-align: right; }
    .cell.b { font-weight: 700; }
    .cell.mono { font-family: 'Courier New', monospace; font-size: 11px; color: #555; }

    /* Totals */
    .totals { margin-left: auto; margin-top: 8px; border-collapse: collapse; }
    .totals td { padding: 3px 8px; font-size: 14px; }
    .totals .lbl { text-align: left; }
    .totals .val { text-align: right; min-width: 80px; }
    .totals .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #000; padding-top: 8px; }
    .totals .disc td { color: #dc2626; }

    /* Sections */
    .info { font-size: 14px; margin-top: 16px; }
    .info-line { margin-bottom: 2px; }
    .note { font-size: 12px; line-height: 1.45; margin-top: 12px; }
    .note-bold { font-weight: 700; }
    .sig-section { margin-top: 24px; font-size: 14px; }
    .sig-line { border-bottom: 1px solid #000; display: inline-block; width: 260px; vertical-align: middle; margin-left: 8px; min-height: 20px; }
    .sig-img { height: 48px; vertical-align: middle; margin-left: 8px; }
    .footer-co { margin-top: 32px; font-size: 14px; font-weight: 700; line-height: 1.5; }
    .barcode-wrap { text-align: center; margin-top: 16px; }
    .barcode-wrap svg { max-width: 200px; }
  </style>
</head>
<body>
  <!-- Title -->
  <h1>Sales Receipt</h1>

  <!-- Order ID -->
  <div class="field-row">
    <span class="field-label">Order #:</span>
    <span class="field-value">${esc(sale.square_order_id)}</span>
  </div>

  <div class="sp"></div>

  <!-- Customer -->
  <div class="field-row">
    <span class="field-label">Name:</span>
    <span class="field-value">${esc(sale.customer_name || '')}</span>
  </div>
  <div class="field-row">
    <span class="field-label">Phone:</span>
    <span class="field-value">${esc(sale.customer_phone || '')}</span>
  </div>
  <div class="field-row">
    <span class="field-label">Email:</span>
    <span class="field-value">${esc(sale.customer_email || '')}</span>
  </div>

  <div class="sp"></div>

  <!-- Line Items -->
  <table class="items">
    <thead>
      <tr>
        <th style="width:32px;">Qty</th>
        <th>Description</th>
        ${hasAnySku ? '<th style="width:75px;">SKU</th>' : ''}
        <th class="r" style="width:60px;">Price</th>
        ${hasDiscount ? '<th class="r" style="width:65px;">Discount</th>' : ''}
        <th class="r" style="width:80px;">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      ${emptyRows}
    </tbody>
  </table>

  <!-- Totals -->
  <table class="totals">
    <tr>
      <td class="lbl">Subtotal</td>
      <td class="val">${fmt(sale.subtotal)}</td>
    </tr>
    ${hasDiscount ? `
    <tr class="disc">
      <td class="lbl">Discount</td>
      <td class="val">-${fmt(sale.discount)}</td>
    </tr>` : ''}
    <tr>
      <td class="lbl">Tax</td>
      <td class="val">${fmt(sale.tax)}</td>
    </tr>
    <tr class="total-row">
      <td class="lbl">Total</td>
      <td class="val">${fmt(sale.total)}</td>
    </tr>
  </table>

  <div class="sp"></div>

  <!-- Payment -->
  <div class="field-row">
    <span class="field-value" style="min-width: 250px;">${esc(sale.payment_method || 'Card')}</span>
    <span> - Payment Method</span>
  </div>

  <!-- Info text -->
  <div class="note">
    <p>Thank you for your business.</p>
    <p class="note-bold" style="margin-top: 8px;">There is a 30 day Warranty on all our sales orders.</p>
  </div>

  <div class="sp"></div>

  <!-- Pick Up Signature -->
  <div class="sig-section">
    Pick Up X
    ${signatureDataUrl
      ? `<img class="sig-img" src="${signatureDataUrl}" alt="Signature" />`
      : '<span class="sig-line"></span>'
    }
    <span style="margin-left: 16px;">Date: </span>
    <span class="field-value" style="min-width: 160px;">${dateStr}</span>
  </div>

  <div class="note" style="margin-top: 8px;">
    <p>By signing above you acknowledge receipt of the purchased items.</p>
  </div>

  <!-- Barcode -->
  <div class="barcode-wrap">
    <svg id="barcode"></svg>
  </div>

  <!-- Company Footer -->
  <div class="footer-co">
    USAV Solutions<br>
    16161 Gothard St. Suite A<br>
    Huntington Beach, CA 92647, United States<br>
    Tel: (714) 596-6888<br>
    Email: info@usavsolutions.com
  </div>

  <script>
    try {
      JsBarcode("#barcode", "${esc(sale.square_order_id.slice(0, 20))}", {
        format: "CODE128", width: 1.5, height: 40, displayValue: false, margin: 0,
      });
    } catch(e) {}
    window.onload = function() { window.print(); };
  <\/script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error: unknown) {
    console.error('GET /api/walk-in/receipt error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
