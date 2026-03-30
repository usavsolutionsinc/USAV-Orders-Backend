/**
 * Staff Goals v2: Add station column + create goal history table
 *
 * Usage: node scripts/migrate-staff-goals-v2.mjs
 * Requires DATABASE_URL in .env (repo root).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env and retry.');
  process.exit(1);
}

const sqlPath = path.resolve(
  __dirname,
  '../src/lib/migrations/2026-03-30_staff_goals_v2.sql',
);
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Running migration:', sqlPath);
    console.log('');

    // Pre-migration: check current state
    const goalsBefore = await client.query('SELECT COUNT(*) AS cnt FROM staff_goals');
    console.log(`staff_goals rows before: ${goalsBefore.rows[0].cnt}`);

    const stationColExists = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_goals' AND column_name = 'station'`
    );
    console.log(`staff_goals.station column exists: ${stationColExists.rows.length > 0}`);

    const historyExists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'staff_goal_history'`
    );
    console.log(`staff_goal_history table exists: ${historyExists.rows.length > 0}`);
    console.log('');

    // Run migration
    console.log('Executing migration SQL...');
    await client.query(sql);
    console.log('Migration completed successfully.');
    console.log('');

    // Post-migration: verify
    const goalsAfter = await client.query(
      'SELECT id, staff_id, station, daily_goal FROM staff_goals ORDER BY staff_id, station'
    );
    console.log(`staff_goals rows after: ${goalsAfter.rows.length}`);
    for (const row of goalsAfter.rows) {
      console.log(`  staff_id=${row.staff_id} station=${row.station} goal=${row.daily_goal}`);
    }

    const historyAfter = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'staff_goal_history'`
    );
    console.log(`\nstaff_goal_history table exists: ${historyAfter.rows.length > 0}`);

    // Verify unique constraint
    const constraints = await client.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'staff_goals' AND constraint_type = 'UNIQUE'`
    );
    console.log('Unique constraints on staff_goals:');
    for (const row of constraints.rows) {
      console.log(`  ${row.constraint_name}`);
    }

    // Quick endpoint sanity: count SAL rows for today
    const salToday = await client.query(
      `SELECT station, COUNT(*)::int AS cnt
       FROM station_activity_logs
       WHERE staff_id IS NOT NULL
         AND (timezone('America/Los_Angeles', created_at))::date
           = (timezone('America/Los_Angeles', now()))::date
       GROUP BY station
       ORDER BY station`
    );
    console.log('\nSAL counts today by station:');
    for (const row of salToday.rows) {
      console.log(`  ${row.station}: ${row.cnt}`);
    }

    // Verify the full goals query works (same as GET /api/staff-goals)
    const fullQuery = await client.query(`
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
      today_counts AS (
        SELECT staff_id, station, COUNT(*)::int AS today_count
        FROM station_activity_logs
        WHERE staff_id IS NOT NULL
          AND (timezone('America/Los_Angeles', created_at))::date
            = (timezone('America/Los_Angeles', now()))::date
        GROUP BY staff_id, station
      ),
      week_counts AS (
        SELECT staff_id, station, COUNT(*)::int AS week_count
        FROM station_activity_logs
        WHERE staff_id IS NOT NULL
          AND (timezone('America/Los_Angeles', created_at))::date
            >= (timezone('America/Los_Angeles', now()))::date - INTERVAL '6 days'
        GROUP BY staff_id, station
      )
      SELECT
        s.id AS staff_id,
        s.name,
        s.role,
        s.employee_id,
        COALESCE(sg.station, ds.default_station) AS station,
        COALESCE(sg.daily_goal, 50) AS daily_goal,
        COALESCE(tc.today_count, 0) AS today_count,
        COALESCE(wc.week_count, 0) AS week_count,
        ROUND(COALESCE(wc.week_count, 0)::numeric / 7.0, 2) AS avg_daily_last_7d
      FROM staff s
      JOIN derived_station ds ON ds.id = s.id
      LEFT JOIN staff_goals sg ON sg.staff_id = s.id
      LEFT JOIN today_counts tc ON tc.staff_id = s.id AND tc.station = COALESCE(sg.station, ds.default_station)
      LEFT JOIN week_counts wc ON wc.staff_id = s.id AND wc.station = COALESCE(sg.station, ds.default_station)
      WHERE s.active = true
      ORDER BY s.name ASC
    `);
    console.log('\nFull goals query (simulates GET /api/staff-goals):');
    console.log(`  Returned ${fullQuery.rows.length} rows`);
    for (const row of fullQuery.rows) {
      console.log(`  ${row.name} [${row.employee_id}] station=${row.station} goal=${row.daily_goal} today=${row.today_count} week=${row.week_count}`);
    }

    console.log('\nAll checks passed.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
