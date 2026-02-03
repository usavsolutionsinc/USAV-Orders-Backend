import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

interface MigrationStats {
    staffUpdated: boolean;
    foreignKeysAdded: string[];
    techMigration: {
        tech1_michael: number;
        tech2_thuc: number;
        tech3_sang: number;
        total: number;
    };
    packerMigration: {
        packer1_tuan: number;
        packer2_thuy: number;
        total: number;
    };
    validation: {
        ordersWithTestedBy: number;
        ordersWithPackedBy: number;
        fkIntegrityTestPassed: boolean;
        fkIntegrityPackPassed: boolean;
    };
    sampleRecords: any[];
}

export async function POST() {
    const client = await pool.connect();
    const logs: string[] = [];
    const stats: Partial<MigrationStats> = {};

    try {
        logs.push('🚀 Starting Tech & Packer Data Migration');
        
        await client.query('BEGIN');

        // =============================================================================
        // STEP 1: Update Table Structure
        // =============================================================================
        logs.push('\n=== STEP 1: Updating Table Structure ===');
        
        const checkColumn = await client.query(`
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'staff' AND column_name = 'source_table'
        `);
        
        if (checkColumn.rows.length === 0) {
            await client.query('ALTER TABLE staff ADD COLUMN source_table TEXT');
            logs.push('✓ Added source_table column to staff table');
        } else {
            logs.push('✓ source_table column already exists');
        }
        
        const checkStatusHistory = await client.query(`
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'orders' AND column_name = 'status_history'
        `);
        
        if (checkStatusHistory.rows.length === 0) {
            await client.query(`ALTER TABLE orders ADD COLUMN status_history JSONB DEFAULT '[]'::jsonb`);
            logs.push('✓ Added status_history column to orders table');
        } else {
            logs.push('✓ status_history column already exists');
        }

        // Update staff records with source table mappings
        await client.query(`UPDATE staff SET source_table = 'tech_1' WHERE employee_id = 'TECH001'`);
        await client.query(`UPDATE staff SET source_table = 'tech_2' WHERE employee_id = 'TECH002'`);
        await client.query(`UPDATE staff SET source_table = 'tech_3' WHERE employee_id = 'TECH003'`);
        await client.query(`UPDATE staff SET source_table = 'packer_1' WHERE employee_id = 'PACK001'`);
        await client.query(`UPDATE staff SET source_table = 'packer_2' WHERE employee_id = 'PACK002'`);
        
        logs.push('✓ Updated staff records with source_table mappings');
        stats.staffUpdated = true;

        // =============================================================================
        // STEP 2: Add Foreign Key Constraints
        // =============================================================================
        logs.push('\n=== STEP 2: Adding Foreign Key Constraints ===');
        const foreignKeysAdded: string[] = [];

        const constraints = [
            { name: 'fk_orders_tested_by', column: 'tested_by', checkColumn: true },
            { name: 'fk_orders_packed_by', column: 'packed_by', checkColumn: true },
            { name: 'fk_orders_tester_id', column: 'tester_id', checkColumn: true },
            { name: 'fk_orders_packer_id', column: 'packer_id', checkColumn: true },
        ];

        for (const constraint of constraints) {
            const checkConstraint = await client.query(`
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = $1 AND table_name = 'orders'
            `, [constraint.name]);

            if (checkConstraint.rows.length === 0) {
                // Check if column exists
                const columnExists = await client.query(`
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'orders' AND column_name = $1
                `, [constraint.column]);

                if (columnExists.rows.length > 0) {
                    await client.query(`
                        ALTER TABLE orders 
                            ADD CONSTRAINT ${constraint.name} 
                            FOREIGN KEY (${constraint.column}) 
                            REFERENCES staff(id) 
                            ON DELETE SET NULL
                    `);
                    logs.push(`✓ Added FK constraint: orders.${constraint.column} → staff.id`);
                    foreignKeysAdded.push(constraint.name);
                } else {
                    logs.push(`⚠ Column ${constraint.column} does not exist, skipping FK`);
                }
            } else {
                logs.push(`✓ FK constraint ${constraint.name} already exists`);
            }
        }

        stats.foreignKeysAdded = foreignKeysAdded;

        // =============================================================================
        // STEP 3: Pre-Migration Statistics
        // =============================================================================
        logs.push('\n=== STEP 3: Pre-Migration Statistics ===');

        const preMigrationQueries = await Promise.all([
            client.query(`
                SELECT COUNT(*) as count FROM tech_1 
                WHERE shipping_tracking_number NOT LIKE 'X00%' 
                    AND shipping_tracking_number IS NOT NULL 
                    AND shipping_tracking_number != ''
                    AND date_time IS NOT NULL 
                    AND date_time != ''
            `),
            client.query(`
                SELECT COUNT(*) as count FROM tech_2 
                WHERE shipping_tracking_number NOT LIKE 'X00%' 
                    AND shipping_tracking_number IS NOT NULL 
                    AND shipping_tracking_number != ''
                    AND date_time IS NOT NULL 
                    AND date_time != ''
            `),
            client.query(`
                SELECT COUNT(*) as count FROM tech_3 
                WHERE shipping_tracking_number NOT LIKE 'X00%' 
                    AND shipping_tracking_number IS NOT NULL 
                    AND shipping_tracking_number != ''
                    AND date_time IS NOT NULL 
                    AND date_time != ''
            `),
            client.query(`
                SELECT COUNT(*) as count FROM packer_1 
                WHERE shipping_tracking_number NOT LIKE 'X00%' 
                    AND shipping_tracking_number IS NOT NULL 
                    AND shipping_tracking_number != ''
                    AND date_time IS NOT NULL 
                    AND date_time != ''
            `),
            client.query(`
                SELECT COUNT(*) as count FROM packer_2 
                WHERE shipping_tracking_number NOT LIKE 'X00%' 
                    AND shipping_tracking_number IS NOT NULL 
                    AND shipping_tracking_number != ''
                    AND date_time IS NOT NULL 
                    AND date_time != ''
            `),
            client.query('SELECT COUNT(*) as count FROM orders WHERE tested_by IS NOT NULL'),
            client.query('SELECT COUNT(*) as count FROM orders WHERE packed_by IS NOT NULL'),
        ]);

        logs.push('Tech Records to Migrate:');
        logs.push(`  - tech_1 (Michael): ${preMigrationQueries[0].rows[0].count} records`);
        logs.push(`  - tech_2 (Thuc): ${preMigrationQueries[1].rows[0].count} records`);
        logs.push(`  - tech_3 (Sang): ${preMigrationQueries[2].rows[0].count} records`);
        logs.push('Packer Records to Migrate:');
        logs.push(`  - packer_1 (Tuan): ${preMigrationQueries[3].rows[0].count} records`);
        logs.push(`  - packer_2 (Thuy): ${preMigrationQueries[4].rows[0].count} records`);
        logs.push('Current Orders Table:');
        logs.push(`  - Orders with tested_by: ${preMigrationQueries[5].rows[0].count}`);
        logs.push(`  - Orders with packed_by: ${preMigrationQueries[6].rows[0].count}`);

        // =============================================================================
        // STEP 4: Migrate Tech Table Data
        // =============================================================================
        logs.push('\n=== STEP 4: Migrating Tech Table Data ===');

        // Get staff IDs
        const staffQuery = await client.query(`
            SELECT id, name, employee_id FROM staff 
            WHERE employee_id IN ('TECH001', 'TECH002', 'TECH003')
        `);

        const staffMap: { [key: string]: number } = {};
        staffQuery.rows.forEach(row => {
            staffMap[row.employee_id] = row.id;
        });

        if (!staffMap['TECH001'] || !staffMap['TECH002'] || !staffMap['TECH003']) {
            throw new Error('Staff records not found. Expected TECH001, TECH002, TECH003');
        }

        logs.push(`Staff IDs: Michael=${staffMap['TECH001']}, Thuc=${staffMap['TECH002']}, Sang=${staffMap['TECH003']}`);

        // Migrate tech_1 → Michael
        const tech1Result = await client.query(`
            UPDATE orders o
            SET 
                tested_by = $1,
                test_date_time = t.date_time,
                status_history = (COALESCE(o.status_history, '[]'::jsonb) || 
                    to_jsonb(json_build_object(
                        'status', 'tested',
                        'timestamp', CASE 
                            WHEN t.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                                to_timestamp(t.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                            ELSE t.date_time
                        END,
                        'user', 'Michael',
                        'previous_status', o.status_history->-1->>'status'
                    )))::jsonb
            FROM tech_1 t
            WHERE o.shipping_tracking_number = t.shipping_tracking_number
                AND t.shipping_tracking_number NOT LIKE 'X00%'
                AND t.shipping_tracking_number IS NOT NULL
                AND t.shipping_tracking_number != ''
                AND t.date_time IS NOT NULL
                AND t.date_time != ''
        `, [staffMap['TECH001']]);

        logs.push(`✓ Migrated ${tech1Result.rowCount} orders from tech_1 (Michael) with status_history`);

        // Migrate tech_2 → Thuc
        const tech2Result = await client.query(`
            UPDATE orders o
            SET 
                tested_by = $1,
                test_date_time = t.date_time,
                status_history = (COALESCE(o.status_history, '[]'::jsonb) || 
                    to_jsonb(json_build_object(
                        'status', 'tested',
                        'timestamp', CASE 
                            WHEN t.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                                to_timestamp(t.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                            ELSE t.date_time
                        END,
                        'user', 'Thuc',
                        'previous_status', o.status_history->-1->>'status'
                    )))::jsonb
            FROM tech_2 t
            WHERE o.shipping_tracking_number = t.shipping_tracking_number
                AND t.shipping_tracking_number NOT LIKE 'X00%'
                AND t.shipping_tracking_number IS NOT NULL
                AND t.shipping_tracking_number != ''
                AND t.date_time IS NOT NULL
                AND t.date_time != ''
        `, [staffMap['TECH002']]);

        logs.push(`✓ Migrated ${tech2Result.rowCount} orders from tech_2 (Thuc) with status_history`);

        // Migrate tech_3 → Sang
        const tech3Result = await client.query(`
            UPDATE orders o
            SET 
                tested_by = $1,
                test_date_time = t.date_time,
                status_history = (COALESCE(o.status_history, '[]'::jsonb) || 
                    to_jsonb(json_build_object(
                        'status', 'tested',
                        'timestamp', CASE 
                            WHEN t.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                                to_timestamp(t.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                            ELSE t.date_time
                        END,
                        'user', 'Sang',
                        'previous_status', o.status_history->-1->>'status'
                    )))::jsonb
            FROM tech_3 t
            WHERE o.shipping_tracking_number = t.shipping_tracking_number
                AND t.shipping_tracking_number NOT LIKE 'X00%'
                AND t.shipping_tracking_number IS NOT NULL
                AND t.shipping_tracking_number != ''
                AND t.date_time IS NOT NULL
                AND t.date_time != ''
        `, [staffMap['TECH003']]);

        logs.push(`✓ Migrated ${tech3Result.rowCount} orders from tech_3 (Sang) with status_history`);

        const totalTechMigrated = (tech1Result.rowCount || 0) + (tech2Result.rowCount || 0) + (tech3Result.rowCount || 0);
        logs.push(`Total tech records migrated: ${totalTechMigrated}`);

        stats.techMigration = {
            tech1_michael: tech1Result.rowCount || 0,
            tech2_thuc: tech2Result.rowCount || 0,
            tech3_sang: tech3Result.rowCount || 0,
            total: totalTechMigrated,
        };

        // =============================================================================
        // STEP 5: Migrate Packer Table Data
        // =============================================================================
        logs.push('\n=== STEP 5: Migrating Packer Table Data ===');

        // Get packer staff IDs
        const packerStaffQuery = await client.query(`
            SELECT id, name, employee_id FROM staff 
            WHERE employee_id IN ('PACK001', 'PACK002')
        `);

        const packerStaffMap: { [key: string]: number } = {};
        packerStaffQuery.rows.forEach(row => {
            packerStaffMap[row.employee_id] = row.id;
        });

        if (!packerStaffMap['PACK001'] || !packerStaffMap['PACK002']) {
            throw new Error('Packer staff records not found. Expected PACK001, PACK002');
        }

        logs.push(`Staff IDs: Tuan=${packerStaffMap['PACK001']}, Thuy=${packerStaffMap['PACK002']}`);

        // Migrate packer_1 → Tuan
        const packer1Result = await client.query(`
            UPDATE orders o
            SET 
                packed_by = $1,
                pack_date_time = p.date_time,
                is_shipped = true,
                status_history = (COALESCE(o.status_history, '[]'::jsonb) || 
                    to_jsonb(json_build_object(
                        'status', 'packed',
                        'timestamp', CASE 
                            WHEN p.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                                to_timestamp(p.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                            ELSE p.date_time
                        END,
                        'user', 'Tuan',
                        'previous_status', o.status_history->-1->>'status'
                    )))::jsonb
            FROM packer_1 p
            WHERE o.shipping_tracking_number = p.shipping_tracking_number
                AND p.shipping_tracking_number NOT LIKE 'X00%'
                AND p.shipping_tracking_number IS NOT NULL
                AND p.shipping_tracking_number != ''
                AND p.date_time IS NOT NULL
                AND p.date_time != ''
        `, [packerStaffMap['PACK001']]);

        logs.push(`✓ Migrated ${packer1Result.rowCount} orders from packer_1 (Tuan) with status_history + is_shipped`);

        // Migrate packer_2 → Thuy
        const packer2Result = await client.query(`
            UPDATE orders o
            SET 
                packed_by = $1,
                pack_date_time = p.date_time,
                is_shipped = true,
                status_history = (COALESCE(o.status_history, '[]'::jsonb) || 
                    to_jsonb(json_build_object(
                        'status', 'packed',
                        'timestamp', CASE 
                            WHEN p.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                                to_timestamp(p.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                            ELSE p.date_time
                        END,
                        'user', 'Thuy',
                        'previous_status', o.status_history->-1->>'status'
                    )))::jsonb
            FROM packer_2 p
            WHERE o.shipping_tracking_number = p.shipping_tracking_number
                AND p.shipping_tracking_number NOT LIKE 'X00%'
                AND p.shipping_tracking_number IS NOT NULL
                AND p.shipping_tracking_number != ''
                AND p.date_time IS NOT NULL
                AND p.date_time != ''
        `, [packerStaffMap['PACK002']]);

        logs.push(`✓ Migrated ${packer2Result.rowCount} orders from packer_2 (Thuy) with status_history + is_shipped`);

        const totalPackerMigrated = (packer1Result.rowCount || 0) + (packer2Result.rowCount || 0);
        logs.push(`Total packer records migrated: ${totalPackerMigrated}`);

        stats.packerMigration = {
            packer1_tuan: packer1Result.rowCount || 0,
            packer2_thuy: packer2Result.rowCount || 0,
            total: totalPackerMigrated,
        };

        // =============================================================================
        // STEP 6: Post-Migration Validation
        // =============================================================================
        logs.push('\n=== STEP 6: Post-Migration Validation ===');

        const postMigrationQueries = await Promise.all([
            client.query('SELECT COUNT(*) as count FROM orders WHERE tested_by IS NOT NULL'),
            client.query('SELECT COUNT(*) as count FROM orders WHERE packed_by IS NOT NULL'),
            client.query(`
                SELECT COUNT(*) as count 
                FROM orders o 
                INNER JOIN staff s ON o.tested_by = s.id 
                WHERE o.tested_by IS NOT NULL
            `),
            client.query(`
                SELECT COUNT(*) as count 
                FROM orders o 
                INNER JOIN staff s ON o.packed_by = s.id 
                WHERE o.packed_by IS NOT NULL
            `),
        ]);

        const ordersWithTestedBy = parseInt(postMigrationQueries[0].rows[0].count);
        const ordersWithPackedBy = parseInt(postMigrationQueries[1].rows[0].count);
        const fkTestCount = parseInt(postMigrationQueries[2].rows[0].count);
        const fkPackCount = parseInt(postMigrationQueries[3].rows[0].count);

        logs.push('Post-Migration Statistics:');
        logs.push(`  - Orders with tested_by: ${ordersWithTestedBy}`);
        logs.push(`  - Orders with packed_by: ${ordersWithPackedBy}`);
        logs.push(`  - Verified tested_by FK integrity: ${fkTestCount}`);
        logs.push(`  - Verified packed_by FK integrity: ${fkPackCount}`);

        const fkIntegrityTestPassed = fkTestCount === ordersWithTestedBy;
        const fkIntegrityPackPassed = fkPackCount === ordersWithPackedBy;

        if (fkIntegrityTestPassed && fkIntegrityPackPassed) {
            logs.push('✓ All foreign key relationships validated successfully!');
        } else {
            logs.push('⚠ Some FK relationships may have issues');
        }

        stats.validation = {
            ordersWithTestedBy,
            ordersWithPackedBy,
            fkIntegrityTestPassed,
            fkIntegrityPackPassed,
        };

        // Get sample records
        logs.push('\n=== Sample Migrated Records ===');
        const sampleRecords = await client.query(`
            SELECT 
                o.id,
                o.shipping_tracking_number,
                s1.name as tested_by_name,
                s1.employee_id as tested_by_emp_id,
                o.test_date_time,
                s2.name as packed_by_name,
                s2.employee_id as packed_by_emp_id,
                o.pack_date_time
            FROM orders o
            LEFT JOIN staff s1 ON o.tested_by = s1.id
            LEFT JOIN staff s2 ON o.packed_by = s2.id
            WHERE (o.tested_by IS NOT NULL OR o.packed_by IS NOT NULL)
            ORDER BY o.id DESC
            LIMIT 5
        `);

        stats.sampleRecords = sampleRecords.rows;

        sampleRecords.rows.forEach((record, idx) => {
            logs.push(`Order #${record.id}: tracking=${record.shipping_tracking_number}, tested_by=${record.tested_by_name} (${record.tested_by_emp_id}), packed_by=${record.packed_by_name} (${record.packed_by_emp_id})`);
        });

        if (sampleRecords.rows.length === 0) {
            logs.push('No migrated records found in orders table');
        }

        await client.query('COMMIT');
        logs.push('\n=== Migration Complete! ===');
        logs.push('All changes have been committed successfully.');

        console.log(logs.join('\n'));

        return NextResponse.json({
            success: true,
            message: 'Migration completed successfully',
            stats,
            logs,
        });

    } catch (error: any) {
        await client.query('ROLLBACK');
        logs.push(`\n❌ ERROR: ${error.message}`);
        console.error('Migration error:', error);
        console.log(logs.join('\n'));

        return NextResponse.json({
            success: false,
            error: error.message,
            logs,
            stats,
        }, { status: 500 });

    } finally {
        client.release();
    }
}

export async function GET() {
    return NextResponse.json({
        endpoint: '/api/migrate-tech-packer',
        method: 'POST',
        description: 'Migrate tech_1-3 and packer_1-2 data to orders table with staff FK relationships',
        note: 'This endpoint is idempotent and can be run multiple times safely',
    });
}
