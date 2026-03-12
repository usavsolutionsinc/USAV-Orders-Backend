require('dotenv').config({ path: '.env', quiet: true });
const { Client } = require('pg');

const CUTOFF = process.argv[2] || '2026-03-03 17:24:36.8035';

async function queryValue(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0];
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    const before = {
      pendingCount: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         left join shipping_tracking_numbers stn on stn.id = o.shipment_id
         where not coalesce(
           stn.is_carrier_accepted or stn.is_in_transit
           or stn.is_out_for_delivery or stn.is_delivered,
           false
         )
           and not exists (
             select 1
             from packer_logs pl
             where pl.shipment_id is not null
               and pl.shipment_id = o.shipment_id
           )
           and o.shipment_id is not null`
      ),
      targetOrders: await queryValue(
        client,
        `select count(*)::int as n
         from orders
         where created_at <= $1::timestamp
           and shipment_id is not null`,
        [CUTOFF]
      ),
      targetShipmentsUnshipped: await queryValue(
        client,
        `select count(distinct o.shipment_id)::int as n
         from orders o
         left join shipping_tracking_numbers stn on stn.id = o.shipment_id
         where o.created_at <= $1::timestamp
           and o.shipment_id is not null
           and not coalesce(
             stn.is_carrier_accepted or stn.is_in_transit
             or stn.is_out_for_delivery or stn.is_delivered,
             false
           )`,
        [CUTOFF]
      ),
    };

    const updated = await client.query(
      `update shipping_tracking_numbers stn
       set latest_status_category = coalesce(nullif(stn.latest_status_category, ''), 'DELIVERED'),
           is_carrier_accepted = true,
           is_in_transit = true,
           is_out_for_delivery = coalesce(stn.is_out_for_delivery, false),
           is_delivered = true,
           delivered_at = coalesce(stn.delivered_at, now()),
           updated_at = now()
       where stn.id in (
         select distinct o.shipment_id
         from orders o
         where o.created_at <= $1::timestamp
           and o.shipment_id is not null
       )
       returning stn.id`,
      [CUTOFF]
    );

    const after = {
      pendingCount: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         left join shipping_tracking_numbers stn on stn.id = o.shipment_id
         where not coalesce(
           stn.is_carrier_accepted or stn.is_in_transit
           or stn.is_out_for_delivery or stn.is_delivered,
           false
         )
           and not exists (
             select 1
             from packer_logs pl
             where pl.shipment_id is not null
               and pl.shipment_id = o.shipment_id
           )
           and o.shipment_id is not null`
      ),
      targetOrdersStillUnshipped: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         left join shipping_tracking_numbers stn on stn.id = o.shipment_id
         where o.created_at <= $1::timestamp
           and o.shipment_id is not null
           and not coalesce(
             stn.is_carrier_accepted or stn.is_in_transit
             or stn.is_out_for_delivery or stn.is_delivered,
             false
           )`,
        [CUTOFF]
      ),
    };

    await client.query('COMMIT');

    console.log(JSON.stringify({
      cutoff: CUTOFF,
      before,
      updatedShipmentCount: updated.rowCount,
      after,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
