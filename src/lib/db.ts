// Dual-driver pool:
//   - dev (Node, long-running): standard `pg` over TCP. Persistent connections,
//     no per-query WebSocket handshake, survives a busy event loop.
//   - prod (Vercel serverless): `@neondatabase/serverless` over WebSocket so
//     Neon compute can sleep between requests.
//
// Same `pool.query()` / `pool.connect()` API for callers — drivers are
// interface-compatible for our usage.
import { Pool as NeonPool } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';

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

const isDev = process.env.NODE_ENV !== 'production';

const connectionTimeoutMillis = readPositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10000);
const queryTimeoutMillis = readPositiveInt(process.env.PG_QUERY_TIMEOUT_MS, 30000);
const idleTxTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TX_TIMEOUT_MS, 30000);
// Dev with persistent TCP pg can afford more concurrency; serverless WS keeps it small.
const poolMax = readPositiveInt(process.env.PG_POOL_MAX, isDev ? 10 : 3);
const idleTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TIMEOUT_MS, isDev ? 30000 : 10000);

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/postgres';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any;

if (isDev) {
    pool = new PgPool({
        connectionString,
        connectionTimeoutMillis,
        query_timeout: queryTimeoutMillis,
        idle_in_transaction_session_timeout: idleTxTimeoutMillis,
        max: poolMax,
        idleTimeoutMillis,
        // Neon requires SSL; pg parses sslmode=require from the URL but be explicit.
        ssl: { rejectUnauthorized: false },
        // Set timezone to PST for all database operations
        options: '-c timezone=America/Los_Angeles',
    });
} else {
    pool = new NeonPool({
        connectionString,
        connectionTimeoutMillis,
        query_timeout: queryTimeoutMillis,
        idle_in_transaction_session_timeout: idleTxTimeoutMillis,
        max: poolMax,
        idleTimeoutMillis,
        options: '-c timezone=America/Los_Angeles',
    });
}

export default pool;
