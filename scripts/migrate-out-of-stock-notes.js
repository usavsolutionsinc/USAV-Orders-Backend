const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve('.env'), quiet: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  options: '-c timezone=America/Los_Angeles',
});

function cleanText(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const migrated = [];
  const skipped = [];
  const client = await pool.connect();

  try {
    const orders = await client.query(`
      SELECT o.id, o.order_id, o.product_title, o.sku, o.quantity, o.out_of_stock,
             i.id AS item_id, i.zoho_item_id, i.name AS item_name, i.purchase_rate,
             i.quantity_available, i.quantity_on_hand, i.custom_fields
      FROM orders o
      LEFT JOIN items i ON i.sku = o.sku
      WHERE COALESCE(BTRIM(o.out_of_stock), '') <> ''
      ORDER BY o.created_at ASC, o.id ASC
    `);

    for (const order of orders.rows) {
      if (!order.item_id || !order.zoho_item_id) {
        skipped.push({ orderId: order.id, reason: 'item_not_linked' });
        continue;
      }

      await client.query('BEGIN');
      try {
        const existing = await client.query(
          `SELECT id
           FROM replenishment_requests
           WHERE zoho_item_id = $1
             AND status NOT IN ('fulfilled', 'cancelled')
           ORDER BY created_at DESC
           LIMIT 1`,
          [order.zoho_item_id]
        );

        let requestId = existing.rows[0]?.id || null;
        const qty = Math.max(1, toNumber(order.quantity, 1));

        if (!requestId) {
          const customFields = (order.custom_fields && typeof order.custom_fields === 'object') ? order.custom_fields : {};
          const vendorZohoContactId = cleanText(
            customFields.default_vendor_zoho_id ||
            customFields.vendor_zoho_contact_id ||
            customFields.vendor_id
          );
          const vendorName = cleanText(
            customFields.default_vendor_name ||
            customFields.vendor_name ||
            customFields.vendor
          );

          const inserted = await client.query(
            `INSERT INTO replenishment_requests (
               item_id,
               zoho_item_id,
               sku,
               item_name,
               quantity_needed,
               zoho_quantity_available,
               zoho_quantity_on_hand,
               zoho_incoming_quantity,
               vendor_zoho_contact_id,
               vendor_name,
               unit_cost,
               status,
               notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, 'pending_review', $11)
             RETURNING id`,
            [
              order.item_id,
              order.zoho_item_id,
              cleanText(order.sku),
              cleanText(order.item_name) || cleanText(order.product_title) || 'Unknown item',
              qty,
              toNumber(order.quantity_available, 0),
              toNumber(order.quantity_on_hand, 0),
              vendorZohoContactId,
              vendorName,
              cleanText(order.purchase_rate),
              cleanText(order.out_of_stock),
            ]
          );
          requestId = inserted.rows[0].id;
        }

        await client.query(
          `INSERT INTO replenishment_order_lines (
             replenishment_request_id,
             order_id,
             channel_order_id,
             quantity_needed
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (replenishment_request_id, order_id) DO UPDATE SET
             channel_order_id = EXCLUDED.channel_order_id,
             quantity_needed = EXCLUDED.quantity_needed`,
          [requestId, order.id, cleanText(order.order_id), qty]
        );

        await client.query(
          `UPDATE replenishment_requests rr
           SET quantity_needed = COALESCE((
                 SELECT SUM(rol.quantity_needed)
                 FROM replenishment_order_lines rol
                 WHERE rol.replenishment_request_id = rr.id
               ), 0),
               updated_at = NOW(),
               notes = CASE
                 WHEN $2 IS NULL THEN notes
                 WHEN notes IS NULL OR BTRIM(notes) = '' THEN $2
                 WHEN POSITION($2 IN notes) > 0 THEN notes
                 ELSE notes || E'\n' || $2
               END
           WHERE rr.id = $1`,
          [requestId, cleanText(order.out_of_stock)]
        );

        await client.query(
          `UPDATE orders SET replenishment_request_id = $2 WHERE id = $1`,
          [order.id, requestId]
        );

        await client.query('COMMIT');
        migrated.push(order.id);
      } catch (error) {
        await client.query('ROLLBACK');
        skipped.push({ orderId: order.id, reason: error?.message || String(error) });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(JSON.stringify({ migrated, skipped }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
