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
        console.log('Starting SKU table migration...');

        // Create skus table
        await client.query(`
            CREATE TABLE IF NOT EXISTS skus (
                sku VARCHAR(100) PRIMARY KEY,
                serial_numbers TEXT,
                notes TEXT
            );
        `);
        console.log('skus table created.');

        // Add index for faster lookup
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_skus_sku ON skus(sku);
        `);
        console.log('Index created.');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
