import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * Migration endpoint to change parts_needed to process column
 * Run once: POST /api/migrate-process
 */
export async function POST(req: NextRequest) {
  try {
    console.log('Starting migration: parts_needed -> process');

    // Step 1: Add the new process column as JSON (stored as TEXT)
    await pool.query(`
      ALTER TABLE repair_service 
      ADD COLUMN IF NOT EXISTS process TEXT DEFAULT '[]'
    `);
    console.log('✓ Added process column');

    // Step 2: Add the name column if it doesn't exist
    await pool.query(`
      ALTER TABLE repair_service 
      ADD COLUMN IF NOT EXISTS name TEXT
    `);
    console.log('✓ Added name column');

    // Step 3: Check if parts_needed exists
    const checkColumn = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'repair_service' 
        AND column_name = 'parts_needed'
      ) as exists
    `);

    const partsNeededExists = checkColumn.rows[0].exists;

    if (partsNeededExists) {
      // Migrate existing parts_needed to process format
      const migrateResult = await pool.query(`
        UPDATE repair_service 
        SET process = CASE 
          WHEN parts_needed IS NOT NULL AND parts_needed != '' THEN 
            json_build_array(
              json_build_object(
                'parts', parts_needed,
                'person', 'System',
                'date', COALESCE(date_time, NOW()::TEXT)
              )
            )::TEXT
          ELSE '[]'
        END
        WHERE (process = '[]' OR process IS NULL) AND parts_needed IS NOT NULL
        RETURNING id
      `);
      console.log(`✓ Migrated ${migrateResult.rowCount} records`);

      // Drop the old parts_needed column
      await pool.query(`
        ALTER TABLE repair_service DROP COLUMN parts_needed
      `);
      console.log('✓ Dropped parts_needed column');
    } else {
      console.log('✓ parts_needed column does not exist (already migrated)');
    }

    // Step 4: Ensure process column is never NULL
    await pool.query(`
      UPDATE repair_service 
      SET process = '[]' 
      WHERE process IS NULL
    `);
    console.log('✓ Ensured all process values are not NULL');

    return NextResponse.json({
      success: true,
      message: 'Migration completed successfully',
      partsNeededExists,
    });

  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({
      success: false,
      error: 'Migration failed',
      details: error.message,
    }, { status: 500 });
  }
}
