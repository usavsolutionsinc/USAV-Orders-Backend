// Use @neondatabase/serverless instead of pg — HTTP/WebSocket transport lets
// Neon compute sleep between requests, dramatically reducing CU-hr consumption.
import { Pool } from '@neondatabase/serverless';

// Load .env when running outside the Next.js runtime (e.g. standalone scripts).
// Next.js automatically loads .env/.env.local during dev/build, so this is a no-op there.
if (!process.env.NEXT_RUNTIME) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch { /* dotenv optional for non-script contexts */ }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

const connectionTimeoutMillis = readPositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10000);
const queryTimeoutMillis = readPositiveInt(process.env.PG_QUERY_TIMEOUT_MS, 30000);
const idleTxTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TX_TIMEOUT_MS, 30000);
// Serverless: small pool — connections are short-lived WebSockets, not persistent TCP
const poolMax = readPositiveInt(process.env.PG_POOL_MAX, 3);
const idleTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 10000);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    idle_in_transaction_session_timeout: idleTxTimeoutMillis,
    max: poolMax,
    idleTimeoutMillis,
    // Set timezone to PST for all database operations
    options: '-c timezone=America/Los_Angeles',
});

export default pool;
