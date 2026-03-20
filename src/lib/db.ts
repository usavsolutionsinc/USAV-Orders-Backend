import { Pool } from 'pg';

function readPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

const connectionTimeoutMillis = readPositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10000);
const queryTimeoutMillis = readPositiveInt(process.env.PG_QUERY_TIMEOUT_MS, 30000);
const statementTimeoutMillis = readPositiveInt(process.env.PG_STATEMENT_TIMEOUT_MS, queryTimeoutMillis);
const idleTxTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TX_TIMEOUT_MS, 30000);
const poolMax = readPositiveInt(process.env.PG_POOL_MAX, 10);
const idleTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 30000);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? {
        rejectUnauthorized: false
    } : false,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
    idle_in_transaction_session_timeout: idleTxTimeoutMillis,
    max: poolMax,
    idleTimeoutMillis,
    // Set timezone to PST for all database operations
    options: '-c timezone=America/Los_Angeles'
});

export default pool;
