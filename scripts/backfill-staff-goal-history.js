#!/usr/bin/env node

const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.resolve('.env'), quiet: true });
require('dotenv').config({ path: path.resolve('.env.local'), quiet: true, override: false });

const ACTIVITY_TYPES = [
  'TRACKING_SCANNED',
  'FNSKU_SCANNED',
  'PACK_SCAN',
  'PACK_COMPLETED',
  'FBA_READY',
];

function getPacificDateStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to derive Pacific date stamp');
  }

  return `${year}-${month}-${day}`;
}

function parseLoggedDate() {
  const idx = process.argv.indexOf('--date');
  const loggedDate = idx >= 0 ? String(process.argv[idx + 1] || '').trim() : getPacificDateStamp();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(loggedDate)) {
    throw new Error('Use --date YYYY-MM-DD');
  }

  return loggedDate;
}

async function main() {
  const loggedDate = parseLoggedDate();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const result = await client.query(
      `
        WITH derived_station AS (
          SELECT id,
            CASE
              WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
              WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
              WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
              ELSE 'TECH'
            END AS default_station
          FROM staff
        ),
        goal_rows AS (
          SELECT
            s.id AS staff_id,
            COALESCE(sg.station, ds.default_station) AS station,
            COALESCE(sg.daily_goal, 50)::int AS goal
          FROM staff s
          JOIN derived_station ds ON ds.id = s.id
          LEFT JOIN staff_goals sg ON sg.staff_id = s.id
          WHERE s.active = true
        ),
        actual_counts AS (
          SELECT
            sal.staff_id,
            sal.station,
            COUNT(DISTINCT COALESCE(sal.shipment_id::text, sal.scan_ref, sal.id::text))::int AS actual
          FROM station_activity_logs sal
          WHERE sal.staff_id IS NOT NULL
            AND sal.activity_type = ANY($2::text[])
            AND (timezone('America/Los_Angeles', sal.created_at))::date = $1::date
          GROUP BY sal.staff_id, sal.station
        )
        INSERT INTO staff_goal_history (staff_id, station, goal, actual, logged_date)
        SELECT
          gr.staff_id,
          gr.station,
          gr.goal,
          COALESCE(ac.actual, 0)::int AS actual,
          $1::date AS logged_date
        FROM goal_rows gr
        LEFT JOIN actual_counts ac
          ON ac.staff_id = gr.staff_id
         AND ac.station = gr.station
        ON CONFLICT (staff_id, station, logged_date)
        DO UPDATE SET
          goal = EXCLUDED.goal,
          actual = EXCLUDED.actual
        RETURNING staff_id, station, goal, actual, logged_date::text AS logged_date
      `,
      [loggedDate, ACTIVITY_TYPES],
    );

    const summary = await client.query(
      `
        SELECT
          logged_date::text AS logged_date,
          COUNT(*)::int AS row_count,
          COUNT(DISTINCT staff_id)::int AS staff_count,
          MIN(actual)::int AS min_actual,
          MAX(actual)::int AS max_actual
        FROM staff_goal_history
        WHERE logged_date = $1::date
        GROUP BY logged_date
      `,
      [loggedDate],
    );

    console.log(JSON.stringify({
      ok: true,
      loggedDate,
      upsertedRows: result.rows.length,
      summary: summary.rows[0] || null,
      sample: result.rows.slice(0, 5),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
