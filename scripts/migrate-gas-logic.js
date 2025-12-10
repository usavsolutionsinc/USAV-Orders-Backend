const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration...');

        // 1. SKU Stock Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS sku_stock (
                sku VARCHAR(100) PRIMARY KEY,
                quantity INTEGER DEFAULT 0,
                title TEXT,
                serial_numbers TEXT
            );
        `);
        console.log('sku_stock table created.');

        // 2. Technician Logs
        await client.query(`
            CREATE TABLE IF NOT EXISTS technician_logs (
                id SERIAL PRIMARY KEY,
                tech_id VARCHAR(50),
                tracking_number VARCHAR(100),
                action VARCHAR(50),
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('technician_logs table created.');

        // 3. Packer Logs
        await client.query(`
            CREATE TABLE IF NOT EXISTS packer_logs (
                id SERIAL PRIMARY KEY,
                packer_id VARCHAR(50),
                tracking_number VARCHAR(100),
                action VARCHAR(50),
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('packer_logs table created.');

        // 4. Receiving Logs
        await client.query(`
            CREATE TABLE IF NOT EXISTS receiving_logs (
                id SERIAL PRIMARY KEY,
                tracking_number VARCHAR(100),
                carrier VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('receiving_logs table created.');

        // 5. Alter Shipped Table (Add columns from GAS logic)
        // Check if columns exist first to avoid errors
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipped' AND column_name='serial_numbers') THEN
                    ALTER TABLE shipped ADD COLUMN serial_numbers TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipped' AND column_name='tech_name') THEN
                    ALTER TABLE shipped ADD COLUMN tech_name VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipped' AND column_name='status') THEN
                    ALTER TABLE shipped ADD COLUMN status VARCHAR(50);
                END IF;
            END
            $$;
        `);
        console.log('shipped table altered.');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
