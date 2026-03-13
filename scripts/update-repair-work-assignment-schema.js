const path = require('path');
require('dotenv').config({ path: path.resolve('.env'), quiet: true });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE work_assignments
        ADD COLUMN IF NOT EXISTS completed_by_tech_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS out_of_stock TEXT,
        ADD COLUMN IF NOT EXISTS repair_outcome TEXT
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_work_assignments_completed_by_tech_id
        ON work_assignments(completed_by_tech_id)
        WHERE completed_by_tech_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wa_repair_out_of_stock
        ON work_assignments (entity_type, work_type, out_of_stock)
        WHERE out_of_stock IS NOT NULL
    `);

    await client.query(`
      ALTER TABLE repair_service
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    `);

    const hasDateTime = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'repair_service'
        AND column_name = 'date_time'
      LIMIT 1
    `);

    if (hasDateTime.rowCount) {
      await client.query(`
        WITH normalized AS (
          SELECT
            id,
            NULLIF(
              TRIM(BOTH '"' FROM COALESCE(
                CASE
                  WHEN date_time IS NULL THEN NULL
                  WHEN json_typeof(date_time) = 'object' THEN COALESCE(
                    date_time->>'start',
                    date_time->>'submittedAt',
                    date_time->>'createdAt',
                    date_time->>'repaired',
                    date_time->>'done'
                  )
                  ELSE date_time::text
                END,
                ''
              )),
              ''
            ) AS raw_created_at
          FROM repair_service
        ),
        backfilled AS (
          SELECT
            id,
            CASE
              WHEN raw_created_at IS NULL THEN NOW()
              WHEN raw_created_at ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN raw_created_at::timestamptz
              WHEN raw_created_at ~ '^\\d{4}-\\d{2}-\\d{2} ' THEN (raw_created_at::timestamp AT TIME ZONE 'UTC')
              WHEN raw_created_at ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (raw_created_at::date::timestamp AT TIME ZONE 'UTC')
              WHEN raw_created_at ~ '^\\d{1,2}/\\d{1,2}/\\d{4},' THEN to_timestamp(raw_created_at, 'MM/DD/YYYY, HH24:MI:SS') AT TIME ZONE 'UTC'
              WHEN raw_created_at ~ '^\\d{1,2}/\\d{1,2}/\\d{4} ' THEN to_timestamp(raw_created_at, 'MM/DD/YYYY HH24:MI:SS') AT TIME ZONE 'UTC'
              WHEN raw_created_at ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN to_timestamp(raw_created_at, 'MM/DD/YYYY') AT TIME ZONE 'UTC'
              ELSE NOW()
            END AS parsed_created_at
          FROM normalized
        )
        UPDATE repair_service rs
        SET
          created_at = COALESCE(rs.created_at, b.parsed_created_at),
          updated_at = COALESCE(rs.updated_at, rs.created_at, b.parsed_created_at)
        FROM backfilled b
        WHERE rs.id = b.id
      `);
    }

    await client.query(`
      UPDATE repair_service
      SET
        created_at = COALESCE(created_at, NOW()),
        updated_at = COALESCE(updated_at, created_at, NOW())
    `);

    await client.query(`
      ALTER TABLE repair_service
        ALTER COLUMN created_at SET DEFAULT NOW(),
        ALTER COLUMN updated_at SET DEFAULT NOW(),
        ALTER COLUMN created_at SET NOT NULL,
        ALTER COLUMN updated_at SET NOT NULL
    `);

    await client.query(`
      ALTER TABLE repair_service
        DROP COLUMN IF EXISTS status_history,
        DROP COLUMN IF EXISTS process,
        DROP COLUMN IF EXISTS date_time,
        DROP COLUMN IF EXISTS repaired_by
    `);

    await client.query('COMMIT');
    console.log('Schema update applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
