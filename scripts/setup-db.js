const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function setup() {
    const client = await pool.connect();
    try {
        console.log('Creating tables...');

        // Orders Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        buyer_name VARCHAR(255),
        product_title TEXT,
        qty INTEGER,
        ship_by DATE,
        sku VARCHAR(100),
        shipping_speed VARCHAR(50),
        tracking_number VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Orders table created/verified.');

        // Shipped Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS shipped (
        id VARCHAR(50) PRIMARY KEY,
        order_id VARCHAR(50),
        shipped_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        carrier VARCHAR(50),
        tracking_number VARCHAR(100),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );
    `);
        console.log('Shipped table created/verified.');

        // Receiving Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS receiving (
        id SERIAL PRIMARY KEY,
        item_name VARCHAR(255),
        expected_qty INTEGER,
        received_qty INTEGER DEFAULT 0,
        supplier VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Pending',
        arrival_date DATE
      );
    `);
        console.log('Receiving table created/verified.');

        // Seed Data (Optional - only if empty)
        const orderCount = await client.query('SELECT COUNT(*) FROM orders');
        if (parseInt(orderCount.rows[0].count) === 0) {
            console.log('Seeding orders...');
            await client.query(`
            INSERT INTO orders (id, buyer_name, product_title, qty, ship_by, sku, shipping_speed, tracking_number)
            VALUES 
            ('ORD-1001', 'John Doe', 'Wireless Headphones', 1, '2023-12-01', 'WH-001', 'Standard', 'TRK123456'),
            ('ORD-1002', 'Jane Smith', 'Gaming Mouse', 2, '2023-12-02', 'GM-002', 'Express', 'TRK789012');
        `);
        }

    } catch (err) {
        console.error('Error setting up DB:', err);
    } finally {
        client.release();
        pool.end();
    }
}

setup();
