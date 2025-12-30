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
        console.log('Starting daily tasks migration...');

        // 1. Task Templates Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS task_templates (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                role VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('task_templates table created.');

        // 2. Daily Task Instances Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS daily_task_instances (
                id SERIAL PRIMARY KEY,
                template_id INTEGER REFERENCES task_templates(id) ON DELETE CASCADE,
                user_id VARCHAR(50) NOT NULL,
                role VARCHAR(50) NOT NULL,
                task_date DATE NOT NULL,
                completed BOOLEAN DEFAULT FALSE,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, template_id, task_date)
            );
        `);
        console.log('daily_task_instances table created.');

        // 3. Create index for faster lookups
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date 
            ON daily_task_instances(user_id, task_date);
        `);
        console.log('Index created.');

        // 4. Seed some default task templates (optional - can be managed via admin later)
        const templateCount = await client.query('SELECT COUNT(*) FROM task_templates');
        if (parseInt(templateCount.rows[0].count) === 0) {
            console.log('Seeding default task templates...');
            
            // Default packer tasks
            await client.query(`
                INSERT INTO task_templates (title, description, role) VALUES
                ('Check packing supplies', 'Verify tape, boxes, and labels are stocked', 'packer'),
                ('Review daily orders', 'Check assigned orders for the day', 'packer'),
                ('Verify order accuracy', 'Double-check items match order details', 'packer'),
                ('Print shipping labels', 'Generate and attach shipping labels', 'packer'),
                ('Update order status', 'Mark orders as packed in system', 'packer');
            `);

            // Default technician tasks
            await client.query(`
                INSERT INTO task_templates (title, description, role) VALUES
                ('Check equipment', 'Verify testing equipment is functional', 'technician'),
                ('Review assigned orders', 'Check orders requiring technician work', 'technician'),
                ('Test products', 'Perform quality checks on products', 'technician'),
                ('Record serial numbers', 'Log serial numbers for tracked items', 'technician'),
                ('Update order status', 'Mark orders as completed in system', 'technician');
            `);
            
            console.log('Default task templates seeded.');
        }

        console.log('Daily tasks migration completed successfully!');

    } catch (err) {
        console.error('Migration failed:', err);
        throw err;
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
