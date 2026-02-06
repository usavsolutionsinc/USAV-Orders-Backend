require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function test() {
    console.log('Testing database operations...');
    console.log('Database URL:', process.env.DATABASE_URL ? 'Set ✓' : 'NOT SET ✗');
    
    const client = await pool.connect();
    try {
        console.log('✓ Database connected');
        
        // Test TRUNCATE
        await client.query('BEGIN');
        console.log('✓ Transaction started');
        
        await client.query('TRUNCATE TABLE orders RESTART IDENTITY CASCADE');
        console.log('✓ Orders table truncated (in transaction)');
        
        await client.query('TRUNCATE TABLE packer_logs RESTART IDENTITY CASCADE');
        console.log('✓ Packer logs truncated (in transaction)');
        
        await client.query('TRUNCATE TABLE tech_serial_numbers RESTART IDENTITY CASCADE');
        console.log('✓ Tech serial numbers truncated (in transaction)');
        
        await client.query('ROLLBACK');
        console.log('✓ Transaction rolled back (no actual data deleted)');
        
        console.log('\n✅ All database tests passed!');
        console.log('The sync script should work correctly.');
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error('Full error:', err);
        await client.query('ROLLBACK');
    } finally {
        client.release();
        await pool.end();
    }
}

test();
