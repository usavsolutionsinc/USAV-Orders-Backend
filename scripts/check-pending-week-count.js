require('dotenv').config({ path: '.env', quiet: true });
const { Client } = require('pg');

async function main() {
  const weekStart = process.argv[2] || '2026-03-09';
  const weekEnd = process.argv[3] || '2026-03-13';

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const sql = `
    select count(*)::int as n
    from orders o
    left join shipping_tracking_numbers stn on stn.id = o.shipment_id
    left join lateral (
      select wa.deadline_at
      from work_assignments wa
      where wa.entity_type = 'ORDER'
        and wa.entity_id = o.id
        and wa.work_type = 'TEST'
      order by
        case wa.status
          when 'IN_PROGRESS' then 1
          when 'ASSIGNED' then 2
          when 'OPEN' then 3
          when 'DONE' then 4
          else 5
        end,
        wa.updated_at desc,
        wa.id desc
      limit 1
    ) wa_deadline on true
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
      and o.shipment_id is not null
      and coalesce(wa_deadline.deadline_at::date, o.created_at::date) >= $1::date
      and coalesce(wa_deadline.deadline_at::date, o.created_at::date) <= $2::date
  `;

  const result = await client.query(sql, [weekStart, weekEnd]);
  console.log(JSON.stringify({ weekStart, weekEnd, pendingCount: result.rows[0]?.n ?? null }, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
