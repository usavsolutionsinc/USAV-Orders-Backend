import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? {
        rejectUnauthorized: false
    } : false,
    connectionTimeoutMillis: 4000,
    query_timeout: 8000,
    statement_timeout: 8000,
    idle_in_transaction_session_timeout: 8000,
    // Set timezone to PST for all database operations
    options: '-c timezone=America/Los_Angeles'
});

export default pool;
