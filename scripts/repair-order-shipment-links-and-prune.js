require('dotenv').config({ path: '.env', quiet: true });
const { Client } = require('pg');

const TARGET_CREATED_AT = "2026-02-09 13:30:07.037944";

function normalizeSql(expr) {
  return `regexp_replace(upper(coalesce(${expr}, '')), '[^A-Z0-9]', '', 'g')`;
}

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
      ordersMissingShipment: await queryValue(
        client,
        `select count(*)::int as n
         from orders
         where shipment_id is null
           and coalesce(btrim(shipping_tracking_number), '') <> ''`
      ),
      packerLogsMissingShipment: await queryValue(
        client,
        `select count(*)::int as n
         from packer_logs
         where shipment_id is null
           and tracking_type = 'ORDERS'`
      ),
      targetOrdersUnmatchedPacker: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         where o.created_at = $1::timestamp
           and not exists (
             select 1
             from packer_logs pl
             where pl.shipment_id = o.shipment_id
           )`,
        [TARGET_CREATED_AT]
      ),
      pendingRuleCount: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         left join shipping_tracking_numbers stn on stn.id = o.shipment_id
         where coalesce(btrim(o.shipping_tracking_number), '') <> ''
           and not coalesce(
             stn.is_carrier_accepted or stn.is_in_transit
             or stn.is_out_for_delivery or stn.is_delivered,
             false
           )
           and not exists (
             select 1
             from packer_logs pl
             where pl.shipment_id = o.shipment_id
           )`
      ),
    };

    const ordersBackfill = await client.query(
      `with matched as (
         select o.id, stn.id as shipment_id
         from orders o
         join shipping_tracking_numbers stn
           on ${normalizeSql('stn.tracking_number_normalized')} = ${normalizeSql('o.shipping_tracking_number')}
         where o.shipment_id is null
           and coalesce(btrim(o.shipping_tracking_number), '') <> ''
       )
       update orders o
       set shipment_id = matched.shipment_id
       from matched
       where o.id = matched.id
       returning o.id`,
    );

    const packerLogsBackfill = await client.query(
      `with matched as (
         select pl.id, stn.id as shipment_id
         from packer_logs pl
         join shipping_tracking_numbers stn
           on ${normalizeSql('stn.tracking_number_normalized')} = ${normalizeSql('pl.scan_ref')}
         where pl.shipment_id is null
           and pl.tracking_type = 'ORDERS'
           and coalesce(btrim(pl.scan_ref), '') <> ''
       )
       update packer_logs pl
       set shipment_id = matched.shipment_id
       from matched
       where pl.id = matched.id
       returning pl.id`,
    );

    const deletePreview = await client.query(
      `select o.id, o.order_id, o.shipment_id, o.shipping_tracking_number
       from orders o
       where o.created_at = $1::timestamp
         and not exists (
           select 1
           from packer_logs pl
           where pl.shipment_id = o.shipment_id
         )
       order by o.id asc`,
      [TARGET_CREATED_AT]
    );

    const deletedOrders = await client.query(
      `delete from orders o
       where o.created_at = $1::timestamp
         and not exists (
           select 1
           from packer_logs pl
           where pl.shipment_id = o.shipment_id
         )
       returning o.id, o.order_id, o.shipment_id`,
      [TARGET_CREATED_AT]
    );

    const after = {
      ordersMissingShipment: await queryValue(
        client,
        `select count(*)::int as n
         from orders
         where shipment_id is null
           and coalesce(btrim(shipping_tracking_number), '') <> ''`
      ),
      packerLogsMissingShipment: await queryValue(
        client,
        `select count(*)::int as n
         from packer_logs
         where shipment_id is null
           and tracking_type = 'ORDERS'`
      ),
      targetOrdersUnmatchedPacker: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         where o.created_at = $1::timestamp
           and not exists (
             select 1
             from packer_logs pl
             where pl.shipment_id = o.shipment_id
           )`,
        [TARGET_CREATED_AT]
      ),
      pendingRuleCount: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         left join shipping_tracking_numbers stn on stn.id = o.shipment_id
         where coalesce(btrim(o.shipping_tracking_number), '') <> ''
           and not coalesce(
             stn.is_carrier_accepted or stn.is_in_transit
             or stn.is_out_for_delivery or stn.is_delivered,
             false
           )
           and not exists (
             select 1
             from packer_logs pl
             where pl.shipment_id = o.shipment_id
           )`
      ),
      brokenOrderShipmentRefs: await queryValue(
        client,
        `select count(*)::int as n
         from orders o
         left join shipping_tracking_numbers stn on stn.id = o.shipment_id
         where o.shipment_id is not null
           and stn.id is null`
      ),
      brokenPackerShipmentRefs: await queryValue(
        client,
        `select count(*)::int as n
         from packer_logs pl
         left join shipping_tracking_numbers stn on stn.id = pl.shipment_id
         where pl.shipment_id is not null
           and stn.id is null`
      ),
    };

    await client.query('COMMIT');

    console.log(JSON.stringify({
      targetCreatedAt: TARGET_CREATED_AT,
      before,
      backfill: {
        ordersUpdated: ordersBackfill.rowCount,
        packerLogsUpdated: packerLogsBackfill.rowCount,
      },
      deleted: {
        count: deletedOrders.rowCount,
        preview: deletePreview.rows,
      },
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
